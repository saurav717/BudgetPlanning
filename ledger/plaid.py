"""Plaid connector: link institutions, sync transactions/balances/holdings.

Uses Plaid's REST API directly (no SDK) so the dependency footprint stays small.
Set PLAID_CLIENT_ID, PLAID_SECRET and PLAID_ENV (sandbox | production) in the environment or a .env file.
Docs: https://plaid.com/docs/api/
"""
from __future__ import annotations

import os
import sqlite3
from datetime import date

import httpx

from .categorize import Categorizer, clean_merchant

ENV_HOSTS = {"sandbox": "https://sandbox.plaid.com", "production": "https://production.plaid.com"}

# Plaid personal_finance_category.primary -> our category name (used when no rule matches)
PFC_MAP = {
    "INCOME": "Paycheck", "TRANSFER_IN": "Transfer", "TRANSFER_OUT": "Transfer", "LOAN_PAYMENTS": "Credit Card Payment",
    "BANK_FEES": "Fees & Charges", "ENTERTAINMENT": "Entertainment", "FOOD_AND_DRINK": "Restaurants & Bars",
    "GENERAL_MERCHANDISE": "Shopping", "HOME_IMPROVEMENT": "Home Maintenance", "MEDICAL": "Medical",
    "PERSONAL_CARE": "Personal Care", "GENERAL_SERVICES": "Fees & Charges", "GOVERNMENT_AND_NON_PROFIT": "Gifts & Donations",
    "TRANSPORTATION": "Public Transit & Rideshare", "TRAVEL": "Travel", "RENT_AND_UTILITIES": "Utilities",
}
PFC_DETAILED_MAP = {
    "FOOD_AND_DRINK_GROCERIES": "Groceries", "FOOD_AND_DRINK_COFFEE": "Coffee Shops",
    "TRANSPORTATION_GAS": "Gas & Fuel", "TRANSPORTATION_PARKING": "Parking & Tolls", "TRANSPORTATION_TOLLS": "Parking & Tolls",
    "RENT_AND_UTILITIES_RENT": "Rent / Mortgage", "RENT_AND_UTILITIES_INTERNET_AND_CABLE": "Internet & Phone",
    "RENT_AND_UTILITIES_TELEPHONE": "Internet & Phone", "LOAN_PAYMENTS_MORTGAGE_PAYMENT": "Rent / Mortgage",
    "LOAN_PAYMENTS_CAR_PAYMENT": "Auto Payment", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT": "Credit Card Payment",
    "INCOME_WAGES": "Paycheck", "INCOME_DIVIDENDS": "Interest & Dividends", "INCOME_INTEREST_EARNED": "Interest & Dividends",
    "INCOME_TAX_REFUND": "Refunds", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES": "Shopping",
    "ENTERTAINMENT_TV_AND_MOVIES": "Subscriptions", "ENTERTAINMENT_MUSIC_AND_AUDIO": "Subscriptions",
    "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS": "Fitness", "MEDICAL_PHARMACIES_AND_SUPPLEMENTS": "Pharmacy",
    "GENERAL_SERVICES_INSURANCE": "Insurance", "GENERAL_SERVICES_EDUCATION": "Education",
    "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT": "Taxes", "GOVERNMENT_AND_NON_PROFIT_DONATIONS": "Gifts & Donations",
    "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS": "Investment Contribution",
}
ACCOUNT_TYPE_MAP = {("depository", "checking"): "checking", ("depository", "savings"): "savings",
                    ("depository", "money market"): "savings", ("depository", "cd"): "savings",
                    ("depository", "hsa"): "savings", ("depository", "cash management"): "checking",
                    ("depository", "paypal"): "cash", ("depository", "prepaid"): "cash"}


class PlaidNotConfigured(RuntimeError):
    pass


class PlaidClient:
    def __init__(self, client_id: str | None = None, secret: str | None = None, env: str | None = None,
                 http: httpx.Client | None = None):
        self.client_id = client_id or os.environ.get("PLAID_CLIENT_ID", "")
        self.secret = secret or os.environ.get("PLAID_SECRET", "")
        self.env = (env or os.environ.get("PLAID_ENV", "sandbox")).lower()
        self.base = ENV_HOSTS.get(self.env, ENV_HOSTS["sandbox"])
        self.http = http or httpx.Client(timeout=60)

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.secret)

    def _post(self, path: str, **body) -> dict:
        if not self.configured:
            raise PlaidNotConfigured("Set PLAID_CLIENT_ID and PLAID_SECRET to use Plaid.")
        body.update(client_id=self.client_id, secret=self.secret)
        r = self.http.post(f"{self.base}{path}", json=body)
        if r.status_code >= 400:
            try:
                err = r.json()
                msg = f"{err.get('error_code')}: {err.get('error_message')}"
            except Exception:
                msg = r.text
            raise RuntimeError(f"Plaid {path} failed ({r.status_code}): {msg}")
        return r.json()

    # ---- Link ----
    def create_link_token(self, user_id: str = "ledger-user", access_token: str | None = None,
                          products: list[str] | None = None, redirect_uri: str | None = None) -> dict:
        body = {"user": {"client_user_id": user_id}, "client_name": "Ledger", "language": "en",
                "country_codes": ["US"]}
        if access_token:
            body["access_token"] = access_token          # update mode (re-authenticate an existing item)
        else:
            body["products"] = products or ["transactions"]
            body["optional_products"] = ["investments", "liabilities"]
        if redirect_uri:
            body["redirect_uri"] = redirect_uri
        return self._post("/link/token/create", **body)

    def exchange_public_token(self, public_token: str) -> dict:
        return self._post("/item/public_token/exchange", public_token=public_token)

    def item_get(self, access_token: str) -> dict:
        return self._post("/item/get", access_token=access_token)

    def institution_get(self, institution_id: str) -> dict:
        return self._post("/institutions/get_by_id", institution_id=institution_id, country_codes=["US"])

    def accounts_get(self, access_token: str) -> dict:
        return self._post("/accounts/get", access_token=access_token)

    def balances_get(self, access_token: str) -> dict:
        return self._post("/accounts/balance/get", access_token=access_token)

    def transactions_sync(self, access_token: str, cursor: str = "") -> dict:
        body = {"access_token": access_token, "count": 500,
                "options": {"include_personal_finance_category": True}}
        if cursor:
            body["cursor"] = cursor
        return self._post("/transactions/sync", **body)

    def holdings_get(self, access_token: str) -> dict:
        return self._post("/investments/holdings/get", access_token=access_token)

    def item_remove(self, access_token: str) -> dict:
        return self._post("/item/remove", access_token=access_token)

    # Sandbox helper: creates a test item without going through Link UI
    def sandbox_public_token(self, institution_id: str = "ins_109508", products: list[str] | None = None) -> dict:
        return self._post("/sandbox/public_token/create", institution_id=institution_id,
                          initial_products=products or ["transactions"])


# ---------- persistence helpers ----------

def map_account_type(plaid_type: str, subtype: str | None) -> str:
    if plaid_type == "credit":
        return "credit"
    if plaid_type == "loan":
        return "loan"
    if plaid_type in ("investment", "brokerage"):
        return "investment"
    return ACCOUNT_TYPE_MAP.get((plaid_type, (subtype or "").lower()), "checking" if plaid_type == "depository" else "other")


def signed_balance(acct_type: str, current: float | None) -> float:
    """Plaid reports liabilities as positive amounts owed; we store them negative."""
    v = current or 0.0
    return -abs(v) if acct_type in ("credit", "loan") else v


def link_item(conn: sqlite3.Connection, client: PlaidClient, public_token: str) -> dict:
    """Exchange a Link public token, store the item and create local accounts for each Plaid account."""
    ex = client.exchange_public_token(public_token)
    access_token, item_id = ex["access_token"], ex["item_id"]
    inst_name, inst_id = "", ""
    try:
        item = client.item_get(access_token)["item"]
        inst_id = item.get("institution_id") or ""
        if inst_id:
            inst_name = client.institution_get(inst_id)["institution"]["name"]
    except Exception:
        pass
    conn.execute("INSERT OR IGNORE INTO plaid_items (item_id, access_token, institution_name, institution_id) VALUES (?,?,?,?)",
                 (item_id, access_token, inst_name, inst_id))
    row_id = conn.execute("SELECT id FROM plaid_items WHERE item_id=?", (item_id,)).fetchone()[0]
    conn.commit()
    created = upsert_accounts(conn, client, row_id)
    return {"item_id": row_id, "institution": inst_name, "accounts": created}


def upsert_accounts(conn: sqlite3.Connection, client: PlaidClient, item_row_id: int) -> list[dict]:
    item = conn.execute("SELECT * FROM plaid_items WHERE id=?", (item_row_id,)).fetchone()
    data = client.accounts_get(item["access_token"])
    today = date.today().isoformat()
    out = []
    for a in data["accounts"]:
        t = map_account_type(a["type"], a.get("subtype"))
        name = a.get("official_name") or a["name"]
        if a.get("mask"):
            name = f"{name} ••{a['mask']}"
        existing = conn.execute("SELECT id FROM accounts WHERE plaid_account_id=?", (a["account_id"],)).fetchone()
        if existing:
            acct_id = existing["id"]
        else:
            # avoid UNIQUE(name) collisions across institutions
            base, n, candidate = name, 2, name
            while conn.execute("SELECT 1 FROM accounts WHERE name=?", (candidate,)).fetchone():
                candidate = f"{base} ({n})"; n += 1
            cur = conn.execute("INSERT INTO accounts (name, type, institution, currency, import_profile, plaid_account_id, plaid_item_id) "
                               "VALUES (?,?,?,?, 'plaid', ?, ?)",
                               (candidate, t, item["institution_name"], (a.get("balances") or {}).get("iso_currency_code") or "USD",
                                a["account_id"], item_row_id))
            acct_id = cur.lastrowid
        bal = signed_balance(t, (a.get("balances") or {}).get("current"))
        conn.execute("INSERT OR REPLACE INTO balance_snapshots (account_id, date, balance) VALUES (?,?,?)", (acct_id, today, bal))
        out.append({"id": acct_id, "name": name, "type": t, "balance": bal})
    conn.commit()
    return out


def _pick_category(conn, cat: Categorizer, tx: dict, merchant: str) -> tuple[int, str]:
    desc = tx.get("name") or merchant
    rule_cat, rename, _ = cat.match(desc, merchant)
    if rule_cat is not None:
        return rule_cat, (rename or merchant)
    pfc = tx.get("personal_finance_category") or {}
    name = PFC_DETAILED_MAP.get(pfc.get("detailed", "")) or PFC_MAP.get(pfc.get("primary", ""))
    if name:
        r = conn.execute("SELECT id FROM categories WHERE name=?", (name,)).fetchone()
        if r:
            return r["id"], merchant
    return cat.uncategorized_id, merchant


def sync_item(conn: sqlite3.Connection, client: PlaidClient, item_row_id: int) -> dict:
    """Pull added/modified/removed transactions via /transactions/sync and refresh balances."""
    item = conn.execute("SELECT * FROM plaid_items WHERE id=?", (item_row_id,)).fetchone()
    acct_ids = {r["plaid_account_id"]: r["id"] for r in conn.execute(
        "SELECT id, plaid_account_id FROM accounts WHERE plaid_item_id=?", (item_row_id,))}
    cat = Categorizer(conn)
    cursor = item["sync_cursor"] or ""
    added = modified = removed = 0
    try:
        while True:
            page = client.transactions_sync(item["access_token"], cursor)
            for tx in page.get("added", []) + page.get("modified", []):
                local_acct = acct_ids.get(tx["account_id"])
                if local_acct is None:
                    upsert_accounts(conn, client, item_row_id)
                    acct_ids = {r["plaid_account_id"]: r["id"] for r in conn.execute(
                        "SELECT id, plaid_account_id FROM accounts WHERE plaid_item_id=?", (item_row_id,))}
                    local_acct = acct_ids.get(tx["account_id"])
                    if local_acct is None:
                        continue
                amount = -float(tx["amount"])  # Plaid: positive = money out
                merchant = tx.get("merchant_name") or clean_merchant(tx.get("name") or "")
                category_id, merchant = _pick_category(conn, cat, tx, merchant)
                existing = conn.execute("SELECT id, reviewed, category_id, merchant FROM transactions WHERE external_id=?",
                                        (tx["transaction_id"],)).fetchone()
                pending = 1 if tx.get("pending") else 0
                if existing:
                    # keep the user's own edits on reviewed rows
                    if existing["reviewed"]:
                        conn.execute("UPDATE transactions SET date=?, amount=?, pending=? WHERE id=?",
                                     (tx["date"], amount, pending, existing["id"]))
                    else:
                        conn.execute("UPDATE transactions SET date=?, amount=?, description=?, merchant=?, category_id=?, pending=? WHERE id=?",
                                     (tx["date"], amount, tx.get("name") or merchant, merchant, category_id, pending, existing["id"]))
                    modified += 1
                else:
                    # a pending tx we already have may be replaced by a posted one with a new id
                    ptid = tx.get("pending_transaction_id")
                    if ptid:
                        prev = conn.execute("SELECT id FROM transactions WHERE external_id=?", (ptid,)).fetchone()
                        if prev:
                            conn.execute("UPDATE transactions SET external_id=?, date=?, amount=?, pending=0 WHERE id=?",
                                         (tx["transaction_id"], tx["date"], amount, prev["id"]))
                            modified += 1
                            continue
                    conn.execute(
                        "INSERT INTO transactions (account_id, date, amount, description, merchant, category_id, source, pending, external_id) "
                        "VALUES (?,?,?,?,?,?,'plaid',?,?)",
                        (local_acct, tx["date"], amount, tx.get("name") or merchant, merchant, category_id, pending, tx["transaction_id"]))
                    added += 1
            for rm in page.get("removed", []):
                conn.execute("DELETE FROM transactions WHERE external_id=? AND reviewed=0", (rm["transaction_id"],))
                removed += 1
            cursor = page.get("next_cursor", cursor)
            if not page.get("has_more"):
                break
        upsert_accounts(conn, client, item_row_id)  # refresh balances
        conn.execute("UPDATE plaid_items SET sync_cursor=?, last_synced_at=datetime('now'), last_error='' WHERE id=?",
                     (cursor, item_row_id))
        conn.commit()
    except Exception as e:  # record the error so the UI can show "needs re-authentication"
        conn.execute("UPDATE plaid_items SET last_error=? WHERE id=?", (str(e)[:500], item_row_id))
        conn.commit()
        raise
    return {"item_id": item_row_id, "added": added, "modified": modified, "removed": removed}


def sync_holdings(conn: sqlite3.Connection, client: PlaidClient, item_row_id: int) -> int:
    item = conn.execute("SELECT * FROM plaid_items WHERE id=?", (item_row_id,)).fetchone()
    try:
        data = client.holdings_get(item["access_token"])
    except RuntimeError as e:
        if "PRODUCTS_NOT_SUPPORTED" in str(e) or "NO_INVESTMENT_ACCOUNTS" in str(e):
            return 0
        raise
    secs = {s["security_id"]: s for s in data.get("securities", [])}
    acct_ids = {r["plaid_account_id"]: r["id"] for r in conn.execute(
        "SELECT id, plaid_account_id FROM accounts WHERE plaid_item_id=?", (item_row_id,))}
    today = date.today().isoformat()
    n = 0
    for h in data.get("holdings", []):
        acct = acct_ids.get(h["account_id"])
        if not acct:
            continue
        s = secs.get(h["security_id"], {})
        conn.execute(
            "INSERT OR REPLACE INTO holdings (account_id, security_id, ticker, name, type, quantity, price, value, cost_basis, as_of) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (acct, h["security_id"], s.get("ticker_symbol") or "", s.get("name") or "", s.get("type") or "",
             h.get("quantity") or 0, h.get("institution_price") or 0, h.get("institution_value") or 0, h.get("cost_basis"), today))
        n += 1
    conn.commit()
    return n


def sync_all(conn: sqlite3.Connection, client: PlaidClient) -> list[dict]:
    results = []
    for item in conn.execute("SELECT id FROM plaid_items").fetchall():
        try:
            r = sync_item(conn, client, item["id"])
            r["holdings"] = sync_holdings(conn, client, item["id"])
        except Exception as e:
            r = {"item_id": item["id"], "error": str(e)}
        results.append(r)
    return results
