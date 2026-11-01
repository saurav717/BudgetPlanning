from ledger import importer

CHASE = """Transaction Date,Post Date,Description,Category,Type,Amount,Memo
10/03/2026,10/04/2026,NETFLIX.COM,Entertainment,Sale,-15.49,
10/03/2026,10/04/2026,STARBUCKS STORE 05912,Food & Drink,Sale,-6.25,
10/03/2026,10/04/2026,STARBUCKS STORE 05912,Food & Drink,Sale,-6.25,
10/05/2026,10/06/2026,Payment Thank You-Mobile,,Payment,500.00,
"""
AMEX = """Date,Description,Amount
10/02/2026,WHOLE FOODS MARKET,84.12
10/04/2026,AUTOPAY PAYMENT - THANK YOU,-300.00
"""
DEBIT_CREDIT = """Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit
2026-10-01,2026-10-02,1234,SAFEWAY #1282,Merchandise,52.10,
2026-10-03,2026-10-04,1234,CREDIT-CARD PAYMENT,Payment,,250.00
"""


def test_profile_detection():
    assert importer.detect_profile(CHASE) == "generic"  # 'Post Date' not 'Posting Date'
    assert importer.detect_profile(DEBIT_CREDIT) == "capital_one"
    assert importer.detect_profile("Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags\n") == "monarch"


def test_parse_signed_amount_profile():
    rows, errors = importer.parse_csv(CHASE, importer.PROFILES["chase"])
    assert not errors and len(rows) == 4
    assert rows[0] == {"date": "2026-10-03", "amount": -15.49, "description": "NETFLIX.COM", "pending": False}


def test_negate_profile_flips_credit_card_sign():
    rows, _ = importer.parse_csv(AMEX, importer.PROFILES["amex"])
    assert rows[0]["amount"] == -84.12 and rows[1]["amount"] == 300.0


def test_debit_credit_columns():
    rows, _ = importer.parse_csv(DEBIT_CREDIT, importer.PROFILES["capital_one"])
    assert rows[0]["amount"] == -52.10 and rows[1]["amount"] == 250.0


def test_import_dedupes_but_keeps_legit_same_day_duplicates(conn, card):
    r1 = importer.import_csv(conn, card, CHASE, "chase")
    assert r1.imported == 4 and r1.duplicates == 0   # two identical coffees are both kept
    r2 = importer.import_csv(conn, card, CHASE, "chase")
    assert r2.imported == 0 and r2.duplicates == 4   # re-importing the same file adds nothing
    assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 4
    cats = {r["merchant"]: r["name"] for r in conn.execute(
        "SELECT t.merchant, c.name FROM transactions t JOIN categories c ON c.id=t.category_id")}
    assert cats["Netflix"] == "Subscriptions" and cats["Starbucks"] == "Coffee Shops"


def test_dry_run_writes_nothing(conn, card):
    r = importer.import_csv(conn, card, CHASE, "chase", dry_run=True)
    assert r.imported == 4
    assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0


def test_bad_rows_reported_not_fatal(conn, card):
    text = "Date,Description,Amount\n10/01/2026,OK ROW,-1.00\nnot-a-date,BAD ROW,-2.00\n"
    r = importer.import_csv(conn, card, text, "generic")
    assert r.imported == 1 and r.skipped == 1   # rows without a usable date are skipped and counted
