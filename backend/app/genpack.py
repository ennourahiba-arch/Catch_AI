"""Turns uploaded course material into exam-style practice questions, for any subject.

Trust model (there is no SymPy for history or biology, so it's layered):
  1. Grounding: every question cites a passage id and quotes it. We check
     deterministically that the quote really appears in that passage (ignoring
     spacing and punctuation). Anything fabricated is dropped.
  2. Independent check: a second AI call, which did not write the questions,
     reviews each one against its cited passage (the marked answer is right and
     the only right one; the model answer is correct). Failures are dropped.
  3. Humans: professors approve each question before it reaches a class quiz.
Questions are labelled "generated from your document and checked against it",
never "verified".
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from . import llm

Format = Literal["quiz", "written", "oral"]
LETTERS = "ABCD"


# --- grounding ---------------------------------------------------------------

def _norm(s: str) -> str:
    return re.sub(r"[^0-9a-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u0600-\u06ff]+", "", s.lower())


def quote_found(quote: str, passage_text: str) -> bool:
    q = _norm(quote)
    return len(q) >= 12 and q in _norm(passage_text)


def material_block(passages: list[dict[str, Any]]) -> str:
    return "<<<MATERIAL\n" + "\n\n".join(f"[{p['id']}] ({p['file']})\n{p['text']}" for p in passages) + "\nMATERIAL>>>"


# --- expected AI output --------------------------------------------------------

class Cited(BaseModel):
    source_id: str = Field(max_length=12)
    quote: str = Field(min_length=12, max_length=400)


class MCQ(Cited):
    question: str = Field(min_length=5, max_length=800)
    options: list[str] = Field(min_length=4, max_length=4)
    correct: int = Field(ge=0, le=3)
    explanation: str = Field(default="", max_length=1000)
    wrong_reasons: list[str | None] = Field(default_factory=list, max_length=4)
    hint: str = Field(default="", max_length=400)
    difficulty: int = Field(default=2, ge=1, le=3)


class Open(Cited):
    question: str = Field(min_length=5, max_length=800)
    key_points: list[str] = Field(min_length=1, max_length=6)
    model_answer: str = Field(min_length=10, max_length=2500)
    hint: str = Field(default="", max_length=400)
    difficulty: int = Field(default=2, ge=1, le=3)


class GenerationError(Exception):
    pass


# --- prompts --------------------------------------------------------------------

SYSTEM = (
    "You write exam practice questions for university students from THEIR course material. "
    "Use only facts stated in the MATERIAL. Write in the same language as the MATERIAL. "
    "Every question must cite a passage id like P3 in source_id and copy a short exact quote (12 to 200 characters) "
    "from that passage into quote, character for character. Never invent sources. Return only JSON."
)


def _style(past: str) -> str:
    if not past.strip():
        return "\n\nNo past exams were provided: write questions typical of a university exam on this material."
    return ("\n\nPAST EXAMS (follow their question types, wording, difficulty and level of detail as closely as possible, "
            "but take every fact from the MATERIAL, never from these):\n<<<PAST\n" + past + "\nPAST>>>")


PROFILE = ('"exam_profile": {"question_types": ["e.g. multiple choice", "short answer"], "duration_minutes": null, '
           '"number_of_questions": null, "notes": "one sentence on the exam style"}')


def prompt(fmt: Format, passages: list[dict[str, Any]], past: str, n: int) -> str:
    if fmt == "quiz":
        task = f"""TASK: generate_quiz
Write {n} multiple-choice exam questions. Each has exactly 4 options and ONE correct option (index 0-3).
Wrong options must be tempting mistakes real students make; for each option give in wrong_reasons a short label of the
misconception behind it (null for the correct option). Add an explanation of the right answer, a hint that helps without
giving it away, and difficulty 1-3. Vary topics across the material.
JSON: {{"title": "short title", {PROFILE}, "questions": [{{"question": "", "options": ["", "", "", ""], "correct": 0,
"wrong_reasons": [null, "", "", ""], "explanation": "", "hint": "", "difficulty": 2, "source_id": "P1", "quote": ""}}]}}"""
    else:
        kind = "written exam questions" if fmt == "written" else "oral exam questions an examiner would ask aloud"
        task = f"""TASK: generate_{fmt}
Write {n} {kind}. Each has key_points (2-5 things a full-marks answer must contain), a model_answer, a hint that helps
without giving the answer away, and difficulty 1-3. Vary topics across the material.
JSON: {{"title": "short title", {PROFILE}, "questions": [{{"question": "", "key_points": [""], "model_answer": "",
"hint": "", "difficulty": 2, "source_id": "P1", "quote": ""}}]}}"""
    return f"{task}\n\n{material_block(passages)}{_style(past)}"


CHECK_SYSTEM = (
    "You are a strict, independent exam reviewer. You did not write these questions. Judge each ONLY against its cited "
    "MATERIAL passage. Mark ok=false if anything is unsupported or ambiguous, or if more than one option could be correct. "
    "Return only JSON."
)


async def independent_check(items: list[dict[str, Any]], passages: list[dict[str, Any]]) -> set[str]:
    if not items:
        return set()
    cited = {c for it in items for c in it["cites"]}
    user = f"""TASK: check_items
For each item, verify every statement in "must_hold" against the cited passages.
Return {{"results":[{{"id":"","ok":true,"reason":"short reason"}}]}} with one result per item.

ITEMS:
{json.dumps([{k: v for k, v in it.items() if k != 'cites'} for it in items], ensure_ascii=False)}

{material_block([p for p in passages if p['id'] in cited])}"""
    data = await llm.complete_json(CHECK_SYSTEM, user, temperature=0.0, max_tokens=16000)
    results = data.get("results", []) if isinstance(data, dict) else []
    return {str(r.get("id")) for r in results if isinstance(r, dict) and r.get("ok") is True}


# --- assembly ---------------------------------------------------------------------

def _profile(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    types = [str(t)[:60] for t in raw.get("question_types", []) if isinstance(t, (str, int))][:6]
    dur = raw.get("duration_minutes")
    num = raw.get("number_of_questions")
    return {"question_types": types,
            "duration_minutes": dur if isinstance(dur, int) and 5 <= dur <= 600 else None,
            "number_of_questions": num if isinstance(num, int) and 1 <= num <= 200 else None,
            "notes": str(raw.get("notes", ""))[:300]}


async def generate(fmt: Format, passages: list[dict[str, Any]], past: str, n: int) -> dict[str, Any]:
    by_id = {p["id"]: p for p in passages}
    pack_id = "u-" + uuid.uuid4().hex[:10]
    data = await llm.complete_json(SYSTEM, prompt(fmt, passages, past, n), temperature=0.5, max_tokens=32000)
    if not isinstance(data, dict):
        raise GenerationError("The AI's reply wasn't usable. Try again.")
    title = str(data.get("title") or "My course").strip()[:80]
    dropped: list[str] = []
    model = MCQ if fmt == "quiz" else Open

    parsed = []
    for i, raw in enumerate(data.get("questions", []) if isinstance(data.get("questions"), list) else []):
        try:
            item = model.model_validate(raw)
        except ValidationError:
            dropped.append(f"question {i + 1}: malformed"); continue
        p = by_id.get(item.source_id)
        if not p or not quote_found(item.quote, p["text"]):
            dropped.append(f"question {i + 1}: its quote wasn't found in the cited passage"); continue
        if isinstance(item, MCQ) and len({o.strip().lower() for o in item.options}) < 4:
            dropped.append(f"question {i + 1}: duplicate options"); continue
        parsed.append(item)

    if fmt == "quiz":
        items = [{"id": f"q{i}", "cites": [q.source_id],
                  "must_hold": [f"'{q.question}': option '{q.options[q.correct]}' is correct and is the only correct option among {q.options}."]}
                 for i, q in enumerate(parsed)]
    else:
        items = [{"id": f"q{i}", "cites": [q.source_id],
                  "must_hold": [f"This model answer to '{q.question}' is correct: '{q.model_answer}'",
                                f"These key points are all correct: {q.key_points}"]}
                 for i, q in enumerate(parsed)]
    approved = await independent_check(items, passages)

    st = llm.status()
    who = "a simulated AI (test mode)" if st["test_mode"] else st["model"]
    exercises = []
    for i, q in enumerate(parsed):
        if f"q{i}" not in approved:
            dropped.append(f"question {i + 1}: rejected by the independent review"); continue
        src = by_id[q.source_id]["file"]
        base = {"id": f"{pack_id}-q{len(exercises) + 1}", "topic": pack_id, "difficulty": q.difficulty,
                "prompt": q.question, "latex": "", "answer_latex": "", "source_ids": [q.source_id],
                "hint": q.hint or "Re-read the part of your course this question is about.",
                "provenance": f"Generated by {who} from your document and checked against it."}
        if isinstance(q, MCQ):
            labels = (q.wrong_reasons + [None] * 4)[:4]
            labels[q.correct] = None
            exercises.append({**base, "options": q.options, "answer": {"kind": "mcq", "correct": q.correct},
                              "labels": labels, "answer_text": f"{LETTERS[q.correct]}) {q.options[q.correct]}",
                              "input_help": "Choose one answer.",
                              "solution": [{"text": q.explanation or f"The answer is {LETTERS[q.correct]}.", "latex": "",
                                            "quote": q.quote, "source": src}]})
        else:
            exercises.append({**base, "answer": {"kind": "open", "key_points": q.key_points, "model_answer": q.model_answer},
                              "answer_text": q.model_answer,
                              "input_help": "Answer as you would in the exam." if fmt == "written" else "Answer as you would out loud.",
                              "solution": [{"text": q.model_answer, "latex": "", "quote": q.quote, "source": src}]})
    if not exercises:
        raise GenerationError("None of the generated questions passed the checks against your document. Try again, or upload more detailed material.")
    return {
        "id": pack_id, "version": 2, "title": title, "format": fmt,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "generator": {"provider": llm.provider(), "model": llm.model(), "test_mode": st["test_mode"]},
        "exercises": exercises, "exam_profile": _profile(data.get("exam_profile")), "dropped": dropped,
    }
