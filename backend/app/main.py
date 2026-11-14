"""Catch the AI classroom server.

Run locally:  uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import contextlib
import os
from typing import Any, Literal

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from . import db
from .logic import InvalidChoice, aggregate, judge, max_points, next_phase, points
from .pack import get_round, load_pack, options_view, public_round, reveal_view


# --- live updates ----------------------------------------------------------

class Hub:
    """Tells connected clients "room changed, refetch". Clients that can't hold
    a WebSocket fall back to polling GET /state, so this is an optimisation,
    never the source of truth."""

    def __init__(self) -> None:
        self.rooms: dict[str, set[WebSocket]] = {}

    async def broadcast(self, code: str, version: int) -> None:
        for ws in list(self.rooms.get(code, ())):
            try:
                await ws.send_json({"type": "update", "version": version})
            except Exception:
                self.rooms.get(code, set()).discard(ws)


hub = Hub()


async def changed(code: str) -> None:
    await hub.broadcast(code, db.bump(code))


async def ticker() -> None:
    """Server-authoritative timer: closes rooms whose deadline has passed."""
    n = 0
    while True:
        await asyncio.sleep(1)
        with contextlib.suppress(Exception):
            for code in db.overdue_rooms():
                if db.finish_room(code):
                    await changed(code)
            n += 1
            if n % 60 == 0:
                db.purge_expired()


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    db.conn()
    db.purge_expired()
    task = asyncio.create_task(ticker())
    yield
    task.cancel()


app = FastAPI(title="Catch the AI classroom API", lifespan=lifespan)
origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])


# --- helpers ---------------------------------------------------------------

def room_or_404(code: str) -> dict[str, Any]:
    room = db.get_room(code)
    if not room:
        raise HTTPException(404, "This room code doesn't exist or has expired.")
    return room


async def settle(room: dict[str, Any]) -> dict[str, Any]:
    """Apply the deadline immediately if the ticker hasn't yet."""
    if room["status"] == "running" and room["deadline_ms"] <= db.now_ms():
        if db.finish_room(room["code"]):
            await changed(room["code"])
        room = db.get_room(room["code"]) or room
    return room


def build_state(room: dict[str, Any], host: bool, team: dict[str, Any] | None) -> dict[str, Any]:
    pack = load_pack()
    r = get_round(room["round_id"])
    assert r is not None
    teams = db.teams_with_subs(room["code"])
    finished = room["status"] == "finished"
    state: dict[str, Any] = {
        "code": room["code"],
        "status": room["status"],
        "duration_s": room["duration_s"],
        "deadline_ms": room["deadline_ms"],
        "server_now_ms": db.now_ms(),
        "version": room["version"],
        "topic_name": next((t["name"] for t in pack["topics"] if t["id"] == r["topic"]), r["topic"]),
        "round": public_round(r),
        "team_count": len(teams),
        "role": "host" if host else "team" if team else "viewer",
    }
    if host:
        state["teams"] = [{"name": t["name"], "submitted": "catch" in t["subs"],
                           "done": next_phase(r, t["subs"]) == "done"} for t in teams]
        state["submitted_count"] = sum(1 for t in teams if "catch" in t["subs"])
        if finished:
            state["results"] = aggregate(r, teams, pack)
    if team:
        subs = db.team_subs(team["id"])
        you: dict[str, Any] = {
            "name": team["name"],
            "phase": next_phase(r, subs),
            "subs": subs,
            "points": points(r, subs, pack["scoring"]),
            "max_points": max_points(r, pack["scoring"]),
        }
        if "catch" in subs and not r["is_fully_correct"]:
            you["options"] = options_view(r)
        state["you"] = you
    if finished:
        state["reveal"] = reveal_view(r)
    return state


# --- request models --------------------------------------------------------

class CreateRoom(BaseModel):
    round_id: str = Field(max_length=64)
    duration_s: int = Field(default=180, ge=60, le=600)


class JoinRoom(BaseModel):
    team_name: str = Field(min_length=1, max_length=40)

    @field_validator("team_name")
    @classmethod
    def clean(cls, v: str) -> str:
        v = " ".join(v.split())
        if not 1 <= len(v) <= 24:
            raise ValueError("Team names are 1 to 24 characters.")
        return v


class Submit(BaseModel):
    phase: Literal["catch", "fix", "explain"]
    choice: str = Field(min_length=1, max_length=32)


# --- routes ----------------------------------------------------------------

@app.get("/api/health")
def health() -> dict[str, Any]:
    p = load_pack()
    return {"ok": True, "pack_version": p["pack_version"], "rounds": len(p["rounds"])}


@app.get("/api/topics")
def topics() -> list[dict[str, Any]]:
    p = load_pack()
    return [{**t, "rounds": sum(1 for r in p["rounds"] if r["topic"] == t["id"])} for t in p["topics"]]


@app.get("/api/packs/{topic}")
def pack_for_topic(topic: str) -> dict[str, Any]:
    p = load_pack()
    rounds = [public_round(r) for r in p["rounds"] if r["topic"] == topic]
    if not rounds:
        raise HTTPException(404, f"No rounds for topic {topic!r}.")
    return {"pack_version": p["pack_version"], "topic": topic, "rounds": rounds}


@app.post("/api/rooms")
def create_room(body: CreateRoom) -> dict[str, Any]:
    if not get_round(body.round_id):
        raise HTTPException(404, "That round isn't in the current pack.")
    code, host_token = db.create_room(body.round_id, body.duration_s)
    return {"code": code, "host_token": host_token}


@app.post("/api/rooms/{code}/join")
async def join_room(code: str, body: JoinRoom) -> dict[str, Any]:
    room = await settle(room_or_404(code))
    if room["status"] == "finished":
        raise HTTPException(409, "This round has already finished.")
    try:
        team_id, token = db.add_team(room["code"], body.team_name)
    except db.JoinError as e:
        raise HTTPException(409, str(e))
    await changed(room["code"])
    return {"team_token": token, "team_name": body.team_name, "code": room["code"]}


@app.post("/api/rooms/{code}/start")
async def start(code: str, x_host_token: str | None = Header(default=None)) -> dict[str, Any]:
    room = room_or_404(code)
    if not db.is_host(room, x_host_token):
        raise HTTPException(403, "Only the professor who created this room can start it.")
    if room["status"] != "lobby":
        raise HTTPException(409, "This round has already started.")
    if not db.teams_with_subs(room["code"]):
        raise HTTPException(409, "Wait for at least one team to join.")
    db.start_room(room["code"])
    await changed(room["code"])
    return build_state(db.get_room(room["code"]), host=True, team=None)


@app.post("/api/rooms/{code}/reveal")
async def reveal(code: str, x_host_token: str | None = Header(default=None)) -> dict[str, Any]:
    room = room_or_404(code)
    if not db.is_host(room, x_host_token):
        raise HTTPException(403, "Only the professor who created this room can end it.")
    if room["status"] == "lobby":
        raise HTTPException(409, "Start the round before revealing it.")
    if db.finish_room(room["code"]):
        await changed(room["code"])
    return build_state(db.get_room(room["code"]), host=True, team=None)


@app.get("/api/rooms/{code}/state")
async def state(code: str, x_host_token: str | None = Header(default=None),
                x_team_token: str | None = Header(default=None)) -> dict[str, Any]:
    room = await settle(room_or_404(code))
    host = db.is_host(room, x_host_token)
    team = db.team_by_token(room["code"], x_team_token)
    return build_state(room, host, team)


@app.post("/api/rooms/{code}/submit")
async def submit(code: str, body: Submit, x_team_token: str | None = Header(default=None)) -> dict[str, Any]:
    room = await settle(room_or_404(code))
    team = db.team_by_token(room["code"], x_team_token)
    if not team:
        raise HTTPException(403, "Join this room as a team before answering.")
    if room["status"] == "lobby":
        raise HTTPException(409, "The professor hasn't started the round yet.")
    if room["status"] == "finished":
        raise HTTPException(409, "Time is up. Answers are closed.")
    r = get_round(room["round_id"])
    assert r is not None
    subs = db.team_subs(team["id"])
    if body.phase in subs:  # duplicate (e.g. double tap or retry): never re-scored
        return build_state(room, host=False, team=team)
    if body.phase != next_phase(r, subs):
        raise HTTPException(409, f"Answer the {next_phase(r, subs)} step first.")
    try:
        correct = judge(r, body.phase, body.choice)
    except InvalidChoice as e:
        raise HTTPException(422, str(e))
    if db.add_submission(team["id"], body.phase, body.choice, correct):
        await changed(room["code"])
    return build_state(db.get_room(room["code"]), host=False, team=team)


@app.get("/api/rooms/{code}/results")
async def results(code: str, x_host_token: str | None = Header(default=None)) -> dict[str, Any]:
    room = await settle(room_or_404(code))
    if not db.is_host(room, x_host_token):
        raise HTTPException(403, "Only the professor who created this room can see results.")
    if room["status"] != "finished":
        raise HTTPException(409, "Results open after the reveal, so the projector never shows answers mid-round.")
    r = get_round(room["round_id"])
    return aggregate(r, db.teams_with_subs(room["code"]), load_pack())


@app.get("/api/demo/sample-results/{round_id}")
def sample_results(round_id: str) -> dict[str, Any]:
    """Clearly labelled demonstration data for rooms with fewer than 3 teams.
    Synthetic teams are run through the same judging and aggregation code."""
    r = get_round(round_id)
    if not r:
        raise HTTPException(404, "That round isn't in the current pack.")
    if r["is_fully_correct"]:
        plan = [("none",), ("none",), ("none",), ("none",), ("none",), ("2",), ("2",), ("4",)]
    else:
        first = str(r["first_incorrect_step"])
        other = "1" if first != "1" else "2"
        good_fix = r["correct_fix"]
        bad_fix = next(o["id"] for o in r["fix_options"] if o["id"] != good_fix)
        good_why = r["correct_why"]
        bad_why = next(w["id"] for w in r["why_options"] if w["id"] != good_why)
        plan = [(first, good_fix, good_why), (first, good_fix, bad_why), (first, good_fix, bad_why),
                (first, bad_fix, good_why), (first, good_fix, good_why), (other, good_fix, good_why),
                ("none", bad_fix, bad_why), (other, bad_fix, bad_why)]
    teams = []
    for i, choices in enumerate(plan, start=1):
        subs = {}
        for phase, choice in zip(("catch", "fix", "explain"), choices):
            subs[phase] = {"choice": choice, "correct": judge(r, phase, choice)}
        teams.append({"name": f"Sample team {i}", "subs": subs})
    return {**aggregate(r, teams, load_pack()), "sample": True}


@app.websocket("/api/rooms/{code}/ws")
async def room_socket(ws: WebSocket, code: str) -> None:
    room = db.get_room(code)
    if not room:
        await ws.close(code=4404)
        return
    await ws.accept()
    hub.rooms.setdefault(room["code"], set()).add(ws)
    try:
        await ws.send_json({"type": "update", "version": room["version"]})
        while True:
            await ws.receive_text()  # clients may send pings; content ignored
    except WebSocketDisconnect:
        pass
    finally:
        hub.rooms.get(room["code"], set()).discard(ws)
