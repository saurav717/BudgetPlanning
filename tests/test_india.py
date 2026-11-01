from pathlib import Path

import pytest

from ledger import importer
from ledger.categorize import Categorizer, clean_merchant

SAMPLES = Path(__file__).resolve().parent.parent / "sample_data"


@pytest.mark.parametrize("desc,merchant", [
    ("UPI/DR/412345678901/SWIGGY LIMITED/YESB/swiggy@ybl/Payment", "Swiggy"),
    ("UPI-ZOMATO LTD-ZOMATO.PAYU@HDFCBANK-HDFC0000499-412398765432-UPI INTENT", "Zomato"),
    ("TO TRANSFER-UPI/DR/412312341234/RAHUL KUMAR/SBIN/rahul.k@oksbi/Lunch--", "Rahul Kumar"),
    ("NEFT CR-ICIC0000104-ACME TECHNOLOGIES PVT LTD-SALARY NOV", "Acme"),
    ("BY TRANSFER-NEFT*HDFC0000001*N123*JOHN DOE--", "John Doe"),
    ("IMPS-412345678901-PRIYA SHARMA-HDFC-XXXXXXX1234-RENT", "Priya Sharma"),
    ("ATW-512345XXXXXX1234-S1ANBG12-BANGALORE", "ATM withdrawal"),
    ("UPI/CR/412311112222/rahul.k@okicici/NA", "Rahul K"),
])
def test_indian_narrations(desc, merchant):
    assert clean_merchant(desc) == merchant


def test_us_descriptions_unchanged():
    assert clean_merchant("SQ *BLUE BOTTLE COFFEE 0423 SAN FRANCISCO CA 94110") == "Blue Bottle Coffee San Francisco"


def test_indian_categories_and_sbi_prefix(conn):
    cat = Categorizer(conn)
    name = lambda d: conn.execute("SELECT name FROM categories WHERE id=?", (cat.categorize(d)[0],)).fetchone()[0]
    assert name("TO TRANSFER-UPI/DR/1/SWIGGY/YESB/swiggy@ybl/UPI--") == "Restaurants & Bars"
    assert name("TO TRANSFER-UPI/DR/412312341234/RAHUL KUMAR/SBIN/rahul.k@oksbi/Lunch--") == "Uncategorized"  # not a transfer
    assert name("NEFT CR-CITI0000002-ACME TECHNOLOGIES PVT LTD-SALARY OCT") == "Paycheck"                    # generic NEFT rule loses
    assert name("ACH D- INDIAN CLEARING CORP-ABCD1234567") == "Investment Contribution"
    assert name("UPI-BESCOM-BESCOM.BILLDESK@HDFCBANK-HDFC0000499-1-ELECTRICITY") == "Utilities"
    assert name("ZELLE PAYMENT TO OAKRIDGE PROPERTIES RENT") == "Rent / Mortgage"


def test_amount_parsing():
    assert importer._parse_amount("1,85,000.00") == (185000.0, 0)
    assert importer._parse_amount("₹ 500.00 Cr") == (500.0, 1)
    assert importer._parse_amount("250.00 DR") == (250.0, -1)
    assert importer._parse_amount("(12.50)") == (-12.5, 0)
    assert importer._parse_amount("") == (None, 0)


def test_hdfc_statement_with_preamble_and_footer(conn, checking):
    text = (SAMPLES / "hdfc_savings.csv").read_text()
    assert importer.detect_profile(text) == "india"
    res = importer.import_csv(conn, checking, text, "hdfc")
    assert res.imported == 10 and not res.errors
    rows = {r["merchant"]: r["amount"] for r in conn.execute("SELECT merchant, amount FROM transactions")}
    assert rows["Acme"] == 185000.0 and rows["Swiggy"] == -456.0 and rows["Priya Sharma"] == -32000.0
    assert rows["Rahul Kumar"] == 750.0 and rows["Interest"] == 1412.0
    d = conn.execute("SELECT date FROM transactions WHERE merchant='Acme'").fetchone()[0]
    assert d == "2026-10-01"   # dd/mm/yy, not mm/dd


def test_sbi_and_kotak(conn, checking):
    r1 = importer.import_csv(conn, checking, (SAMPLES / "sbi_savings.csv").read_text(), "auto" and importer.detect_profile((SAMPLES / "sbi_savings.csv").read_text()))
    assert r1.imported == 4 and not r1.errors
    kotak = (SAMPLES / "kotak_savings.csv").read_text()
    r2 = importer.import_csv(conn, checking, kotak, importer.detect_profile(kotak))
    assert r2.imported == 3 and not r2.errors
    amts = {r["description"][:20]: r["amount"] for r in conn.execute("SELECT description, amount FROM transactions")}
    assert amts["UPI/RELIANCE FRESH/4"] == -1045.5 and amts["IMPS-427812341234-MO"] == 25000.0   # Dr/Cr column
    assert conn.execute("SELECT date FROM transactions WHERE description LIKE 'ATM WDL%'").fetchone()[0] == "2026-10-14"


def test_custom_mapping_and_inspect(conn, checking):
    text = "Some bank\nWhen,What,Money Out,Money In\n05/11/2026,Chai stall,40,\n06/11/2026,Refund,,100\n"
    info = importer.inspect(text)
    assert info["headers"] == ["When", "What", "Money Out", "Money In"] and len(info["sample"]) == 2
    res = importer.import_csv(conn, checking, text, mapping={"date": "When", "description": "What", "debit": "Money Out", "credit": "Money In", "date_format": "%d/%m/%Y"})
    assert res.imported == 2
    assert [tuple(r) for r in conn.execute("SELECT date, amount FROM transactions ORDER BY date")] == [("2026-11-05", -40.0), ("2026-11-06", 100.0)]


def test_unparseable_file_gives_helpful_error(conn, checking):
    res = importer.import_csv(conn, checking, "foo,bar\n1,2\n", "india")
    assert res.imported == 0 and "column headers" in res.errors[0]
