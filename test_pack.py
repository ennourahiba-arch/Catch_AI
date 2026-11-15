"""Integrity checks on the built pack: answer keys agree with the verifier."""
import json
from pathlib import Path

import pytest

from catchai.build_pack import build
from catchai.verify import VALID, check_claim, first_invalid_step

REQUIRED = ["id", "topic", "difficulty", "problem_statement", "steps", "first_incorrect_step",
            "is_fully_correct", "mistake_label", "corrected_step", "fix_options", "why_options",
            "correct_solution", "verified_answer", "hint_ladder", "source_provenance",
            "verification_status", "pack_version"]


@pytest.fixture(scope="module")
def result():
    return build()


def test_no_drafts_rejected(result):
    assert result["review"] == [], result["review"]


def test_pack_size_and_mix(result):
    rounds = result["pack"]["rounds"]
    assert len(rounds) >= 15
    share = sum(r["is_fully_correct"] for r in rounds) / len(rounds)
    assert 0.15 <= share <= 0.35
    assert {r["topic"] for r in rounds} == {"derivatives", "chain-rule", "critical-points", "closed-interval"}


def test_required_fields(result):
    for r in result["pack"]["rounds"]:
        for k in REQUIRED:
            assert k in r, f"{r['id']} missing {k}"


def test_answer_keys_match_verifier(result):
    for r in result["pack"]["rounds"]:
        first, _ = first_invalid_step(r["steps"])
        assert first == r["first_incorrect_step"], r["id"]
        assert r["is_fully_correct"] == (first is None)
        if first is None:
            assert r["fix_options"] == [] and r["why_options"] == []
            continue
        valid = [o["id"] for o in r["fix_options"] if check_claim(o["claim"]).status == VALID]
        assert valid == [r["correct_fix"]], r["id"]
        assert r["correct_why"] in [w["id"] for w in r["why_options"]]
        assert len(r["why_options"]) == 4


def test_mandatory_demo_rounds(result):
    by_id = {r["id"]: r for r in result["pack"]["rounds"]}
    demo = by_id["int-demo-endpoints"]
    assert demo["first_incorrect_step"] == 4 and demo["mistake_label"] == "forgot_endpoints"
    assert demo["verified_answer"]["claim"]["value"] == "6"
    assert demo["verified_answer"]["claim"]["at"] == ["4"]
    lucky = by_id["int-demo-lucky"]
    assert lucky["first_incorrect_step"] == 2 and lucky["mistake_label"] == "solved_f_not_fprime"
    assert lucky["steps"][3]["verdict"] == VALID  # coincidentally correct final answer


def test_build_is_deterministic(result):
    again = build()
    assert again["pack"]["content_hash"] == result["pack"]["content_hash"]


def test_web_copy_matches(result):
    web = Path(__file__).resolve().parents[2] / "frontend" / "public" / "packs" / "calculus1.json"
    assert json.loads(web.read_text())["content_hash"] == result["pack"]["content_hash"]


def test_backend_copy_matches(result):
    api = Path(__file__).resolve().parents[2] / "backend" / "packs" / "calculus1.json"
    assert json.loads(api.read_text())["content_hash"] == result["pack"]["content_hash"]
