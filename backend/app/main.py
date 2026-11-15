"""Catch the AI classroom server.

Run locally:  uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import contextlib
import os
from typing import Any, Literal

import json

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator

from . import db, extract, genpack, llm, oral, ratelimit
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

def room_round(room: dict[str, Any]) -> dict[str, Any]:
    """The room's round: an approved custom round stored with the room, or a built-in one."""
    if room.get("round_json"):
        return json.loads(room["round_json"])
    r = get_round(room["round_id"])
    assert r is not None
    return r


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
    r = room_round(room)
    teams = db.teams_with_subs(room["code"])
    finished = room["status"] == "finished"
    state: dict[str, Any] = {
        "code": room["code"],
        "status": room["status"],
        "duration_s": room["duration_s"],
        "deadline_ms": room["deadline_ms"],
        "server_now_ms": db.now_ms(),
        "version": room["version"],
        "topic_name": r.get("topic_name") or next((t["name"] for t in pack["topics"] if t["id"] == r["topic"]), r["topic"]),
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

class StepIn(BaseModel):
    n: int = Field(ge=1, le=6)
    text: str = Field(max_length=1500)
    latex: str = Field(default="", max_length=600)
    detail: str = Field(default="", max_length=1500)


class OptIn(BaseModel):
    id: str = Field(max_length=8)
    text: str = Field(default="", max_length=1500)
    latex: str = Field(default="", max_length=600)


class WhyIn(BaseModel):
    id: str = Field(max_length=24)
    label: str = Field(max_length=200)


class SolIn(BaseModel):
    text: str = Field(max_length=2000)
    latex: str = Field(default="", max_length=600)
    quote: str = Field(default="", max_length=400)
    source: str = Field(default="", max_length=200)


class CustomRound(BaseModel):
    """A round generated from uploaded material and approved by the professor.
    Validated for consistency, then stored with the room until it expires."""
    id: str = Field(max_length=64)
    topic: str = Field(max_length=64)
    topic_name: str = Field(default="Your course", max_length=80)
    difficulty: int = Field(default=2, ge=1, le=3)
    problem_statement: dict[str, str]
    steps: list[StepIn] = Field(min_length=2, max_length=6)
    first_incorrect_step: int | None
    is_fully_correct: bool
    fix_options: list[OptIn] = Field(max_length=4)
    correct_fix: str | None
    why_options: list[WhyIn] = Field(max_length=4)
    correct_why: str | None
    correct_solution: list[SolIn] = Field(max_length=10)
    verified_answer: dict[str, str]
    key_lesson: str = Field(max_length=600)
    verification_status: dict[str, Any]
    source_provenance: dict[str, Any] = Field(default_factory=dict)
    pack_version: str = Field(default="custom", max_length=20)

    @model_validator(mode="after")
    def consistent(self) -> "CustomRound":
        if [s.n for s in self.steps] != list(range(1, len(self.steps) + 1)):
            raise ValueError("steps must be numbered 1, 2, 3...")
        if len(json.dumps(self.problem_statement)) > 1500 or len(json.dumps(self.verified_answer)) > 2500:
            raise ValueError("round text is too long")
        if self.is_fully_correct:
            if self.first_incorrect_step is not None:
                raise ValueError("a mistake-free round can't have a first error")
            return self
        if not self.first_incorrect_step or not 1 <= self.first_incorrect_step <= len(self.steps):
            raise ValueError("first_incorrect_step must point at a step")
        if len(self.fix_options) < 2 or self.correct_fix not in {o.id for o in self.fix_options}:
            raise ValueError("fix options must include the correct fix")
        if len(self.why_options) < 2 or self.correct_why not in {w.id for w in self.why_options}:
            raise ValueError("explanation options must include the correct reason")
        return self


class CreateRoom(BaseModel):
    round_id: str = Field(default="", max_length=64)
    custom_round: CustomRound | None = None
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
    if body.custom_round:
        code, host_token = db.create_room(body.custom_round.id, body.duration_s, json.dumps(body.custom_round.model_dump()))
        return {"code": code, "host_token": host_token}
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
    r = room_round(room)
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
    return aggregate(room_round(room), db.teams_with_subs(room["code"]), load_pack())


@app.get("/api/demo/sample-results/{round_id}")
def sample_results(round_id: str) -> dict[str, Any]:
    """Clearly labelled demonstration data for rooms with fewer than 3 teams.
    Synthetic teams are run through the same judging and aggregation code."""
    r = get_round(round_id)
    if not r:
        raise HTTPException(404, "That round isn't in the current pack.")
    return _sample(r)


@app.get("/api/rooms/{code}/sample")
def room_sample(code: str, x_host_token: str | None = Header(default=None)) -> dict[str, Any]:
    room = room_or_404(code)
    if not db.is_host(room, x_host_token):
        raise HTTPException(403, "Only the professor who created this room can see this.")
    return _sample(room_round(room))


def _sample(r: dict[str, Any]) -> dict[str, Any]:
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


# --- AI features: any subject ------------------------------------------------

def _ai_error(e: Exception) -> HTTPException:
    if isinstance(e, llm.LLMError):
        return HTTPException(502 if llm.status()["enabled"] else 503, str(e))
    if isinstance(e, genpack.GenerationError):
        return HTTPException(422, str(e))
    return HTTPException(500, "Something went wrong while generating. Try again.")


@app.get("/api/ai/status")
def ai_status() -> dict[str, Any]:
    return {**llm.status(), "access_code_required": bool(os.environ.get("ACCESS_CODE")),
            "limits": ratelimit.LIMITS, "max_files": extract.MAX_FILES}


@app.post("/api/material/extract")
async def extract_material(files: list[UploadFile] = File(...), kind: str = Form("material")) -> dict[str, Any]:
    """Reads files in memory and returns their text as numbered passages. No AI is
    called and nothing is stored: the browser keeps the result."""
    if len(files) > extract.MAX_FILES:
        raise HTTPException(413, f"Upload at most {extract.MAX_FILES} files at once.")
    docs, info = [], []
    for f in files:
        data = await f.read(extract.MAX_FILE_BYTES + 1)
        try:
            text = extract.extract_text(f.filename or "file", data)
        except extract.ExtractError as e:
            raise HTTPException(422, str(e))
        docs.append((f.filename or "file", text))
        info.append({"file": f.filename, "chars": len(text)})
    if kind == "past":
        joined = "\n\n".join(f"--- {n} ---\n{t}" for n, t in docs)
        return {"documents": info, "text": joined[: extract.MAX_PAST_EXAM_CHARS],
                "truncated": len(joined) > extract.MAX_PAST_EXAM_CHARS}
    passages, truncated = extract.to_passages(docs)
    return {"documents": info, "passages": passages, "truncated": truncated}


class PassageIn(BaseModel):
    id: str = Field(pattern=r"^P\d{1,4}$")
    file: str = Field(max_length=200)
    text: str = Field(max_length=4000)


class GenerateIn(BaseModel):
    format: genpack.Format
    passages: list[PassageIn] = Field(min_length=1, max_length=150)
    past_exams: str = Field(default="", max_length=30000)
    count: int = Field(default=4, ge=2, le=8)


@app.post("/api/generate")
async def generate(body: GenerateIn, request: Request) -> dict[str, Any]:
    ratelimit.check(request, "generate")
    passages = [p.model_dump() for p in body.passages]
    if sum(len(p["text"]) for p in passages) > extract.MAX_MATERIAL_CHARS + 5000:
        raise HTTPException(413, "That's too much material for one pack. Upload fewer chapters at a time.")
    try:
        return await genpack.generate(body.format, passages, body.past_exams, body.count)
    except (llm.LLMError, genpack.GenerationError) as e:
        raise _ai_error(e)


@app.post("/api/grade")
async def grade_answer(body: oral.GradeRequest, request: Request) -> dict[str, Any]:
    ratelimit.check(request, "message")
    try:
        return await oral.grade(body)
    except llm.LLMError as e:
        raise _ai_error(e)


@app.post("/api/oral/examiner")
async def oral_examiner(body: oral.ExaminerTurn, request: Request) -> dict[str, Any]:
    if any(m.role == "student" for m in body.history):
        ratelimit.check(request, "message")
    try:
        return await oral.examiner_turn(body)
    except llm.LLMError as e:
        raise _ai_error(e)


@app.post("/api/oral/candidate")
async def oral_candidate(body: oral.CandidateTurn, request: Request) -> dict[str, Any]:
    ratelimit.check(request, "message")
    try:
        return await oral.candidate_turn(body)
    except llm.LLMError as e:
        raise _ai_error(e)


@app.post("/api/oral/judge")
async def oral_judge(body: oral.CandidateJudge, request: Request) -> dict[str, Any]:
    ratelimit.check(request, "message")
    try:
        return await oral.candidate_judge(body)
    except llm.LLMError as e:
        raise _ai_error(e)
