"""Rehearsal server: live class quizzes and AI-backed practice from uploaded material.

Run locally:  uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
from typing import Any

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator

from . import db, extract, genpack, llm, oral, ratelimit
from .pack import calculus_question, get_exercise, load_pack, topic_name
from .quiz import public_question, question_results, summary


# --- live updates ----------------------------------------------------------

class Hub:
    """Tells connected clients "room changed, refetch". Clients that can't hold a
    WebSocket poll GET /state instead, so this is an optimisation, never the truth."""

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
    """Server-authoritative timer: closes questions whose time is up."""
    n = 0
    while True:
        await asyncio.sleep(1)
        with contextlib.suppress(Exception):
            for code in db.overdue_rooms():
                if db.reveal(code):
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


app = FastAPI(title="Rehearsal API", lifespan=lifespan)
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
    if room["status"] == "question" and room["deadline_ms"] and room["deadline_ms"] <= db.now_ms():
        if db.reveal(room["code"]):
            await changed(room["code"])
        room = db.get_room(room["code"]) or room
    return room


def build_state(room: dict[str, Any], host: bool, team: dict[str, Any] | None) -> dict[str, Any]:
    questions = json.loads(room["quiz_json"])
    teams = db.teams_with_answers(room["code"])
    i, total, status = room["q_index"], len(questions), room["status"]
    state: dict[str, Any] = {
        "code": room["code"], "title": room["title"], "status": status,
        "q_index": i, "total": total, "per_q_s": room["per_q_s"],
        "deadline_ms": room["deadline_ms"], "server_now_ms": db.now_ms(), "version": room["version"],
        "team_count": len(teams), "role": "host" if host else "team" if team else "viewer",
    }
    if status in ("question", "reveal"):
        state["question"] = public_question(questions[i], i, total)
        state["answered_count"] = sum(1 for t in teams if i in t["answers"])
    if status == "reveal":
        state["result"] = question_results(questions[i], [t["answers"][i]["choice"] for t in teams if i in t["answers"]])
    if host:
        state["teams"] = [{"name": t["name"], "answered": i in t["answers"] and status in ("question", "reveal")} for t in teams]
        if status == "finished":
            state["summary"] = summary(questions, teams)
    if team:
        mine = next((t for t in teams if t["id"] == team["id"]), {"answers": {}})["answers"]
        state["you"] = {
            "name": team["name"],
            "score": sum(1 for a in mine.values() if a["correct"]),
            "answer": mine.get(i, {}).get("choice") if status in ("question", "reveal") else None,
        }
        if status == "reveal":
            state["you"]["was_right"] = mine.get(i, {}).get("correct")
        if status == "finished":
            state["you"]["history"] = [{"index": k, "was_right": a["correct"]} for k, a in sorted(mine.items())]
    return state


# --- request models --------------------------------------------------------

class OptionIn(BaseModel):
    text: str = Field(default="", max_length=600)
    latex: str = Field(default="", max_length=600)


class SolutionIn(BaseModel):
    text: str = Field(default="", max_length=2000)
    latex: str = Field(default="", max_length=600)
    quote: str = Field(default="", max_length=400)
    source: str = Field(default="", max_length=200)


class QuestionIn(BaseModel):
    """A multiple-choice question from uploaded material, approved by the professor."""
    id: str = Field(max_length=64)
    prompt: str = Field(min_length=3, max_length=800)
    latex: str = Field(default="", max_length=600)
    options: list[OptionIn] = Field(min_length=2, max_length=4)
    correct: int = Field(ge=0, le=3)
    labels: list[str | None] = Field(default_factory=list, max_length=4)
    solution: list[SolutionIn] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def check(self) -> "QuestionIn":
        if self.correct >= len(self.options):
            raise ValueError("the correct option must be one of the options")
        if any(not (o.text.strip() or o.latex.strip()) for o in self.options):
            raise ValueError("options can't be empty")
        return self


class CreateRoom(BaseModel):
    title: str = Field(default="Class quiz", max_length=80)
    exercise_ids: list[str] = Field(default_factory=list, max_length=20)   # verified Calculus questions
    questions: list[QuestionIn] = Field(default_factory=list, max_length=20)  # approved uploaded questions
    seconds_per_question: int = Field(default=45, ge=15, le=180)


class JoinRoom(BaseModel):
    team_name: str = Field(min_length=1, max_length=40)

    @field_validator("team_name")
    @classmethod
    def clean(cls, v: str) -> str:
        v = " ".join(v.split())
        if not 1 <= len(v) <= 24:
            raise ValueError("Team names are 1 to 24 characters.")
        return v


class Answer(BaseModel):
    q_index: int = Field(ge=0, le=19)
    choice: int = Field(ge=0, le=3)


# --- quiz routes -------------------------------------------------------------

@app.get("/api/health")
def health() -> dict[str, Any]:
    p = load_pack()
    return {"ok": True, "pack_version": p["pack_version"], "questions": len(p["exercises"])}


@app.post("/api/rooms")
def create_room(body: CreateRoom) -> dict[str, Any]:
    questions: list[dict[str, Any]] = []
    for eid in body.exercise_ids:
        e = get_exercise(eid)
        if not e:
            raise HTTPException(404, f"Question {eid} isn't in the current Calculus pack.")
        questions.append(calculus_question(e))
    questions += [q.model_dump() for q in body.questions]
    if not 1 <= len(questions) <= 20:
        raise HTTPException(422, "Choose between 1 and 20 questions.")
    title = body.title
    if body.exercise_ids and title == "Class quiz":
        title = topic_name(get_exercise(body.exercise_ids[0])["topic"])
    code, host_token = db.create_room(title, json.dumps(questions), body.seconds_per_question)
    return {"code": code, "host_token": host_token}


@app.post("/api/rooms/{code}/join")
async def join_room(code: str, body: JoinRoom) -> dict[str, Any]:
    room = await settle(room_or_404(code))
    if room["status"] == "finished":
        raise HTTPException(409, "This quiz has already finished.")
    try:
        _, token = db.add_team(room["code"], body.team_name)
    except db.JoinError as e:
        raise HTTPException(409, str(e))
    await changed(room["code"])
    return {"team_token": token, "team_name": body.team_name, "code": room["code"]}


def _host(room: dict[str, Any], token: str | None, action: str) -> None:
    if not db.is_host(room, token):
        raise HTTPException(403, f"Only the professor who created this quiz can {action} it.")


@app.post("/api/rooms/{code}/start")
async def start(code: str, x_host_token: str | None = Header(default=None)) -> dict[str, Any]:
    room = room_or_404(code)
    _host(room, x_host_token, "start")
    if room["status"] != "lobby":
        raise HTTPException(409, "This quiz has already started.")
    if not db.teams_with_answers(room["code"]):
        raise HTTPException(409, "Wait for at least one team to join.")
    db.open_question(room["code"], 0, room["per_q_s"])
    await changed(room["code"])
    return build_state(db.get_room(room["code"]), host=True, team=None)


@app.post("/api/rooms/{code}/next")
async def next_step(code: str, x_host_token: str | None = Header(default=None)) -> dict[str, Any]:
    """Question -> reveal answers early. Reveal -> next question, or finish after the last one."""
    room = await settle(room_or_404(code))
    _host(room, x_host_token, "control")
    total = len(json.loads(room["quiz_json"]))
    if room["status"] == "question":
        db.reveal(room["code"])
    elif room["status"] == "reveal":
        if room["q_index"] + 1 < total:
            db.open_question(room["code"], room["q_index"] + 1, room["per_q_s"])
        else:
            db.finish(room["code"])
    else:
        raise HTTPException(409, "There's nothing to move on to right now.")
    await changed(room["code"])
    return build_state(db.get_room(room["code"]), host=True, team=None)


@app.get("/api/rooms/{code}/state")
async def state(code: str, x_host_token: str | None = Header(default=None),
                x_team_token: str | None = Header(default=None)) -> dict[str, Any]:
    room = await settle(room_or_404(code))
    return build_state(room, db.is_host(room, x_host_token), db.team_by_token(room["code"], x_team_token))


@app.post("/api/rooms/{code}/answer")
async def answer(code: str, body: Answer, x_team_token: str | None = Header(default=None)) -> dict[str, Any]:
    room = await settle(room_or_404(code))
    team = db.team_by_token(room["code"], x_team_token)
    if not team:
        raise HTTPException(403, "Join this quiz as a team before answering.")
    if room["status"] != "question" or body.q_index != room["q_index"]:
        raise HTTPException(409, "Answers for this question are closed.")
    q = json.loads(room["quiz_json"])[room["q_index"]]
    if body.choice >= len(q["options"]):
        raise HTTPException(422, "That isn't one of the options.")
    if db.add_answer(team["id"], room["q_index"], body.choice, body.choice == q["correct"]):
        await changed(room["code"])
    return build_state(db.get_room(room["code"]), host=False, team=team)


@app.get("/api/rooms/{code}/results")
async def results(code: str, x_host_token: str | None = Header(default=None)) -> dict[str, Any]:
    room = await settle(room_or_404(code))
    _host(room, x_host_token, "see results for")
    if room["status"] != "finished":
        raise HTTPException(409, "The summary opens when the quiz ends.")
    return summary(json.loads(room["quiz_json"]), db.teams_with_answers(room["code"]))


@app.get("/api/rooms/{code}/sample")
def sample(code: str, x_host_token: str | None = Header(default=None)) -> dict[str, Any]:
    """Clearly labelled demonstration data for rooms with fewer than 3 teams.
    Invented teams are run through the same summary code as real ones."""
    room = room_or_404(code)
    _host(room, x_host_token, "see this for")
    questions = json.loads(room["quiz_json"])
    teams = []
    for t in range(8):
        answers = {}
        for i, q in enumerate(questions):
            wrong = next((k for k in range(len(q["options"])) if k != q["correct"]), 0)
            choice = q["correct"] if (t + i) % 3 != 0 else wrong
            answers[i] = {"choice": choice, "correct": choice == q["correct"]}
        teams.append({"name": f"Sample team {t + 1}", "answers": answers})
    return {**summary(questions, teams), "sample": True}


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
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        hub.rooms.get(room["code"], set()).discard(ws)


# --- AI features: practice from uploaded material ------------------------------

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
    count: int = Field(default=10, ge=3, le=20)


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


class MockIn(BaseModel):
    passages: list[PassageIn] = Field(min_length=1, max_length=200)
    past_exams: str = Field(default="", max_length=30000)
    mcq: int = Field(default=10, ge=0, le=25)
    written: int = Field(default=3, ge=0, le=8)


@app.post("/api/mock-exam")
async def mock_exam(body: MockIn, request: Request) -> dict[str, Any]:
    """Questions for a timed mock exam across several lessons: a multiple-choice part
    and a written part, generated in parallel with the same checks as practice questions."""
    if body.mcq + body.written == 0:
        raise HTTPException(422, "Choose at least one question.")
    ratelimit.check(request, "generate")
    passages = [p.model_dump() for p in body.passages]
    if sum(len(p["text"]) for p in passages) > extract.MAX_MATERIAL_CHARS + 5000:
        raise HTTPException(413, "That's too much material for one exam. Choose fewer lessons.")
    parts = [("quiz", body.mcq), ("written", body.written)]
    jobs = [genpack.generate(fmt, passages, body.past_exams, n) for fmt, n in parts if n > 0]
    results = await asyncio.gather(*jobs, return_exceptions=True)
    out: dict[str, Any] = {"mcq": None, "written": None, "exam_profile": None, "errors": []}
    for (fmt, n), res in zip([p for p in parts if p[1] > 0], results):
        key = "mcq" if fmt == "quiz" else "written"
        if isinstance(res, Exception):
            out["errors"].append(str(res) if isinstance(res, (llm.LLMError, genpack.GenerationError)) else "generation failed")
        else:
            out[key] = res
            out["exam_profile"] = out["exam_profile"] or res.get("exam_profile")
    if not out["mcq"] and not out["written"]:
        raise _ai_error(results[0]) if isinstance(results[0], (llm.LLMError, genpack.GenerationError)) else HTTPException(500, "Generation failed. Try again.")
    return out


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
