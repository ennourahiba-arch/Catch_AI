"""Acceptance Test B (real classroom) and Test I (privacy), plus abuse cases."""
import json

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app
from app.pack import get_round

DEMO = "int-demo-endpoints"


@pytest.fixture()
def client(tmp_path):
    db.reset_for_tests(str(tmp_path / "test.db"))
    with TestClient(app) as c:
        yield c


def make_room(c, round_id=DEMO):
    r = c.post("/api/rooms", json={"round_id": round_id})
    assert r.status_code == 200
    return r.json()["code"], {"X-Host-Token": r.json()["host_token"]}


def join(c, code, name):
    r = c.post(f"/api/rooms/{code}/join", json={"team_name": name})
    assert r.status_code == 200, r.text
    return {"X-Team-Token": r.json()["team_token"]}


def submit(c, code, team, phase, choice):
    return c.post(f"/api/rooms/{code}/submit", json={"phase": phase, "choice": choice}, headers=team)


def test_full_class_round(client):
    """Test B: professor + 3 teams on separate sessions, accurate summary."""
    c = client
    code, host = make_room(c)
    r = get_round(DEMO)
    a, b, d = join(c, code, "Limits"), join(c, code, "Tangents"), join(c, code, "Epsilons")
    assert c.get(f"/api/rooms/{code}/state", headers=host).json()["team_count"] == 3
    assert c.post(f"/api/rooms/{code}/start", headers=host).status_code == 200

    # Team A: perfect. Team B: catch right, wrong fix, wrong why. Team D: wrong catch.
    wrong_fix = next(o["id"] for o in r["fix_options"] if o["id"] != r["correct_fix"])
    wrong_why = next(w["id"] for w in r["why_options"] if w["id"] != r["correct_why"])
    for phase, choice in [("catch", "4"), ("fix", r["correct_fix"]), ("explain", "forgot_endpoints")]:
        assert submit(c, code, a, phase, choice).status_code == 200
    for phase, choice in [("catch", "4"), ("fix", wrong_fix), ("explain", wrong_why)]:
        submit(c, code, b, phase, choice)
    s = submit(c, code, d, "catch", "3").json()
    assert s["you"]["subs"]["catch"]["correct"] is False
    assert s["you"]["points"] == 0

    assert c.get(f"/api/rooms/{code}/results", headers=host).status_code == 409  # not during the round
    c.post(f"/api/rooms/{code}/reveal", headers=host)
    res = c.get(f"/api/rooms/{code}/results", headers=host).json()
    assert res["locked"] is False and res["teams_submitted"] == 3
    assert res["catch_counts"]["4"] == 2 and res["catch_counts"]["3"] == 1
    assert res["pct_caught"] == 67 and res["pct_fix"] == 33 and res["pct_why"] == 33
    assert [t["points"] for t in res["scoreboard"]] == [4, 2, 0]
    assert res["insights"][0] == "2 of 3 teams found that the first mistake is in step 4."


def test_answer_key_never_sent_before_catch(client):
    c = client
    code, host = make_room(c)
    team = join(c, code, "Peekers")
    c.post(f"/api/rooms/{code}/start", headers=host)
    raw = json.dumps(c.get(f"/api/rooms/{code}/state", headers=team).json())
    for leak in ("correct_fix", "correct_why", "first_incorrect_step", "is_fully_correct",
                 "verdict", "correct_solution", "verified_answer", "claim"):
        assert leak not in raw, leak


def test_non_host_cannot_start_or_reveal(client):
    c = client
    code, _ = make_room(c)
    team = join(c, code, "Sneaky")
    assert c.post(f"/api/rooms/{code}/start", headers=team).status_code == 403
    assert c.post(f"/api/rooms/{code}/start", headers={"X-Host-Token": "guess"}).status_code == 403
    assert c.post(f"/api/rooms/{code}/reveal").status_code == 403


def test_duplicate_submissions_do_not_rescore(client):
    c = client
    code, host = make_room(c)
    team = join(c, code, "Double tap")
    c.post(f"/api/rooms/{code}/start", headers=host)
    submit(c, code, team, "catch", "3")       # wrong
    s = submit(c, code, team, "catch", "4").json()  # retry with right answer is ignored
    assert s["you"]["subs"]["catch"] == {"choice": "3", "correct": False}
    assert s["you"]["points"] == 0


def test_phase_order_and_validation(client):
    c = client
    code, host = make_room(c)
    team = join(c, code, "Skippers")
    assert submit(c, code, team, "catch", "4").status_code == 409  # not started
    c.post(f"/api/rooms/{code}/start", headers=host)
    assert submit(c, code, team, "fix", "f1").status_code == 409   # must catch first
    assert submit(c, code, team, "catch", "9").status_code == 422  # no step 9
    assert submit(c, code, team, "catch", "4").status_code == 200
    assert submit(c, code, team, "fix", "zzz").status_code == 422


def test_deadline_is_enforced_by_server(client):
    c = client
    code, host = make_room(c)
    team = join(c, code, "Late")
    c.post(f"/api/rooms/{code}/start", headers=host)
    db.ex("UPDATE rooms SET deadline_ms = ? WHERE code = ?", (db.now_ms() - 1, code))
    r = submit(c, code, team, "catch", "4")
    assert r.status_code == 409
    assert c.get(f"/api/rooms/{code}/state", headers=team).json()["status"] == "finished"


def test_privacy_threshold_with_two_teams(client):
    """Test I: breakdowns stay hidden below 3 submitting teams."""
    c = client
    code, host = make_room(c)
    t1, t2 = join(c, code, "One"), join(c, code, "Two")
    c.post(f"/api/rooms/{code}/start", headers=host)
    submit(c, code, t1, "catch", "4")
    submit(c, code, t2, "catch", "2")
    c.post(f"/api/rooms/{code}/reveal", headers=host)
    res = c.get(f"/api/rooms/{code}/results", headers=host).json()
    assert res["locked"] is True
    assert "catch_counts" not in res and "scoreboard" not in res


def test_sample_data_is_labelled(client):
    res = client.get(f"/api/demo/sample-results/{DEMO}").json()
    assert res["sample"] is True and res["locked"] is False


def test_mistake_free_round(client):
    """Test D in class: 'none' is correct and the team is done."""
    c = client
    clean = "int-07"
    code, host = make_room(c, clean)
    team = join(c, code, "Trusting")
    c.post(f"/api/rooms/{code}/start", headers=host)
    s = submit(c, code, team, "catch", "none").json()
    assert s["you"]["phase"] == "done" and s["you"]["points"] == 4
    assert "options" not in s["you"]


def test_team_names_unique_and_clean(client):
    c = client
    code, _ = make_room(c)
    join(c, code, "  The   Derivers ")
    r = c.post(f"/api/rooms/{code}/join", json={"team_name": "the derivers"})
    assert r.status_code == 409
    assert c.post(f"/api/rooms/{code}/join", json={"team_name": "   "}).status_code == 422


def test_unknown_room(client):
    assert client.get("/api/rooms/ZZZZZ/state").status_code == 404


def test_websocket_receives_updates(client):
    c = client
    code, host = make_room(c)
    with c.websocket_connect(f"/api/rooms/{code}/ws") as ws:
        first = ws.receive_json()
        join(c, code, "Listener")
        second = ws.receive_json()
        assert second["type"] == "update" and second["version"] > first["version"]
