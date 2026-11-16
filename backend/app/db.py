"""SQLite storage for temporary classroom sessions.

Stores only: room code, a hash of the host token, the round id, timing, team
nicknames with hashed tokens, and each team's choices. No names, emails, IPs
or chat. Rooms are deleted ROOM_TTL_MINUTES after creation.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import sqlite3
import threading
import time
from typing import Any

DB_PATH = os.environ.get("DB_PATH", "catchai.db")
ROOM_TTL_MINUTES = int(os.environ.get("ROOM_TTL_MINUTES", "180"))
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L
MAX_TEAMS = 60

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS quiz_rooms (
  code TEXT PRIMARY KEY,
  host_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  quiz_json TEXT NOT NULL,          -- the questions with their answer keys (deleted with the room)
  status TEXT NOT NULL,             -- lobby | question | reveal | finished
  q_index INTEGER NOT NULL DEFAULT 0,
  per_q_s INTEGER NOT NULL,
  deadline_ms INTEGER,
  created_ms INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS quiz_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL REFERENCES quiz_rooms(code) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  joined_ms INTEGER NOT NULL,
  UNIQUE (room_code, name_key)
);
CREATE TABLE IF NOT EXISTS answers (
  team_id INTEGER NOT NULL REFERENCES quiz_teams(id) ON DELETE CASCADE,
  q_index INTEGER NOT NULL,
  choice INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  PRIMARY KEY (team_id, q_index)    -- one answer per team per question
);
"""


def now_ms() -> int:
    return int(time.time() * 1000)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA foreign_keys = ON")
        _conn.executescript(SCHEMA)
    return _conn


def reset_for_tests(path: str) -> None:
    global _conn, DB_PATH
    if _conn is not None:
        _conn.close()
    _conn, DB_PATH = None, path


def q(sql: str, args: tuple = ()) -> list[sqlite3.Row]:
    with _lock:
        return conn().execute(sql, args).fetchall()


def ex(sql: str, args: tuple = ()) -> sqlite3.Cursor:
    with _lock:
        return conn().execute(sql, args)


# --- rooms -----------------------------------------------------------------

def create_room(title: str, quiz_json: str, per_q_s: int) -> tuple[str, str]:
    host_token = secrets.token_urlsafe(24)
    for _ in range(20):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(5))
        try:
            ex("INSERT INTO quiz_rooms (code, host_hash, title, quiz_json, status, per_q_s, created_ms) VALUES (?,?,?,?,?,?,?)",
               (code, hash_token(host_token), title, quiz_json, "lobby", per_q_s, now_ms()))
            return code, host_token
        except sqlite3.IntegrityError:
            continue
    raise RuntimeError("could not allocate a room code")


def get_room(code: str) -> dict[str, Any] | None:
    rows = q("SELECT * FROM quiz_rooms WHERE code = ?", (code.upper(),))
    return dict(rows[0]) if rows else None


def is_host(room: dict[str, Any], token: str | None) -> bool:
    return bool(token) and secrets.compare_digest(room["host_hash"], hash_token(token))


def bump(code: str) -> int:
    ex("UPDATE quiz_rooms SET version = version + 1 WHERE code = ?", (code,))
    return q("SELECT version FROM quiz_rooms WHERE code = ?", (code,))[0]["version"]


def open_question(code: str, index: int, per_q_s: int) -> None:
    ex("UPDATE quiz_rooms SET status='question', q_index=?, deadline_ms=? WHERE code=?",
       (index, now_ms() + per_q_s * 1000, code))


def reveal(code: str) -> bool:
    return ex("UPDATE quiz_rooms SET status='reveal', deadline_ms=NULL WHERE code=? AND status='question'", (code,)).rowcount > 0


def finish(code: str) -> None:
    ex("UPDATE quiz_rooms SET status='finished', deadline_ms=NULL WHERE code=?", (code,))


def overdue_rooms() -> list[str]:
    return [r["code"] for r in q("SELECT code FROM quiz_rooms WHERE status='question' AND deadline_ms <= ?", (now_ms(),))]


def purge_expired() -> int:
    cutoff = now_ms() - ROOM_TTL_MINUTES * 60_000
    return ex("DELETE FROM quiz_rooms WHERE created_ms < ?", (cutoff,)).rowcount


# --- teams -----------------------------------------------------------------

class JoinError(ValueError):
    pass


def add_team(code: str, name: str) -> tuple[int, str]:
    if q("SELECT COUNT(*) AS n FROM quiz_teams WHERE room_code=?", (code,))[0]["n"] >= MAX_TEAMS:
        raise JoinError("This room is full.")
    token = secrets.token_urlsafe(24)
    try:
        cur = ex("INSERT INTO quiz_teams (room_code, name, name_key, token_hash, joined_ms) VALUES (?,?,?,?,?)",
                 (code, name, name.casefold(), hash_token(token), now_ms()))
    except sqlite3.IntegrityError:
        raise JoinError("Another team already uses that name. Pick a different one.")
    return cur.lastrowid, token


def team_by_token(code: str, token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    rows = q("SELECT * FROM quiz_teams WHERE room_code=? AND token_hash=?", (code, hash_token(token)))
    return dict(rows[0]) if rows else None


def teams_with_answers(code: str) -> list[dict[str, Any]]:
    teams = {t["id"]: {"id": t["id"], "name": t["name"], "answers": {}}
             for t in q("SELECT id, name FROM quiz_teams WHERE room_code=? ORDER BY joined_ms", (code,))}
    for a in q("SELECT a.team_id, a.q_index, a.choice, a.correct FROM answers a JOIN quiz_teams t ON t.id=a.team_id WHERE t.room_code=?", (code,)):
        teams[a["team_id"]]["answers"][a["q_index"]] = {"choice": a["choice"], "correct": bool(a["correct"])}
    return list(teams.values())


def add_answer(team_id: int, q_index: int, choice: int, correct: bool) -> bool:
    """False if this team already answered this question (answers never change)."""
    return ex("INSERT OR IGNORE INTO answers (team_id, q_index, choice, correct, ms) VALUES (?,?,?,?,?)",
              (team_id, q_index, choice, int(correct), now_ms())).rowcount > 0
