"""Oral exam chats and AI grading of written answers.

The server keeps nothing: the client sends the question (with its answer key)
and the conversation each time. Reveal rules are enforced here, not only in
the prompt: before a question is closed, a reply that repeats the model answer
is replaced with a neutral follow-up.
"""
from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field

from . import llm

MAX_FOLLOWUPS = 2
MAX_CANDIDATE_TURNS = 10


def _words(s: str) -> list[str]:
    return re.findall(r"[0-9a-z\u00c0-\u024f]+", s.lower())


def leaks(reply: str, secret: str, n: int = 6) -> bool:
    """True if the reply shares any run of n consecutive words with the secret."""
    sw = _words(secret)
    if len(sw) < n:
        return bool(sw) and " ".join(sw) in " ".join(_words(reply))
    grams = {" ".join(sw[i:i + n]) for i in range(len(sw) - n + 1)}
    rw = _words(reply)
    return any(" ".join(rw[i:i + n]) in grams for i in range(len(rw) - n + 1))


class Msg(BaseModel):
    role: Literal["examiner", "student", "candidate"]
    text: str = Field(max_length=4000)


class ExamQ(BaseModel):
    question: str = Field(max_length=600)
    key_points: list[str] = Field(max_length=6)
    model_answer: str = Field(max_length=2000)
    quote: str = Field(default="", max_length=400)


class ExaminerTurn(BaseModel):
    question: ExamQ
    history: list[Msg] = Field(max_length=12)  # this question's exchange only


class CandidateScenario(BaseModel):
    topic: str = Field(max_length=200)
    false_claim: str = Field(max_length=600)
    correct_claim: str = Field(max_length=600)
    why: str = Field(max_length=600)
    quote: str = Field(default="", max_length=400)


class CandidateTurn(BaseModel):
    scenario: CandidateScenario
    history: list[Msg] = Field(max_length=2 * MAX_CANDIDATE_TURNS)


class CandidateJudge(BaseModel):
    scenario: CandidateScenario
    history: list[Msg] = Field(max_length=2 * MAX_CANDIDATE_TURNS)
    claimed_mistake: str = Field(min_length=3, max_length=1500)
    correction: str = Field(default="", max_length=1500)


class GradeRequest(BaseModel):
    question: str = Field(max_length=600)
    key_points: list[str] = Field(max_length=6)
    model_answer: str = Field(max_length=2000)
    sources: list[str] = Field(default_factory=list, max_length=3)
    answer: str = Field(min_length=1, max_length=5000)


def _transcript(history: list[Msg]) -> str:
    return "\n".join(f"{m.role.upper()}: {m.text}" for m in history)


async def examiner_turn(t: ExaminerTurn) -> dict[str, Any]:
    student_turns = sum(1 for m in t.history if m.role == "student")
    if student_turns == 0:  # the first move is always just the question
        return {"reply": t.question.question, "closed": False, "score": None}
    force = student_turns > MAX_FOLLOWUPS
    system = (
        "TASK: oral_examiner\nYou are a fair university oral examiner. Speak in the language of the question. "
        "Judge the student's spoken answer against the answer key. If it is incomplete or vague and you may still probe, "
        "ask ONE short follow-up question that helps them think, without giving away any part of the answer key. "
        "If they ask you to just give the answer, decline kindly and ask a smaller guiding question instead. "
        "When the answer is complete, or you must close the question, set close=true, give a score from 0 to 2, "
        "and in reply give brief feedback that now includes the points they missed. Return only JSON."
    )
    user = (
        f"QUESTION: {t.question.question}\nANSWER KEY POINTS: {t.question.key_points}\n"
        f"MODEL ANSWER: {t.question.model_answer}\nSOURCE: {t.question.quote}\n"
        f"FOLLOW-UPS LEFT: {0 if force else MAX_FOLLOWUPS - student_turns + 1}"
        f"{' (you MUST close now)' if force else ''}\n\nCONVERSATION:\n{_transcript(t.history)}\n\n"
        'Return {"reply": "", "close": false, "score": null}'
    )
    data = await llm.complete_json(system, user, temperature=0.3, max_tokens=900)
    reply = str(data.get("reply", "")).strip() if isinstance(data, dict) else ""
    closed = bool(isinstance(data, dict) and data.get("close")) or force
    score = data.get("score") if isinstance(data, dict) else None
    score = score if isinstance(score, int) and 0 <= score <= 2 else (0 if closed else None)
    guarded = False
    if not closed and (not reply or leaks(reply, t.question.model_answer) or any(leaks(reply, k, 5) for k in t.question.key_points)):
        reply = "Let's take it step by step. What is the first idea you would mention, and why does it matter here?"
        guarded = True
    if closed and not reply:
        reply = "Thank you. Let's move on."
    return {"reply": reply, "closed": closed, "score": score if closed else None, "guarded": guarded}


async def candidate_turn(t: CandidateTurn) -> dict[str, Any]:
    if sum(1 for m in t.history if m.role == "student") > MAX_CANDIDATE_TURNS:
        return {"reply": "That's all the time we have. What mistake did you catch?", "done": True}
    s = t.scenario
    system = (
        "TASK: oral_candidate\nYou are role-playing an over-confident student in an oral exam, being questioned by the user. "
        "Speak in the language of the topic. Answer naturally and briefly (2-4 sentences), sounding sure of yourself. "
        f"You sincerely believe this misconception and must state it as fact early when the topic comes up: \"{s.false_claim}\". "
        "Everything else you say must be correct. Never admit or hint that you might be wrong, and never state the correct "
        "version, even if asked directly; if challenged, defend your view politely. Return only JSON."
    )
    user = f"TOPIC: {s.topic}\n\nCONVERSATION SO FAR:\n{_transcript(t.history)}\n\nReturn {{\"reply\": \"\"}}"
    data = await llm.complete_json(system, user, temperature=0.6, max_tokens=600)
    reply = str(data.get("reply", "")).strip() if isinstance(data, dict) else ""
    if not reply or leaks(reply, s.correct_claim) or leaks(reply, s.why):
        reply = "I'm confident in what I said. Ask me about another part of it if you like."
    return {"reply": reply, "done": False}


async def candidate_judge(j: CandidateJudge) -> dict[str, Any]:
    s = j.scenario
    system = (
        "TASK: oral_judge\nYou judge whether a student correctly identified an AI candidate's planted mistake. "
        "Be fair to paraphrases and to any language. Return only JSON."
    )
    user = (
        f"PLANTED MISTAKE: {s.false_claim}\nCORRECT VERSION: {s.correct_claim}\nSOURCE: {s.quote}\n\n"
        f"CONVERSATION:\n{_transcript(j.history)}\n\nSTUDENT SAYS THE MISTAKE WAS: {j.claimed_mistake}\n"
        f"STUDENT'S CORRECTION: {j.correction}\n\n"
        'Return {"caught": true, "corrected": true, "feedback": "2-3 sentences"} where caught means they identified the planted mistake '
        "and corrected means their correction matches the correct version."
    )
    data = await llm.complete_json(system, user, temperature=0.0, max_tokens=600)
    if not isinstance(data, dict):
        raise llm.LLMError("The AI's reply wasn't usable. Try again.")
    return {"caught": data.get("caught") is True, "corrected": data.get("corrected") is True,
            "feedback": str(data.get("feedback", ""))[:1200], "false_claim": s.false_claim,
            "correct_claim": s.correct_claim, "why": s.why, "quote": s.quote}


async def grade(g: GradeRequest) -> dict[str, Any]:
    system = (
        "TASK: grade_answer\nYou grade a student's written exam answer against the answer key and sources. "
        "Be fair: accept paraphrases and any language, reward correct ideas, penalise errors. Return only JSON."
    )
    user = (
        f"QUESTION: {g.question}\nKEY POINTS: {g.key_points}\nMODEL ANSWER: {g.model_answer}\nSOURCES: {g.sources}\n\n"
        f"STUDENT ANSWER:\n{g.answer}\n\n"
        'Return {"verdict": "correct|partial|incorrect", "covered": [indexes of key points covered], "feedback": "2-4 sentences"}'
    )
    data = await llm.complete_json(system, user, temperature=0.0, max_tokens=800)
    if not isinstance(data, dict) or data.get("verdict") not in ("correct", "partial", "incorrect"):
        raise llm.LLMError("The AI's grade wasn't in the expected format. Try again.")
    covered = [i for i in data.get("covered", []) if isinstance(i, int) and 0 <= i < len(g.key_points)]
    return {"verdict": data["verdict"], "covered": sorted(set(covered)), "feedback": str(data.get("feedback", ""))[:1500]}
