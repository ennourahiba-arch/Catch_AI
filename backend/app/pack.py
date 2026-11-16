"""The verified Calculus pack, and conversion of its questions to class-quiz form."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

PACK_PATH = Path(__file__).resolve().parent.parent / "packs" / "calculus1.json"


@lru_cache(maxsize=1)
def load_pack() -> dict[str, Any]:
    return json.loads(PACK_PATH.read_text(encoding="utf-8"))


def get_exercise(eid: str) -> dict[str, Any] | None:
    return next((e for e in load_pack()["exercises"] if e["id"] == eid), None)


def topic_name(topic: str) -> str:
    return next((t["name"] for t in load_pack()["topics"] if t["id"] == topic), topic)


def calculus_question(e: dict[str, Any]) -> dict[str, Any]:
    """A verified Calculus question in class-quiz form. Wrong options carry the mistake they come from."""
    m = e["mcq"]
    return {
        "id": e["id"], "prompt": m["prompt"], "latex": e["latex"],
        "options": [{"text": "", "latex": o} for o in m["options"]],
        "correct": m["correct"], "labels": m["labels"],
        "solution": [{"text": s["text"], "latex": s.get("latex", "")} for s in e["solution"]],
    }
