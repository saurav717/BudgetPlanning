"""Detect recurring bills, subscriptions and income from transaction history."""
from __future__ import annotations

import sqlite3
import statistics
from datetime import date, timedelta

from .categorize import merchant_key

# (label, nominal period in days, tolerance in days)
CADENCES = [("weekly", 7, 2), ("biweekly", 14, 3), ("monthly", 30, 5), ("quarterly", 91, 8), ("yearly", 365, 15)]


def _cadence(gaps: list[int]) -> str | None:
    if not gaps:
        return None
    med = statistics.median(gaps)
    for label, days, tol in CADENCES:
        if abs(med - days) <= tol and sum(1 for g in gaps if abs(g - days) <= tol * 2) >= max(2, int(0.6 * len(gaps))):
            return label
    return None


def _period_days(label: str) -> int:
    return dict((l, d) for l, d, _ in CADENCES)[label]


MONTH_STEPS = {"monthly": 1, "quarterly": 3, "yearly": 12}


def add_months(d: date, n: int, anchor_day: int | None = None) -> date:
    """Calendar-month step that keeps the day of month (clamped for short months), so bills don't drift."""
    import calendar
    m = d.month - 1 + n
    y, m = d.year + m // 12, m % 12 + 1
    day = min(anchor_day or d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)


def step(d: date, cadence: str, anchor_day: int | None = None) -> date:
    if cadence in MONTH_STEPS:
        return add_months(d, MONTH_STEPS[cadence], anchor_day)
    return d + timedelta(days=_period_days(cadence))


def detect_recurring(conn: sqlite3.Connection, min_occurrences: int = 3, lookback_days: int = 400,
                     include_transfers: bool = False) -> list[dict]:
    """Recurring bills/income. include_transfers adds regular moves between accounts (savings, investing,
    remittances) which matter for a cash forecast but aren't spending."""
    since = (date.today() - timedelta(days=lookback_days)).isoformat()
    transfer_clause = "" if include_transfers else "AND t.transfer_pair_id IS NULL AND (c.kind IS NULL OR c.kind != 'transfer')"
    rows = conn.execute(
        "SELECT t.id, t.date, t.amount, t.merchant, t.category_id, t.account_id, c.name AS category, c.kind AS category_kind "
        "FROM tx_home t LEFT JOIN categories c ON c.id=t.category_id "
        f"WHERE t.date >= ? AND t.hidden = 0 AND t.pending = 0 {transfer_clause} "
        "ORDER BY t.date", (since,)
    ).fetchall()
    overrides = {r["merchant_key"]: r for r in conn.execute("SELECT * FROM recurring_overrides")}
    category_groups = {r["id"]: r["group"] for r in conn.execute('SELECT id, "group" FROM categories')}
    groups: dict[tuple[str, int], list] = {}
    for r in rows:
        key = merchant_key(r["merchant"])
        if include_transfers:
            key = f"{key}@{r['account_id']}"  # the two legs of a transfer live in different accounts
        groups.setdefault((key, 1 if r["amount"] > 0 else -1), []).append(r)

    out = []
    today = date.today()
    for (key, sign), txs in groups.items():
        ov = overrides.get(key.split("@")[0])
        if ov and ov["status"] == "ignored":
            continue
        if len(txs) < min_occurrences and not (ov and ov["status"] == "confirmed"):
            continue
        amounts = [abs(t["amount"]) for t in txs]
        med_amt = statistics.median(amounts)
        # amounts should be stable: subscriptions/rent are exact, utilities swing, groceries aren't bills at all
        group = category_groups.get(txs[-1]["category_id"], "")
        tol = 0.35 if group == "Housing" else 0.12
        stable = [t for t in txs if abs(abs(t["amount"]) - med_amt) <= max(tol * med_amt, 2)]
        if group == "Food" and not ov:
            continue
        if len(stable) < min_occurrences and not ov:
            continue
        dates = [date.fromisoformat(t["date"]) for t in stable]
        gaps = [(b - a).days for a, b in zip(dates, dates[1:]) if (b - a).days > 0]
        cad = _cadence(gaps)
        if cad is None and not ov:
            continue
        cad = cad or "monthly"
        last = dates[-1]
        period = _period_days(cad)
        anchor = statistics.median_low([d.day for d in dates[-4:]]) if cad in MONTH_STEPS else None
        nxt = step(last, cad, anchor)
        while nxt < today - timedelta(days=period // 2):  # catch up if we missed detecting a cycle
            nxt = step(nxt, cad, anchor)
        out.append({
            "merchant_key": key.split("@")[0],
            "merchant": (ov["display_name"] if ov and ov["display_name"] else stable[-1]["merchant"]),
            "category": stable[-1]["category"],
            "category_id": stable[-1]["category_id"],
            "account_id": stable[-1]["account_id"],
            "kind": "income" if sign > 0 else "expense",
            "is_transfer": stable[-1]["category_kind"] == "transfer",
            "cadence": cad,
            "amount": round(sign * med_amt, 2),
            "last_date": last.isoformat(),
            "next_date": nxt.isoformat(),
            "days_until": (nxt - today).days,
            "occurrences": len(stable),
            "monthly_equivalent": round(sign * med_amt * 30.4 / period, 2),
            "status": ov["status"] if ov else "detected",
            "overdue": nxt < today,
            "anchor_day": anchor,
        })
    out.sort(key=lambda r: r["next_date"])
    return out


def upcoming(conn: sqlite3.Connection, days: int = 30) -> list[dict]:
    horizon = date.today() + timedelta(days=days)
    return [r for r in detect_recurring(conn) if date.fromisoformat(r["next_date"]) <= horizon]
