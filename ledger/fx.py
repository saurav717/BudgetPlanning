"""Currency conversion. Rates are stored as 'units per 1 USD' so any pair can be derived."""
from __future__ import annotations

import sqlite3
from datetime import datetime

import httpx

from .db import DEFAULT_PER_USD, get_setting, set_setting

SYMBOLS = {"USD": "$", "INR": "₹", "EUR": "€", "GBP": "£", "CAD": "C$", "AUD": "A$", "SGD": "S$", "AED": "AED ", "JPY": "¥", "CHF": "CHF "}


def home_currency(conn: sqlite3.Connection) -> str:
    return get_setting(conn, "home_currency", "USD") or "USD"


def rates(conn: sqlite3.Connection) -> dict[str, dict]:
    return {r["currency"]: dict(r) for r in conn.execute("SELECT * FROM fx_rates ORDER BY currency")}


def convert(conn: sqlite3.Connection, amount: float, from_cur: str, to_cur: str | None = None) -> float:
    to_cur = to_cur or home_currency(conn)
    if not amount or from_cur == to_cur:
        return amount or 0.0
    r = rates(conn)
    a, b = r.get(from_cur), r.get(to_cur)
    if not a or not b:
        return amount
    return round(amount * b["per_usd"] / a["per_usd"], 2)


def set_rate(conn: sqlite3.Connection, currency: str, per_usd: float, source: str = "manual") -> None:
    conn.execute("INSERT OR REPLACE INTO fx_rates (currency, per_usd, updated_at, source) VALUES (?,?,datetime('now'),?)",
                 (currency.upper(), per_usd, source))
    conn.commit()


def refresh(conn: sqlite3.Connection, http: httpx.Client | None = None) -> dict:
    """Pull latest ECB reference rates (free, no key). Manual rates are kept for currencies the feed lacks."""
    http = http or httpx.Client(timeout=15)
    errors = []
    for url in ("https://api.frankfurter.dev/v1/latest?base=USD", "https://api.frankfurter.app/latest?from=USD"):
        try:
            r = http.get(url)
            r.raise_for_status()
            data = r.json()
            updated = 0
            for cur, v in data.get("rates", {}).items():
                if cur in DEFAULT_PER_USD or conn.execute("SELECT 1 FROM fx_rates WHERE currency=?", (cur,)).fetchone():
                    set_rate(conn, cur, float(v), "ecb")
                    updated += 1
            set_rate(conn, "USD", 1.0, "ecb")
            return {"ok": True, "updated": updated, "date": data.get("date")}
        except Exception as e:  # network blocked, API moved, etc.
            errors.append(f"{url}: {e}")
    return {"ok": False, "errors": errors}


def set_home(conn: sqlite3.Connection, currency: str) -> None:
    set_setting(conn, "home_currency", currency.upper())


def fmt(v: float, currency: str) -> str:
    """Whole-unit money string; INR uses Indian digit grouping (12,34,567)."""
    sym = SYMBOLS.get(currency, currency + " ")
    neg, n = v < 0, f"{abs(v):.0f}"
    if currency == "INR" and len(n) > 3:
        head, tail = n[:-3], n[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:]); head = head[:-2]
        if head: parts.insert(0, head)
        n = ",".join(parts + [tail])
    else:
        n = f"{abs(v):,.0f}"
    return ("-" if neg else "") + sym + n
