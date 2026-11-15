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
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  host_hash TEXT NOT NULL,
  round_id TEXT NOT NULL,
  round_json TEXT,                 -- an approved round from uploaded material, if any
  status TEXT NOT NULL,            -- lobby | running | finished
  duration_s INTEGER NOT NULL,
  created_ms INTEGER NOT NULL,
  deadline_ms INTEGER,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  joined_ms INTEGER NOT NULL,
  UNIQUE (room_code, name_key)
);
CREATE TABLE IF NOT EXISTS submissions (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  choice TEXT NOT NULL,
  correct INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  PRIMARY KEY (team_id, phase)    -- a team answers each phase exactly once
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
        cols = {r[1] for r in _conn.execute("PRAGMA table_info(rooms)")}
        if "round_json" not in cols:  # databases created before custom rounds existed
            _conn.execute("ALTER TABLE rooms ADD COLUMN round_json TEXT")
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

def create_room(round_id: str, duration_s: int, round_json: str | None = None) -> tuple[str, str]:
    host_token = secrets.token_urlsafe(24)
    for _ in range(20):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(5))
        try:
            ex(
                "INSERT INTO rooms (code, host_hash, round_id, round_json, status, duration_s, created_ms) VALUES (?,?,?,?,?,?,?)",
                (code, hash_token(host_token), round_id, round_json, "lobby", duration_s, now_ms()),
            )
            return code, host_token
        except sqlite3.IntegrityError:
            continue
    raise RuntimeError("could not allocate a room code")


def get_room(code: str) -> dict[str, Any] | None:
    rows = q("SELECT * FROM rooms WHERE code = ?", (code.upper(),))
    return dict(rows[0]) if rows else None


def is_host(room: dict[str, Any], token: str | None) -> bool:
    return bool(token) and secrets.compare_digest(room["host_hash"], hash_token(token))


def bump(code: str) -> int:
    ex("UPDATE rooms SET version = version + 1 WHERE code = ?", (code,))
    return q("SELECT version FROM rooms WHERE code = ?", (code,))[0]["version"]


def start_room(code: str) -> None:
    room = get_room(code)
    assert room
    ex("UPDATE rooms SET status='running', deadline_ms=? WHERE code=? AND status='lobby'",
       (now_ms() + room["duration_s"] * 1000, code))


def finish_room(code: str) -> bool:
    cur = ex("UPDATE rooms SET status='finished', deadline_ms=MIN(COALESCE(deadline_ms, ?), ?) "
             "WHERE code=? AND status='running'", (now_ms(), now_ms(), code))
    return cur.rowcount > 0


def overdue_rooms() -> list[str]:
    return [r["code"] for r in q("SELECT code FROM rooms WHERE status='running' AND deadline_ms <= ?", (now_ms(),))]


def purge_expired() -> int:
    cutoff = now_ms() - ROOM_TTL_MINUTES * 60_000
    return ex("DELETE FROM rooms WHERE created_ms < ?", (cutoff,)).rowcount


# --- teams -----------------------------------------------------------------

class JoinError(ValueError):
    pass


def add_team(code: str, name: str) -> tuple[int, str]:
    if q("SELECT COUNT(*) AS n FROM teams WHERE room_code=?", (code,))[0]["n"] >= MAX_TEAMS:
        raise JoinError("This room is full.")
    token = secrets.token_urlsafe(24)
    try:
        cur = ex("INSERT INTO teams (room_code, name, name_key, token_hash, joined_ms) VALUES (?,?,?,?,?)",
                 (code, name, name.casefold(), hash_token(token), now_ms()))
    except sqlite3.IntegrityError:
        raise JoinError("Another team already uses that name. Pick a different one.")
    return cur.lastrowid, token


def team_by_token(code: str, token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    rows = q("SELECT * FROM teams WHERE room_code=? AND token_hash=?", (code, hash_token(token)))
    return dict(rows[0]) if rows else None


def teams_with_subs(code: str) -> list[dict[str, Any]]:
    teams = [dict(t) for t in q("SELECT id, name FROM teams WHERE room_code=? ORDER BY joined_ms", (code,))]
    by_id = {t["id"]: {**t, "subs": {}} for t in teams}
    for s in q("SELECT s.team_id, s.phase, s.choice, s.correct FROM submissions s "
               "JOIN teams t ON t.id = s.team_id WHERE t.room_code=?", (code,)):
        by_id[s["team_id"]]["subs"][s["phase"]] = {"choice": s["choice"], "correct": bool(s["correct"])}
    return list(by_id.values())


def team_subs(team_id: int) -> dict[str, dict[str, Any]]:
    return {s["phase"]: {"choice": s["choice"], "correct": bool(s["correct"])}
            for s in q("SELECT phase, choice, correct FROM submissions WHERE team_id=?", (team_id,))}


def add_submission(team_id: int, phase: str, choice: str, correct: bool) -> bool:
    """Returns False if this phase was already answered (duplicates never re-score)."""
    cur = ex("INSERT OR IGNORE INTO submissions (team_id, phase, choice, correct, ms) VALUES (?,?,?,?,?)",
             (team_id, phase, choice, int(correct), now_ms()))
    return cur.rowcount > 0
