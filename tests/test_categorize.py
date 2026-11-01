from ledger.categorize import Categorizer, clean_merchant, merchant_key


def test_clean_merchant_strips_noise():
    assert clean_merchant("SQ *BLUE BOTTLE COFFEE 0423 SAN FRANCISCO CA 94110") == "Blue Bottle Coffee San Francisco"
    assert clean_merchant("NETFLIX.COM 866-579-7172 CA") == "Netflix"
    assert clean_merchant("PG&E WEB ONLINE PAYMENT") == "PG&E"
    assert clean_merchant("TST* CHIPOTLE 1234 BERKELEY CA") == "Chipotle Berkeley"


def test_merchant_key_normalises():
    assert merchant_key("Blue Bottle Coffee") == merchant_key("BLUE-BOTTLE coffee")


def test_default_rules_categorize_and_rename(conn):
    cat = Categorizer(conn)
    cid, merchant = cat.categorize("TRADER JOE'S #0045 OAKLAND CA")
    assert conn.execute("SELECT name FROM categories WHERE id=?", (cid,)).fetchone()[0] == "Groceries"
    assert merchant == "Trader Joe's"
    cid, _ = cat.categorize("ACME CORP PAYROLL DIRECT DEP")
    assert conn.execute("SELECT name FROM categories WHERE id=?", (cid,)).fetchone()[0] == "Paycheck"


def test_unknown_goes_to_uncategorized(conn):
    cat = Categorizer(conn)
    cid, merchant = cat.categorize("ZZYZX WIDGETS 0099")
    assert cid == cat.uncategorized_id
    assert merchant == "Zzyzx Widgets"


def test_user_rule_wins_over_defaults_and_applies_retroactively(conn, checking):
    conn.execute("INSERT INTO transactions (account_id, date, amount, description, merchant, category_id) VALUES (?,?,?,?,?,?)",
                 (checking, "2026-01-05", -12.0, "AMAZON PRIME MEMBERSHIP", "Amazon", 1))
    subs = conn.execute("SELECT id FROM categories WHERE name='Subscriptions'").fetchone()[0]
    rid = conn.execute("INSERT INTO rules (pattern, category_id, rename_to, priority) VALUES ('amazon prime', ?, 'Amazon Prime', 1)", (subs,)).lastrowid
    conn.commit()
    assert Categorizer(conn).apply_rule_retroactively(rid) == 1
    row = conn.execute("SELECT category_id, merchant FROM transactions").fetchone()
    assert row["category_id"] == subs and row["merchant"] == "Amazon Prime"
    # a fresh categorisation also prefers the user rule (priority 1) over the default 'amazon' rule
    cid, _ = Categorizer(conn).categorize("AMAZON PRIME MEMBERSHIP")
    assert cid == subs
