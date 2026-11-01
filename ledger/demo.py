"""Generate a realistic year of demo data so you can explore the app before connecting real accounts."""
from __future__ import annotations

import random
import sqlite3
from datetime import date, timedelta

from .categorize import Categorizer
from .importer import import_rows
from .transfers import match_transfers


def _rand_days(start: date, end: date, n: int, rng) -> list[date]:
    span = (end - start).days
    return sorted(start + timedelta(days=rng.randint(0, span)) for _ in range(n))


def seed(conn: sqlite3.Connection, months: int = 14, seed: int = 7) -> dict:
    rng = random.Random(seed)
    today = date.today()
    start = (today.replace(day=1) - timedelta(days=30 * months)).replace(day=1)

    def acct(name, type_, inst, bal, currency="USD", limit=None, tax=""):
        cur = conn.execute("INSERT INTO accounts (name, type, institution, currency, credit_limit, tax_type) VALUES (?,?,?,?,?,?)",
                           (name, type_, inst, currency, limit, tax))
        return cur.lastrowid, bal

    checking, chk_bal = acct("Everyday Checking ••4821", "checking", "Chase", 6200.0)
    savings, sav_bal = acct("High-Yield Savings ••0093", "savings", "Marcus", 18500.0)
    card1, c1_bal = acct("Sapphire Preferred ••7710", "credit", "Chase", -1840.0, limit=15000)
    card2, c2_bal = acct("Blue Cash ••3002", "credit", "American Express", -412.0, limit=8000)
    broker, br_bal = acct("Brokerage ••5519", "investment", "Vanguard", 42300.0)
    k401, k_bal = acct("401(k)", "investment", "Fidelity", 87900.0, tax="401k")
    hsa, hsa_bal = acct("HSA", "investment", "Fidelity", 6400.0, tax="hsa")
    car, car_bal = acct("Auto Loan", "loan", "Toyota Financial", -11250.0)
    nre, nre_bal = acct("NRE Savings ••2210", "savings", "ICICI Bank", 640000.0, currency="INR")

    tx = {checking: [], card1: [], card2: [], savings: [], broker: [], car: [], k401: [], hsa: [], nre: []}

    # --- income: biweekly paycheck + yearly bonus ---
    d = start + timedelta(days=4)
    while d <= today:
        tx[checking].append((d, 3185.42, "ACME CORP PAYROLL DIRECT DEP"))
        tx[k401].append((d, 850.00, "EMPLOYEE 401K CONTRIBUTION"))
        tx[k401].append((d, 255.00, "EMPLOYER MATCH 401K"))
        d += timedelta(days=14)
    tx[checking].append((date(today.year, 3, 15) if today.month >= 3 else date(today.year - 1, 3, 15), 6500.00, "ACME CORP BONUS DIRECT DEP"))

    # --- monthly fixed bills ---
    m = start
    netflix_price = 15.49
    while m <= today:
        tx[checking].append((m.replace(day=1), -2450.00, "OAKRIDGE PROPERTIES ACH RENT PMT"))
        tx[checking].append((m.replace(day=min(5, 28)), -rng.choice([118.40, 132.10, 97.55, 141.20, 110.00]), "PG&E WEB ONLINE PAYMENT"))
        tx[checking].append((m.replace(day=7), -79.99, "COMCAST CALIFORNIA XFINITY"))
        tx[checking].append((m.replace(day=12), -85.00, "T-MOBILE *AUTOPAY"))
        tx[checking].append((m.replace(day=16), -389.14, "TOYOTA FINANCIAL SVC AUTO PYMT"))
        tx[car].append((m.replace(day=16), 389.14, "PAYMENT RECEIVED - THANK YOU"))
        tx[checking].append((m.replace(day=20), -142.50, "GEICO *AUTO INSURANCE"))
        if (m.month - start.month) % 12 == 6 and m > start + timedelta(days=60):
            netflix_price = 17.99  # price hike mid-series
        tx[card1].append((m.replace(day=3), -netflix_price, "NETFLIX.COM 866-579-7172 CA"))
        tx[card1].append((m.replace(day=9), -10.99, "SPOTIFY USA"))
        tx[card1].append((m.replace(day=11), -2.99, "APPLE.COM/BILL ICLOUD"))
        tx[card1].append((m.replace(day=22), -20.00, "OPENAI *CHATGPT SUBSCR"))
        tx[card2].append((m.replace(day=14), -49.00, "EQUINOX FITNESS 0231"))
        tx[checking].append((m.replace(day=2), -1000.00, "ONLINE TRANSFER TO SAVINGS ••0093"))
        tx[savings].append((m.replace(day=2), 1000.00, "ONLINE TRANSFER FROM CHECKING ••4821"))
        tx[savings].append((m.replace(day=28), round(rng.uniform(55, 72), 2), "INTEREST PAYMENT"))
        tx[checking].append((m.replace(day=18), -500.00, "VANGUARD BUY INVESTMENT"))
        tx[hsa].append((m.replace(day=15), 300.00, "PAYROLL HSA CONTRIBUTION"))
        # money home: a monthly Wise transfer to your own NRE account, plus support for family every other month
        wise = round(rng.uniform(780, 820), 2)
        tx[checking].append((m.replace(day=4), -wise, "WISE INC TRANSFER TO INR"))
        tx[nre].append((m.replace(day=5), round(wise * 88.2, 2), "INWARD REMITTANCE WISE"))
        if m.month % 2 == 0:
            tx[checking].append((m.replace(day=10), -300.00, "REMITLY* FAMILY SUPPORT"))
        tx[nre].append((m.replace(day=28), round(rng.uniform(1800, 2300), 2), "SB INTEREST CREDIT"))
        tx[broker].append((m.replace(day=18), 500.00, "ELECTRONIC BANK TRANSFER IN"))
        # credit card payments: pay off previous month on the 25th
        tx[checking].append((m.replace(day=25), -round(rng.uniform(1300, 2100), 2), "CHASE CREDIT CRD AUTOPAY"))
        tx[checking].append((m.replace(day=26), -round(rng.uniform(300, 650), 2), "AMEX EPAYMENT ACH PMT"))
        m = (m.replace(day=1) + timedelta(days=32)).replace(day=1)

    # make card payments actually match (transfer matching needs equal amounts)
    pays = [t for t in tx[checking] if "AUTOPAY" in t[2] and "CHASE" in t[2]]
    for dd, amt, _ in pays:
        tx[card1].append((dd + timedelta(days=1), -amt, "AUTOMATIC PAYMENT - THANK YOU"))
    for dd, amt, _ in [t for t in tx[checking] if "AMEX" in t[2]]:
        tx[card2].append((dd + timedelta(days=1), -amt, "ONLINE PAYMENT - THANK YOU"))

    # --- variable spending ---
    groceries = ["TRADER JOE'S #0045 OAKLAND CA", "WHOLEFDS MKT 10342 OAKLAND CA", "SAFEWAY #1282 OAKLAND CA", "COSTCO WHSE #0423 SAN LEANDRO CA"]
    for dd in _rand_days(start, today, months * 9, rng):
        tx[card2].append((dd, -round(rng.uniform(22, 165), 2), rng.choice(groceries)))
    eats = ["TST* CHIPOTLE 1234 BERKELEY CA", "DOORDASH*TACO BAR", "SQ *COMAL RESTAURANT", "UBER EATS", "SQ *CHOLITA LINDA", "RAMEN SHOP OAKLAND", "SQ *BLUE BOTTLE COFFEE 0423 SAN FRANCISCO CA 94110", "STARBUCKS STORE 05912", "PEET'S COFFEE #1120"]
    for dd in _rand_days(start, today, months * 14, rng):
        name = rng.choice(eats)
        amt = rng.uniform(4.5, 9) if ("COFFEE" in name or "STARBUCKS" in name or "PEET" in name) else rng.uniform(14, 85)
        tx[card1].append((dd, -round(amt, 2), name))
    for dd in _rand_days(start, today, months * 6, rng):
        tx[card1].append((dd, -round(rng.uniform(12, 240), 2), rng.choice(["AMAZON.COM*2K3JD9SJ1 AMZN.COM/BILL WA", "AMZN Mktp US*1A2B3C4D5", "TARGET 00021483 EMERYVILLE CA", "BEST BUY 00003412", "IKEA EMERYVILLE"])))
    for dd in _rand_days(start, today, months * 3, rng):
        tx[card1].append((dd, -round(rng.uniform(38, 72), 2), rng.choice(["CHEVRON 0091234 OAKLAND CA", "SHELL OIL 57444123", "ARCO #82311 AMPM"])))
    for dd in _rand_days(start, today, months * 5, rng):
        tx[card1].append((dd, -round(rng.uniform(9, 42), 2), rng.choice(["UBER *TRIP HELP.UBER.COM", "LYFT *RIDE SAT 9PM", "BART CLIPPER RELOAD", "SP PLUS PARKING 0012"])))
    for dd in _rand_days(start, today, months * 2, rng):
        tx[card2].append((dd, -round(rng.uniform(15, 110), 2), rng.choice(["CVS/PHARMACY #0912 OAKLAND CA", "WALGREENS #4432", "ONE MEDICAL GROUP COPAY"])))
    for dd in _rand_days(start, today, months * 2, rng):
        tx[card1].append((dd, -round(rng.uniform(16, 95), 2), rng.choice(["AMC THEATRES 2180", "STEAMGAMES.COM 4259522985", "TICKETMASTER *EVENT", "GOLDEN STATE WARRIORS"])))
    for dd in _rand_days(start, today, months, rng):
        tx[card2].append((dd, -round(rng.uniform(28, 60), 2), rng.choice(["TEMESCAL BARBER SHOP", "SEPHORA.COM"])))
    for dd in _rand_days(start, today, max(2, months // 4), rng):
        tx[card1].append((dd, -round(rng.uniform(50, 200), 2), rng.choice(["GOFUNDME *CAMPAIGN", "RED CROSS DONATION", "WIKIMEDIA DONATION"])))
    # two trips
    for trip_start in _rand_days(start, today - timedelta(days=20), 2, rng):
        tx[card1].append((trip_start - timedelta(days=30), -round(rng.uniform(280, 620), 2), "UNITED AIRLINES 0162348"))
        tx[card1].append((trip_start, -round(rng.uniform(450, 1100), 2), "AIRBNB * HM8KQ2TXP"))
        for k in range(3):
            tx[card1].append((trip_start + timedelta(days=k), -round(rng.uniform(30, 140), 2), "RESTAURANT LA FONDA"))
    # an unusual one-off this month
    tx[card1].append((today - timedelta(days=min(6, today.day - 1)), -489.00, "BEST BUY 00003412"))
    # a double charge (dup detector)
    dup_day = today - timedelta(days=min(3, today.day - 1))
    tx[card1].append((dup_day, -64.20, "SQ *COMAL RESTAURANT"))
    tx[card1].append((dup_day, -64.20, "SQ *COMAL RESTAURANT"))
    # fee + refund
    tx[checking].append((today - timedelta(days=40), -35.00, "OVERDRAFT FEE"))
    tx[card1].append((today - timedelta(days=12), 58.30, "AMAZON.COM REFUND"))
    # new subscription started recently (subscription creep)
    for k in range(2):
        dd = today - timedelta(days=50 - 30 * k)
        tx[card2].append((dd, -14.99, "HULU 877-824-4858 CA"))

    total = 0
    for acct_id, items in tx.items():
        rows_ = [{"date": dd.isoformat(), "amount": round(a, 2), "description": desc} for dd, a, desc in items if dd <= today]
        total += import_rows(conn, acct_id, rows_, source="demo").imported
    pairs = match_transfers(conn)

    # --- balance snapshots: walk backwards from today's balance using the transactions ---
    balances = {checking: chk_bal, savings: sav_bal, card1: c1_bal, card2: c2_bal, broker: br_bal, k401: k_bal, car: car_bal,
                hsa: hsa_bal, nre: nre_bal}
    growth = {broker: 0.0085, k401: 0.008, hsa: 0.006}
    m_end = today
    for acct_id, bal in balances.items():
        b = bal
        cur = today
        for i in range(months):
            conn.execute("INSERT OR REPLACE INTO balance_snapshots (account_id, date, balance) VALUES (?,?,?)", (acct_id, cur.isoformat(), round(b, 2)))
            prev_end = (cur.replace(day=1) - timedelta(days=1))
            flow = conn.execute("SELECT COALESCE(SUM(amount),0) FROM transactions WHERE account_id=? AND date>? AND date<=?",
                                (acct_id, prev_end.isoformat(), cur.isoformat())).fetchone()[0]
            b = b - flow
            if acct_id in growth:
                b = b / (1 + growth[acct_id] + rng.uniform(-0.02, 0.02))
            cur = prev_end

    # --- budgets ---
    cats = {r["name"]: r["id"] for r in conn.execute("SELECT id, name FROM categories")}
    for name, amt, bt in [("Paycheck", 6370, "fixed"), ("Rent / Mortgage", 2450, "fixed"), ("Utilities", 130, "fixed"),
                          ("Internet & Phone", 165, "fixed"), ("Auto Payment", 389.14, "fixed"), ("Auto Insurance & Maintenance", 145, "fixed"),
                          ("Subscriptions", 70, "fixed"), ("Fitness", 49, "fixed"), ("Groceries", 650, "flex"), ("Restaurants & Bars", 350, "flex"),
                          ("Coffee Shops", 40, "flex"), ("Shopping", 300, "flex"), ("Gas & Fuel", 120, "flex"), ("Public Transit & Rideshare", 90, "flex"),
                          ("Entertainment", 80, "flex"), ("Personal Care", 60, "flex"), ("Pharmacy", 50, "flex"), ("Medical", 60, "flex"),
                          ("Travel", 250, "non_monthly"), ("Gifts & Donations", 75, "non_monthly")]:
        conn.execute("INSERT OR REPLACE INTO budgets (category_id, month, amount) VALUES (?, NULL, ?)", (cats[name], amt))
        conn.execute("UPDATE categories SET budget_type=? WHERE id=?", (bt, cats[name]))
    conn.execute("UPDATE categories SET rollover=1 WHERE name IN ('Travel','Gifts & Donations')")

    # --- goals ---
    conn.execute("INSERT INTO goals (name, target_amount, target_date, account_id, monthly_contribution) VALUES (?,?,?,?,?)",
                 ("Emergency fund (6 months)", 30000, (today + timedelta(days=365)).isoformat(), savings, 1000))
    conn.execute("INSERT INTO goals (name, target_amount, target_date, account_id, kind, monthly_contribution) VALUES (?,?,?,?,?,?)",
                 ("Pay off car", 24000, (today + timedelta(days=900)).isoformat(), car, "payoff", 389.14))
    conn.execute("INSERT INTO goals (name, target_amount, target_date, starting_amount, monthly_contribution) VALUES (?,?,?,?,?)",
                 ("Japan trip", 6000, (today + timedelta(days=300)).isoformat(), 1800, 400))
    # tags on a couple of rows
    conn.execute("INSERT OR IGNORE INTO tags (name) VALUES ('reimbursable')")
    conn.commit()
    conn.execute("INSERT OR REPLACE INTO budgets (category_id, month, amount) VALUES (?, NULL, ?)", (cats["Family Support"], 150))
    conn.execute("UPDATE categories SET budget_type='fixed' WHERE name='Family Support'")
    conn.commit()
    return {"transactions": total, "transfer_pairs": pairs, "accounts": 10}
