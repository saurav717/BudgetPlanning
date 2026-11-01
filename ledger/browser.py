"""Run the Ledger API inside the browser.

A Web Worker loads Pyodide (CPython compiled to WebAssembly), unpacks this package, and calls
`handle()` for every request the UI makes. `handle()` builds an ASGI request and runs the same
FastAPI app the self-hosted server uses, so both deployments share one code path.

The database is an in-memory SQLite database. The worker gets its bytes with `export_db()`,
encrypts them and stores them in the user's Google Drive; `init()` loads them back.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys

_conn: sqlite3.Connection | None = None


def _patch_threadpool() -> None:
    """WebAssembly has no threads: run FastAPI's sync endpoints inline instead of in a thread pool."""
    async def run_inline(func, *args, **kwargs):
        return func(*args, **kwargs)

    import fastapi.dependencies.utils  # noqa: F401  (make sure the modules are loaded before patching)
    import fastapi.routing  # noqa: F401
    import starlette.concurrency  # noqa: F401
    for name, mod in list(sys.modules.items()):
        if (name.startswith("fastapi") or name.startswith("starlette")) and hasattr(mod, "run_in_threadpool"):
            mod.run_in_threadpool = run_inline


def init(data: bytes | None = None, demo: bool = False, settings: dict | None = None) -> dict:
    """Open the database from decrypted bytes (or empty / demo data)."""
    global _conn
    from . import api, db
    settings = settings or {}
    for key in ("LEDGER_PLAID_RELAY", "PLAID_ENV"):
        if settings.get(key):
            os.environ[key] = str(settings[key])
    if sys.platform == "emscripten":
        _patch_threadpool()
    conn = db.connect(":memory:")
    if data:
        conn.deserialize(bytes(data))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        db.init_schema(conn)  # creates anything newer than the saved file, then migrates
    elif demo:
        from . import demo as demo_mod
        demo_mod.seed(conn)
    _conn = conn
    api.set_connection(conn)
    return {"accounts": conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0],
            "transactions": conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]}


def set_relay_token(token: str | None) -> None:
    """The Google access token the Cloudflare relay uses to check who's calling."""
    if token:
        os.environ["LEDGER_RELAY_TOKEN"] = token
    else:
        os.environ.pop("LEDGER_RELAY_TOKEN", None)


def export_db() -> bytes:
    """Serialised SQLite file, ready to encrypt."""
    assert _conn is not None, "database not initialised"
    _conn.commit()
    return _conn.serialize()


async def handle(method: str, path: str, query: str = "", body=b"", content_type: str = "application/json") -> str:
    """Run one HTTP request through the FastAPI app and return a JSON envelope."""
    from .api import app
    if isinstance(body, str):
        body = body.encode()
    elif body is None:
        body = b""
    else:
        body = bytes(body)
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method.upper(),
        "scheme": "http", "path": path, "raw_path": path.encode(), "query_string": (query or "").encode(),
        "root_path": "", "client": ("browser", 0), "server": ("ledger", 80),
        "headers": [(b"content-type", content_type.encode()), (b"content-length", str(len(body)).encode())],
    }
    pending = [{"type": "http.request", "body": body, "more_body": False}]

    import asyncio
    never = asyncio.get_event_loop().create_future()  # the "client" never disconnects mid-response

    async def receive():
        if pending:
            return pending.pop(0)
        await never
        return {"type": "http.disconnect"}

    out = {"status": 500, "headers": {}, "chunks": []}

    async def send(msg):
        if msg["type"] == "http.response.start":
            out["status"] = msg["status"]
            out["headers"] = {k.decode().lower(): v.decode() for k, v in msg.get("headers", [])}
        elif msg["type"] == "http.response.body":
            out["chunks"].append(msg.get("body", b""))

    try:
        await app(scope, receive, send)
    except Exception as e:  # FastAPI re-raises after sending a 500; keep the response if one was sent
        if not out["chunks"]:
            out["status"] = 500
            out["chunks"] = [json.dumps({"detail": f"{type(e).__name__}: {e}"}).encode()]
            out["headers"]["content-type"] = "application/json"
    status = out["status"]
    return json.dumps({
        "status": status,
        "content_type": out["headers"].get("content-type", ""),
        "content_disposition": out["headers"].get("content-disposition", ""),
        "body": b"".join(out["chunks"]).decode("utf-8", "replace"),
        "changed": method.upper() not in ("GET", "HEAD", "OPTIONS") and status < 400,
    })
