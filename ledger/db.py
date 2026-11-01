"""SQLite connection handling and schema."""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

DEFAULT_DB = Path(os.environ.get("LEDGER_DB", Path.home() / ".ledger" / "ledger.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS plaid_items (
    id INTEGER PRIMARY KEY,
    item_id TEXT NOT NULL UNIQUE,
    access_token TEXT NOT NULL,
    institution_name TEXT DEFAULT '',
    institution_id TEXT DEFAULT '',
    sync_cursor TEXT DEFAULT '',
    last_synced_at TEXT,
    last_error TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('checking','savings','credit','investment','loan','cash','other')),
    institution TEXT DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'USD',
    import_profile TEXT DEFAULT 'generic',
    plaid_account_id TEXT UNIQUE,
    plaid_item_id INTEGER REFERENCES plaid_items(id) ON DELETE SET NULL,
    include_in_net_worth INTEGER NOT NULL DEFAULT 1,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS balance_snapshots (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    balance REAL NOT NULL,
    UNIQUE (account_id, date)
);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    "group" TEXT NOT NULL DEFAULT 'Other',
    kind TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('income','expense','transfer')),
    icon TEXT DEFAULT '',
    budget_type TEXT NOT NULL DEFAULT 'flex' CHECK (budget_type IN ('fixed','flex','non_monthly')),
    rollover INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    amount REAL NOT NULL,              -- signed: + inflow, - outflow
    description TEXT NOT NULL,         -- raw bank text
    merchant TEXT NOT NULL,            -- cleaned display name
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    notes TEXT DEFAULT '',
    import_hash TEXT UNIQUE,
    source TEXT NOT NULL DEFAULT 'csv',
    reviewed INTEGER NOT NULL DEFAULT 0,
    pending INTEGER NOT NULL DEFAULT 0,
    transfer_pair_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
    external_id TEXT UNIQUE,            -- Plaid transaction_id
    hidden INTEGER NOT NULL DEFAULT 0,  -- exclude from reports/budgets
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);

CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY,
    pattern TEXT NOT NULL,             -- case-insensitive substring, or regex if is_regex
    is_regex INTEGER NOT NULL DEFAULT 0,
    category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    rename_to TEXT DEFAULT '',         -- optional merchant rename
    priority INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    month TEXT,                        -- 'YYYY-MM' for an override, NULL = default every month
    amount REAL NOT NULL,
    UNIQUE (category_id, month)
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS transaction_tags (
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (transaction_id, tag_id)
);

CREATE TABLE IF NOT EXISTS splits (
    id INTEGER PRIMARY KEY,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    target_amount REAL NOT NULL,
    target_date TEXT,
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,  -- funded from this account's balance
    starting_amount REAL NOT NULL DEFAULT 0,
    monthly_contribution REAL NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'save' CHECK (kind IN ('save','payoff')),
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recurring_overrides (
    merchant_key TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','ignored')),
    display_name TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    security_id TEXT NOT NULL,
    ticker TEXT DEFAULT '',
    name TEXT DEFAULT '',
    type TEXT DEFAULT '',
    quantity REAL NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    value REAL NOT NULL DEFAULT 0,
    cost_basis REAL,
    as_of TEXT NOT NULL,
    UNIQUE (account_id, security_id)
);

CREATE TABLE IF NOT EXISTS dismissed_insights (
    key TEXT PRIMARY KEY,
    dismissed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""

DEFAULT_CATEGORIES = [
    # (name, group, kind)
    ("Paycheck", "Income", "income"),
    ("Interest & Dividends", "Income", "income"),
    ("Refunds", "Income", "income"),
    ("Other Income", "Income", "income"),
    ("Rent / Mortgage", "Housing", "expense"),
    ("Utilities", "Housing", "expense"),
    ("Internet & Phone", "Housing", "expense"),
    ("Home Maintenance", "Housing", "expense"),
    ("Groceries", "Food", "expense"),
    ("Restaurants & Bars", "Food", "expense"),
    ("Coffee Shops", "Food", "expense"),
    ("Gas & Fuel", "Transportation", "expense"),
    ("Public Transit & Rideshare", "Transportation", "expense"),
    ("Auto Payment", "Transportation", "expense"),
    ("Auto Insurance & Maintenance", "Transportation", "expense"),
    ("Parking & Tolls", "Transportation", "expense"),
    ("Shopping", "Lifestyle", "expense"),
    ("Entertainment", "Lifestyle", "expense"),
    ("Subscriptions", "Lifestyle", "expense"),
    ("Travel", "Lifestyle", "expense"),
    ("Fitness", "Lifestyle", "expense"),
    ("Personal Care", "Lifestyle", "expense"),
    ("Gifts & Donations", "Lifestyle", "expense"),
    ("Medical", "Health", "expense"),
    ("Pharmacy", "Health", "expense"),
    ("Insurance", "Health", "expense"),
    ("Education", "Other", "expense"),
    ("Taxes", "Other", "expense"),
    ("Fees & Charges", "Other", "expense"),
    ("Uncategorized", "Other", "expense"),
    ("Transfer", "Transfer", "transfer"),
    ("Credit Card Payment", "Transfer", "transfer"),
    ("Investment Contribution", "Transfer", "transfer"),
]

DEFAULT_RULES = [
    # (pattern, category, rename_to)
    ("payroll", "Paycheck", ""), ("direct dep", "Paycheck", ""), ("salary", "Paycheck", ""),
    ("interest", "Interest & Dividends", ""), ("dividend", "Interest & Dividends", ""),
    ("refund", "Refunds", ""),
    ("rent", "Rent / Mortgage", ""), ("mortgage", "Rent / Mortgage", ""),
    ("electric", "Utilities", ""), ("pg&e", "Utilities", "PG&E"), ("water", "Utilities", ""), ("gas co", "Utilities", ""),
    ("comcast", "Internet & Phone", "Comcast"), ("xfinity", "Internet & Phone", "Xfinity"),
    ("verizon", "Internet & Phone", "Verizon"), ("t-mobile", "Internet & Phone", "T-Mobile"), ("at&t", "Internet & Phone", "AT&T"),
    ("whole foods", "Groceries", "Whole Foods"), ("wholefds", "Groceries", "Whole Foods"), ("trader joe", "Groceries", "Trader Joe's"), ("safeway", "Groceries", "Safeway"),
    ("costco", "Groceries", "Costco"), ("kroger", "Groceries", "Kroger"), ("aldi", "Groceries", "Aldi"), ("wegmans", "Groceries", "Wegmans"),
    ("instacart", "Groceries", "Instacart"), ("h-e-b", "Groceries", "H-E-B"), ("walmart", "Groceries", "Walmart"), ("target", "Shopping", "Target"),
    ("starbucks", "Coffee Shops", "Starbucks"), ("peet", "Coffee Shops", "Peet's Coffee"), ("blue bottle", "Coffee Shops", "Blue Bottle"), ("dunkin", "Coffee Shops", "Dunkin'"),
    ("doordash", "Restaurants & Bars", "DoorDash"), ("uber eats", "Restaurants & Bars", "Uber Eats"), ("grubhub", "Restaurants & Bars", "Grubhub"),
    ("chipotle", "Restaurants & Bars", "Chipotle"), ("mcdonald", "Restaurants & Bars", "McDonald's"), ("restaurant", "Restaurants & Bars", ""),
    ("pizza", "Restaurants & Bars", ""), ("ramen", "Restaurants & Bars", ""), ("bistro", "Restaurants & Bars", ""), ("grill", "Restaurants & Bars", ""), ("sushi", "Restaurants & Bars", ""), ("taco", "Restaurants & Bars", ""), ("cafe", "Restaurants & Bars", ""),
    ("shell oil", "Gas & Fuel", "Shell"), ("chevron", "Gas & Fuel", "Chevron"), ("exxon", "Gas & Fuel", "Exxon"), ("76 ", "Gas & Fuel", "76"), ("arco", "Gas & Fuel", "ARCO"),
    ("uber ", "Public Transit & Rideshare", "Uber"), ("uber*", "Public Transit & Rideshare", "Uber"), ("lyft", "Public Transit & Rideshare", "Lyft"),
    ("bart", "Public Transit & Rideshare", "BART"), ("mta", "Public Transit & Rideshare", "MTA"), ("clipper", "Public Transit & Rideshare", "Clipper"),
    ("geico", "Auto Insurance & Maintenance", "GEICO"), ("progressive", "Auto Insurance & Maintenance", "Progressive"), ("state farm", "Auto Insurance & Maintenance", "State Farm"),
    ("parking", "Parking & Tolls", ""), ("fastrak", "Parking & Tolls", "FasTrak"), ("toll", "Parking & Tolls", ""),
    ("amazon", "Shopping", "Amazon"), ("amzn", "Shopping", "Amazon"), ("best buy", "Shopping", "Best Buy"), ("apple.com", "Shopping", "Apple"), ("ikea", "Shopping", "IKEA"),
    ("netflix", "Subscriptions", "Netflix"), ("spotify", "Subscriptions", "Spotify"), ("hulu", "Subscriptions", "Hulu"), ("disney", "Subscriptions", "Disney+"),
    ("youtube", "Subscriptions", "YouTube"), ("apple music", "Subscriptions", "Apple Music"), ("icloud", "Subscriptions", "iCloud"), ("hbo", "Subscriptions", "Max"),
    ("prime video", "Subscriptions", "Prime Video"), ("audible", "Subscriptions", "Audible"), ("nytimes", "Subscriptions", "NYTimes"), ("github", "Subscriptions", "GitHub"),
    ("openai", "Subscriptions", "OpenAI"), ("anthropic", "Subscriptions", "Anthropic"), ("adobe", "Subscriptions", "Adobe"),
    ("amc", "Entertainment", "AMC Theatres"), ("steam", "Entertainment", "Steam"), ("ticketmaster", "Entertainment", "Ticketmaster"), ("cinema", "Entertainment", ""),
    ("united air", "Travel", "United Airlines"), ("delta air", "Travel", "Delta"), ("southwest", "Travel", "Southwest"), ("alaska air", "Travel", "Alaska Airlines"),
    ("airbnb", "Travel", "Airbnb"), ("marriott", "Travel", "Marriott"), ("hilton", "Travel", "Hilton"), ("hotel", "Travel", ""), ("expedia", "Travel", "Expedia"),
    ("planet fitness", "Fitness", "Planet Fitness"), ("equinox", "Fitness", "Equinox"), ("24 hour", "Fitness", "24 Hour Fitness"), ("peloton", "Fitness", "Peloton"), ("gym", "Fitness", ""),
    ("barber", "Personal Care", ""), ("salon", "Personal Care", ""), ("sephora", "Personal Care", "Sephora"),
    ("donation", "Gifts & Donations", ""), ("gofundme", "Gifts & Donations", "GoFundMe"), ("red cross", "Gifts & Donations", "Red Cross"),
    ("cvs", "Pharmacy", "CVS"), ("walgreens", "Pharmacy", "Walgreens"), ("rite aid", "Pharmacy", "Rite Aid"),
    ("dental", "Medical", ""), ("medical", "Medical", ""), ("clinic", "Medical", ""), ("kaiser", "Medical", "Kaiser Permanente"), ("one medical", "Medical", "One Medical"),
    ("irs", "Taxes", "IRS"), ("franchise tax", "Taxes", "Franchise Tax Board"), ("tax", "Taxes", ""),
    ("atm fee", "Fees & Charges", ""), ("service fee", "Fees & Charges", ""), ("overdraft", "Fees & Charges", ""), ("annual fee", "Fees & Charges", ""), ("late fee", "Fees & Charges", ""),
    ("tuition", "Education", ""), ("udemy", "Education", "Udemy"), ("coursera", "Education", "Coursera"),
    ("transfer", "Transfer", ""), ("zelle", "Transfer", "Zelle"), ("venmo", "Transfer", "Venmo"), ("paypal", "Transfer", "PayPal"),
    ("crd autopay", "Credit Card Payment", "Card payment"), ("card autopay", "Credit Card Payment", "Card payment"), ("epayment", "Credit Card Payment", "Card payment"), ("card payment", "Credit Card Payment", "Card payment"), ("automatic payment", "Credit Card Payment", "Card payment"), ("payment thank you", "Credit Card Payment", "Card payment"), ("payment - thank", "Credit Card Payment", "Card payment"), ("payment received", "Transfer", "Loan payment"),
    ("vanguard", "Investment Contribution", "Vanguard"), ("fidelity", "Investment Contribution", "Fidelity"), ("schwab", "Investment Contribution", "Schwab"), ("robinhood", "Investment Contribution", "Robinhood"),
]


def connect(path: Path | str | None = None) -> sqlite3.Connection:
    """Open (and initialise) the database."""
    p = Path(path) if path else DEFAULT_DB
    if str(p) != ":memory:":
        p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(p), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL") if str(p) != ":memory:" else None
    init_schema(conn)
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    if conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 0:
        conn.executemany(
            'INSERT INTO categories (name, "group", kind) VALUES (?, ?, ?)', DEFAULT_CATEGORIES
        )
    if conn.execute("SELECT COUNT(*) FROM rules").fetchone()[0] == 0:
        cats = {r["name"]: r["id"] for r in conn.execute("SELECT id, name FROM categories")}
        # Later rules in the list are more specific and should win, so give them lower priority numbers.
        rows = []
        for i, (pattern, cat, rename) in enumerate(DEFAULT_RULES):
            rows.append((pattern, 0, cats[cat], rename, 1000 - i))
        conn.executemany(
            "INSERT INTO rules (pattern, is_regex, category_id, rename_to, priority) VALUES (?, ?, ?, ?, ?)",
            rows,
        )
    conn.commit()


def rows_to_dicts(rows) -> list[dict]:
    return [dict(r) for r in rows]
