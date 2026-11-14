"""Loads the verified round pack and produces answer-safe views of rounds.

The server is the only place that holds answer keys during a class game.
`public_round` is what teams receive before the reveal: it contains no
verdicts, claims, first-error index, correct options or solution.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

PACK_PATH = Path(__file__).resolve().parent.parent / "packs" / "calculus1.json"


@lru_cache(maxsize=1)
def load_pack() -> dict[str, Any]:
    return json.loads(PACK_PATH.read_text(encoding="utf-8"))


def get_round(round_id: str) -> dict[str, Any] | None:
    return next((r for r in load_pack()["rounds"] if r["id"] == round_id), None)


def public_round(r: dict[str, Any]) -> dict[str, Any]:
    """Everything a team may see before answering. Deliberately excludes
    is_fully_correct, verdicts and claims (they would reveal the answer)."""
    return {
        "id": r["id"],
        "topic": r["topic"],
        "difficulty": r["difficulty"],
        "problem_statement": r["problem_statement"],
        "steps": [{"n": s["n"], "text": s["text"], "latex": s["latex"]} for s in r["steps"]],
        "pack_version": r["pack_version"],
    }


def options_view(r: dict[str, Any]) -> dict[str, Any]:
    """Fix and explanation options, shown to a team only after it has locked its catch."""
    return {
        "first_incorrect_step": r["first_incorrect_step"],
        "fix_options": [{"id": o["id"], "text": o["text"], "latex": o["latex"]} for o in r["fix_options"]],
        "why_options": r["why_options"],
    }


def reveal_view(r: dict[str, Any]) -> dict[str, Any]:
    """The full verified answer, sent to everyone once the round has finished."""
    pack = load_pack()
    correct_fix = next((o for o in r["fix_options"] if o["id"] == r["correct_fix"]), None)
    return {
        "is_fully_correct": r["is_fully_correct"],
        "first_incorrect_step": r["first_incorrect_step"],
        "correct_fix": r["correct_fix"],
        "correct_fix_latex": correct_fix["latex"] if correct_fix else None,
        "correct_why": r["correct_why"],
        "correct_why_label": pack["misconceptions"].get(r["correct_why"] or "", None),
        "correct_solution": r["correct_solution"],
        "verified_answer": {"latex": r["verified_answer"]["latex"]},
        "key_lesson": r["key_lesson"],
        "checker": r["verification_status"]["checker"],
        "claims_checked": r["verification_status"]["claims_checked"],
    }
