"""Scripted stand-in for an AI provider (LLM_PROVIDER=fake).

Used by the automated tests and for running the app locally without a key.
It builds structurally valid answers from the uploaded passages, quoting them
exactly, so the whole pipeline can be exercised. Its content is obviously
placeholder text and every pack it produces is labelled as test mode.
"""
from __future__ import annotations

import json
import re

L = "ABCD"


def _passages(user: str) -> list[tuple[str, str]]:
    m = re.search(r"<<<MATERIAL\n(.*?)\nMATERIAL>>>", user, re.S)
    if not m:
        return []
    parts = re.split(r"(?:^|\n\n)\[(P\d+)\] \([^)]*\)\n", m.group(1))
    return [(parts[i], parts[i + 1]) for i in range(1, len(parts) - 1, 2)]


def _quote(text: str) -> str:
    words = text.split()
    return " ".join(words[:10])


def _n(user: str, default: int = 3) -> int:
    m = re.search(r"Create (\d+) rounds", user)
    return int(m.group(1)) if m else default


def _mcq(pid: str, text: str, k: int) -> dict:
    q = _quote(text)
    return {"question": f"(Simulated) Which statement does passage {pid} support? [{k}]",
            "options": [f"It says: {q}", f"It says the opposite of: {q}", "It is not covered in the course", f"Only part {k} is true"],
            "correct": 0, "explanation": f"Passage {pid} states it directly.", "source_id": pid, "quote": q}


def respond(system: str, user: str) -> str:
    task = re.search(r"TASK: (\w+)", system + "\n" + user)
    task = task.group(1) if task else ""
    ps = _passages(user) or [("P1", "placeholder text with enough words to quote from")]
    pick = lambda i: ps[i % len(ps)]

    if task == "generate_quiz":
        n = _n(user)
        k = max(1, round(n * 0.2)) if n >= 3 else 0
        rounds = []
        for r in range(n):
            qs = [_mcq(*pick(r * 4 + j), j) for j in range(4)]
            fully = r < k
            answers = [{"choice": 0, "justification": "The course says so."} for _ in range(4)]
            if not fully:
                answers[1] = {"choice": 2, "justification": "I'm sure this wasn't in the course."}
            rounds.append({"questions": qs, "ai_answers": answers, "fully_correct": fully,
                           "wrong_question": None if fully else 2,
                           "why_options": [] if fully else [{"id": f"w{i}", "label": f"Simulated misconception {i}"} for i in range(1, 5)],
                           "correct_why": None if fully else "w1",
                           "hints": ["Look at question 2.", "Re-read its passage.", "Is it really not covered?"],
                           "key_lesson": "Check the source before answering."})
        practice = [_mcq(*pick(100 + i), i) for i in range(n)]
        return json.dumps({"title": "Simulated course", "rounds": rounds, "practice": practice})

    if task == "generate_written":
        n = _n(user)
        k = max(1, round(n * 0.2)) if n >= 3 else 0
        rounds = []
        for r in range(n):
            paras = [{"text": f"(Simulated) Paragraph {j + 1} restates: {_quote(pick(r + j)[1])}.", "source_id": pick(r + j)[0],
                      "quote": _quote(pick(r + j)[1])} for j in range(4)]
            fully = r < k
            rounds.append({"exam_question": f"(Simulated) Explain the ideas in passage {pick(r)[0]}.", "paragraphs": paras,
                           "fully_correct": fully, "wrong_paragraph": None if fully else 3,
                           "fix_options": [] if fully else [{"text": f"Corrected paragraph version {i}"} for i in range(1, 5)],
                           "correct_fix": None if fully else 0,
                           "why_options": [] if fully else [{"id": f"w{i}", "label": f"Simulated misconception {i}"} for i in range(1, 5)],
                           "correct_why": None if fully else "w2",
                           "model_answer": ["A correct simulated answer."], "hints": ["h1", "h2", "h3"], "key_lesson": "Simulated lesson."})
        practice = [{"question": f"(Simulated) Summarise passage {pick(i)[0]}.", "key_points": ["main idea", "an example"],
                     "model_answer": f"It says {_quote(pick(i)[1])}.", "source_id": pick(i)[0], "quote": _quote(pick(i)[1])} for i in range(n)]
        return json.dumps({"title": "Simulated course", "rounds": rounds, "practice": practice})

    if task == "generate_oral":
        exq = [{"question": f"(Simulated) What does passage {pick(i)[0]} explain?", "key_points": ["main idea"],
                "model_answer": f"It explains that {_quote(pick(i)[1])}.", "source_id": pick(i)[0], "quote": _quote(pick(i)[1])} for i in range(5)]
        sc = [{"topic": f"the content of passage {pick(i)[0]}", "false_claim": "This idea is never used in practice at all.",
               "correct_claim": f"The course says {_quote(pick(i)[1])}.", "why": "Students skim this part.",
               "source_id": pick(i)[0], "quote": _quote(pick(i)[1])} for i in range(3)]
        return json.dumps({"title": "Simulated course", "examiner_questions": exq, "candidate_scenarios": sc})

    if task == "check_items":
        items = json.loads(re.search(r"ITEMS:\n(.*?)\n\n<<<MATERIAL", user, re.S).group(1))
        return json.dumps({"results": [{"id": it["id"], "ok": "REJECT_ME" not in json.dumps(it), "reason": "simulated review"} for it in items]})

    if task == "oral_examiner":
        if "GIVE_AWAY" in user:  # tests: simulate a model that tries to leak the answer
            ma = re.search(r"MODEL ANSWER: (.*)", user).group(1)
            return json.dumps({"reply": f"Fine, the answer is: {ma}", "close": False, "score": None})
        return json.dumps({"reply": "(Simulated) Good start. Can you give an example?", "close": "example" in user.lower().split("conversation:")[-1], "score": 1})

    if task == "oral_candidate":
        return json.dumps({"reply": "(Simulated candidate) Honestly, this idea is never used in practice at all."})

    if task == "oral_judge":
        caught = "never used" in user.split("STUDENT SAYS THE MISTAKE WAS:")[-1].lower()
        return json.dumps({"caught": caught, "corrected": caught, "feedback": "(Simulated) judgement."})

    if task == "grade_answer":
        ans = user.split("STUDENT ANSWER:")[-1].lower()
        verdict = "correct" if "main idea" in ans else "incorrect"
        return json.dumps({"verdict": verdict, "covered": [0] if verdict == "correct" else [], "feedback": "(Simulated) feedback."})

    return json.dumps({})
