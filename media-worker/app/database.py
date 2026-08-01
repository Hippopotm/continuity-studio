import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

DB_PATH = os.getenv("DATABASE_PATH", "continuity.db")


def initialize() -> None:
    with connect() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, project_id TEXT NOT NULL,
            shot_id TEXT NOT NULL, status TEXT NOT NULL, provider TEXT NOT NULL,
            model TEXT NOT NULL, budget_usd REAL NOT NULL, actual_cost_usd REAL,
            request_json TEXT NOT NULL, result_json TEXT, error TEXT,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )""")


@contextmanager
def connect():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        yield db
        db.commit()
    finally:
        db.close()


def create_run(run_id: str, owner: str, request: dict) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with connect() as db:
        db.execute(
            "INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?)",
            (run_id, owner, request["project_id"], request["shot_id"], "queued",
             request["provider"], request["model"], request["budget_usd"],
             json.dumps(request), now, now),
        )


def update_run(run_id: str, status: str, result: dict | None = None, error: str | None = None) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with connect() as db:
        db.execute(
            "UPDATE runs SET status=?, result_json=?, error=?, updated_at=? WHERE id=?",
            (status, json.dumps(result) if result else None, error, now, run_id),
        )


def get_run(run_id: str, owner: str):
    with connect() as db:
        row = db.execute("SELECT * FROM runs WHERE id=? AND owner=?", (run_id, owner)).fetchone()
    if not row:
        return None
    result = dict(row)
    result["result"] = json.loads(result.pop("result_json")) if result["result_json"] else None
    result.pop("request_json", None)
    return result
