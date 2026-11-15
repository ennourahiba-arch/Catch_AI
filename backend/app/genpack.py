"""Turns uploaded course material into Catch the AI rounds for any subject.

Trust model (there is no SymPy for history or biology, so it's layered):
  1. Grounding: every question, step and claim must cite a passage id and quote
     it. We check deterministically that the quote really appears in that
     passage (ignoring spacing and punctuation). Anything fabricated is dropped.
  2. Independent check: a second AI call, which did not write the items, checks
     each one against the cited passages (correct answer supported, planted
     mistake really contradicts the source, nothing ambiguous). Failures are dropped.
  3. Humans: professors approve each round before it reaches a class game.
Rounds are labelled "generated from your document and checked against it",
never "verified".
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from . import llm

Format = Literal["quiz", "written", "oral"]
LETTERS = "ABCD"


# ---------------------------------------------------------------------------
# Grounding
# ---------------------------------------------------------------------------

def _norm(s: str) -> str:
    return re.sub(r"[^0-9a-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u0600-\u06ff]+", "", s.lower())


def quote_found(quote: str, passage_text: str) -> bool:
    q = _norm(quote)
    return len(q) >= 12 and q in _norm(passage_text)


def material_block(passages: list[dict[str, Any]]) -> str:
    return "<<<MATERIAL\n" + "\n\n".join(f"[{p['id']}] ({p['file']})\n{p['text']}" for p in passages) + "\nMATERIAL>>>"


# ---------------------------------------------------------------------------
# Expected AI output shapes
# ---------------------------------------------------------------------------

class Cited(BaseModel):
    source_id: str = Field(max_length=12)
    quote: str = Field(min_length=12, max_length=400)


class MCQ(Cited):
    question: str = Field(min_length=5, max_length=600)
    options: list[str] = Field(min_length=4, max_length=4)
    correct: int = Field(ge=0, le=3)
    explanation: str = Field(default="", max_length=800)


class AIAnswer(BaseModel):
    choice: int = Field(ge=0, le=3)
    justification: str = Field(max_length=600)


class Why(BaseModel):
    id: str = Field(max_length=12)
    label: str = Field(min_length=3, max_length=160)


class QuizRound(BaseModel):
    questions: list[MCQ] = Field(min_length=4, max_length=4)
    ai_answers: list[AIAnswer] = Field(min_length=4, max_length=4)
    fully_correct: bool
    wrong_question: int | None = None
    why_options: list[Why] = Field(default_factory=list, max_length=4)
    correct_why: str | None = None
    hints: list[str] = Field(min_length=3, max_length=3)
    key_lesson: str = Field(max_length=500)


class Paragraph(Cited):
    text: str = Field(min_length=10, max_length=1500)


class Fix(BaseModel):
    text: str = Field(min_length=5, max_length=1500)


class WrittenRound(BaseModel):
    exam_question: str = Field(min_length=5, max_length=600)
    paragraphs: list[Paragraph] = Field(min_length=3, max_length=5)
    fully_correct: bool
    wrong_paragraph: int | None = None
    fix_options: list[Fix] = Field(default_factory=list, max_length=4)
    correct_fix: int | None = None
    why_options: list[Why] = Field(default_factory=list, max_length=4)
    correct_why: str | None = None
    model_answer: list[str] = Field(min_length=1, max_length=6)
    hints: list[str] = Field(min_length=3, max_length=3)
    key_lesson: str = Field(max_length=500)


class OpenPractice(BaseModel):
    question: str = Field(min_length=5, max_length=600)
    key_points: list[str] = Field(min_length=1, max_length=6)
    model_answer: str = Field(min_length=10, max_length=2000)
    source_id: str = Field(max_length=12)
    quote: str = Field(min_length=12, max_length=400)


class ExaminerQ(OpenPractice):
    pass


class Scenario(Cited):
    topic: str = Field(min_length=3, max_length=200)
    false_claim: str = Field(min_length=10, max_length=600)
    correct_claim: str = Field(min_length=10, max_length=600)
    why: str = Field(min_length=5, max_length=600)


class GenerationError(Exception):
    pass


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

SYSTEM_BASE = (
    "You create exam-training material for university students from THEIR course material. "
    "Use only facts stated in the MATERIAL. Write in the same language as the MATERIAL. "
    "Every item must cite a passage id like P3 in source_id and copy a short exact quote (12 to 200 characters) "
    "from that passage into quote, character for character. Never invent sources. Return only JSON."
)


def _style(past_exams: str) -> str:
    if not past_exams.strip():
        return ""
    return (
        "\n\nPAST EXAMS (style reference only: imitate their question types, difficulty and wording, "
        "but take every fact from the MATERIAL, never from these):\n<<<PAST\n" + past_exams + "\nPAST>>>"
    )


def _n_correct(n: int) -> int:
    return max(1, round(n * 0.2)) if n >= 3 else 0


def quiz_prompt(passages, past, n) -> tuple[str, str]:
    k = _n_correct(n)
    user = f"""TASK: generate_quiz
Create {n} rounds and {n} practice questions.

Each round: an over-confident AI student takes a 4-question multiple-choice quiz.
- questions: 4 multiple-choice questions, each with exactly 4 options and the index (0-3) of the single correct option, each citing source_id + quote that proves the correct option.
- ai_answers: the AI student's choice (0-3) for each question plus a confident one-sentence justification.
- In exactly {k} round(s) set fully_correct=true: all 4 AI choices are correct, wrong_question=null, why_options=[], correct_why=null.
- In every other round set fully_correct=false: exactly ONE ai_answer is wrong (a realistic, tempting mistake a student would make); wrong_question is its 1-based number; the other three are correct.
- why_options: 4 short misconception labels (ids w1..w4) explaining why a student might pick that wrong answer; correct_why is the id of the true reason.
- hints: 3 progressive hints that point toward the wrong question without naming the answer.
- key_lesson: one sentence to remember.

practice: {n} NEW multiple-choice questions (not used in rounds), each with question, options (4), correct (0-3), explanation, source_id, quote.

JSON shape: {{"title": "short title for this material", "rounds": [{{"questions":[{{"question":"","options":["","","",""],"correct":0,"source_id":"P1","quote":""}}],"ai_answers":[{{"choice":0,"justification":""}}],"fully_correct":false,"wrong_question":2,"why_options":[{{"id":"w1","label":""}}],"correct_why":"w1","hints":["","",""],"key_lesson":""}}], "practice":[{{"question":"","options":["","","",""],"correct":0,"explanation":"","source_id":"P1","quote":""}}]}}

{material_block(passages)}{_style(past)}"""
    return SYSTEM_BASE, user


def written_prompt(passages, past, n) -> tuple[str, str]:
    k = _n_correct(n)
    user = f"""TASK: generate_written
Create {n} rounds and {n} practice questions.

Each round: an over-confident AI student writes an answer to a written exam question in 3 to 5 short paragraphs.
- paragraphs: each with text, source_id and quote. Correct paragraphs cite the passage that supports them.
- In exactly {k} round(s) set fully_correct=true: every paragraph is correct, wrong_paragraph=null, fix_options=[], correct_fix=null, why_options=[], correct_why=null.
- In every other round set fully_correct=false: exactly ONE paragraph contains a realistic mistake that contradicts the material (its quote must be the passage text it contradicts); wrong_paragraph is its 1-based number. Paragraphs after it may build on it, but no earlier paragraph may be wrong.
- fix_options: 4 candidate replacements for the wrong paragraph; correct_fix is the 0-based index of the only correct one.
- why_options: 4 short misconception labels (ids w1..w4); correct_why is the id of the true reason.
- model_answer: a correct answer as a list of paragraphs.
- hints: 3 progressive hints. key_lesson: one sentence.

practice: {n} NEW written exam questions, each with key_points (2-5 things a full-marks answer must contain), model_answer, source_id and quote.

JSON shape: {{"title":"","rounds":[{{"exam_question":"","paragraphs":[{{"text":"","source_id":"P1","quote":""}}],"fully_correct":false,"wrong_paragraph":2,"fix_options":[{{"text":""}}],"correct_fix":0,"why_options":[{{"id":"w1","label":""}}],"correct_why":"w1","model_answer":[""],"hints":["","",""],"key_lesson":""}}],"practice":[{{"question":"","key_points":[""],"model_answer":"","source_id":"P1","quote":""}}]}}

{material_block(passages)}{_style(past)}"""
    return SYSTEM_BASE, user


def oral_prompt(passages, past, n) -> tuple[str, str]:
    m = max(3, min(n, 5))
    user = f"""TASK: generate_oral
Prepare an oral exam.

examiner_questions: {n + 2} open questions an examiner would ask aloud, each with key_points (2-5 things a full-marks answer must contain), model_answer, source_id, quote.

candidate_scenarios: {m} scenarios where an over-confident AI candidate will be questioned by the student. Each has:
- topic: what the student should ask about,
- false_claim: one realistic misconception the candidate will state as fact (it must contradict the passage in quote),
- correct_claim: what the material actually says,
- why: why students commonly get this wrong,
- source_id and quote (the passage text that proves correct_claim).

JSON shape: {{"title":"","examiner_questions":[{{"question":"","key_points":[""],"model_answer":"","source_id":"P1","quote":""}}],"candidate_scenarios":[{{"topic":"","false_claim":"","correct_claim":"","why":"","source_id":"P1","quote":""}}]}}

{material_block(passages)}{_style(past)}"""
    return SYSTEM_BASE, user


CHECK_SYSTEM = (
    "You are a strict, independent exam reviewer. You did not write these items. "
    "For each item, judge ONLY against the cited MATERIAL passages. Mark ok=false if anything is unsupported, "
    "ambiguous, or if more than one option could be correct. Return only JSON."
)


def check_prompt(items: list[dict[str, Any]], passages: list[dict[str, Any]]) -> tuple[str, str]:
    import json
    cited = {i for it in items for i in it["cites"]}
    block = material_block([p for p in passages if p["id"] in cited])
    user = f"""TASK: check_items
For each item, verify every statement in "must_hold" against the cited passages.
Return {{"results":[{{"id":"","ok":true,"reason":"short reason"}}]}} with one result per item.

ITEMS:
{json.dumps([{k: v for k, v in it.items() if k != 'cites'} for it in items], ensure_ascii=False)}

{block}"""
    return CHECK_SYSTEM, user


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _grounded(c: Cited | OpenPractice, by_id: dict[str, dict[str, Any]]) -> bool:
    p = by_id.get(c.source_id)
    return bool(p) and quote_found(c.quote, p["text"])


def _parse_list(model: type[BaseModel], raw: Any, dropped: list[str], label: str) -> list[Any]:
    out = []
    for i, item in enumerate(raw if isinstance(raw, list) else []):
        try:
            out.append(model.model_validate(item))
        except ValidationError:
            dropped.append(f"{label} {i + 1}: malformed")
    return out


def _quiz_ok(r: QuizRound, by_id, dropped: list[str], i: int) -> bool:
    if not all(_grounded(q, by_id) for q in r.questions):
        dropped.append(f"round {i}: a quote wasn't found in the cited passage"); return False
    if any(len({o.strip().lower() for o in q.options}) < 4 for q in r.questions):
        dropped.append(f"round {i}: duplicate options"); return False
    wrong = [j + 1 for j, (q, a) in enumerate(zip(r.questions, r.ai_answers)) if q.correct != a.choice]
    if r.fully_correct:
        if wrong: dropped.append(f"round {i}: marked correct but has a wrong answer"); return False
        return True
    if wrong != [r.wrong_question]:
        dropped.append(f"round {i}: answer key doesn't match the AI's answers"); return False
    ids = [w.id for w in r.why_options]
    if len(ids) != 4 or len(set(ids)) != 4 or r.correct_why not in ids:
        dropped.append(f"round {i}: explanation options invalid"); return False
    return True


def _written_ok(r: WrittenRound, by_id, dropped: list[str], i: int) -> bool:
    if not all(_grounded(p, by_id) for p in r.paragraphs):
        dropped.append(f"round {i}: a quote wasn't found in the cited passage"); return False
    if r.fully_correct:
        return r.wrong_paragraph is None
    if not r.wrong_paragraph or not 1 <= r.wrong_paragraph <= len(r.paragraphs):
        dropped.append(f"round {i}: no valid wrong paragraph"); return False
    if len(r.fix_options) != 4 or r.correct_fix is None or not 0 <= r.correct_fix <= 3:
        dropped.append(f"round {i}: fix options invalid"); return False
    if len({f.text.strip().lower() for f in r.fix_options}) < 4:
        dropped.append(f"round {i}: duplicate fix options"); return False
    ids = [w.id for w in r.why_options]
    if len(ids) != 4 or len(set(ids)) != 4 or r.correct_why not in ids:
        dropped.append(f"round {i}: explanation options invalid"); return False
    return True


# ---------------------------------------------------------------------------
# Checker items (what the independent reviewer must confirm)
# ---------------------------------------------------------------------------

def _check_items_quiz(rounds: list[QuizRound], practice: list[MCQ]) -> list[dict[str, Any]]:
    items = []
    for i, r in enumerate(rounds):
        must = []
        for j, (q, a) in enumerate(zip(r.questions, r.ai_answers), start=1):
            must.append(f"Q{j} '{q.question}': option '{q.options[q.correct]}' is correct and the only correct option among {q.options}.")
            if not r.fully_correct and j == r.wrong_question:
                must.append(f"Q{j}: the AI's choice '{q.options[a.choice]}' is wrong according to the material.")
        items.append({"id": f"r{i}", "must_hold": must, "cites": [q.source_id for q in r.questions]})
    for i, q in enumerate(practice):
        items.append({"id": f"p{i}", "cites": [q.source_id],
                      "must_hold": [f"'{q.question}': option '{q.options[q.correct]}' is correct and the only correct option among {q.options}."]})
    return items


def _check_items_written(rounds: list[WrittenRound], practice: list[OpenPractice]) -> list[dict[str, Any]]:
    items = []
    for i, r in enumerate(rounds):
        must = []
        for j, p in enumerate(r.paragraphs, start=1):
            if not r.fully_correct and j == r.wrong_paragraph:
                must.append(f"Paragraph {j} contains a mistake that the material contradicts: '{p.text}'")
                must.append(f"This replacement is correct: '{r.fix_options[r.correct_fix].text}'")
                others = [f.text for k, f in enumerate(r.fix_options) if k != r.correct_fix]
                must.append(f"These replacements are each wrong or incomplete: {others}")
            elif r.fully_correct or j < (r.wrong_paragraph or 99):
                must.append(f"Paragraph {j} is correct: '{p.text}'")
        items.append({"id": f"r{i}", "must_hold": must, "cites": [p.source_id for p in r.paragraphs]})
    for i, q in enumerate(practice):
        items.append({"id": f"p{i}", "cites": [q.source_id], "must_hold": [f"This model answer to '{q.question}' is correct: '{q.model_answer}'"]})
    return items


def _check_items_oral(exq: list[ExaminerQ], sc: list[Scenario]) -> list[dict[str, Any]]:
    items = [{"id": f"e{i}", "cites": [q.source_id], "must_hold": [f"This model answer to '{q.question}' is correct: '{q.model_answer}'"]}
             for i, q in enumerate(exq)]
    items += [{"id": f"s{i}", "cites": [s.source_id],
               "must_hold": [f"This is correct: '{s.correct_claim}'", f"This is wrong according to the material: '{s.false_claim}'"]}
              for i, s in enumerate(sc)]
    return items


async def independent_check(items: list[dict[str, Any]], passages: list[dict[str, Any]]) -> set[str]:
    """Returns the ids the reviewer approved. Unmentioned items count as rejected."""
    if not items:
        return set()
    system, user = check_prompt(items, passages)
    data = await llm.complete_json(system, user, temperature=0.0, max_tokens=16000)
    results = data.get("results", []) if isinstance(data, dict) else []
    return {str(r.get("id")) for r in results if isinstance(r, dict) and r.get("ok") is True}


# ---------------------------------------------------------------------------
# Assembly into the app's round format
# ---------------------------------------------------------------------------

def _file(by_id, sid):
    return by_id.get(sid, {}).get("file", "")


def _provenance(n_checks: int) -> tuple[dict[str, Any], dict[str, Any]]:
    st = llm.status()
    who = "a simulated AI (test mode)" if st["test_mode"] else f"{st['model']}"
    return (
        {"method": "llm-grounded", "llm": st["model"], "test_mode": st["test_mode"],
         "description": f"Generated by {who} from your document."},
        {"status": "checked", "checker": "source quotes matched word for word, plus an independent AI review",
         "claims_checked": n_checks, "step_verdicts": []},
    )


def _whys(r: QuizRound | WrittenRound, idx: int) -> tuple[list[dict[str, str]], str | None]:
    """Misconception ids are made unique per round (r1-w2, ...)."""
    if r.fully_correct:
        return [], None
    pre = f"r{idx + 1}-"
    return [{"id": pre + w.id, "label": w.label} for w in r.why_options], pre + (r.correct_why or "")


def _quiz_to_round(r: QuizRound, idx: int, pack_id: str, title: str, by_id) -> dict[str, Any]:
    steps = []
    for j, (q, a) in enumerate(zip(r.questions, r.ai_answers), start=1):
        steps.append({"n": j, "text": q.question, "latex": "",
                      "detail": f"AI's answer: {LETTERS[a.choice]}) {q.options[a.choice]}. {a.justification}"})
    prov, ver = _provenance(len(r.questions) + 1)
    whys, cwhy = _whys(r, idx)
    fully = r.fully_correct
    w = r.wrong_question
    wq = r.questions[w - 1] if w else None
    fix_options = [{"id": f"f{k + 1}", "text": f"{LETTERS[k]}) {o}", "latex": ""} for k, o in enumerate(wq.options)] if wq else []
    return {
        "id": f"{pack_id}-r{idx + 1}", "topic": pack_id, "topic_name": title, "difficulty": 2,
        "problem_statement": {"text": "The AI took this quiz on your course. Check its answers.", "latex": ""},
        "steps": steps,
        "first_incorrect_step": None if fully else w,
        "is_fully_correct": fully,
        "mistake_label": cwhy,
        "corrected_step": None if fully else {"step": w, "text": f"{LETTERS[wq.correct]}) {wq.options[wq.correct]}", "latex": ""},
        "fix_options": fix_options,
        "correct_fix": None if fully else f"f{wq.correct + 1}",
        "why_options": whys,
        "correct_why": cwhy,
        "correct_solution": [
            {"text": f"Q{j}: {LETTERS[q.correct]}) {q.options[q.correct]}", "latex": "",
             "quote": q.quote, "source": _file(by_id, q.source_id)}
            for j, q in enumerate(r.questions, start=1)
        ],
        "verified_answer": {"latex": "", "text": "All four of the AI's answers were correct." if fully
                            else f"Question {w}: the correct answer is {LETTERS[wq.correct]}) {wq.options[wq.correct]}."},
        "key_lesson": r.key_lesson, "hint_ladder": r.hints,
        "source_provenance": prov, "verification_status": ver, "pack_version": "custom",
    }


def _written_to_round(r: WrittenRound, idx: int, pack_id: str, title: str, by_id) -> dict[str, Any]:
    prov, ver = _provenance(len(r.paragraphs) + 2)
    whys, cwhy = _whys(r, idx)
    fully = r.fully_correct
    w = r.wrong_paragraph
    return {
        "id": f"{pack_id}-r{idx + 1}", "topic": pack_id, "topic_name": title, "difficulty": 2,
        "problem_statement": {"text": r.exam_question, "latex": ""},
        "steps": [{"n": j, "text": p.text, "latex": ""} for j, p in enumerate(r.paragraphs, start=1)],
        "first_incorrect_step": None if fully else w,
        "is_fully_correct": fully,
        "mistake_label": cwhy,
        "corrected_step": None if fully else {"step": w, "text": r.fix_options[r.correct_fix].text, "latex": ""},
        "fix_options": [] if fully else [{"id": f"f{k + 1}", "text": f.text, "latex": ""} for k, f in enumerate(r.fix_options)],
        "correct_fix": None if fully else f"f{r.correct_fix + 1}",
        "why_options": whys,
        "correct_why": cwhy,
        "correct_solution": [{"text": t, "latex": ""} for t in r.model_answer] + [
            {"text": "From your material:", "latex": "", "quote": p.quote, "source": _file(by_id, p.source_id)}
            for j, p in enumerate(r.paragraphs, start=1) if not fully and j == w],
        "verified_answer": {"latex": "", "text": "Every paragraph was correct." if fully
                            else f"Paragraph {w} should read: {r.fix_options[r.correct_fix].text}"},
        "key_lesson": r.key_lesson, "hint_ladder": r.hints,
        "source_provenance": prov, "verification_status": ver, "pack_version": "custom",
    }


async def generate(fmt: Format, passages: list[dict[str, Any]], past_exams: str, n: int, title_hint: str = "") -> dict[str, Any]:
    by_id = {p["id"]: p for p in passages}
    pack_id = "u-" + uuid.uuid4().hex[:10]
    prompt = {"quiz": quiz_prompt, "written": written_prompt, "oral": oral_prompt}[fmt]
    system, user = prompt(passages, past_exams, n)
    # Room for long packs, including "thinking" tokens on models that count them.
    data = await llm.complete_json(system, user, temperature=0.5, max_tokens=32000)
    if not isinstance(data, dict):
        raise GenerationError("The AI's reply wasn't usable. Try again.")
    title = (str(data.get("title") or title_hint or "My course")).strip()[:80]
    dropped: list[str] = []
    pack: dict[str, Any] = {
        "id": pack_id, "title": title, "format": fmt,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "generator": {"provider": llm.provider(), "model": llm.model(), "test_mode": llm.status()["test_mode"]},
        "rounds": [], "exercises": [], "oral": None, "dropped": dropped,
    }

    if fmt == "quiz":
        rounds = [r for i, r in enumerate(_parse_list(QuizRound, data.get("rounds"), dropped, "round"))
                  if _quiz_ok(r, by_id, dropped, i + 1)]
        practice = [q for q in _parse_list(MCQ, data.get("practice"), dropped, "practice")
                    if _grounded(q, by_id) or dropped.append("practice: quote not found")]
        approved = await independent_check(_check_items_quiz(rounds, practice), passages)
        for i, r in enumerate(rounds):
            if f"r{i}" in approved:
                pack["rounds"].append(_quiz_to_round(r, len(pack["rounds"]), pack_id, title, by_id))
            else:
                dropped.append(f"round {i + 1}: rejected by the independent review")
        for i, q in enumerate(practice):
            if f"p{i}" not in approved:
                dropped.append(f"practice {i + 1}: rejected by the independent review"); continue
            pack["exercises"].append({
                "id": f"{pack_id}-x{len(pack['exercises']) + 1}", "topic": pack_id, "difficulty": 2,
                "prompt": q.question, "latex": "", "options": q.options,
                "answer": {"kind": "mcq", "correct": q.correct},
                "answer_latex": "", "answer_text": f"{LETTERS[q.correct]}) {q.options[q.correct]}",
                "input_help": "Choose one answer.", "hint": "Re-read the part of the course this question comes from.",
                "solution": [{"text": q.explanation or f"The answer is {LETTERS[q.correct]}.", "latex": "",
                              "quote": q.quote, "source": _file(by_id, q.source_id)}],
            })

    elif fmt == "written":
        rounds = [r for i, r in enumerate(_parse_list(WrittenRound, data.get("rounds"), dropped, "round"))
                  if _written_ok(r, by_id, dropped, i + 1)]
        practice = [q for q in _parse_list(OpenPractice, data.get("practice"), dropped, "practice")
                    if _grounded(q, by_id) or dropped.append("practice: quote not found")]
        approved = await independent_check(_check_items_written(rounds, practice), passages)
        for i, r in enumerate(rounds):
            if f"r{i}" in approved:
                pack["rounds"].append(_written_to_round(r, len(pack["rounds"]), pack_id, title, by_id))
            else:
                dropped.append(f"round {i + 1}: rejected by the independent review")
        for i, q in enumerate(practice):
            if f"p{i}" not in approved:
                dropped.append(f"practice {i + 1}: rejected by the independent review"); continue
            pack["exercises"].append({
                "id": f"{pack_id}-x{len(pack['exercises']) + 1}", "topic": pack_id, "difficulty": 2,
                "prompt": q.question, "latex": "",
                "answer": {"kind": "open", "key_points": q.key_points, "model_answer": q.model_answer},
                "answer_latex": "", "answer_text": q.model_answer,
                "input_help": "Write your answer as you would in the exam.",
                "hint": "List the key ideas first, then write them up in full sentences.",
                "solution": [{"text": q.model_answer, "latex": "", "quote": q.quote, "source": _file(by_id, q.source_id)}],
                "source_ids": [q.source_id],
            })

    else:  # oral
        exq = [q for q in _parse_list(ExaminerQ, data.get("examiner_questions"), dropped, "question")
               if _grounded(q, by_id) or dropped.append("question: quote not found")]
        sc = [s for s in _parse_list(Scenario, data.get("candidate_scenarios"), dropped, "scenario")
              if _grounded(s, by_id) or dropped.append("scenario: quote not found")]
        approved = await independent_check(_check_items_oral(exq, sc), passages)
        pack["oral"] = {
            "examiner_questions": [{**q.model_dump(), "source": _file(by_id, q.source_id)} for i, q in enumerate(exq) if f"e{i}" in approved],
            "candidate_scenarios": [{**s.model_dump(), "source": _file(by_id, s.source_id)} for i, s in enumerate(sc) if f"s{i}" in approved],
        }
        dropped += [f"oral item {i}: rejected by the independent review" for i in
                    [f"e{i}" for i in range(len(exq)) if f"e{i}" not in approved] + [f"s{i}" for i in range(len(sc)) if f"s{i}" not in approved]]
        if not pack["oral"]["examiner_questions"] and not pack["oral"]["candidate_scenarios"]:
            raise GenerationError("None of the generated oral questions passed the checks. Try again, or upload more detailed material.")

    if fmt != "oral" and not pack["rounds"]:
        raise GenerationError("None of the generated rounds passed the checks. Try again, or upload more detailed material.")
    pack["misconceptions"] = {w["id"]: w["label"] for r in pack["rounds"] for w in r["why_options"]}
    return pack
