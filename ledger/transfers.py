"""Pair up transfers between your own accounts so they don't count as income or spending."""
from __future__ import annotations

import sqlite3
from datetime import date, timedelta


def match_transfers(conn: sqlite3.Connection, window_days: int = 4) -> int:
    """Find (-X in account A, +X in account B) within a few days and link them. Returns pairs created."""
    transfer_id = conn.execute("SELECT id FROM categories WHERE name='Transfer'").fetchone()[0]
    ccpay_id = conn.execute("SELECT id FROM categories WHERE name='Credit Card Payment'").fetchone()[0]
    acct_types = {r["id"]: r["type"] for r in conn.execute("SELECT id, type FROM accounts")}
    rows = conn.execute(
        "SELECT id, account_id, date, amount FROM transactions "
        "WHERE transfer_pair_id IS NULL AND hidden = 0 ORDER BY date"
    ).fetchall()
    outs = [r for r in rows if r["amount"] < 0]
    ins = {}
    for r in rows:
        if r["amount"] > 0:
            ins.setdefault(round(r["amount"], 2), []).append(r)
    pairs = 0
    used: set[int] = set()
    for o in outs:
        cands = ins.get(round(-o["amount"], 2), [])
        od = date.fromisoformat(o["date"])
        best = None
        for c in cands:
            if c["id"] in used or c["account_id"] == o["account_id"]:
                continue
            delta = abs((date.fromisoformat(c["date"]) - od).days)
            if delta <= window_days and (best is None or delta < best[0]):
                best = (delta, c)
        if best is None:
            continue
        c = best[1]
        used.add(c["id"]); used.add(o["id"])
        cat = ccpay_id if acct_types.get(c["account_id"]) == "credit" else transfer_id
        conn.execute("UPDATE transactions SET transfer_pair_id=?, category_id=? WHERE id=?", (c["id"], cat, o["id"]))
        conn.execute("UPDATE transactions SET transfer_pair_id=?, category_id=? WHERE id=?", (o["id"], cat, c["id"]))
        pairs += 1
    conn.commit()
    return pairs
