from ledger import demo, reports
from ledger.recurring import detect_recurring


def test_demo_seed_is_coherent(conn):
    r = demo.seed(conn, months=6)
    assert r["transactions"] > 200 and r["transfer_pairs"] > 10
    nw = reports.net_worth(conn)
    assert nw["assets"] > 0 and nw["liabilities"] < 0
    names = {x["merchant"] for x in detect_recurring(conn)}
    assert {"Netflix", "PG&E", "GEICO"} <= names
    cf = reports.cashflow(conn, 3)[0]
    assert cf["income"] > 5000 and 3000 < cf["expenses"] < 9000
