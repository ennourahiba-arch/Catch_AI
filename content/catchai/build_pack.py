"""Verify draft rounds and export an immutable, versioned round pack.

Usage (from the content/ directory):
    python -m catchai.build_pack

Writes:
    content/packs/calculus1-v<version>.json      the verified pack
    content/packs/review_queue.json             drafts that failed verification
    frontend/public/packs/calculus1.json        copy served to the web app
"""
from __future__ import annotations

import hashlib
import json
import random
import shutil
from pathlib import Path
from typing import Any

import sympy as sp

from .templates import MISCONCEPTIONS, TOPICS, all_drafts
from .verify import INVALID, VALID, check_claim, first_invalid_step

PACK_VERSION = "1.0.0"
ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "content" / "packs"
WEB_DIR = ROOT / "frontend" / "public" / "packs"


class Rejected(Exception):
    pass


def _rng(rid: str) -> random.Random:
    # Deterministic per round so rebuilding gives an identical pack.
    return random.Random(int(hashlib.sha256(rid.encode()).hexdigest(), 16))


def verify_draft(d: dict[str, Any]) -> dict[str, Any]:
    rid = d["id"]
    try:
        first, verdicts = first_invalid_step(d["steps"])
    except ValueError as exc:
        raise Rejected(str(exc))

    if first != d["intended_first_incorrect"]:
        raise Rejected(
            f"answer key says first error is step {d['intended_first_incorrect']}, "
            f"verifier says {first}: {[v.reason for v in verdicts]}"
        )
    is_fully_correct = first is None

    for i, s in enumerate(d["correct_solution"], start=1):
        v = check_claim(s["claim"])
        if v.status != VALID:
            raise Rejected(f"correct_solution step {i} is {v.status}: {v.reason}")
    va = check_claim(d["verified_answer"]["claim"])
    if va.status != VALID:
        raise Rejected(f"verified_answer is {va.status}: {va.reason}")

    rng = _rng(rid)
    fix_options: list[dict[str, Any]] = []
    correct_fix = None
    corrected_step = None
    if not is_fully_correct:
        if len(d["fix_options"]) != 4:
            raise Rejected("a mistaken round needs exactly 4 fix options")
        latexes = [o["latex"] for o in d["fix_options"]]
        if len(set(latexes)) != 4:
            raise Rejected(f"fix options are not distinct: {latexes}")
        statuses = [check_claim(o["claim"]).status for o in d["fix_options"]]
        if statuses.count(VALID) != 1 or statuses[0] != VALID:
            raise Rejected(f"fix options must have exactly one valid answer (the first); got {statuses}")
        if any(s not in (VALID, INVALID) for s in statuses):
            raise Rejected(f"unverifiable fix option: {statuses}")
        order = list(range(4))
        rng.shuffle(order)
        for new_i, old_i in enumerate(order):
            o = d["fix_options"][old_i]
            oid = f"f{new_i + 1}"
            fix_options.append({"id": oid, "text": o["text"], "latex": o["latex"], "claim": o["claim"]})
            if old_i == 0:
                correct_fix = oid
        corrected_step = {k: d["fix_options"][0][k] for k in ("text", "latex", "claim")}
        corrected_step["step"] = first

    why_options: list[dict[str, str]] = []
    if not is_fully_correct:
        label = d["mistake_label"]
        others = [w for w in d["why_ids"] if w != label]
        if not label or label not in MISCONCEPTIONS:
            raise Rejected(f"unknown mistake label {label!r}")
        rng.shuffle(others)
        chosen = [label, *others[:3]]
        rng.shuffle(chosen)
        why_options = [{"id": w, "label": MISCONCEPTIONS[w]} for w in chosen]

    if len(d["hint_ladder"]) != 3:
        raise Rejected("hint ladder must have 3 levels")

    return {
        "id": rid,
        "topic": d["topic"],
        "difficulty": d["difficulty"],
        "problem_statement": {"text": d["problem_text"], "latex": d["problem_latex"]},
        "steps": [
            {"n": i, "text": s["text"], "latex": s["latex"], "claim": s["claim"], "verdict": v.status}
            for i, (s, v) in enumerate(zip(d["steps"], verdicts), start=1)
        ],
        "first_incorrect_step": first,
        "is_fully_correct": is_fully_correct,
        "mistake_label": d["mistake_label"],
        "corrected_step": corrected_step,
        "fix_options": fix_options,
        "correct_fix": correct_fix,
        "why_options": why_options,
        "correct_why": d["mistake_label"],
        "correct_solution": [{"text": s["text"], "latex": s["latex"]} for s in d["correct_solution"]],
        "verified_answer": d["verified_answer"],
        "key_lesson": d["key_lesson"],
        "hint_ladder": d["hint_ladder"],
        "source_provenance": {
            "method": "template",
            "description": "Hand-authored misconception template over SymPy-computed mathematics. Not LLM output.",
            "llm": None,
        },
        "verification_status": {
            "status": "verified",
            "checker": f"sympy {sp.__version__}",
            "claims_checked": len(d["steps"]) + len(d["correct_solution"]) + len(d["fix_options"]) + 1,
            "step_verdicts": [v.reason for v in verdicts],
        },
        "pack_version": PACK_VERSION,
    }


def build() -> dict[str, Any]:
    rounds, review = [], []
    for d in all_drafts():
        try:
            rounds.append(verify_draft(d))
        except Rejected as exc:
            review.append({"id": d["id"], "reason": str(exc)})

    body = json.dumps(rounds, sort_keys=True, ensure_ascii=False)
    pack = {
        "pack_id": "calculus1",
        "subject": "Calculus 1",
        "pack_version": PACK_VERSION,
        "content_hash": hashlib.sha256(body.encode()).hexdigest()[:16],
        "topics": [{"id": k, "name": v} for k, v in TOPICS.items()],
        "misconceptions": MISCONCEPTIONS,
        "scoring": {"catch": 2, "fix": 1, "explain": 1, "no_mistake": 4},
        "rounds": rounds,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    WEB_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"calculus1-v{PACK_VERSION}.json"
    out.write_text(json.dumps(pack, indent=2, ensure_ascii=False))
    (OUT_DIR / "review_queue.json").write_text(json.dumps(review, indent=2, ensure_ascii=False))
    shutil.copy(out, WEB_DIR / "calculus1.json")
    return {"pack": pack, "review": review, "path": out}


if __name__ == "__main__":
    res = build()
    rounds = res["pack"]["rounds"]
    correct = sum(r["is_fully_correct"] for r in rounds)
    print(f"Verified rounds: {len(rounds)} ({correct} fully correct)")
    for r in rounds:
        print(f"  {r['id']:<22} first error: {r['first_incorrect_step']}  label: {r['mistake_label']}")
    if res["review"]:
        print(f"Sent to review queue: {len(res['review'])}")
        for r in res["review"]:
            print(f"  {r['id']}: {r['reason']}")
    print(f"Wrote {res['path']}")
