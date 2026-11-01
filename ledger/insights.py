"""Rule-based 'advice': the things a good financial planner would point out to you."""
from __future__ import annotations

import sqlite3
import statistics
from datetime import date, timedelta

from . import reports
from .categorize import merchant_key
from .recurring import detect_recurring


def _ins(key, severity, title, body, action=None, **extra):
    return {"key": key, "severity": severity, "title": title, "body": body, "action": action, **extra}


def generate(conn: sqlite3.Connection) -> list[dict]:
    dismissed = {r["key"] for r in conn.execute("SELECT key FROM dismissed_insights")}
    out: list[dict] = []
    month = reports.this_month()
    start, end = reports.month_bounds(month)
    today = date.today()

    # 1. Budgets at risk / blown
    bs = reports.budget_status(conn, month)
    for r in bs["rows"]:
        if r["kind"] != "expense" or not r["has_budget"] or not r["available"]:
            continue
        if r["remaining"] < -0.5:
            out.append(_ins(f"budget-over:{r['category_id']}:{month}", "serious", f"Over budget on {r['category']}",
                            f"You've spent ${r['actual']:,.0f} of a ${r['available']:,.0f} budget this month "
                            f"(${-r['remaining']:,.0f} over).", {"view": "budgets"}))
        elif r["budget_type"] == "flex" and r["pct"] > bs["summary"]["month_progress"] + 0.2 and r["pct"] >= 0.6:
            out.append(_ins(f"budget-pace:{r['category_id']}:{month}", "warning", f"{r['category']} is ahead of pace",
                            f"{r['pct']:.0%} of the budget used with {bs['summary']['month_progress']:.0%} of the month gone.",
                            {"view": "budgets"}))

    # 2. Recurring: new subscriptions, price increases, upcoming large bills
    rec = detect_recurring(conn)
    for r in rec:
        if r["kind"] != "expense":
            continue
        first = conn.execute("SELECT MIN(date) FROM transactions WHERE merchant=?", (r["merchant"],)).fetchone()[0]
        if first and (today - date.fromisoformat(first)).days <= 75 and r["occurrences"] >= 2:
            out.append(_ins(f"new-recurring:{r['merchant_key']}", "info", f"New recurring charge: {r['merchant']}",
                            f"${-r['amount']:,.2f} {r['cadence']} started {first}. That's ${-r['monthly_equivalent']*12:,.0f}/yr "
                            f"if it stays.", {"view": "recurring"}))
        hist = conn.execute(
            "SELECT amount FROM transactions WHERE merchant=? AND amount<0 ORDER BY date DESC LIMIT 6", (r["merchant"],)).fetchall()
        if len(hist) >= 4:
            prior = [-h["amount"] for h in hist[1:]]
            latest, prev = -hist[0]["amount"], statistics.median(prior)
            was_stable = prev > 0 and max(prior) - min(prior) <= 0.05 * prev + 0.5
            if was_stable and latest > prev * 1.05 and latest - prev >= 1:
                out.append(_ins(f"price-up:{r['merchant_key']}:{round(latest,2)}", "warning", f"{r['merchant']} went up",
                                f"Latest charge ${latest:,.2f} vs. usual ${prev:,.2f} (+{(latest/prev-1):.0%}).",
                                {"view": "recurring"}))
    subs_total = sum(-r["monthly_equivalent"] for r in rec if r["kind"] == "expense" and r["category"] == "Subscriptions")
    if subs_total > 0:
        out.append(_ins(f"subs-total:{month}", "info", f"Subscriptions cost ${subs_total:,.0f}/month",
                        f"That's ${subs_total*12:,.0f} a year across {sum(1 for r in rec if r['category']=='Subscriptions')} services. "
                        "Worth a 5-minute audit?", {"view": "recurring"}))

    # 3. Cash position vs. bills
    sts = reports.safe_to_spend(conn, [r for r in rec if r["days_until"] <= 45])
    if sts["liquid_cash"] > 0 and sts["safe_to_spend"] < 0:
        out.append(_ins(f"cash-short:{month}", "critical", "Upcoming bills exceed available cash",
                        f"${sts['upcoming_bills']:,.0f} in bills and ${sts['card_balances']:,.0f} on cards against "
                        f"${sts['liquid_cash']:,.0f} in checking.", {"view": "dashboard"}))
    cf = reports.cashflow(conn, 4)[:-1]
    avg_exp = statistics.mean([c["expenses"] for c in cf]) if cf and any(c["expenses"] for c in cf) else 0
    if avg_exp and sts["liquid_cash"] > 4 * avg_exp:
        out.append(_ins(f"idle-cash:{month}", "info", "Cash sitting idle in checking",
                        f"${sts['liquid_cash']:,.0f} in checking is about {sts['liquid_cash']/avg_exp:.1f} months of spending. "
                        "Beyond a 1-2 month buffer, a high-yield savings account would earn interest on the rest.",
                        {"view": "accounts"}))

    # 4. Unusual transactions this month (3x the category's typical charge)
    rows = conn.execute(
        f"""SELECT t.id, t.merchant, t.amount, t.date, t.category_id, c.name AS category FROM transactions t
            LEFT JOIN categories c ON c.id=t.category_id WHERE t.date BETWEEN ? AND ? AND t.amount < -50 AND {reports.REAL_MONEY}""",
        (start, end)).fetchall()
    for t in rows:
        if t["category"] in (None, "Rent / Mortgage", "Travel", "Taxes", "Uncategorized"):
            continue
        hist = [-h[0] for h in conn.execute(
            "SELECT amount FROM transactions WHERE category_id=? AND amount<0 AND date<? ORDER BY date DESC LIMIT 30",
            (t["category_id"], start)).fetchall()]
        if len(hist) >= 8 and -t["amount"] > 3 * statistics.median(hist) and -t["amount"] > 100:
            out.append(_ins(f"unusual:{t['id']}", "info", f"Unusually large {t['category']} charge",
                            f"${-t['amount']:,.2f} at {t['merchant']} on {t['date']}; you typically spend "
                            f"${statistics.median(hist):,.0f} per {t['category']} transaction.",
                            {"view": "transactions", "search": t["merchant"]}))

    # 5. Possible duplicate charges
    dups = conn.execute(
        """SELECT merchant, date, amount, COUNT(*) n, GROUP_CONCAT(id) ids FROM transactions
           WHERE date BETWEEN ? AND ? AND amount < 0 AND hidden=0 GROUP BY merchant, date, amount HAVING n > 1""",
        (start, end)).fetchall()
    for d in dups:
        if -d["amount"] >= 10:
            out.append(_ins(f"dup:{d['ids']}", "warning", f"Possible duplicate charge at {d['merchant']}",
                            f"{d['n']} charges of ${-d['amount']:,.2f} on {d['date']}. Could be a double-swipe.",
                            {"view": "transactions", "search": d["merchant"]}))

    # 6. Category spending trending up vs. 3-month average (only once enough of the month has passed)
    for r in (reports.spending_by_category(conn, start, end)[:12] if bs["summary"]["month_progress"] >= 0.25 else []):
        if r["category_id"] is None or r["spent"] < 100:
            continue
        trend = reports.category_trend(conn, r["category_id"], 4)[:-1]
        avg = statistics.mean([x["spent"] for x in trend]) if trend else 0
        projected = r["spent"] / max(bs["summary"]["month_progress"], 0.15)
        if avg > 50 and projected > avg * 1.3:
            out.append(_ins(f"trend-up:{r['category_id']}:{month}", "info", f"{r['category']} is trending up",
                            f"On pace for ${projected:,.0f} this month vs. a ${avg:,.0f} average over the last 3 months.",
                            {"view": "reports", "category_id": r["category_id"]}))

    # 7. Housekeeping
    unc = conn.execute(
        "SELECT COUNT(*) FROM transactions t JOIN categories c ON c.id=t.category_id WHERE c.name='Uncategorized' AND t.hidden=0").fetchone()[0]
    if unc:
        out.append(_ins("uncategorized", "info", f"{unc} uncategorized transaction{'s' if unc != 1 else ''}",
                        "Categorize them (and save a rule) so budgets and reports stay accurate.",
                        {"view": "transactions", "uncategorized": True}))
    stale = [a for a in reports.account_balances(conn) if not a["archived"] and a["balance_date"]
             and (today - date.fromisoformat(a["balance_date"])).days > 14]
    for a in stale:
        out.append(_ins(f"stale:{a['id']}:{a['balance_date']}", "info", f"{a['name']} balance is stale",
                        f"Last updated {a['balance_date']}. Net worth may be off.", {"view": "accounts"}))

    # 8. Savings rate
    last = [c for c in reports.cashflow(conn, 2) if c["month"] != month]
    if last and last[0]["income"] > 0:
        sr = last[0]["savings_rate"]
        if sr is not None and sr < 0.1:
            out.append(_ins(f"savings-rate:{last[0]['month']}", "warning", f"Savings rate was {sr:.0%} last month",
                            f"Income ${last[0]['income']:,.0f}, spending ${last[0]['expenses']:,.0f}. A 20% rate is a common target.",
                            {"view": "reports"}))

    sev_rank = {"critical": 0, "serious": 1, "warning": 2, "info": 3}
    out = [i for i in out if i["key"] not in dismissed]
    out.sort(key=lambda i: sev_rank[i["severity"]])
    return out
