"""Aggregations that power the dashboard: net worth, cash flow, spending, budgets."""
from __future__ import annotations

import calendar
import sqlite3
from datetime import date, timedelta

from . import fx

LIABILITY_TYPES = ("credit", "loan")

# Only money that actually left or entered the household counts. Transfers between your
# own accounts, hidden rows and pending holds are excluded everywhere below.
REAL_MONEY = ("t.hidden = 0 AND t.transfer_pair_id IS NULL AND t.pending = 0 "
              "AND (c.kind IS NULL OR c.kind != 'transfer')")


def month_bounds(month: str) -> tuple[str, str]:
    y, m = int(month[:4]), int(month[5:7])
    return f"{month}-01", f"{month}-{calendar.monthrange(y, m)[1]:02d}"


def shift_month(month: str, delta: int) -> str:
    y, m = int(month[:4]), int(month[5:7]) + delta
    y += (m - 1) // 12
    m = (m - 1) % 12 + 1
    return f"{y:04d}-{m:02d}"


def this_month() -> str:
    return date.today().strftime("%Y-%m")


# ---------- accounts / net worth ----------

def account_balances(conn: sqlite3.Connection, as_of: str | None = None) -> list[dict]:
    """Latest balance snapshot per account on or before as_of (signed: liabilities negative)."""
    as_of = as_of or date.today().isoformat()
    rows = conn.execute(
        """SELECT a.id, a.name, a.type, a.institution, a.currency, a.archived, a.include_in_net_worth,
                  a.plaid_item_id, a.import_profile, a.credit_limit, a.tax_type,
                  (SELECT balance FROM balance_snapshots b WHERE b.account_id=a.id AND b.date<=? ORDER BY b.date DESC LIMIT 1) AS balance,
                  (SELECT date FROM balance_snapshots b WHERE b.account_id=a.id AND b.date<=? ORDER BY b.date DESC LIMIT 1) AS balance_date,
                  (SELECT COUNT(*) FROM transactions t WHERE t.account_id=a.id) AS tx_count,
                  (SELECT MAX(date) FROM transactions t WHERE t.account_id=a.id) AS last_tx_date
           FROM accounts a ORDER BY a.archived, a.type, a.name""", (as_of, as_of)).fetchall()
    out = []
    home = fx.home_currency(conn)
    for r in rows:
        d = dict(r)
        d["balance"] = d["balance"] if d["balance"] is not None else 0.0
        d["balance_home"] = fx.convert(conn, d["balance"], d["currency"] or home, home)
        d["is_liability"] = d["type"] in LIABILITY_TYPES
        out.append(d)
    return out


def net_worth(conn: sqlite3.Connection, as_of: str | None = None) -> dict:
    accts = [a for a in account_balances(conn, as_of) if not a["archived"] and a["include_in_net_worth"]]
    assets = sum(a["balance_home"] for a in accts if a["balance_home"] > 0)
    liabilities = sum(a["balance_home"] for a in accts if a["balance_home"] < 0)
    by_type: dict[str, float] = {}
    for a in accts:
        by_type[a["type"]] = round(by_type.get(a["type"], 0) + a["balance_home"], 2)
    return {"net_worth": round(assets + liabilities, 2), "assets": round(assets, 2),
            "liabilities": round(liabilities, 2), "by_type": by_type, "as_of": as_of or date.today().isoformat()}


def net_worth_history(conn: sqlite3.Connection, months: int = 12) -> list[dict]:
    """Month-end net worth for the last N months (uses latest snapshot on/before each month end)."""
    out = []
    cur = this_month()
    for i in range(months - 1, -1, -1):
        m = shift_month(cur, -i)
        _, end = month_bounds(m)
        if m == cur:
            end = date.today().isoformat()
        nw = net_worth(conn, end)
        out.append({"month": m, "date": end, **{k: nw[k] for k in ("net_worth", "assets", "liabilities")}})
    return out


# ---------- cash flow ----------

def cashflow(conn: sqlite3.Connection, months: int = 12) -> list[dict]:
    start = month_bounds(shift_month(this_month(), -(months - 1)))[0]
    rows = conn.execute(
        f"""SELECT substr(t.date,1,7) AS month,
                   SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS income,
                   SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS expenses
            FROM tx_home t LEFT JOIN categories c ON c.id=t.category_id
            WHERE t.date >= ? AND {REAL_MONEY}
            GROUP BY month ORDER BY month""", (start,)).fetchall()
    by = {r["month"]: r for r in rows}
    out = []
    for i in range(months - 1, -1, -1):
        m = shift_month(this_month(), -i)
        r = by.get(m)
        inc = round(r["income"], 2) if r else 0.0
        exp = round(r["expenses"], 2) if r else 0.0
        out.append({"month": m, "income": inc, "expenses": exp, "savings": round(inc - exp, 2),
                    "savings_rate": round((inc - exp) / inc, 3) if inc else None})
    return out


# ---------- spending ----------

def spending_by_category(conn: sqlite3.Connection, start: str, end: str, account_id: int | None = None) -> list[dict]:
    acct = "AND t.account_id = ?" if account_id else ""
    params: list = [start, end] + ([account_id] if account_id else [])
    rows = conn.execute(
        f"""SELECT c.id AS category_id, COALESCE(c.name,'Uncategorized') AS category, COALESCE(c."group",'Other') AS "group",
                   COALESCE(c.kind,'expense') AS kind,
                   SUM(-t.amount) AS spent, COUNT(*) AS count
            FROM tx_home t LEFT JOIN categories c ON c.id=t.category_id
            WHERE t.date BETWEEN ? AND ? AND t.amount < 0 AND {REAL_MONEY} {acct}
            GROUP BY c.id ORDER BY spent DESC""", params).fetchall()
    return [dict(r, spent=round(r["spent"], 2)) for r in rows]


def spending_by_group(conn: sqlite3.Connection, start: str, end: str) -> list[dict]:
    groups: dict[str, dict] = {}
    for r in spending_by_category(conn, start, end):
        g = groups.setdefault(r["group"], {"group": r["group"], "spent": 0.0, "categories": []})
        g["spent"] = round(g["spent"] + r["spent"], 2)
        g["categories"].append(r)
    return sorted(groups.values(), key=lambda g: -g["spent"])


def top_merchants(conn: sqlite3.Connection, start: str, end: str, limit: int = 15) -> list[dict]:
    rows = conn.execute(
        f"""SELECT t.merchant, SUM(-t.amount) AS spent, COUNT(*) AS count
            FROM tx_home t LEFT JOIN categories c ON c.id=t.category_id
            WHERE t.date BETWEEN ? AND ? AND t.amount < 0 AND {REAL_MONEY}
            GROUP BY lower(t.merchant) ORDER BY spent DESC LIMIT ?""", (start, end, limit)).fetchall()
    return [dict(r, spent=round(r["spent"], 2)) for r in rows]


def category_trend(conn: sqlite3.Connection, category_id: int, months: int = 12) -> list[dict]:
    start = month_bounds(shift_month(this_month(), -(months - 1)))[0]
    rows = conn.execute(
        f"""SELECT substr(t.date,1,7) AS month, SUM(-t.amount) AS spent FROM tx_home t
            LEFT JOIN categories c ON c.id=t.category_id
            WHERE t.category_id=? AND t.date>=? AND t.amount<0 AND {REAL_MONEY} GROUP BY month""",
        (category_id, start)).fetchall()
    by = {r["month"]: round(r["spent"], 2) for r in rows}
    return [{"month": (m := shift_month(this_month(), -i)), "spent": by.get(m, 0.0)} for i in range(months - 1, -1, -1)]


def sankey(conn: sqlite3.Connection, start: str, end: str) -> dict:
    """Income sources -> 'Budget' -> category groups -> categories (for a cash-flow sankey)."""
    inc = conn.execute(
        f"""SELECT COALESCE(c.name,'Other Income') AS name, SUM(t.amount) AS v FROM tx_home t
            LEFT JOIN categories c ON c.id=t.category_id
            WHERE t.date BETWEEN ? AND ? AND t.amount>0 AND {REAL_MONEY} GROUP BY c.id""", (start, end)).fetchall()
    links = [{"source": r["name"], "target": "Cash flow", "value": round(r["v"], 2)} for r in inc]
    total_in = sum(r["v"] for r in inc)
    total_out = 0.0
    for g in spending_by_group(conn, start, end):
        links.append({"source": "Cash flow", "target": g["group"], "value": g["spent"]})
        total_out += g["spent"]
        for c in g["categories"][:6]:
            links.append({"source": g["group"], "target": c["category"], "value": c["spent"]})
        rest = round(g["spent"] - sum(c["spent"] for c in g["categories"][:6]), 2)
        if rest > 0:
            links.append({"source": g["group"], "target": f"Other {g['group']}", "value": rest})
    if total_in > total_out:
        links.append({"source": "Cash flow", "target": "Saved", "value": round(total_in - total_out, 2)})
    return {"links": links, "income": round(total_in, 2), "expenses": round(total_out, 2)}


# ---------- budgets ----------

def budget_for(conn: sqlite3.Connection, category_id: int, month: str) -> float | None:
    r = conn.execute("SELECT amount FROM budgets WHERE category_id=? AND month=?", (category_id, month)).fetchone()
    if r:
        return r["amount"]
    r = conn.execute("SELECT amount FROM budgets WHERE category_id=? AND month IS NULL", (category_id,)).fetchone()
    return r["amount"] if r else None


def _rollover(conn, category_id: int, month: str, depth: int = 12) -> float:
    """Unspent (or overspent) budget carried from prior months, for categories with rollover on."""
    carry = 0.0
    first = conn.execute("SELECT MIN(date) FROM transactions").fetchone()[0]
    m = shift_month(month, -depth)
    if first and first[:7] > m:
        m = first[:7]  # no rollover from before your history starts
    while m < month:
        b = budget_for(conn, category_id, m)
        if b is not None:
            s, e = month_bounds(m)
            spent = conn.execute(
                f"SELECT COALESCE(SUM(-t.amount),0) FROM tx_home t LEFT JOIN categories c ON c.id=t.category_id "
                f"WHERE t.category_id=? AND t.date BETWEEN ? AND ? AND t.amount<0 AND {REAL_MONEY}",
                (category_id, s, e)).fetchone()[0]
            carry = carry + b - spent
        m = shift_month(m, 1)
    return round(carry, 2)


def budget_status(conn: sqlite3.Connection, month: str | None = None) -> dict:
    month = month or this_month()
    start, end = month_bounds(month)
    spent_rows = {r["category_id"]: r for r in spending_by_category(conn, start, end)}
    income_rows = conn.execute(
        f"""SELECT c.id AS category_id, SUM(t.amount) AS earned FROM tx_home t LEFT JOIN categories c ON c.id=t.category_id
            WHERE t.date BETWEEN ? AND ? AND t.amount>0 AND {REAL_MONEY} GROUP BY c.id""", (start, end)).fetchall()
    earned = {r["category_id"]: round(r["earned"], 2) for r in income_rows}
    cats = conn.execute('SELECT * FROM categories WHERE archived=0 ORDER BY "group", name').fetchall()
    out, totals = [], {"income_budget": 0.0, "income_actual": 0.0, "fixed_budget": 0.0, "fixed_actual": 0.0,
                       "flex_budget": 0.0, "flex_actual": 0.0, "non_monthly_budget": 0.0, "non_monthly_actual": 0.0}
    for c in cats:
        b = budget_for(conn, c["id"], month)
        if c["kind"] == "transfer":
            continue
        if c["kind"] == "income":
            actual = earned.get(c["id"], 0.0)
            totals["income_budget"] += b or 0
            totals["income_actual"] += actual
        else:
            actual = spent_rows.get(c["id"], {}).get("spent", 0.0)
            bt = c["budget_type"]
            totals[f"{bt}_budget"] += b or 0
            totals[f"{bt}_actual"] += actual
        if b is None and actual == 0:
            continue
        roll = _rollover(conn, c["id"], month) if (c["rollover"] and b is not None) else 0.0
        avail = (b or 0) + roll
        out.append({"category_id": c["id"], "category": c["name"], "group": c["group"], "kind": c["kind"],
                    "budget_type": c["budget_type"], "budget": b, "rollover": roll, "available": round(avail, 2),
                    "actual": round(actual, 2), "remaining": round(avail - actual, 2) if b is not None else None,
                    "pct": round(actual / avail, 3) if avail else None, "has_budget": b is not None})
    for k in totals:
        totals[k] = round(totals[k], 2)
    expected_income = totals["income_budget"] or totals["income_actual"]
    planned = totals["fixed_budget"] + totals["flex_budget"] + totals["non_monthly_budget"]
    spent = totals["fixed_actual"] + totals["flex_actual"] + totals["non_monthly_actual"]
    days_in = int(end[-2:])
    today = date.today()
    day = min(today.day, days_in) if month == this_month() else days_in
    return {"month": month, "rows": out, "totals": totals,
            "summary": {"expected_income": round(expected_income, 2), "planned_spending": round(planned, 2),
                        "left_to_budget": round(expected_income - planned, 2), "spent": round(spent, 2),
                        "remaining": round(planned - spent, 2), "month_progress": round(day / days_in, 3),
                        "unbudgeted_spend": round(sum(r["actual"] for r in out if r["kind"] == "expense" and not r["has_budget"]), 2)}}


def suggest_budgets(conn: sqlite3.Connection, months: int = 3) -> list[dict]:
    """Average of the last N complete months per category - a starting point for a new budget."""
    cur = this_month()
    start = month_bounds(shift_month(cur, -months))[0]
    end = month_bounds(shift_month(cur, -1))[1]
    rows = spending_by_category(conn, start, end)
    return [{"category_id": r["category_id"], "category": r["category"], "suggested": round(r["spent"] / months, 0)}
            for r in rows if r["category_id"] is not None and r["kind"] == "expense"]


# ---------- the one number ----------

def safe_to_spend(conn: sqlite3.Connection, upcoming: list[dict]) -> dict:
    """Liquid cash minus bills due before your next paycheck minus what you owe on cards.

    Monarch shows balances; this answers the question people actually have: 'can I afford this?'
    """
    accts = [a for a in account_balances(conn) if not a["archived"]]
    liquid = sum(a["balance_home"] for a in accts if a["type"] in ("checking", "cash") and a["balance_home"] > 0)
    cards = -sum(a["balance_home"] for a in accts if a["type"] == "credit" and a["balance_home"] < 0)
    incomes = [u for u in upcoming if u["kind"] == "income" and u["days_until"] >= 0]
    horizon = min((u["days_until"] for u in incomes), default=30)
    bills = [u for u in upcoming if u["kind"] == "expense" and 0 <= u["days_until"] <= horizon]
    bills_total = -sum(u["amount"] for u in bills)
    return {"liquid_cash": round(liquid, 2), "card_balances": round(cards, 2), "upcoming_bills": round(bills_total, 2),
            "days_to_next_income": horizon, "safe_to_spend": round(liquid - cards - bills_total, 2),
            "bills": bills}
