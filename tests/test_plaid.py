"""Exercises the Plaid sync logic against a fake Plaid server (httpx MockTransport)."""
import json

import httpx

from ledger import plaid
from ledger.transfers import match_transfers

ACCOUNTS = [
    {"account_id": "acc_chk", "name": "Plaid Checking", "official_name": "Plaid Gold Standard 0% Interest Checking", "mask": "0000",
     "type": "depository", "subtype": "checking", "balances": {"current": 110.0, "iso_currency_code": "USD"}},
    {"account_id": "acc_cc", "name": "Plaid Credit Card", "mask": "3333", "type": "credit", "subtype": "credit card",
     "balances": {"current": 410.0, "iso_currency_code": "USD"}},
]


class FakePlaid:
    def __init__(self):
        self.calls = []
        self.pages = [
            {"added": [
                {"transaction_id": "t1", "account_id": "acc_chk", "amount": 12.5, "date": "2026-10-02", "name": "Uber 063015 SF**POOL**", "merchant_name": "Uber", "pending": False,
                 "personal_finance_category": {"primary": "TRANSPORTATION", "detailed": "TRANSPORTATION_TAXIS_AND_RIDE_SHARES"}},
                {"transaction_id": "t2", "account_id": "acc_chk", "amount": -2500.0, "date": "2026-10-03", "name": "INTRST PYMNT", "merchant_name": None, "pending": False,
                 "personal_finance_category": {"primary": "INCOME", "detailed": "INCOME_INTEREST_EARNED"}},
                {"transaction_id": "t3", "account_id": "acc_chk", "amount": 89.4, "date": "2026-10-05", "name": "SparkFun", "merchant_name": "SparkFun", "pending": True,
                 "personal_finance_category": {"primary": "GENERAL_MERCHANDISE", "detailed": "GENERAL_MERCHANDISE_ELECTRONICS"}},
            ], "modified": [], "removed": [], "next_cursor": "c1", "has_more": True},
            {"added": [
                {"transaction_id": "t4", "account_id": "acc_chk", "amount": 100.0, "date": "2026-10-06", "name": "CREDIT CARD PAYMENT", "merchant_name": None, "pending": False,
                 "personal_finance_category": {"primary": "LOAN_PAYMENTS", "detailed": "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"}},
                {"transaction_id": "t5", "account_id": "acc_cc", "amount": -100.0, "date": "2026-10-07", "name": "PAYMENT RECEIVED", "merchant_name": None, "pending": False,
                 "personal_finance_category": {"primary": "TRANSFER_IN", "detailed": "TRANSFER_IN_ACCOUNT_TRANSFER"}},
            ], "modified": [], "removed": [], "next_cursor": "c2", "has_more": False},
        ]
        self.second_sync = {"added": [
            {"transaction_id": "t3_posted", "pending_transaction_id": "t3", "account_id": "acc_chk", "amount": 89.4, "date": "2026-10-06", "name": "SparkFun", "merchant_name": "SparkFun", "pending": False,
             "personal_finance_category": {"primary": "GENERAL_MERCHANDISE", "detailed": "GENERAL_MERCHANDISE_ELECTRONICS"}}],
            "modified": [{"transaction_id": "t1", "account_id": "acc_chk", "amount": 14.0, "date": "2026-10-02", "name": "Uber 063015 SF**POOL**", "merchant_name": "Uber", "pending": False,
                          "personal_finance_category": {"primary": "TRANSPORTATION", "detailed": "TRANSPORTATION_TAXIS_AND_RIDE_SHARES"}}],
            "removed": [{"transaction_id": "t2"}], "next_cursor": "c3", "has_more": False}

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        path = request.url.path
        self.calls.append((path, body))
        assert body["client_id"] == "cid" and body["secret"] == "sec"
        if path == "/item/public_token/exchange":
            return httpx.Response(200, json={"access_token": "access-sandbox-1", "item_id": "item1"})
        if path == "/item/get":
            return httpx.Response(200, json={"item": {"institution_id": "ins_1"}})
        if path == "/institutions/get_by_id":
            return httpx.Response(200, json={"institution": {"name": "First Platypus Bank"}})
        if path == "/accounts/get":
            return httpx.Response(200, json={"accounts": ACCOUNTS})
        if path == "/transactions/sync":
            cur = body.get("cursor", "")
            if cur == "":
                return httpx.Response(200, json=self.pages[0])
            if cur == "c1":
                return httpx.Response(200, json=self.pages[1])
            if cur == "c2":
                return httpx.Response(200, json=self.second_sync)
            return httpx.Response(200, json={"added": [], "modified": [], "removed": [], "next_cursor": cur, "has_more": False})
        if path == "/investments/holdings/get":
            return httpx.Response(400, json={"error_code": "NO_INVESTMENT_ACCOUNTS", "error_message": "none"})
        if path == "/link/token/create":
            return httpx.Response(200, json={"link_token": "link-sandbox-abc", "expiration": "x"})
        return httpx.Response(404, json={"error_code": "NOT_FOUND", "error_message": path})


def _client(fake):
    return plaid.PlaidClient("cid", "sec", "sandbox", http=httpx.Client(transport=httpx.MockTransport(fake.handler)))


def test_link_creates_accounts_with_signed_balances(conn):
    fake = FakePlaid()
    res = plaid.link_item(conn, _client(fake), "public-sandbox-xyz")
    assert res["institution"] == "First Platypus Bank" and len(res["accounts"]) == 2
    bal = {r["name"]: r["balance"] for r in conn.execute(
        "SELECT a.name, b.balance FROM accounts a JOIN balance_snapshots b ON b.account_id=a.id")}
    assert bal["Plaid Gold Standard 0% Interest Checking ••0000"] == 110.0
    assert bal["Plaid Credit Card ••3333"] == -410.0           # liabilities stored negative
    assert conn.execute("SELECT type FROM accounts WHERE plaid_account_id='acc_cc'").fetchone()[0] == "credit"


def test_sync_pages_cursor_and_maps_categories(conn):
    fake = FakePlaid()
    client = _client(fake)
    item = plaid.link_item(conn, client, "pt")["item_id"]
    r = plaid.sync_item(conn, client, item)
    assert r["added"] == 5
    assert conn.execute("SELECT sync_cursor FROM plaid_items").fetchone()[0] == "c2"
    rows = {r["external_id"]: r for r in conn.execute(
        "SELECT t.external_id, t.amount, t.merchant, t.pending, c.name AS cat FROM transactions t JOIN categories c ON c.id=t.category_id")}
    assert rows["t1"]["amount"] == -12.5 and rows["t1"]["merchant"] == "Uber" and rows["t1"]["cat"] == "Public Transit & Rideshare"  # via rule
    assert rows["t2"]["amount"] == 2500.0 and rows["t2"]["cat"] == "Interest & Dividends"                                           # via Plaid PFC fallback
    assert rows["t3"]["pending"] == 1
    assert match_transfers(conn) == 1                       # t4/t5 card payment linked
    # second sync: pending->posted replacement, modification, removal, user edits preserved
    conn.execute("UPDATE transactions SET category_id=(SELECT id FROM categories WHERE name='Shopping'), reviewed=1 WHERE external_id='t1'")
    conn.commit()
    r2 = plaid.sync_item(conn, client, item)
    assert r2 == {"item_id": item, "added": 0, "modified": 2, "removed": 1}
    assert conn.execute("SELECT COUNT(*) FROM transactions WHERE external_id='t3'").fetchone()[0] == 0
    posted = conn.execute("SELECT pending, date FROM transactions WHERE external_id='t3_posted'").fetchone()
    assert posted["pending"] == 0 and posted["date"] == "2026-10-06"
    t1 = conn.execute("SELECT t.amount, c.name FROM transactions t JOIN categories c ON c.id=t.category_id WHERE external_id='t1'").fetchone()
    assert t1["amount"] == -14.0 and t1["name"] == "Shopping"   # amount refreshed, user's category kept
    assert conn.execute("SELECT COUNT(*) FROM transactions WHERE external_id='t2'").fetchone()[0] == 0
    assert conn.execute("SELECT sync_cursor FROM plaid_items").fetchone()[0] == "c3"


def test_sync_records_error_on_item(conn):
    fake = FakePlaid()
    client = _client(fake)
    item = plaid.link_item(conn, client, "pt")["item_id"]
    def boom(req):
        return httpx.Response(400, json={"error_code": "ITEM_LOGIN_REQUIRED", "error_message": "re-auth"})
    client.http = httpx.Client(transport=httpx.MockTransport(boom))
    try:
        plaid.sync_item(conn, client, item)
    except RuntimeError as e:
        assert "ITEM_LOGIN_REQUIRED" in str(e)
    assert "ITEM_LOGIN_REQUIRED" in conn.execute("SELECT last_error FROM plaid_items").fetchone()[0]


def test_link_token_update_mode(conn):
    fake = FakePlaid()
    c = _client(fake)
    c.create_link_token(access_token="tok")
    body = fake.calls[-1][1]
    assert body["access_token"] == "tok" and "products" not in body
    c.create_link_token()
    assert fake.calls[-1][1]["products"] == ["transactions"]
