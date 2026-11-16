"""Scripted stand-in for an AI provider (LLM_PROVIDER=fake).

Used by the automated tests and for running the app locally without a key. It
builds structurally valid answers from the uploaded passages, quoting them
exactly, so the whole pipeline can be exercised. Its content is placeholder
text and every pack it produces is labelled as test mode.
"""
from __future__ import annotations

import json
import re


def _passages(user: str) -> list[tuple[str, str]]:
    m = re.search(r"<<<MATERIAL\n(.*?)\nMATERIAL>>>", user, re.S)
    if not m:
        return []
    parts = re.split(r"(?:^|\n\n)\[(P\d+)\] \([^)]*\)\n", m.group(1))
    return [(parts[i], parts[i + 1]) for i in range(1, len(parts) - 1, 2)]


def _quote(text: str) -> str:
    return " ".join(text.split()[:10])


def _n(user: str) -> int:
    m = re.search(r"Write (\d+) ", user)
    return int(m.group(1)) if m else 5


PROFILE = {"question_types": ["multiple choice", "short answer"], "duration_minutes": 90,
           "number_of_questions": 20, "notes": "(Simulated) exam profile."}


def respond(system: str, user: str) -> str:
    task = re.search(r"TASK: (\w+)", system + "\n" + user)
    task = task.group(1) if task else ""
    ps = _passages(user) or [("P1", "placeholder text with enough words to quote from")]
    pick = lambda i: ps[i % len(ps)]

    if task == "generate_quiz":
        qs = []
        for i in range(_n(user)):
            pid, text = pick(i)
            q = _quote(text)
            qs.append({"question": f"(Simulated) Which statement does passage {pid} support? [{i + 1}]",
                       "options": [f"It says: {q}", f"It says the opposite of: {q}", "It is not covered in the course", f"Only part {i + 1} is true"],
                       "correct": 0, "wrong_reasons": [None, "Simulated: reversed the claim", "Simulated: skimmed the chapter", "Simulated: over-generalised"],
                       "explanation": f"Passage {pid} states it directly.", "hint": "Re-read that passage.",
                       "difficulty": 1 + i % 3, "source_id": pid, "quote": q})
        return json.dumps({"title": "Simulated course", "exam_profile": PROFILE, "questions": qs})

    if task in ("generate_written", "generate_oral"):
        qs = []
        for i in range(_n(user)):
            pid, text = pick(i)
            qs.append({"question": f"(Simulated) Explain what passage {pid} says. [{i + 1}]", "key_points": ["main idea", "an example"],
                       "model_answer": f"It says {_quote(text)}.", "hint": "Start with the main idea.",
                       "difficulty": 2, "source_id": pid, "quote": _quote(text)})
        return json.dumps({"title": "Simulated course", "exam_profile": PROFILE, "questions": qs})

    if task == "check_items":
        items = json.loads(re.search(r"ITEMS:\n(.*?)\n\n<<<MATERIAL", user, re.S).group(1))
        return json.dumps({"results": [{"id": it["id"], "ok": "REJECT_ME" not in json.dumps(it), "reason": "simulated review"} for it in items]})

    if task == "oral_examiner":
        if "GIVE_AWAY" in user:  # tests: simulate a model that tries to leak the answer
            ma = re.search(r"MODEL ANSWER: (.*)", user).group(1)
            return json.dumps({"reply": f"Fine, the answer is: {ma}", "close": False, "score": None})
        last = user.lower().split("conversation:")[-1]
        return json.dumps({"reply": "(Simulated) Good start. Can you give an example?", "close": "example" in last, "score": 1})

    if task == "grade_answer":
        ans = user.split("STUDENT ANSWER:")[-1].lower()
        verdict = "correct" if "main idea" in ans else "incorrect"
        return json.dumps({"verdict": verdict, "covered": [0] if verdict == "correct" else [], "feedback": "(Simulated) feedback."})

    return json.dumps({})
