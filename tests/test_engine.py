from datetime import date, timedelta

from ledger import reports, insights
from ledger.importer import import_rows
from ledger.recurring import detect_recurring
from ledger.transfers import match_transfers


def _add(conn, acct, rows):
    return import_rows(conn, acct, [{"date": d, "amount": a, "description": desc} for d, a, desc in rows]).imported


def test_transfer_matching_links_and_recategorizes(conn, checking, card):
    _add(conn, checking, [("2026-10-25", -500.0, "CHASE CRD AUTOPAY"), ("2026-10-25", -40.0, "LUNCH SPOT")])
    _add(conn, card, [("2026-10-26", 500.0, "AUTOMATIC PAYMENT - THANK YOU"), ("2026-10-20", 500.0, "REFUND SOMETHING")])
    assert match_transfers(conn) == 1
    rows = conn.execute("SELECT description, transfer_pair_id, c.name FROM transactions t JOIN categories c ON c.id=t.category_id").fetchall()
    paired = {r["description"]: r for r in rows if r["transfer_pair_id"]}
    assert set(paired) == {"CHASE CRD AUTOPAY", "AUTOMATIC PAYMENT - THANK YOU"}
    assert all(r["name"] == "Credit Card Payment" for r in paired.values())
    # the earlier same-amount refund was NOT chosen (farther away in time) and the lunch stays spending
    assert not [r for r in rows if r["description"] == "LUNCH SPOT"][0]["transfer_pair_id"]


def test_transfers_excluded_from_cashflow(conn, checking, card):
    m = reports.this_month()
    _add(conn, checking, [(f"{m}-02", 3000.0, "ACME PAYROLL"), (f"{m}-03", -1000.0, "CHASE CRD AUTOPAY"), (f"{m}-04", -200.0, "SAFEWAY")])
    _add(conn, card, [(f"{m}-04", 1000.0, "AUTOMATIC PAYMENT - THANK YOU")])
    match_transfers(conn)
    cf = reports.cashflow(conn, 1)[0]
    assert cf["income"] == 3000.0 and cf["expenses"] == 200.0 and cf["savings"] == 2800.0


def test_recurring_detection_monthly_and_biweekly(conn, checking):
    today = date.today()
    rows = []
    for i in range(6, 0, -1):
        d = (today.replace(day=15) - timedelta(days=30 * i))
        rows.append((d.isoformat(), -15.49, "NETFLIX.COM"))
    for i in range(8, 0, -1):
        rows.append(((today - timedelta(days=14 * i)).isoformat(), 2000.0, "ACME PAYROLL DIRECT DEP"))
    # one-off noise with varying amounts should not be flagged
    for i, amt in enumerate([12.0, 45.0, 80.0, 23.0]):
        rows.append(((today - timedelta(days=20 * (i + 1))).isoformat(), -amt, "RANDOM SHOP"))
    _add(conn, checking, rows)
    rec = {r["merchant"]: r for r in detect_recurring(conn)}
    assert rec["Netflix"]["cadence"] == "monthly" and rec["Netflix"]["amount"] == -15.49
    assert rec["Acme Payroll Direct Dep"]["cadence"] == "biweekly" and rec["Acme Payroll Direct Dep"]["kind"] == "income"
    assert "Random Shop" not in rec
    nxt = date.fromisoformat(rec["Netflix"]["next_date"])
    assert 0 <= (nxt - today).days <= 31


def test_recurring_override_ignore(conn, checking):
    today = date.today()
    _add(conn, checking, [((today - timedelta(days=30 * i)).isoformat(), -9.99, "SPOTIFY USA") for i in range(1, 5)])
    assert any(r["merchant"] == "Spotify" for r in detect_recurring(conn))
    conn.execute("INSERT INTO recurring_overrides (merchant_key, status) VALUES ('spotify', 'ignored')")
    assert not any(r["merchant"] == "Spotify" for r in detect_recurring(conn))


def test_budget_status_with_rollover(conn, checking):
    m = reports.this_month()
    prev = reports.shift_month(m, -1)
    travel = conn.execute("SELECT id FROM categories WHERE name='Travel'").fetchone()[0]
    conn.execute("UPDATE categories SET rollover=1 WHERE id=?", (travel,))
    conn.execute("INSERT INTO budgets (category_id, month, amount) VALUES (?, NULL, 200)", (travel,))
    conn.commit()
    _add(conn, checking, [(f"{prev}-10", -50.0, "UNITED AIRLINES"), (f"{m}-05", -120.0, "AIRBNB * STAY")])
    bs = reports.budget_status(conn, m)
    row = next(r for r in bs["rows"] if r["category"] == "Travel")
    assert row["rollover"] == 150.0 and row["available"] == 350.0 and row["actual"] == 120.0 and row["remaining"] == 230.0


def test_month_override_beats_default(conn):
    g = conn.execute("SELECT id FROM categories WHERE name='Groceries'").fetchone()[0]
    conn.execute("INSERT INTO budgets (category_id, month, amount) VALUES (?, NULL, 500)", (g,))
    conn.execute("INSERT INTO budgets (category_id, month, amount) VALUES (?, '2026-12', 900)", (g,))
    assert reports.budget_for(conn, g, "2026-11") == 500 and reports.budget_for(conn, g, "2026-12") == 900


def test_net_worth_uses_latest_snapshot_per_account(conn, checking, card):
    conn.execute("INSERT INTO balance_snapshots VALUES (NULL, ?, '2026-01-31', 1000)", (checking,))
    conn.execute("INSERT INTO balance_snapshots VALUES (NULL, ?, '2026-02-28', 1500)", (checking,))
    conn.execute("INSERT INTO balance_snapshots VALUES (NULL, ?, '2026-02-10', -400)", (card,))
    nw = reports.net_worth(conn, "2026-02-28")
    assert nw == {"net_worth": 1100.0, "assets": 1500.0, "liabilities": -400.0, "by_type": {"checking": 1500.0, "credit": -400.0}, "as_of": "2026-02-28"}
    assert reports.net_worth(conn, "2026-01-31")["net_worth"] == 1000.0


def test_safe_to_spend():
    upcoming = [{"kind": "income", "days_until": 10, "amount": 2000}, {"kind": "expense", "days_until": 3, "amount": -300},
                {"kind": "expense", "days_until": 20, "amount": -999}]
    import sqlite3
    from ledger import db
    c = db.connect(":memory:")
    a = c.execute("INSERT INTO accounts (name, type) VALUES ('c', 'checking')").lastrowid
    k = c.execute("INSERT INTO accounts (name, type) VALUES ('k', 'credit')").lastrowid
    c.execute("INSERT INTO balance_snapshots VALUES (NULL, ?, '2026-10-01', 1000)", (a,))
    c.execute("INSERT INTO balance_snapshots VALUES (NULL, ?, '2026-10-01', -250)", (k,))
    s = reports.safe_to_spend(c, upcoming)
    assert s["safe_to_spend"] == 1000 - 250 - 300 and s["days_to_next_income"] == 10


def test_insights_flag_overspend_and_duplicates(conn, checking):
    m = reports.this_month()
    shop = conn.execute("SELECT id FROM categories WHERE name='Shopping'").fetchone()[0]
    conn.execute("INSERT INTO budgets (category_id, month, amount) VALUES (?, NULL, 100)", (shop,))
    _add(conn, checking, [(f"{m}-01", -150.0, "TARGET 0001"), (f"{m}-01", -42.0, "LUNCH CAFE"), (f"{m}-01", -42.0, "LUNCH CAFE")])
    keys = {i["key"].split(":")[0] for i in insights.generate(conn)}
    assert {"budget-over", "dup"} <= keys
    conn.execute("INSERT INTO dismissed_insights (key) VALUES (?)", (next(i["key"] for i in insights.generate(conn) if i["key"].startswith("dup")),))
    assert "dup" not in {i["key"].split(":")[0] for i in insights.generate(conn)}
