from datetime import date, timedelta

import pytest

from ledger import db, fx, personal, reports
from ledger.importer import import_rows
from ledger.recurring import add_months, detect_recurring


def _add(conn, acct, rows):
    return import_rows(conn, acct, [{"date": d, "amount": a, "description": desc} for d, a, desc in rows]).imported


def _acct(conn, name, type_, currency="USD", **kw):
    cols = ["name", "type", "currency", *kw]
    cur = conn.execute(f"INSERT INTO accounts ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", (name, type_, currency, *kw.values()))
    conn.commit()
    return cur.lastrowid


def _ago(days):
    return (date.today() - timedelta(days=days)).isoformat()


# ---------- currency ----------

def test_fx_convert_and_indian_grouping(conn):
    fx.set_rate(conn, "INR", 80.0)
    assert fx.convert(conn, 100, "USD", "INR") == 8000.0
    assert fx.convert(conn, 8000, "INR", "USD") == 100.0
    assert fx.convert(conn, 5, "USD", "USD") == 5
    assert fx.fmt(1234567, "INR") == "₹12,34,567" and fx.fmt(999, "INR") == "₹999" and fx.fmt(-1500, "USD") == "-$1,500"


def test_foreign_account_converted_in_net_worth_and_spending(conn):
    fx.set_rate(conn, "INR", 80.0)
    usd = _acct(conn, "Chk", "checking")
    inr = _acct(conn, "NRE", "savings", "INR")
    conn.execute("INSERT INTO balance_snapshots VALUES (NULL, ?, ?, 1000)", (usd, date.today().isoformat()))
    conn.execute("INSERT INTO balance_snapshots VALUES (NULL, ?, ?, 160000)", (inr, date.today().isoformat()))
    nw = reports.net_worth(conn)
    assert nw["net_worth"] == 3000.0                       # 1000 + 160000/80
    m = reports.this_month()
    _add(conn, inr, [(f"{m}-01", -8000.0, "SWIGGY ORDER")])
    spent = {r["category"]: r["spent"] for r in reports.spending_by_category(conn, *reports.month_bounds(m))}
    assert spent["Restaurants & Bars"] == 100.0             # reported in USD, not rupees


def test_home_currency_switch(conn):
    fx.set_rate(conn, "INR", 80.0)
    usd = _acct(conn, "Chk", "checking")
    conn.execute("INSERT INTO balance_snapshots VALUES (NULL, ?, ?, 100)", (usd, date.today().isoformat()))
    personal.save_profile(conn, {"home_currency": "INR"})
    assert reports.net_worth(conn)["net_worth"] == 8000.0


def test_splits_flow_into_reports(conn):
    a = _acct(conn, "Chk", "checking")
    m = reports.this_month()
    _add(conn, a, [(f"{m}-02", -100.0, "COSTCO WHSE")])
    tid = conn.execute("SELECT id FROM transactions").fetchone()[0]
    cats = {r["name"]: r["id"] for r in conn.execute("SELECT id, name FROM categories")}
    conn.execute("INSERT INTO splits (transaction_id, amount, category_id) VALUES (?, -70, ?)", (tid, cats["Groceries"]))
    conn.execute("INSERT INTO splits (transaction_id, amount, category_id) VALUES (?, -30, ?)", (tid, cats["Shopping"]))
    spent = {r["category"]: r["spent"] for r in reports.spending_by_category(conn, *reports.month_bounds(m))}
    assert spent == {"Groceries": 70.0, "Shopping": 30.0}


def test_migrate_is_idempotent_and_upgrades_old_rules(conn):
    conn.execute("UPDATE settings SET value='1' WHERE key='rules_version'")
    conn.execute("DELETE FROM rules WHERE pattern='wise'")
    db.migrate(conn); db.migrate(conn)
    assert conn.execute("SELECT COUNT(*) FROM rules WHERE pattern='wise'").fetchone()[0] == 1
    assert {"credit_limit", "tax_type"} <= {r[1] for r in conn.execute("PRAGMA table_info(accounts)")}


# ---------- profile & layout ----------

def test_profile_defaults_and_save(conn):
    p = personal.get_profile(conn)
    assert p["onboarded"] is False and p["home_currency"] == "USD"
    p = personal.save_profile(conn, {"name": "Sam", "priorities": ["support_family", "bogus"], "second_currency": "INR"})
    assert p["name"] == "Sam" and p["priorities"] == ["support_family"]


def test_recommended_layout_follows_priorities(conn):
    p = personal.save_profile(conn, {"priorities": ["support_family", "reduce_spending"]})
    lay = personal.recommended_layout(conn, p)
    ids = [w["id"] for w in lay]
    assert ids[0] == "kpis" and ids.index("remittances") < ids.index("networth") and ids.index("pace") < ids.index("networth")
    vis = {w["id"]: w["visible"] for w in lay}
    assert vis["remittances"] and not vis["retirement"] and vis["spending"]


def test_saved_layout_roundtrip_and_reset(conn):
    personal.save_layout(conn, [{"id": "goals", "visible": True}, {"id": "kpis", "visible": False}, {"id": "nope"}])
    lay = personal.get_layout(conn)
    assert [w["id"] for w in lay[:2]] == ["goals", "kpis"] and lay[1]["visible"] is False
    assert len(lay) == len(personal.WIDGETS)                # missing widgets appended (hidden)
    assert personal.save_layout(conn, None)[0]["id"] == "kpis"


# ---------- trackers ----------

def test_remittances_split_family_and_own_transfers(conn):
    fx.set_rate(conn, "INR", 80.0)
    personal.save_profile(conn, {"second_currency": "INR"})
    a = _acct(conn, "Chk", "checking")
    y = date.today().year
    _add(conn, a, [(f"{y}-01-04", -800.0, "WISE INC TRANSFER"), (f"{y}-01-10", -200.0, "REMITLY* FAMILY"), (f"{y}-01-11", -50.0, "TRADER JOE'S")])
    r = personal.remittances(conn)
    assert r["total"] == 1000.0 and r["total_second"] == 80000.0 and r["count"] == 2
    assert r["by_category"] == {"International Transfer": 800.0, "Family Support": 200.0}
    # own-account transfers are not spending; family support is
    spent = {x["category"] for x in reports.spending_by_category(conn, f"{y}-01-01", f"{y}-01-31")}
    assert "Family Support" in spent and "International Transfer" not in spent


def test_retirement_excludes_employer_match(conn):
    k = _acct(conn, "401k", "investment", tax_type="401k")
    y = date.today().year
    _add(conn, k, [(f"{y}-01-15", 1000.0, "EMPLOYEE 401K CONTRIBUTION"), (f"{y}-01-15", 500.0, "EMPLOYER MATCH 401K"), (f"{y}-01-20", 40.0, "DIVIDEND")])
    r = personal.retirement(conn, profile={**personal.PROFILE_DEFAULTS, "pay_frequency": "biweekly"})
    b = r["buckets"][0]
    assert b["bucket"] == "401k" and b["contributed"] == 1000.0 and b["limit"] == 24500 and b["remaining"] == 23500.0


def test_utilization(conn):
    c1 = _acct(conn, "Card", "credit", credit_limit=10000)
    conn.execute("INSERT INTO balance_snapshots VALUES (NULL, ?, ?, -1500)", (c1, date.today().isoformat()))
    u = personal.utilization(conn)
    assert u["util"] == 0.15 and u["cards"][0]["owed"] == 1500.0


# ---------- forecast / recurring dates ----------

def test_add_months_keeps_day_and_clamps():
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2026, 2, 28), 1, anchor_day=31) == date(2026, 3, 31)
    assert add_months(date(2026, 11, 1), 2) == date(2027, 1, 1)


def test_forecast_projects_income_bills_and_buffer(conn):
    chk = _acct(conn, "Chk", "checking")
    conn.execute("INSERT INTO balance_snapshots VALUES (NULL, ?, ?, 2000)", (chk, date.today().isoformat()))
    rows = [(_ago(14 * i), 3000.0, "ACME PAYROLL") for i in range(1, 7)]
    rows += [(add_months(date.today(), -i).isoformat(), -2500.0, "OAKRIDGE RENT") for i in range(1, 6)]
    _add(conn, chk, rows)
    personal.save_profile(conn, {"min_cash_buffer": 1000})
    fc = personal.forecast(conn, 60)
    labels = {e["label"] for e in fc["events"]}
    assert "Acme Payroll" in labels and "Oakridge Rent" in labels
    rent_days = sorted({e["date"][8:] for e in fc["events"] if e["label"] == "Oakridge Rent"})
    assert len(rent_days) == 1                              # same day of month every time, no drift
    assert len(fc["series"]) == 61 and fc["start"] == 2000.0
    assert fc["low"]["balance"] == min(p["balance"] for p in fc["series"])


def test_checkup_scores_and_briefing(conn):
    from ledger import demo
    demo.seed(conn, months=6)
    personal.save_profile(conn, {"name": "Sam", "priorities": ["emergency_fund"]})
    c = personal.checkup(conn)
    assert 0 <= c["score"] <= 100 and c["grade"]
    assert {"emergency", "savings_rate", "utilization", "dti", "budget", "retirement"} <= {m["id"] for m in c["metrics"]}
    lines = personal.briefing(conn)
    assert len(lines) >= 3 and all(l["tone"] in ("neutral", "good", "warning", "serious") for l in lines)


def test_pace_and_daily_shapes(conn):
    a = _acct(conn, "Chk", "checking")
    m = reports.this_month()
    _add(conn, a, [(f"{m}-01", -10.0, "STARBUCKS")])
    p = personal.pace(conn)
    assert p["days"] >= 28 and p["this_month"][0] == 10.0
    d = personal.daily(conn, 2)
    assert len(d["months"]) == 2 and len(d["breaks"]) == 4


# ---------- api ----------

def test_personal_endpoints(client):
    assert client.put("/api/profile", json={"name": "Sam", "second_currency": "INR", "priorities": ["support_family"], "onboarded": True, "reset_layout": True}).json()["name"] == "Sam"
    prof = client.get("/api/profile").json()
    assert prof["onboarded"] and "support_family" in prof["priority_options"]
    for path in ["/api/overview", "/api/layout", "/api/checkup", "/api/forecast?days=30", "/api/reports/pace", "/api/reports/daily",
                 "/api/remittances", "/api/retirement", "/api/utilization", "/api/fx"]:
        assert client.get(path).status_code == 200, path
    r = client.put("/api/fx/INR", json={"per_home": 90}).json()
    assert next(x for x in r["rates"] if x["currency"] == "INR")["per_usd"] == 90
    lay = client.get("/api/layout").json()["layout"]
    lay[0]["visible"] = False
    assert client.put("/api/layout", json={"layout": lay}).json()["layout"][0]["visible"] is False
    a = client.post("/api/accounts", json={"name": "Card", "type": "credit", "balance": 500, "credit_limit": 5000}).json()
    assert a["credit_limit"] == 5000
    assert client.get("/api/utilization").json()["util"] == 0.1
