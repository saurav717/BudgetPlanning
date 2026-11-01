"""Personalisation: your profile, the dashboard you see, and the analyses built around your situation."""
from __future__ import annotations

import calendar
import sqlite3
import statistics
from datetime import date, timedelta

from . import fx, reports
from .db import get_setting, set_setting
from .recurring import CADENCES, detect_recurring

PRIORITIES = {
    "emergency_fund": "Build an emergency fund",
    "debt_payoff": "Pay off debt",
    "reduce_spending": "Spend less / stick to a budget",
    "invest_retirement": "Max out retirement accounts",
    "support_family": "Send money home / support family",
    "save_for_goal": "Save for something big",
    "grow_net_worth": "Grow net worth",
}

PROFILE_DEFAULTS = {
    "name": "", "home_currency": "USD", "second_currency": "", "pay_frequency": "biweekly",
    "monthly_take_home": None, "emergency_months": 6, "min_cash_buffer": 1000, "savings_rate_target": 0.2,
    "priorities": [], "onboarded": False,
}

# 2026 IRS limits (employee deferral / individual). Editable in Settings.
DEFAULT_LIMITS = {"401k": 24500, "ira": 7500, "hsa": 4400}
TAX_BUCKET = {"401k": "401k", "roth_401k": "401k", "403b": "401k", "ira": "ira", "roth_ira": "ira", "hsa": "hsa"}
TAX_LABEL = {"401k": "401(k) / 403(b)", "ira": "IRA (Traditional + Roth)", "hsa": "HSA"}
PAYCHECKS_PER_YEAR = {"weekly": 52, "biweekly": 26, "semimonthly": 24, "monthly": 12}

WIDGETS = {
    # id: (title, column span on a 12-col grid)
    "kpis": ("Key numbers", 12), "networth": ("Net worth", 8), "insights": ("Insights", 4),
    "forecast": ("Cash forecast", 8), "checkup": ("Money checkup", 4), "pace": ("Spending pace", 7),
    "heatmap": ("Daily spending", 5), "budget": ("Budget", 4), "upcoming": ("Upcoming bills", 4),
    "recent": ("Recent transactions", 4), "cashflow": ("Cash flow", 8), "spending": ("Spending by group", 4),
    "goals": ("Goals", 6), "remittances": ("Money sent home", 6), "retirement": ("Retirement contributions", 6),
    "utilization": ("Credit card utilisation", 6),
}
BASE_ORDER = ["kpis", "networth", "insights", "forecast", "checkup", "pace", "heatmap", "budget", "upcoming", "recent",
              "goals", "remittances", "retirement", "utilization", "cashflow", "spending"]


# ---------------- profile & layout ----------------

def get_profile(conn: sqlite3.Connection) -> dict:
    p = {**PROFILE_DEFAULTS, **(get_setting(conn, "profile", {}) or {})}
    p["home_currency"] = fx.home_currency(conn)
    return p


def save_profile(conn: sqlite3.Connection, data: dict) -> dict:
    p = {**get_profile(conn), **{k: v for k, v in data.items() if k in PROFILE_DEFAULTS}}
    p["priorities"] = [x for x in p.get("priorities") or [] if x in PRIORITIES]
    fx.set_home(conn, p["home_currency"] or "USD")
    set_setting(conn, "profile", p)
    return get_profile(conn)


def has_tax_accounts(conn) -> bool:
    return conn.execute("SELECT 1 FROM accounts WHERE COALESCE(tax_type,'') != '' AND archived=0").fetchone() is not None


def recommended_layout(conn, profile: dict) -> list[dict]:
    """Order and visibility of dashboard widgets, derived from what you said matters to you."""
    pr = set(profile.get("priorities") or [])
    boost = []
    if "emergency_fund" in pr: boost += ["checkup", "forecast", "goals"]
    if "debt_payoff" in pr: boost += ["utilization", "goals", "checkup"]
    if "reduce_spending" in pr: boost += ["pace", "budget", "heatmap"]
    if "support_family" in pr: boost += ["remittances"]
    if "invest_retirement" in pr: boost += ["retirement", "networth"]
    if "save_for_goal" in pr: boost += ["goals", "forecast"]
    if "grow_net_worth" in pr: boost += ["networth", "retirement"]
    order = ["kpis"]
    # boosted widgets go right after the key numbers, in the order the priorities named them
    for w in boost:
        if w not in order: order.append(w)
    for w in BASE_ORDER:
        if w not in order: order.append(w)
    has_cards_with_limits = conn.execute("SELECT 1 FROM accounts WHERE type='credit' AND credit_limit > 0").fetchone()
    hidden = set()
    if not (profile.get("second_currency") or "support_family" in pr or _remit_total(conn) > 0):
        hidden.add("remittances")
    if not ("invest_retirement" in pr or has_tax_accounts(conn)):
        hidden.add("retirement")
    if not (has_cards_with_limits or "debt_payoff" in pr):
        hidden.add("utilization")
    if pr and "reduce_spending" not in pr:
        hidden.add("spending")  # still on Reports; keep the dashboard focused
    return [{"id": w, "title": WIDGETS[w][0], "span": WIDGETS[w][1], "visible": w not in hidden} for w in order]


def get_layout(conn, profile: dict | None = None) -> list[dict]:
    profile = profile or get_profile(conn)
    saved = get_setting(conn, "dashboard_layout")
    if not saved:
        return recommended_layout(conn, profile)
    seen = {w["id"] for w in saved if w.get("id") in WIDGETS}
    out = [{"id": w["id"], "title": WIDGETS[w["id"]][0], "span": WIDGETS[w["id"]][1], "visible": bool(w.get("visible", True))}
           for w in saved if w.get("id") in WIDGETS]
    for w in BASE_ORDER:  # widgets added in a later version appear (hidden) at the end
        if w not in seen:
            out.append({"id": w, "title": WIDGETS[w][0], "span": WIDGETS[w][1], "visible": False})
    return out


def save_layout(conn, layout: list[dict] | None) -> list[dict]:
    if layout is None:
        conn.execute("DELETE FROM settings WHERE key='dashboard_layout'")
        conn.commit()
    else:
        set_setting(conn, "dashboard_layout", [{"id": w["id"], "visible": bool(w.get("visible", True))} for w in layout if w.get("id") in WIDGETS])
    return get_layout(conn)


# ---------------- helpers ----------------

def _complete_months(n: int) -> list[str]:
    cur = reports.this_month()
    return [reports.shift_month(cur, -i) for i in range(n, 0, -1)]


def _avg_month(conn, months: int = 3) -> dict:
    cf = {r["month"]: r for r in reports.cashflow(conn, months + 1)}
    rows = [cf[m] for m in _complete_months(months) if m in cf and (cf[m]["income"] or cf[m]["expenses"])]
    if not rows:
        return {"income": 0.0, "expenses": 0.0, "months": 0}
    return {"income": round(statistics.mean(r["income"] for r in rows), 2),
            "expenses": round(statistics.mean(r["expenses"] for r in rows), 2), "months": len(rows)}


def _interp(x: float, pts: list[tuple[float, float]]) -> float:
    """Piecewise-linear score: pts are (x, score) sorted by x."""
    if x <= pts[0][0]: return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def _status(score: float) -> str:
    return "good" if score >= 75 else "warning" if score >= 45 else "serious"


def _liquid(conn) -> dict:
    accts = [a for a in reports.account_balances(conn) if not a["archived"]]
    cash = sum(a["balance_home"] for a in accts if a["type"] in ("checking", "savings", "cash") and a["balance_home"] > 0)
    cards = -sum(a["balance_home"] for a in accts if a["type"] == "credit" and a["balance_home"] < 0)
    return {"cash": round(cash, 2), "cards": round(cards, 2), "net": round(cash - cards, 2)}


# ---------------- credit utilisation ----------------

def utilization(conn) -> dict:
    cards = [a for a in reports.account_balances(conn) if a["type"] == "credit" and not a["archived"]]
    rows = []
    for a in cards:
        owed = max(0.0, -a["balance_home"])
        limit = fx.convert(conn, a["credit_limit"], a["currency"]) if a["credit_limit"] else None
        rows.append({"id": a["id"], "name": a["name"], "owed": round(owed, 2), "limit": limit,
                     "util": round(owed / limit, 3) if limit else None})
    with_limits = [r for r in rows if r["limit"]]
    total_owed = sum(r["owed"] for r in with_limits)
    total_limit = sum(r["limit"] for r in with_limits)
    return {"cards": rows, "total_owed": round(sum(r["owed"] for r in rows), 2),
            "total_limit": round(total_limit, 2) if with_limits else None,
            "util": round(total_owed / total_limit, 3) if total_limit else None}


# ---------------- retirement ----------------

def retirement(conn, year: int | None = None, profile: dict | None = None) -> dict:
    profile = profile or get_profile(conn)
    year = year or date.today().year
    limits = {**DEFAULT_LIMITS, **(get_setting(conn, "contribution_limits", {}) or {})}
    accts = conn.execute("SELECT id, name, tax_type, currency FROM accounts WHERE COALESCE(tax_type,'') != '' AND archived=0").fetchall()
    buckets: dict[str, dict] = {}
    today = date.today()
    elapsed = (today - date(year, 1, 1)).days / (366 if calendar.isleap(year) else 365) if year == today.year else 1.0
    per_year = PAYCHECKS_PER_YEAR.get(profile.get("pay_frequency"), 26)
    checks_left = max(1, round(per_year * (1 - elapsed))) if year == today.year else 0
    for a in accts:
        b = TAX_BUCKET.get(a["tax_type"])
        if not b:
            continue
        contributed = conn.execute(
            # employer match and investment gains don't count toward your personal deferral limit
            "SELECT COALESCE(SUM(amount),0) FROM tx_home WHERE account_id=? AND amount>0 AND date BETWEEN ? AND ? "
            "AND lower(description) NOT LIKE '%employer%' AND lower(description) NOT LIKE '%match%' "
            "AND lower(description) NOT LIKE '%dividend%' AND lower(description) NOT LIKE '%interest%'",
            (a["id"], f"{year}-01-01", f"{year}-12-31")).fetchone()[0]
        bk = buckets.setdefault(b, {"bucket": b, "label": TAX_LABEL[b], "limit": limits.get(b), "contributed": 0.0, "accounts": []})
        bk["contributed"] = round(bk["contributed"] + contributed, 2)
        bk["accounts"].append({"id": a["id"], "name": a["name"], "contributed": round(contributed, 2)})
    for bk in buckets.values():
        lim = bk["limit"] or 0
        bk["pct"] = round(bk["contributed"] / lim, 3) if lim else None
        bk["expected_pct"] = round(elapsed, 3)
        bk["remaining"] = round(max(0.0, lim - bk["contributed"]), 2)
        bk["per_paycheck_to_max"] = round(bk["remaining"] / checks_left, 2) if checks_left and bk["remaining"] else 0.0
        bk["on_pace"] = bk["pct"] is not None and bk["pct"] >= elapsed - 0.03
    return {"year": year, "buckets": sorted(buckets.values(), key=lambda b: list(TAX_LABEL).index(b["bucket"])),
            "paychecks_left": checks_left, "limits": limits}


# ---------------- remittances ----------------

def _remit_total(conn, year: int | None = None) -> float:
    year = year or date.today().year
    r = conn.execute("""SELECT COALESCE(SUM(-t.amount),0) FROM tx_home t JOIN categories c ON c.id=t.category_id
                        JOIN accounts a ON a.id=t.account_id
                        WHERE c."group"='Remittances' AND t.amount<0 AND t.hidden=0 AND t.date BETWEEN ? AND ?""",
                     (f"{year}-01-01", f"{year}-12-31")).fetchone()[0]
    return round(r, 2)


def remittances(conn, year: int | None = None, profile: dict | None = None) -> dict:
    profile = profile or get_profile(conn)
    year = year or date.today().year
    home = fx.home_currency(conn)
    second = profile.get("second_currency") or ""
    rows = conn.execute(
        """SELECT t.id, t.date, -t.amount AS amount, t.merchant, c.name AS category, a.name AS account FROM tx_home t
           JOIN categories c ON c.id=t.category_id JOIN accounts a ON a.id=t.account_id
           WHERE c."group"='Remittances' AND t.amount<0 AND t.hidden=0 AND t.date BETWEEN ? AND ? ORDER BY t.date DESC""",
        (f"{year}-01-01", f"{year}-12-31")).fetchall()
    monthly = {f"{year}-{m:02d}": 0.0 for m in range(1, 13)}
    by_service: dict[str, float] = {}
    by_cat: dict[str, float] = {}
    for r in rows:
        monthly[r["date"][:7]] = round(monthly[r["date"][:7]] + r["amount"], 2)
        by_service[r["merchant"]] = round(by_service.get(r["merchant"], 0) + r["amount"], 2)
        by_cat[r["category"]] = round(by_cat.get(r["category"], 0) + r["amount"], 2)
    total = round(sum(r["amount"] for r in rows), 2)
    last = conn.execute(
        """SELECT COALESCE(SUM(-t.amount),0) FROM tx_home t JOIN categories c ON c.id=t.category_id
           WHERE c."group"='Remittances' AND t.amount<0 AND t.hidden=0 AND t.date BETWEEN ? AND ?""",
        (f"{year-1}-01-01", f"{year-1}-{date.today().strftime('%m-%d') if year == date.today().year else '12-31'}")).fetchone()[0]
    months_elapsed = date.today().month if year == date.today().year else 12
    return {"year": year, "currency": home, "second_currency": second, "total": total,
            "total_second": fx.convert(conn, total, home, second) if second else None,
            "rate": fx.convert(conn, 1.0, home, second) if second else None,
            "count": len(rows), "monthly": [{"month": k, "amount": v} for k, v in monthly.items()],
            "avg_month": round(total / months_elapsed, 2) if months_elapsed else 0.0,
            "same_period_last_year": round(last, 2),
            "by_service": sorted(({"merchant": k, "amount": v} for k, v in by_service.items()), key=lambda x: -x["amount"]),
            "by_category": by_cat, "items": [dict(r) for r in rows[:50]]}


# ---------------- spending pace & daily ----------------

def pace(conn, month: str | None = None) -> dict:
    month = month or reports.this_month()
    prev = reports.shift_month(month, -1)

    def daily_cum(m: str) -> list[float]:
        start, end = reports.month_bounds(m)
        rows = dict(conn.execute(
            f"""SELECT CAST(substr(t.date,9,2) AS INTEGER), SUM(-t.amount) FROM tx_home t LEFT JOIN categories c ON c.id=t.category_id
                WHERE t.date BETWEEN ? AND ? AND t.amount<0 AND {reports.REAL_MONEY} GROUP BY 1""", (start, end)).fetchall())
        out, run = [], 0.0
        for d in range(1, int(end[-2:]) + 1):
            run += rows.get(d, 0.0)
            out.append(round(run, 2))
        return out

    cur, last = daily_cum(month), daily_cum(prev)
    days = len(cur)
    today_idx = min(date.today().day, days) if month == reports.this_month() else days
    bs = reports.budget_status(conn, month)["summary"]
    planned = bs["planned_spending"]
    spent_now = cur[today_idx - 1] if today_idx else 0.0
    last_same = last[min(today_idx, len(last)) - 1] if last and today_idx else 0.0
    return {"month": month, "days": days, "today": today_idx, "this_month": cur[:today_idx], "last_month": last,
            "budget_line": [round(planned * (d + 1) / days, 2) for d in range(days)] if planned else None,
            "spent": spent_now, "last_month_same_day": last_same, "delta_vs_last": round(spent_now - last_same, 2),
            "planned": planned, "expected_by_now": round(planned * today_idx / days, 2) if planned else None,
            "projected": round(spent_now / today_idx * days, 2) if today_idx >= 5 else None}


def daily(conn, months: int = 3) -> dict:
    cur = reports.this_month()
    start = reports.month_bounds(reports.shift_month(cur, -(months - 1)))[0]
    rows = conn.execute(
        f"""SELECT t.date, SUM(-t.amount) AS spent, COUNT(*) AS n FROM tx_home t LEFT JOIN categories c ON c.id=t.category_id
            WHERE t.date >= ? AND t.date <= ? AND t.amount<0 AND {reports.REAL_MONEY} GROUP BY t.date""",
        (start, date.today().isoformat())).fetchall()
    by = {r["date"]: (round(r["spent"], 2), r["n"]) for r in rows}
    out = []
    for i in range(months - 1, -1, -1):
        m = reports.shift_month(cur, -i)
        s, e = reports.month_bounds(m)
        d0 = date.fromisoformat(s)
        days = []
        for k in range(int(e[-2:])):
            d = (d0 + timedelta(days=k)).isoformat()
            spent, n = by.get(d, (0.0, 0))
            days.append({"date": d, "spent": spent, "count": n, "future": d > date.today().isoformat()})
        out.append({"month": m, "first_weekday": (d0.weekday() + 1) % 7, "days": days})
    vals = sorted(v[0] for v in by.values() if v[0] > 0)
    # quantile breaks so the colour scale adapts to how you actually spend
    breaks = [vals[int(len(vals) * q)] for q in (0.2, 0.4, 0.6, 0.8)] if len(vals) >= 5 else [10, 30, 60, 120]
    return {"months": out, "breaks": [round(b, 2) for b in breaks]}


# ---------------- cash forecast ----------------

def _occurrences(item: dict, start: date, end: date) -> list[date]:
    from .recurring import step
    d = date.fromisoformat(item["next_date"])
    while d < start:
        d = step(d, item["cadence"], item.get("anchor_day"))
    out = []
    while d <= end:
        out.append(d)
        d = step(d, item["cadence"], item.get("anchor_day"))
    return out


def forecast(conn, days: int = 60, profile: dict | None = None) -> dict:
    """Project spendable cash: checking + cash, minus what's owed on cards, plus scheduled income,
    minus scheduled bills/transfers out, minus your typical day-to-day spending."""
    profile = profile or get_profile(conn)
    today = date.today()
    end = today + timedelta(days=days)
    accts = {a["id"]: a for a in reports.account_balances(conn) if not a["archived"]}
    liquid_ids = {i for i, a in accts.items() if a["type"] in ("checking", "cash")}
    cash = sum(accts[i]["balance_home"] for i in liquid_ids)
    cards = -sum(a["balance_home"] for a in accts.values() if a["type"] == "credit" and a["balance_home"] < 0)
    items = detect_recurring(conn, include_transfers=True)
    events = []
    rec_keys = set()
    for it in items:
        acct = accts.get(it["account_id"])
        if not acct:
            continue
        if it["kind"] == "income" and it["account_id"] not in liquid_ids:
            continue  # interest landing in savings doesn't help checking
        if it["kind"] == "expense" and acct["type"] not in ("checking", "cash", "credit"):
            continue
        rec_keys.add(it["merchant_key"])
        for d in _occurrences(it, today + timedelta(days=1), end):
            events.append({"date": d.isoformat(), "amount": it["amount"], "label": it["merchant"],
                           "kind": "transfer" if it.get("is_transfer") else it["kind"]})
    # typical non-recurring spending per day, from the last 90 days
    since = (today - timedelta(days=90)).isoformat()
    from .categorize import merchant_key
    var_rows = conn.execute(
        f"""SELECT t.merchant, -t.amount AS amt FROM tx_home t LEFT JOIN categories c ON c.id=t.category_id
            WHERE t.date >= ? AND t.date < ? AND t.amount < 0 AND {reports.REAL_MONEY}""", (since, today.isoformat())).fetchall()
    variable_total = sum(r["amt"] for r in var_rows if merchant_key(r["merchant"]) not in rec_keys)
    daily_var = round(variable_total / 90, 2)
    by_day: dict[str, list] = {}
    for e in events:
        by_day.setdefault(e["date"], []).append(e)
    bal = cash - cards
    series = [{"date": today.isoformat(), "balance": round(bal, 2)}]
    low = {"date": today.isoformat(), "balance": round(bal, 2)}
    for k in range(1, days + 1):
        d = (today + timedelta(days=k)).isoformat()
        bal -= daily_var
        for e in by_day.get(d, []):
            bal += e["amount"]
        series.append({"date": d, "balance": round(bal, 2)})
        if bal < low["balance"]:
            low = {"date": d, "balance": round(bal, 2)}
    events.sort(key=lambda e: e["date"])
    timeline = events
    buffer = float(profile.get("min_cash_buffer") or 0)
    below = [p for p in series if p["balance"] < buffer]
    return {"days": days, "start_cash": round(cash, 2), "card_balances": round(cards, 2), "start": round(cash - cards, 2),
            "daily_variable": daily_var, "series": series, "events": timeline, "low": low, "end": series[-1],
            "buffer": buffer, "first_below_buffer": below[0]["date"] if below else None,
            "income_total": round(sum(e["amount"] for e in events if e["amount"] > 0), 2),
            "outflow_total": round(-sum(e["amount"] for e in events if e["amount"] < 0), 2)}


# ---------------- money checkup ----------------

def checkup(conn, profile: dict | None = None) -> dict:
    profile = profile or get_profile(conn)
    cur = fx.home_currency(conn)
    avg = _avg_month(conn, 3)
    liq = _liquid(conn)
    metrics = []

    def money(v):
        return fx.fmt(v, cur)

    # 1. emergency fund
    target = float(profile.get("emergency_months") or 6)
    if avg["expenses"] > 0:
        months = liq["net"] / avg["expenses"]
        need = max(0.0, target * avg["expenses"] - liq["net"])
        sc = max(0.0, min(100.0, months / target * 100))
        advice = (f"You could cover {months:.1f} months of spending. "
                  + (f"Your {target:.0f}-month target needs {money(need)} more." if need > 0 else "You've hit your target; extra cash could be invested."))
        metrics.append({"id": "emergency", "label": "Emergency fund", "display": f"{months:.1f} mo", "value": round(months, 2),
                        "target": f"{target:.0f} mo", "score": round(sc), "weight": 25, "advice": advice})
    # 2. savings rate
    sr_target = float(profile.get("savings_rate_target") or 0.2)
    if avg["income"] > 0:
        sr = (avg["income"] - avg["expenses"]) / avg["income"]
        sc = max(0.0, min(100.0, sr / sr_target * 100))
        gap = (sr_target - sr) * avg["income"]
        metrics.append({"id": "savings_rate", "label": "Savings rate", "display": f"{sr:.0%}", "value": round(sr, 3),
                        "target": f"{sr_target:.0%}", "score": round(sc), "weight": 25,
                        "advice": (f"Over the last {avg['months']} months you kept {sr:.0%} of your income. "
                                   + (f"Cutting {money(gap)}/month would reach {sr_target:.0%}." if gap > 0 else "That's at or above your target."))})
    # 3. credit utilisation
    u = utilization(conn)
    if u["util"] is not None:
        sc = _interp(u["util"], [(0.0, 100), (0.1, 100), (0.3, 60), (0.5, 25), (0.9, 0)])
        metrics.append({"id": "utilization", "label": "Credit utilisation", "display": f"{u['util']:.0%}", "value": u["util"],
                        "target": "< 10%", "score": round(sc), "weight": 15,
                        "advice": f"{money(u['total_owed'])} owed of {money(u['total_limit'])} in limits. Under 10% helps your credit score; paying before the statement date lowers what's reported."})
    # 4. debt-to-income
    if avg["income"] > 0:
        months = _complete_months(3)
        s, e = reports.month_bounds(months[0])[0], reports.month_bounds(months[-1])[1]
        debt = conn.execute(
            """SELECT COALESCE(SUM(-t.amount),0) FROM tx_home t
               LEFT JOIN transactions p ON p.id = t.transfer_pair_id LEFT JOIN accounts pa ON pa.id = p.account_id
               LEFT JOIN categories c ON c.id = t.category_id
               WHERE t.date BETWEEN ? AND ? AND t.amount < 0 AND t.hidden = 0
                 AND (pa.type = 'loan' OR c.name = 'Auto Payment')""",
            (s, e)).fetchone()[0] / max(1, len(months))
        dti = debt / avg["income"]
        sc = _interp(dti, [(0.0, 100), (0.15, 100), (0.28, 70), (0.36, 45), (0.5, 10)])
        metrics.append({"id": "dti", "label": "Debt payments / income", "display": f"{dti:.0%}", "value": round(dti, 3),
                        "target": "< 15%", "score": round(sc), "weight": 15,
                        "advice": f"About {money(debt)}/month goes to loan payments (excluding rent and card payoffs)."
                                  + (" Low and healthy." if dti < 0.15 else " Paying the highest-rate loan first saves the most interest.")})
    # 5. budget discipline (last complete month)
    last_m = _complete_months(1)[0]
    bs = reports.budget_status(conn, last_m)
    budgeted = [r for r in bs["rows"] if r["kind"] == "expense" and r["has_budget"] and r["budget"]]
    if budgeted:
        ok = [r for r in budgeted if r["remaining"] >= -0.5]
        frac = len(ok) / len(budgeted)
        worst = sorted((r for r in budgeted if r["remaining"] < -0.5), key=lambda r: r["remaining"])[:2]
        metrics.append({"id": "budget", "label": "Budget discipline", "display": f"{len(ok)}/{len(budgeted)}", "value": round(frac, 3),
                        "target": "all on budget", "score": round(frac * 100), "weight": 10,
                        "advice": f"{len(ok)} of {len(budgeted)} budgets held last month."
                                  + (" Overspent: " + ", ".join(f"{r['category']} by {money(-r['remaining'])}" for r in worst) + "." if worst else "")})
    # 6. retirement pace
    ret = retirement(conn, profile=profile)
    if ret["buckets"]:
        b = ret["buckets"][0]
        ratio = (b["pct"] or 0) / max(0.05, b["expected_pct"])
        sc = max(0.0, min(100.0, ratio * 100))
        metrics.append({"id": "retirement", "label": f"{b['label']} pace", "display": f"{(b['pct'] or 0):.0%}", "value": b["pct"],
                        "target": f"{b['expected_pct']:.0%} by today", "score": round(sc), "weight": 10,
                        "advice": f"{money(b['contributed'])} of the {money(b['limit'])} limit."
                                  + (f" To max out, put in {money(b['per_paycheck_to_max'])} per paycheck for the {ret['paychecks_left']} left." if b["remaining"] > 0 else " Maxed out.")})
    for m in metrics:
        m["status"] = _status(m["score"])
    total_w = sum(m["weight"] for m in metrics)
    score = round(sum(m["score"] * m["weight"] for m in metrics) / total_w) if total_w else None
    grade = None if score is None else "Excellent" if score >= 85 else "Good" if score >= 70 else "Fair" if score >= 50 else "Needs work"
    focus = min(metrics, key=lambda m: m["score"] - m["weight"] / 5) if metrics else None
    return {"score": score, "grade": grade, "metrics": metrics, "focus": focus["id"] if focus else None,
            "avg_income": avg["income"], "avg_expenses": avg["expenses"], "liquid": liq}


# ---------------- goals ----------------

def goal_progress(conn, g: dict) -> dict:
    bal = None
    if g["account_id"]:
        r = conn.execute("SELECT balance FROM balance_snapshots WHERE account_id=? ORDER BY date DESC LIMIT 1", (g["account_id"],)).fetchone()
        bal = r["balance"] if r else None
    if g["kind"] == "payoff":
        current = g["target_amount"] - abs(bal) if bal is not None else g["starting_amount"]
    else:
        current = bal if bal is not None else g["starting_amount"]
    current = max(0.0, current)
    remaining = max(0.0, g["target_amount"] - current)
    months_left = None
    if g["target_date"]:
        td = date.fromisoformat(g["target_date"]); t = date.today()
        months_left = max(0, (td.year - t.year) * 12 + td.month - t.month)
    needed = round(remaining / months_left, 2) if months_left else None
    eta_months = round(remaining / g["monthly_contribution"], 1) if g["monthly_contribution"] > 0 and remaining > 0 else (0 if remaining == 0 else None)
    return {**g, "current": round(current, 2), "remaining": round(remaining, 2),
            "pct": round(current / g["target_amount"], 3) if g["target_amount"] else 0,
            "months_left": months_left, "needed_per_month": needed, "eta_months": eta_months,
            "on_track": (needed is None or g["monthly_contribution"] >= needed) if remaining > 0 else True}


# ---------------- the daily briefing ----------------

def briefing(conn, profile: dict | None = None, pace_data: dict | None = None, fc: dict | None = None) -> list[dict]:
    """A few plain-English sentences about where you stand today."""
    profile = profile or get_profile(conn)
    cur = fx.home_currency(conn)
    money = lambda v: fx.fmt(abs(v), cur)
    signed = lambda v: fx.fmt(v, cur)
    lines = []
    p = pace_data or pace(conn)
    month_name = date.today().strftime("%B")
    if p["today"] >= 1:
        d = p["delta_vs_last"]
        if abs(d) < 25:
            tail = "about the same as this point last month."
        else:
            tail = f"{money(d)} {'more' if d > 0 else 'less'} than this point last month."
        tone = "warning" if (p["expected_by_now"] and p["spent"] > p["expected_by_now"] * 1.1) else "neutral"
        lines.append({"text": f"You've spent {money(p['spent'])} so far in {month_name}, {tail}", "tone": tone})
    rec = detect_recurring(conn)
    incomes = [r for r in rec if r["kind"] == "income" and r["days_until"] >= 0 and r["category"] == "Paycheck"] or \
              [r for r in rec if r["kind"] == "income" and r["days_until"] >= 0]
    if incomes:
        nxt = min(incomes, key=lambda r: r["days_until"])
        bills = [r for r in rec if r["kind"] == "expense" and 0 <= r["days_until"] <= nxt["days_until"]]
        when = "today" if nxt["days_until"] == 0 else "tomorrow" if nxt["days_until"] == 1 else f"in {nxt['days_until']} days"
        bl = f" {len(bills)} bill{'s' if len(bills) != 1 else ''} totalling {money(sum(b['amount'] for b in bills))} {'are' if len(bills) != 1 else 'is'} due before then." if bills else " No bills are due before then."
        lines.append({"text": f"Your next paycheck ({money(nxt['amount'])}) lands {when}.{bl}", "tone": "neutral"})
    f = fc or forecast(conn, 45, profile)
    if f["first_below_buffer"]:
        lines.append({"text": f"Heads up: spendable cash is projected to dip below your {money(f['buffer'])} buffer around "
                              f"{date.fromisoformat(f['first_below_buffer']).strftime('%b %-d')}, bottoming at {signed(f['low']['balance'])} "
                              f"on {date.fromisoformat(f['low']['date']).strftime('%b %-d')}.",
                      "tone": "serious"})
    else:
        lines.append({"text": f"Cash looks steady: the lowest point in the next {f['days']} days is {signed(f['low']['balance'])} "
                              f"on {date.fromisoformat(f['low']['date']).strftime('%b %-d')}.", "tone": "good"})
    pr = profile.get("priorities") or []
    goals = conn.execute("SELECT * FROM goals WHERE archived=0 ORDER BY target_date").fetchall()
    if "support_family" in pr or profile.get("second_currency"):
        r = remittances(conn, profile=profile)
        if r["total"]:
            second = f" (≈ {fx.fmt(r['total_second'], r['second_currency'])})" if r["second_currency"] else ""
            lines.append({"text": f"You've sent {money(r['total'])}{second} home this year across {r['count']} transfers.", "tone": "neutral"})
    if goals and ("emergency_fund" in pr or "save_for_goal" in pr or "debt_payoff" in pr or len(lines) < 4):
        g = goal_progress(conn, dict(goals[0]))
        lines.append({"text": f"{g['name']} is {g['pct']:.0%} of the way there"
                              + (f"; {money(g['remaining'])} to go." if g["remaining"] > 0 else ". Done!"),
                      "tone": "good" if g["on_track"] else "warning"})
    return lines
