"""HTTP API + static frontend. Run with `ledger serve` or `uvicorn ledger.api:app`."""
from __future__ import annotations

import csv
import io
import os
import sqlite3
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db, fx, importer, personal, plaid, recurring, reports, insights
from .categorize import Categorizer, clean_merchant
from .transfers import match_transfers

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

app = FastAPI(title="Ledger", version="0.1.0")
_conn: sqlite3.Connection | None = None


def get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = db.connect(os.environ.get("LEDGER_DB") or None)
    return _conn


def set_connection(conn: sqlite3.Connection) -> None:  # used by tests
    global _conn
    _conn = conn


def rows(cur) -> list[dict]:
    return [dict(r) for r in cur.fetchall()]


# ---------------- overview ----------------

@app.get("/api/overview")
def overview(conn=Depends(get_conn)):
    profile = personal.get_profile(conn)
    rec = recurring.detect_recurring(conn)
    month = reports.this_month()
    bs = reports.budget_status(conn, month)
    start, end = reports.month_bounds(month)
    pace = personal.pace(conn, month)
    fc = personal.forecast(conn, 60, profile)
    goals = [personal.goal_progress(conn, dict(g)) for g in conn.execute("SELECT * FROM goals WHERE archived=0 ORDER BY target_date, id")]
    layout = personal.get_layout(conn, profile)
    visible = {w["id"] for w in layout if w["visible"]}
    return {
        "today": date.today().isoformat(),
        "profile": profile,
        "layout": layout,
        "briefing": personal.briefing(conn, profile, pace, fc),
        "net_worth": reports.net_worth(conn),
        "net_worth_history": reports.net_worth_history(conn, 12),
        "cashflow": reports.cashflow(conn, 6),
        "budget_summary": bs["summary"],
        "budget_rows": sorted([r for r in bs["rows"] if r["kind"] == "expense" and r["has_budget"]],
                              key=lambda r: -(r["pct"] or 0))[:7],
        "spending_by_group": reports.spending_by_group(conn, start, end),
        "safe_to_spend": reports.safe_to_spend(conn, [r for r in rec if r["days_until"] <= 45]),
        "upcoming": [r for r in rec if -3 <= r["days_until"] <= 30],
        "insights": insights.generate(conn)[:5],
        "accounts": [a for a in reports.account_balances(conn) if not a["archived"]],
        "recent": rows(conn.execute(
            "SELECT t.*, c.name AS category, c.\"group\" AS category_group, a.name AS account FROM transactions t LEFT JOIN categories c ON c.id=t.category_id "
            "JOIN accounts a ON a.id=t.account_id WHERE t.hidden=0 ORDER BY t.date DESC, t.id DESC LIMIT 7")),
        "pace": pace,
        "forecast": fc,
        "checkup": personal.checkup(conn, profile),
        "daily": personal.daily(conn, 1),
        "goals": goals,
        "utilization": personal.utilization(conn) if "utilization" in visible else None,
        "remittances": personal.remittances(conn, profile=profile) if "remittances" in visible else None,
        "retirement": personal.retirement(conn, profile=profile) if "retirement" in visible else None,
        "fx": {"home": fx.home_currency(conn), "second": profile.get("second_currency") or "",
               "rate": fx.convert(conn, 1.0, fx.home_currency(conn), profile["second_currency"]) if profile.get("second_currency") else None},
    }


# ---------------- profile / personalisation ----------------

@app.get("/api/profile")
def get_profile(conn=Depends(get_conn)):
    return {**personal.get_profile(conn), "priority_options": personal.PRIORITIES}


@app.put("/api/profile")
def put_profile(body: dict, conn=Depends(get_conn)):
    p = personal.save_profile(conn, body)
    if body.get("reset_layout"):
        personal.save_layout(conn, None)
    return p


@app.get("/api/layout")
def get_layout(conn=Depends(get_conn)):
    return {"layout": personal.get_layout(conn), "recommended": personal.recommended_layout(conn, personal.get_profile(conn))}


@app.put("/api/layout")
def put_layout(body: dict, conn=Depends(get_conn)):
    return {"layout": personal.save_layout(conn, body.get("layout"))}


@app.get("/api/checkup")
def get_checkup(conn=Depends(get_conn)):
    return personal.checkup(conn)


@app.get("/api/forecast")
def get_forecast(days: int = Query(60, ge=7, le=180), conn=Depends(get_conn)):
    return personal.forecast(conn, days)


@app.get("/api/reports/pace")
def r_pace(month: Optional[str] = None, conn=Depends(get_conn)):
    return personal.pace(conn, month)


@app.get("/api/reports/daily")
def r_daily(months: int = Query(3, ge=1, le=12), conn=Depends(get_conn)):
    return personal.daily(conn, months)


@app.get("/api/remittances")
def get_remittances(year: Optional[int] = None, conn=Depends(get_conn)):
    return personal.remittances(conn, year)


@app.get("/api/retirement")
def get_retirement(year: Optional[int] = None, conn=Depends(get_conn)):
    return personal.retirement(conn, year)


@app.put("/api/retirement/limits")
def put_limits(body: dict, conn=Depends(get_conn)):
    db.set_setting(conn, "contribution_limits", {k: float(v) for k, v in body.items() if k in personal.DEFAULT_LIMITS})
    return personal.retirement(conn)


@app.get("/api/utilization")
def get_utilization(conn=Depends(get_conn)):
    return personal.utilization(conn)


@app.get("/api/fx")
def get_fx(conn=Depends(get_conn)):
    return {"home": fx.home_currency(conn), "rates": list(fx.rates(conn).values()), "symbols": fx.SYMBOLS}


@app.put("/api/fx/{currency}")
def put_fx(currency: str, body: dict, conn=Depends(get_conn)):
    """Set a rate. Pass either per_usd, or per_home (units of this currency per 1 unit of home currency)."""
    if "per_home" in body:
        home_per_usd = fx.rates(conn).get(fx.home_currency(conn), {"per_usd": 1.0})["per_usd"]
        fx.set_rate(conn, currency, float(body["per_home"]) * home_per_usd)
    else:
        fx.set_rate(conn, currency, float(body["per_usd"]))
    return get_fx(conn)


@app.post("/api/fx/refresh")
def refresh_fx(conn=Depends(get_conn)):
    return fx.refresh(conn)


# ---------------- accounts ----------------

class AccountIn(BaseModel):
    name: str
    type: str = "checking"
    institution: str = ""
    currency: str = "USD"
    import_profile: str = "generic"
    balance: Optional[float] = None
    include_in_net_worth: bool = True
    credit_limit: Optional[float] = None
    tax_type: str = ""


class AccountPatch(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    institution: Optional[str] = None
    import_profile: Optional[str] = None
    archived: Optional[bool] = None
    include_in_net_worth: Optional[bool] = None
    currency: Optional[str] = None
    credit_limit: Optional[float] = None
    tax_type: Optional[str] = None


class BalanceIn(BaseModel):
    balance: float
    date: Optional[str] = None


def _signed(acct_type: str, balance: float) -> float:
    """Users type what they owe on a card as a positive number; we store liabilities negative."""
    return -abs(balance) if acct_type in reports.LIABILITY_TYPES else balance


@app.get("/api/accounts")
def list_accounts(conn=Depends(get_conn)):
    return reports.account_balances(conn)


@app.post("/api/accounts", status_code=201)
def create_account(a: AccountIn, conn=Depends(get_conn)):
    try:
        cur = conn.execute("INSERT INTO accounts (name, type, institution, currency, import_profile, include_in_net_worth, credit_limit, tax_type) VALUES (?,?,?,?,?,?,?,?)",
                           (a.name, a.type, a.institution, a.currency.upper(), a.import_profile, int(a.include_in_net_worth), a.credit_limit, a.tax_type))
    except sqlite3.IntegrityError as e:
        raise HTTPException(400, f"Could not create account: {e}")
    if a.balance is not None:
        conn.execute("INSERT OR REPLACE INTO balance_snapshots (account_id, date, balance) VALUES (?,?,?)",
                     (cur.lastrowid, date.today().isoformat(), _signed(a.type, a.balance)))
    conn.commit()
    return next(x for x in reports.account_balances(conn) if x["id"] == cur.lastrowid)


@app.patch("/api/accounts/{aid}")
def patch_account(aid: int, p: AccountPatch, conn=Depends(get_conn)):
    fields = {k: (int(v) if isinstance(v, bool) else v) for k, v in p.model_dump().items() if v is not None}
    if fields:
        sets = ", ".join(f"{k}=?" for k in fields)
        conn.execute(f"UPDATE accounts SET {sets} WHERE id=?", (*fields.values(), aid))
        conn.commit()
    r = next((x for x in reports.account_balances(conn) if x["id"] == aid), None)
    if not r:
        raise HTTPException(404)
    return r


@app.delete("/api/accounts/{aid}", status_code=204)
def delete_account(aid: int, conn=Depends(get_conn)):
    conn.execute("DELETE FROM accounts WHERE id=?", (aid,))
    conn.commit()


@app.post("/api/accounts/{aid}/balance")
def set_balance(aid: int, b: BalanceIn, conn=Depends(get_conn)):
    acct = conn.execute("SELECT type FROM accounts WHERE id=?", (aid,)).fetchone()
    if not acct:
        raise HTTPException(404)
    conn.execute("INSERT OR REPLACE INTO balance_snapshots (account_id, date, balance) VALUES (?,?,?)",
                 (aid, b.date or date.today().isoformat(), _signed(acct["type"], b.balance)))
    conn.commit()
    return next(x for x in reports.account_balances(conn) if x["id"] == aid)


@app.get("/api/accounts/{aid}/history")
def balance_history(aid: int, conn=Depends(get_conn)):
    return rows(conn.execute("SELECT date, balance FROM balance_snapshots WHERE account_id=? ORDER BY date", (aid,)))


@app.get("/api/net-worth")
def net_worth(months: int = 12, conn=Depends(get_conn)):
    return {"current": reports.net_worth(conn), "history": reports.net_worth_history(conn, months)}


# ---------------- transactions ----------------

TX_SELECT = """SELECT t.*, c.name AS category, c."group" AS category_group, c.kind AS category_kind, a.name AS account, a.type AS account_type,
                      (SELECT GROUP_CONCAT(g.name, ',') FROM transaction_tags tt JOIN tags g ON g.id=tt.tag_id WHERE tt.transaction_id=t.id) AS tags,
                      (SELECT COUNT(*) FROM splits s WHERE s.transaction_id=t.id) AS split_count
               FROM transactions t LEFT JOIN categories c ON c.id=t.category_id JOIN accounts a ON a.id=t.account_id"""


@app.get("/api/transactions")
def list_transactions(start: Optional[str] = None, end: Optional[str] = None, account_id: Optional[int] = None,
                      category_id: Optional[int] = None, q: Optional[str] = None, uncategorized: bool = False,
                      unreviewed: bool = False, include_hidden: bool = False, tag: Optional[str] = None,
                      limit: int = Query(200, le=100000), offset: int = 0, conn=Depends(get_conn)):
    where, params = [], []
    if start: where.append("t.date >= ?"); params.append(start)
    if end: where.append("t.date <= ?"); params.append(end)
    if account_id: where.append("t.account_id = ?"); params.append(account_id)
    if category_id: where.append("t.category_id = ?"); params.append(category_id)
    if uncategorized: where.append("(c.name = 'Uncategorized' OR t.category_id IS NULL)")
    if unreviewed: where.append("t.reviewed = 0")
    if not include_hidden: where.append("t.hidden = 0")
    if tag: where.append("EXISTS (SELECT 1 FROM transaction_tags tt JOIN tags g ON g.id=tt.tag_id WHERE tt.transaction_id=t.id AND g.name=?)"); params.append(tag)
    if q:
        where.append("(t.merchant LIKE ? OR t.description LIKE ? OR t.notes LIKE ? OR CAST(ABS(t.amount) AS TEXT) LIKE ?)")
        params += [f"%{q}%"] * 4
    w = ("WHERE " + " AND ".join(where)) if where else ""
    total = conn.execute(f"SELECT COUNT(*) FROM transactions t LEFT JOIN categories c ON c.id=t.category_id {w}", params).fetchone()[0]
    items = rows(conn.execute(f"{TX_SELECT} {w} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?", (*params, limit, offset)))
    for t in items:
        t["tags"] = t["tags"].split(",") if t["tags"] else []
    return {"total": total, "items": items}


class TxIn(BaseModel):
    account_id: int
    date: str
    amount: float
    description: str
    merchant: Optional[str] = None
    category_id: Optional[int] = None
    notes: str = ""


class TxPatch(BaseModel):
    category_id: Optional[int] = None
    merchant: Optional[str] = None
    notes: Optional[str] = None
    hidden: Optional[bool] = None
    reviewed: Optional[bool] = None
    date: Optional[str] = None
    amount: Optional[float] = None
    tags: Optional[list[str]] = None
    create_rule: bool = False        # also save "merchant -> category" as a rule and apply to similar rows
    rule_pattern: Optional[str] = None


@app.post("/api/transactions", status_code=201)
def create_transaction(t: TxIn, conn=Depends(get_conn)):
    cat = Categorizer(conn)
    merchant = t.merchant or clean_merchant(t.description)
    category_id = t.category_id
    if category_id is None:
        category_id, merchant = cat.categorize(t.description, merchant)
    cur = conn.execute("INSERT INTO transactions (account_id, date, amount, description, merchant, category_id, notes, source, reviewed) "
                       "VALUES (?,?,?,?,?,?,?,'manual',1)", (t.account_id, t.date, t.amount, t.description, merchant, category_id, t.notes))
    conn.commit()
    return _tx(conn, cur.lastrowid)


def _tx(conn, tid: int) -> dict:
    r = conn.execute(f"{TX_SELECT} WHERE t.id=?", (tid,)).fetchone()
    if not r:
        raise HTTPException(404)
    d = dict(r)
    d["tags"] = d["tags"].split(",") if d["tags"] else []
    d["splits"] = rows(conn.execute("SELECT s.*, c.name AS category FROM splits s LEFT JOIN categories c ON c.id=s.category_id WHERE s.transaction_id=?", (tid,)))
    return d


@app.get("/api/transactions/{tid}")
def get_transaction(tid: int, conn=Depends(get_conn)):
    return _tx(conn, tid)


@app.patch("/api/transactions/{tid}")
def patch_transaction(tid: int, p: TxPatch, conn=Depends(get_conn)):
    cur = conn.execute("SELECT * FROM transactions WHERE id=?", (tid,)).fetchone()
    if not cur:
        raise HTTPException(404)
    fields = {}
    for k in ("category_id", "merchant", "notes", "hidden", "date", "amount"):
        v = getattr(p, k)
        if v is not None:
            fields[k] = int(v) if isinstance(v, bool) else v
    # any manual edit marks the row reviewed so syncs don't overwrite it
    fields["reviewed"] = 1 if p.reviewed is None else int(p.reviewed)
    sets = ", ".join(f"{k}=?" for k in fields)
    conn.execute(f"UPDATE transactions SET {sets} WHERE id=?", (*fields.values(), tid))
    if p.tags is not None:
        conn.execute("DELETE FROM transaction_tags WHERE transaction_id=?", (tid,))
        for name in p.tags:
            name = name.strip()
            if not name:
                continue
            conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (name,))
            tag_id = conn.execute("SELECT id FROM tags WHERE name=?", (name,)).fetchone()[0]
            conn.execute("INSERT OR IGNORE INTO transaction_tags VALUES (?,?)", (tid, tag_id))
    applied = 0
    if p.create_rule and p.category_id is not None:
        pattern = (p.rule_pattern or p.merchant or cur["merchant"]).strip()
        rid = conn.execute("INSERT INTO rules (pattern, category_id, rename_to, priority) VALUES (?,?,?,1)",
                           (pattern, p.category_id, p.merchant or "")).lastrowid
        applied = Categorizer(conn).apply_rule_retroactively(rid)
    conn.commit()
    d = _tx(conn, tid)
    d["rule_applied_to"] = applied
    return d


@app.delete("/api/transactions/{tid}", status_code=204)
def delete_transaction(tid: int, conn=Depends(get_conn)):
    conn.execute("DELETE FROM transactions WHERE id=?", (tid,))
    conn.commit()


class BulkPatch(BaseModel):
    ids: list[int]
    category_id: Optional[int] = None
    hidden: Optional[bool] = None
    reviewed: Optional[bool] = None
    add_tag: Optional[str] = None


@app.post("/api/transactions/bulk")
def bulk_patch(b: BulkPatch, conn=Depends(get_conn)):
    if not b.ids:
        return {"updated": 0}
    marks = ",".join("?" * len(b.ids))
    if b.category_id is not None:
        conn.execute(f"UPDATE transactions SET category_id=?, reviewed=1 WHERE id IN ({marks})", (b.category_id, *b.ids))
    if b.hidden is not None:
        conn.execute(f"UPDATE transactions SET hidden=? WHERE id IN ({marks})", (int(b.hidden), *b.ids))
    if b.reviewed is not None:
        conn.execute(f"UPDATE transactions SET reviewed=? WHERE id IN ({marks})", (int(b.reviewed), *b.ids))
    if b.add_tag:
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (b.add_tag,))
        tag_id = conn.execute("SELECT id FROM tags WHERE name=?", (b.add_tag,)).fetchone()[0]
        conn.executemany("INSERT OR IGNORE INTO transaction_tags VALUES (?,?)", [(i, tag_id) for i in b.ids])
    conn.commit()
    return {"updated": len(b.ids)}


class SplitIn(BaseModel):
    amount: float
    category_id: Optional[int] = None
    notes: str = ""


@app.put("/api/transactions/{tid}/splits")
def set_splits(tid: int, splits: list[SplitIn], conn=Depends(get_conn)):
    t = conn.execute("SELECT amount FROM transactions WHERE id=?", (tid,)).fetchone()
    if not t:
        raise HTTPException(404)
    if splits and abs(sum(s.amount for s in splits) - t["amount"]) > 0.005:
        raise HTTPException(400, f"Splits must sum to the transaction amount ({t['amount']})")
    conn.execute("DELETE FROM splits WHERE transaction_id=?", (tid,))
    conn.executemany("INSERT INTO splits (transaction_id, amount, category_id, notes) VALUES (?,?,?,?)",
                     [(tid, s.amount, s.category_id, s.notes) for s in splits])
    conn.execute("UPDATE transactions SET reviewed=1 WHERE id=?", (tid,))
    conn.commit()
    return _tx(conn, tid)


@app.post("/api/transactions/match-transfers")
def run_match_transfers(conn=Depends(get_conn)):
    return {"pairs": match_transfers(conn)}


@app.post("/api/transactions/recategorize")
def run_recategorize(conn=Depends(get_conn)):
    return {"updated": Categorizer(conn).apply_to_uncategorized()}


@app.get("/api/export/transactions.csv")
def export_csv(conn=Depends(get_conn)):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date", "account", "merchant", "description", "amount", "category", "group", "notes", "tags"])
    for t in list_transactions(start=None, end=None, account_id=None, category_id=None, q=None, uncategorized=False,
                               unreviewed=False, include_hidden=True, tag=None, limit=100000, offset=0, conn=conn)["items"]:
        w.writerow([t["date"], t["account"], t["merchant"], t["description"], t["amount"], t["category"], t["category_group"], t["notes"], " ".join(t["tags"])])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=transactions.csv"})


# ---------------- categories / rules / tags ----------------

class CategoryIn(BaseModel):
    name: str
    group: str = "Other"
    kind: str = "expense"
    budget_type: str = "flex"
    rollover: bool = False


class CategoryPatch(BaseModel):
    name: Optional[str] = None
    group: Optional[str] = None
    kind: Optional[str] = None
    budget_type: Optional[str] = None
    rollover: Optional[bool] = None
    archived: Optional[bool] = None


@app.get("/api/categories")
def list_categories(conn=Depends(get_conn)):
    return rows(conn.execute('SELECT * FROM categories ORDER BY kind, "group", name'))


@app.post("/api/categories", status_code=201)
def create_category(c: CategoryIn, conn=Depends(get_conn)):
    try:
        cur = conn.execute('INSERT INTO categories (name, "group", kind, budget_type, rollover) VALUES (?,?,?,?,?)',
                           (c.name, c.group, c.kind, c.budget_type, int(c.rollover)))
    except sqlite3.IntegrityError as e:
        raise HTTPException(400, str(e))
    conn.commit()
    return dict(conn.execute("SELECT * FROM categories WHERE id=?", (cur.lastrowid,)).fetchone())


@app.patch("/api/categories/{cid}")
def patch_category(cid: int, p: CategoryPatch, conn=Depends(get_conn)):
    fields = {k: (int(v) if isinstance(v, bool) else v) for k, v in p.model_dump().items() if v is not None}
    if fields:
        sets = ", ".join(f'"{k}"=?' for k in fields)
        conn.execute(f"UPDATE categories SET {sets} WHERE id=?", (*fields.values(), cid))
        conn.commit()
    r = conn.execute("SELECT * FROM categories WHERE id=?", (cid,)).fetchone()
    if not r:
        raise HTTPException(404)
    return dict(r)


@app.delete("/api/categories/{cid}", status_code=204)
def delete_category(cid: int, conn=Depends(get_conn)):
    unc = conn.execute("SELECT id FROM categories WHERE name='Uncategorized'").fetchone()[0]
    if cid == unc:
        raise HTTPException(400, "Cannot delete Uncategorized")
    conn.execute("UPDATE transactions SET category_id=? WHERE category_id=?", (unc, cid))
    conn.execute("DELETE FROM categories WHERE id=?", (cid,))
    conn.commit()


class RuleIn(BaseModel):
    pattern: str
    category_id: int
    rename_to: str = ""
    is_regex: bool = False
    priority: int = 1
    apply_now: bool = True


@app.get("/api/rules")
def list_rules(conn=Depends(get_conn)):
    return rows(conn.execute("SELECT r.*, c.name AS category FROM rules r LEFT JOIN categories c ON c.id=r.category_id ORDER BY r.priority, r.id"))


@app.post("/api/rules", status_code=201)
def create_rule(r: RuleIn, conn=Depends(get_conn)):
    cur = conn.execute("INSERT INTO rules (pattern, is_regex, category_id, rename_to, priority) VALUES (?,?,?,?,?)",
                       (r.pattern, int(r.is_regex), r.category_id, r.rename_to, r.priority))
    conn.commit()
    applied = Categorizer(conn).apply_rule_retroactively(cur.lastrowid) if r.apply_now else 0
    return {"id": cur.lastrowid, "applied_to": applied}


@app.delete("/api/rules/{rid}", status_code=204)
def delete_rule(rid: int, conn=Depends(get_conn)):
    conn.execute("DELETE FROM rules WHERE id=?", (rid,))
    conn.commit()


@app.get("/api/tags")
def list_tags(conn=Depends(get_conn)):
    return rows(conn.execute("SELECT g.*, COUNT(tt.transaction_id) AS count FROM tags g LEFT JOIN transaction_tags tt ON tt.tag_id=g.id GROUP BY g.id ORDER BY g.name"))


# ---------------- budgets ----------------

class BudgetIn(BaseModel):
    category_id: int
    amount: Optional[float]        # null removes the budget
    month: Optional[str] = None    # null = default for every month


@app.get("/api/budgets")
def get_budgets(month: Optional[str] = None, conn=Depends(get_conn)):
    return reports.budget_status(conn, month)


@app.put("/api/budgets")
def put_budget(b: BudgetIn, conn=Depends(get_conn)):
    if b.month is None:
        conn.execute("DELETE FROM budgets WHERE category_id=? AND month IS NULL", (b.category_id,))
    else:
        conn.execute("DELETE FROM budgets WHERE category_id=? AND month=?", (b.category_id, b.month))
    if b.amount is not None:
        conn.execute("INSERT INTO budgets (category_id, month, amount) VALUES (?,?,?)", (b.category_id, b.month, b.amount))
    conn.commit()
    return {"ok": True}


@app.get("/api/budgets/suggest")
def budget_suggest(months: int = 3, conn=Depends(get_conn)):
    return reports.suggest_budgets(conn, months)


@app.post("/api/budgets/apply-suggestions")
def budget_apply_suggestions(months: int = 3, conn=Depends(get_conn)):
    n = 0
    for s in reports.suggest_budgets(conn, months):
        if s["suggested"] <= 0:
            continue
        conn.execute("INSERT OR REPLACE INTO budgets (category_id, month, amount) VALUES (?, NULL, ?)", (s["category_id"], s["suggested"]))
        n += 1
    conn.commit()
    return {"set": n}


# ---------------- goals ----------------

class GoalIn(BaseModel):
    name: str
    target_amount: float
    target_date: Optional[str] = None
    account_id: Optional[int] = None
    starting_amount: float = 0
    monthly_contribution: float = 0
    kind: str = "save"


def _goal_progress(conn, g: dict) -> dict:
    return personal.goal_progress(conn, g)


@app.get("/api/goals")
def list_goals(conn=Depends(get_conn)):
    return [_goal_progress(conn, dict(r)) for r in conn.execute("SELECT * FROM goals WHERE archived=0 ORDER BY target_date, id")]


@app.post("/api/goals", status_code=201)
def create_goal(g: GoalIn, conn=Depends(get_conn)):
    cur = conn.execute("INSERT INTO goals (name, target_amount, target_date, account_id, starting_amount, monthly_contribution, kind) VALUES (?,?,?,?,?,?,?)",
                       (g.name, g.target_amount, g.target_date, g.account_id, g.starting_amount, g.monthly_contribution, g.kind))
    conn.commit()
    return _goal_progress(conn, dict(conn.execute("SELECT * FROM goals WHERE id=?", (cur.lastrowid,)).fetchone()))


@app.patch("/api/goals/{gid}")
def patch_goal(gid: int, g: GoalIn, conn=Depends(get_conn)):
    conn.execute("UPDATE goals SET name=?, target_amount=?, target_date=?, account_id=?, starting_amount=?, monthly_contribution=?, kind=? WHERE id=?",
                 (g.name, g.target_amount, g.target_date, g.account_id, g.starting_amount, g.monthly_contribution, g.kind, gid))
    conn.commit()
    r = conn.execute("SELECT * FROM goals WHERE id=?", (gid,)).fetchone()
    if not r:
        raise HTTPException(404)
    return _goal_progress(conn, dict(r))


@app.delete("/api/goals/{gid}", status_code=204)
def delete_goal(gid: int, conn=Depends(get_conn)):
    conn.execute("UPDATE goals SET archived=1 WHERE id=?", (gid,))
    conn.commit()


# ---------------- recurring ----------------

class RecurringStatus(BaseModel):
    status: str  # confirmed | ignored | detected
    display_name: str = ""


@app.get("/api/recurring")
def get_recurring(conn=Depends(get_conn)):
    items = recurring.detect_recurring(conn)
    monthly_out = round(-sum(i["monthly_equivalent"] for i in items if i["kind"] == "expense"), 2)
    monthly_in = round(sum(i["monthly_equivalent"] for i in items if i["kind"] == "income"), 2)
    return {"items": items, "monthly_expenses": monthly_out, "monthly_income": monthly_in}


@app.post("/api/recurring/{key}/status")
def set_recurring_status(key: str, s: RecurringStatus, conn=Depends(get_conn)):
    if s.status == "detected":
        conn.execute("DELETE FROM recurring_overrides WHERE merchant_key=?", (key,))
    else:
        conn.execute("INSERT OR REPLACE INTO recurring_overrides (merchant_key, status, display_name) VALUES (?,?,?)", (key, s.status, s.display_name))
    conn.commit()
    return {"ok": True}


# ---------------- reports ----------------

def _range(start: Optional[str], end: Optional[str], months: int = 1) -> tuple[str, str]:
    if start and end:
        return start, end
    m = reports.this_month()
    return reports.month_bounds(reports.shift_month(m, -(months - 1)))[0], reports.month_bounds(m)[1]


@app.get("/api/reports/cashflow")
def r_cashflow(months: int = 12, conn=Depends(get_conn)):
    return reports.cashflow(conn, months)


@app.get("/api/reports/spending")
def r_spending(start: Optional[str] = None, end: Optional[str] = None, months: int = 1, conn=Depends(get_conn)):
    s, e = _range(start, end, months)
    return {"start": s, "end": e, "groups": reports.spending_by_group(conn, s, e), "merchants": reports.top_merchants(conn, s, e)}


@app.get("/api/reports/sankey")
def r_sankey(start: Optional[str] = None, end: Optional[str] = None, months: int = 1, conn=Depends(get_conn)):
    s, e = _range(start, end, months)
    return {"start": s, "end": e, **reports.sankey(conn, s, e)}


@app.get("/api/reports/trend/{category_id}")
def r_trend(category_id: int, months: int = 12, conn=Depends(get_conn)):
    return reports.category_trend(conn, category_id, months)


@app.get("/api/insights")
def get_insights(conn=Depends(get_conn)):
    return insights.generate(conn)


@app.post("/api/insights/dismiss")
def dismiss_insight(body: dict, conn=Depends(get_conn)):
    conn.execute("INSERT OR REPLACE INTO dismissed_insights (key) VALUES (?)", (body["key"],))
    conn.commit()
    return {"ok": True}


@app.get("/api/holdings")
def get_holdings(conn=Depends(get_conn)):
    return rows(conn.execute("SELECT h.*, a.name AS account FROM holdings h JOIN accounts a ON a.id=h.account_id ORDER BY h.value DESC"))


# ---------------- import ----------------

@app.get("/api/import/profiles")
def import_profiles():
    return [{"name": p.name, "label": p.label or p.name, "date": p.date, "description": p.description, "amount": p.amount,
             "debit": p.debit, "credit": p.credit, "negate": p.negate} for p in importer.PROFILES.values()]


class InspectIn(BaseModel):
    text: str


@app.post("/api/import/inspect")
def import_inspect(b: InspectIn):
    return importer.inspect(b.text)


@app.post("/api/import")
async def import_file(file: UploadFile = File(...), account_id: int = Form(...), profile: str = Form("auto"),
                      dry_run: bool = Form(False), conn=Depends(get_conn)):
    text = (await file.read()).decode("utf-8-sig", errors="replace")
    if profile == "auto":
        profile = importer.detect_profile(text)
    res = importer.import_csv(conn, account_id, text, profile, dry_run=dry_run)
    pairs = 0 if dry_run else match_transfers(conn)
    return {"profile": profile, "transfer_pairs": pairs, **res.as_dict()}


class ImportText(BaseModel):
    account_id: int
    text: str
    profile: str = "auto"
    dry_run: bool = False
    mapping: Optional[dict] = None


@app.post("/api/import-text")
def import_text(b: ImportText, conn=Depends(get_conn)):
    """Same as /api/import but with the file contents in JSON (used by the web UI in both modes)."""
    profile = importer.detect_profile(b.text) if b.profile == "auto" else b.profile
    res = importer.import_csv(conn, b.account_id, b.text, profile, dry_run=b.dry_run, mapping=b.mapping)
    pairs = 0 if b.dry_run else match_transfers(conn)
    return {"profile": profile, "transfer_pairs": pairs, **res.as_dict()}


# ---------------- plaid ----------------

def _plaid() -> plaid.PlaidClient:
    return plaid.PlaidClient()


@app.get("/api/plaid/status")
def plaid_status(conn=Depends(get_conn)):
    c = _plaid()
    items = rows(conn.execute("SELECT id, item_id, institution_name, last_synced_at, last_error, created_at FROM plaid_items"))
    for it in items:
        it["accounts"] = rows(conn.execute("SELECT id, name, type FROM accounts WHERE plaid_item_id=?", (it["id"],)))
    return {"configured": c.configured, "env": c.env, "items": items}


@app.post("/api/plaid/link-token")
def plaid_link_token(body: dict | None = None, conn=Depends(get_conn)):
    c = _plaid()
    if not c.configured:
        raise HTTPException(400, "Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET.")
    access_token = None
    if body and body.get("item_id"):
        r = conn.execute("SELECT access_token FROM plaid_items WHERE id=?", (body["item_id"],)).fetchone()
        access_token = r["access_token"] if r else None
    try:
        return c.create_link_token(access_token=access_token)
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@app.post("/api/plaid/exchange")
def plaid_exchange(body: dict, conn=Depends(get_conn)):
    c = _plaid()
    try:
        res = plaid.link_item(conn, c, body["public_token"])
        sync = plaid.sync_item(conn, c, res["item_id"])
        sync["holdings"] = plaid.sync_holdings(conn, c, res["item_id"])
        match_transfers(conn)
        return {**res, "sync": sync}
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@app.post("/api/plaid/sync")
def plaid_sync(conn=Depends(get_conn)):
    c = _plaid()
    if not c.configured:
        raise HTTPException(400, "Plaid is not configured.")
    results = plaid.sync_all(conn, c)
    pairs = match_transfers(conn)
    return {"results": results, "transfer_pairs": pairs}


@app.delete("/api/plaid/items/{item_id}", status_code=204)
def plaid_remove(item_id: int, keep_data: bool = True, conn=Depends(get_conn)):
    r = conn.execute("SELECT access_token FROM plaid_items WHERE id=?", (item_id,)).fetchone()
    if not r:
        raise HTTPException(404)
    try:
        _plaid().item_remove(r["access_token"])
    except Exception:
        pass
    if not keep_data:
        conn.execute("DELETE FROM accounts WHERE plaid_item_id=?", (item_id,))
    conn.execute("DELETE FROM plaid_items WHERE id=?", (item_id,))
    conn.commit()


@app.post("/api/plaid/sandbox-link")
def plaid_sandbox_link(body: dict | None = None, conn=Depends(get_conn)):
    """Dev shortcut: create a sandbox item without the Link UI (sandbox env only)."""
    c = _plaid()
    if c.env != "sandbox":
        raise HTTPException(400, "Only available in the sandbox environment.")
    inst = (body or {}).get("institution_id", "ins_109508")  # First Platypus Bank
    try:
        pt = c.sandbox_public_token(inst)["public_token"]
        return plaid_exchange({"public_token": pt}, conn)
    except RuntimeError as e:
        raise HTTPException(502, str(e))


# ---------------- frontend ----------------

@app.get("/config.js", include_in_schema=False)
def config_js():
    return Response('window.LEDGER_CONFIG = {"mode": "server"};\n', media_type="application/javascript")


@app.get("/transparency.json", include_in_schema=False)
def transparency():
    p = WEB_DIR.parent / "transparency.json"
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p)


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(WEB_DIR / "index.html")


if WEB_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")
