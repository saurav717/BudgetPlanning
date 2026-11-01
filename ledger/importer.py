"""CSV import with per-bank column profiles and duplicate detection."""
from __future__ import annotations

import csv
import hashlib
import io
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime

from .categorize import Categorizer, clean_merchant


@dataclass
class Profile:
    """Describes how a bank's CSV export maps onto our transaction fields."""
    name: str
    date: list[str]
    description: list[str]
    amount: list[str] = field(default_factory=list)      # single signed column
    debit: list[str] = field(default_factory=list)       # OR separate debit/credit columns
    credit: list[str] = field(default_factory=list)
    date_formats: list[str] = field(default_factory=lambda: ["%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%d/%m/%Y", "%b %d, %Y"])
    negate: bool = False          # bank reports charges as positive (common for credit cards)
    skip_rows: int = 0
    pending_values: tuple[str, ...] = ("pending",)
    status: list[str] = field(default_factory=lambda: ["Status"])


PROFILES: dict[str, Profile] = {
    "generic": Profile("generic", ["Date", "Transaction Date", "Posting Date", "Posted Date", "Trans. Date", "date"],
                       ["Description", "Memo", "Name", "Payee", "description"],
                       amount=["Amount", "amount"], debit=["Debit", "Withdrawal"], credit=["Credit", "Deposit"]),
    "chase": Profile("chase", ["Transaction Date", "Posting Date"], ["Description"], amount=["Amount"]),
    "amex": Profile("amex", ["Date"], ["Description"], amount=["Amount"], negate=True),
    "capital_one": Profile("capital_one", ["Transaction Date"], ["Description"], debit=["Debit"], credit=["Credit"]),
    "bofa": Profile("bofa", ["Date", "Posted Date"], ["Description", "Payee"], amount=["Amount"]),
    "wells_fargo": Profile("wells_fargo", ["Date"], ["Description"], amount=["Amount"]),
    "citi": Profile("citi", ["Date"], ["Description"], debit=["Debit"], credit=["Credit"]),
    "discover": Profile("discover", ["Trans. Date", "Transaction Date"], ["Description"], amount=["Amount"], negate=True),
    "apple_card": Profile("apple_card", ["Transaction Date"], ["Description", "Merchant"], amount=["Amount (USD)"], negate=True),
    "monarch": Profile("monarch", ["Date"], ["Merchant", "Original Statement"], amount=["Amount"]),
    "mint": Profile("mint", ["Date"], ["Original Description", "Description"], amount=["Amount"]),
}


def _parse_amount(s: str) -> float | None:
    s = (s or "").strip().replace(",", "").replace("$", "")
    if not s:
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def _parse_date(s: str, formats: list[str]) -> str | None:
    s = (s or "").strip()
    for f in formats:
        try:
            return datetime.strptime(s, f).strftime("%Y-%m-%d")
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s).strftime("%Y-%m-%d")
    except ValueError:
        return None


def _pick(row: dict, candidates: list[str]) -> str | None:
    lower = {k.strip().lower(): v for k, v in row.items() if k}
    for c in candidates:
        if c.lower() in lower:
            return lower[c.lower()]
    return None


def import_hash(account_id: int, date: str, amount: float, description: str) -> str:
    raw = f"{account_id}|{date}|{amount:.2f}|{description.strip().lower()}"
    return hashlib.sha1(raw.encode()).hexdigest()


@dataclass
class ImportResult:
    imported: int = 0
    duplicates: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)
    transactions: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"imported": self.imported, "duplicates": self.duplicates, "skipped": self.skipped,
                "errors": self.errors[:20], "transactions": self.transactions[:200]}


def parse_csv(text: str, profile: Profile) -> tuple[list[dict], list[str]]:
    """Return (rows, errors). Each row: {date, amount, description, pending}."""
    lines = text.splitlines()[profile.skip_rows:]
    reader = csv.DictReader(io.StringIO("\n".join(lines)))
    out, errors = [], []
    for i, row in enumerate(reader, start=2):
        date = _parse_date(_pick(row, profile.date) or "", profile.date_formats)
        desc = (_pick(row, profile.description) or "").strip()
        amt = None
        a = _pick(row, profile.amount) if profile.amount else None
        if a not in (None, ""):
            amt = _parse_amount(a)
        else:
            d = _parse_amount(_pick(row, profile.debit) or "") if profile.debit else None
            c = _parse_amount(_pick(row, profile.credit) or "") if profile.credit else None
            if d is not None and d != 0:
                amt = -abs(d)
            elif c is not None:
                amt = abs(c)
        if date is None or amt is None or not desc:
            if any((v or "").strip() for v in row.values()):
                errors.append(f"line {i}: could not parse (date={date!r}, amount={amt!r}, desc={desc!r})")
            continue
        if profile.negate:
            amt = -amt
        status = (_pick(row, profile.status) or "").strip().lower()
        out.append({"date": date, "amount": round(amt, 2), "description": desc,
                    "pending": status in profile.pending_values})
    return out, errors


def import_rows(conn: sqlite3.Connection, account_id: int, rows: list[dict], source: str = "csv",
                dry_run: bool = False) -> ImportResult:
    cat = Categorizer(conn)
    res = ImportResult()
    seen_in_batch: dict[str, int] = {}
    for r in rows:
        desc = r["description"]
        # Multiple identical rows on the same day are legitimate (two coffees); suffix an ordinal to the hash.
        base = import_hash(account_id, r["date"], r["amount"], desc)
        n = seen_in_batch.get(base, 0)
        seen_in_batch[base] = n + 1
        h = base if n == 0 else hashlib.sha1(f"{base}|{n}".encode()).hexdigest()
        if conn.execute("SELECT 1 FROM transactions WHERE import_hash=?", (h,)).fetchone():
            res.duplicates += 1
            continue
        category_id, merchant = cat.categorize(desc)
        tx = {"account_id": account_id, "date": r["date"], "amount": r["amount"], "description": desc,
              "merchant": merchant, "category_id": category_id, "import_hash": h, "source": source,
              "pending": 1 if r.get("pending") else 0}
        res.transactions.append(tx)
        if not dry_run:
            conn.execute(
                "INSERT INTO transactions (account_id, date, amount, description, merchant, category_id, "
                "import_hash, source, pending) VALUES (:account_id,:date,:amount,:description,:merchant,"
                ":category_id,:import_hash,:source,:pending)", tx)
        res.imported += 1
    if not dry_run:
        conn.commit()
    return res


def import_csv(conn: sqlite3.Connection, account_id: int, text: str, profile_name: str = "generic",
               dry_run: bool = False) -> ImportResult:
    profile = PROFILES.get(profile_name, PROFILES["generic"])
    rows, errors = parse_csv(text, profile)
    res = import_rows(conn, account_id, rows, source="csv", dry_run=dry_run)
    res.errors = errors + res.errors
    return res


def detect_profile(text: str) -> str:
    header = (text.splitlines() or [""])[0].lower()
    if "original statement" in header:
        return "monarch"
    if "original description" in header:
        return "mint"
    if "amount (usd)" in header:
        return "apple_card"
    if "trans. date" in header:
        return "discover"
    if "posting date" in header:
        return "chase"
    if "transaction date" in header and "debit" in header:
        return "capital_one"
    cols = [c.strip().lower() for c in header.split(",")]
    if cols == ["date", "description", "amount"]:
        return "amex"  # Amex's bare 3-column export, charges positive
    return "generic"
