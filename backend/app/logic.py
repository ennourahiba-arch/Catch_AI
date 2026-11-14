"""Pure game rules: validation, scoring and class aggregates. No I/O here.

Rules match frontend/src/lib/round.ts:
  catch 2, fix 1, explain 1. Fix and explain only score if the catch was right.
  On a mistake-free round, a correct "none" scores 4 and the team is done.
"""
from __future__ import annotations

from collections import Counter
from typing import Any

MIN_TEAMS_FOR_BREAKDOWN = 3
PHASES = ("catch", "fix", "explain")

# subs: {"catch": {"choice": "4", "correct": True}, "fix": {...}, ...}
Subs = dict[str, dict[str, Any]]


def next_phase(r: dict[str, Any], subs: Subs) -> str:
    if "catch" not in subs:
        return "catch"
    if r["is_fully_correct"]:
        return "done"
    if "fix" not in subs:
        return "fix"
    if "explain" not in subs:
        return "explain"
    return "done"


class InvalidChoice(ValueError):
    pass


def judge(r: dict[str, Any], phase: str, choice: str) -> bool:
    """Validate a choice for this round and phase, and return whether it is correct."""
    if phase == "catch":
        if choice == "none":
            return r["is_fully_correct"]
        if not choice.isdigit() or not 1 <= int(choice) <= len(r["steps"]):
            raise InvalidChoice("Pick a step number or 'none'.")
        return (not r["is_fully_correct"]) and int(choice) == r["first_incorrect_step"]
    if phase == "fix":
        if choice not in {o["id"] for o in r["fix_options"]}:
            raise InvalidChoice("That is not one of the fix options.")
        return choice == r["correct_fix"]
    if phase == "explain":
        if choice not in {w["id"] for w in r["why_options"]}:
            raise InvalidChoice("That is not one of the explanation options.")
        return choice == r["correct_why"]
    raise InvalidChoice("Unknown phase.")


def points(r: dict[str, Any], subs: Subs, scoring: dict[str, int]) -> int:
    c = subs.get("catch")
    if not c or not c["correct"]:
        return 0
    if r["is_fully_correct"]:
        return scoring["no_mistake"]
    total = scoring["catch"]
    if subs.get("fix", {}).get("correct"):
        total += scoring["fix"]
    if subs.get("explain", {}).get("correct"):
        total += scoring["explain"]
    return total


def max_points(r: dict[str, Any], scoring: dict[str, int]) -> int:
    return scoring["no_mistake"] if r["is_fully_correct"] else scoring["catch"] + scoring["fix"] + scoring["explain"]


def _pct(n: int, d: int) -> int:
    return round(100 * n / d) if d else 0


def aggregate(r: dict[str, Any], teams: list[dict[str, Any]], pack: dict[str, Any]) -> dict[str, Any]:
    """Class results. `teams` items: {"name": str, "subs": Subs}.

    Response breakdowns are withheld until at least MIN_TEAMS_FOR_BREAKDOWN
    teams have submitted a catch, so no small group can be singled out.
    """
    scoring = pack["scoring"]
    labels = pack["misconceptions"]
    submitted = [t for t in teams if "catch" in t["subs"]]
    out: dict[str, Any] = {
        "teams_joined": len(teams),
        "teams_submitted": len(submitted),
        "min_teams": MIN_TEAMS_FOR_BREAKDOWN,
        "locked": len(submitted) < MIN_TEAMS_FOR_BREAKDOWN,
        "max_points": max_points(r, scoring),
    }
    if out["locked"]:
        return out

    n = len(submitted)
    catch_counts = Counter(t["subs"]["catch"]["choice"] for t in submitted)
    caught = [t for t in submitted if t["subs"]["catch"]["correct"]]
    fix_counts = Counter(t["subs"]["fix"]["choice"] for t in submitted if "fix" in t["subs"])
    why_counts = Counter(t["subs"]["explain"]["choice"] for t in submitted if "explain" in t["subs"])
    fix_right = sum(1 for t in submitted if t["subs"].get("fix", {}).get("correct"))
    why_right = sum(1 for t in submitted if t["subs"].get("explain", {}).get("correct"))

    step_keys = [str(s["n"]) for s in r["steps"]] + ["none"]
    out.update({
        "catch_counts": {k: catch_counts.get(k, 0) for k in step_keys},
        "pct_caught": _pct(len(caught), n),
        "fix_counts": {o["id"]: fix_counts.get(o["id"], 0) for o in r["fix_options"]},
        "pct_fix": _pct(fix_right, n),
        "why_counts": [{"id": w["id"], "label": w["label"], "count": why_counts.get(w["id"], 0)} for w in r["why_options"]],
        "pct_why": _pct(why_right, n),
        "scoreboard": sorted(
            ({"name": t["name"], "points": points(r, t["subs"], scoring)} for t in submitted),
            key=lambda x: (-x["points"], x["name"].lower()),
        ),
        "insights": insights(r, submitted, catch_counts, labels),
    })
    return out


def insights(r: dict[str, Any], submitted: list[dict[str, Any]], catch_counts: Counter, labels: dict[str, str]) -> list[str]:
    """Teaching takeaways. Every sentence is computed from the actual submissions."""
    n = len(submitted)
    caught = sum(1 for t in submitted if t["subs"]["catch"]["correct"])
    lines: list[str] = []
    if r["is_fully_correct"]:
        lines.append(f"{caught} of {n} teams correctly said the AI made no mistake.")
        wrong = [(k, c) for k, c in catch_counts.items() if k != "none" and c > 0]
        if wrong:
            k, c = max(wrong, key=lambda kc: kc[1])
            lines.append(f"The step most often flagged by mistake was step {k} ({c} {'team' if c == 1 else 'teams'}). It is valid; worth explaining why.")
        return lines

    first = r["first_incorrect_step"]
    lines.append(f"{caught} of {n} teams found that the first mistake is in step {first}.")
    wrong = [(k, c) for k, c in catch_counts.items() if k != str(first) and c > 0]
    if wrong:
        k, c = max(wrong, key=lambda kc: kc[1])
        where = "said there was no mistake" if k == "none" else f"picked step {k}"
        lines.append(f"The most common wrong answer: {c} {'team' if c == 1 else 'teams'} {where}.")
    caught_teams = [t for t in submitted if t["subs"]["catch"]["correct"] and "explain" in t["subs"]]
    wrong_why = Counter(t["subs"]["explain"]["choice"] for t in caught_teams if not t["subs"]["explain"]["correct"])
    if wrong_why:
        w, c = wrong_why.most_common(1)[0]
        lines.append(
            f"Of the teams that caught it, {c} blamed \u201c{labels.get(w, w)}\u201d instead of "
            f"\u201c{labels.get(r['correct_why'], r['correct_why'])}\u201d."
        )
    return lines
