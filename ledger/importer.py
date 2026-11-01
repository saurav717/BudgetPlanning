"""CSV import with per-bank column profiles and duplicate detection."""
from __future__ import annotations

import csv
import hashlib
import io
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime

from .categorize import Categorizer, clean_merchant


@dataclass
class Profile:
    """Describes how a bank's export maps onto our transaction fields.

    Column names are matched loosely: case, spaces and punctuation are ignored, and a candidate also
    matches a header that starts with it ("Withdrawal Amt" matches "Withdrawal Amount (INR )")."""
    name: str
    date: list[str]
    description: list[str]
    amount: list[str] = field(default_factory=list)      # single signed column
    debit: list[str] = field(default_factory=list)       # OR separate debit/credit columns
    credit: list[str] = field(default_factory=list)
    dr_cr: list[str] = field(default_factory=list)       # column saying "Dr"/"Cr" for an unsigned amount
    date_formats: list[str] = field(default_factory=lambda: ["%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%d/%m/%Y", "%b %d, %Y"])
    negate: bool = False          # bank reports charges as positive (common for credit cards)
    pending_values: tuple[str, ...] = ("pending",)
    status: list[str] = field(default_factory=lambda: ["Status"])
    label: str = ""


INDIA_DATES = ["%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y", "%d-%m-%y", "%d %b %Y", "%d-%b-%Y", "%d-%b-%y", "%d %b %y",
               "%d.%m.%Y", "%d %B %Y", "%Y-%m-%d", "%d/%m/%Y %H:%M:%S", "%d-%m-%Y %H:%M:%S"]


def _india(name: str, label: str) -> Profile:
    # One flexible profile covers the statement layouts of ICICI, HDFC, SBI, Axis, Kotak and most others:
    #   HDFC   Date | Narration | Chq./Ref.No. | Value Dt | Withdrawal Amt. | Deposit Amt. | Closing Balance
    #   ICICI  Value Date | Transaction Date | Cheque Number | Transaction Remarks | Withdrawal Amount (INR ) | Deposit Amount (INR ) | Balance
    #   SBI    Txn Date | Value Date | Description | Ref No./Cheque No. | Debit | Credit | Balance
    #   Axis   Tran Date | CHQNO | PARTICULARS | DR | CR | BAL | SOL
    #   Kotak  Transaction Date | Description | Chq/Ref No. | Amount | Dr / Cr | Balance
    return Profile(name, label=label,
                   date=["Transaction Date", "Txn Date", "Tran Date", "Date", "Txn Posted Date", "Posting Date", "Value Date", "Value Dt"],
                   description=["Narration", "Transaction Remarks", "Description", "Particulars", "Remarks", "Transaction Details", "Details"],
                   debit=["Withdrawal Amt", "Withdrawal Amount", "Withdrawals", "Withdrawal", "Debit Amount", "Debit", "Dr Amount", "DR"],
                   credit=["Deposit Amt", "Deposit Amount", "Deposits", "Deposit", "Credit Amount", "Credit", "Cr Amount", "CR"],
                   amount=["Transaction Amount", "Amount", "Amount (INR)"],
                   dr_cr=["Dr / Cr", "Dr/Cr", "Cr/Dr", "DR/CR", "Debit/Credit", "Type"],
                   date_formats=INDIA_DATES)


PROFILES: dict[str, Profile] = {
    "generic": Profile("generic", ["Date", "Transaction Date", "Posting Date", "Posted Date", "Trans. Date"],
                       ["Description", "Memo", "Name", "Payee"],
                       amount=["Amount"], debit=["Debit", "Withdrawal"], credit=["Credit", "Deposit"], label="Generic (US dates)"),
    "chase": Profile("chase", ["Transaction Date", "Posting Date"], ["Description"], amount=["Amount"], label="Chase"),
    "amex": Profile("amex", ["Date"], ["Description"], amount=["Amount"], negate=True, label="American Express"),
    "capital_one": Profile("capital_one", ["Transaction Date"], ["Description"], debit=["Debit"], credit=["Credit"], label="Capital One"),
    "bofa": Profile("bofa", ["Date", "Posted Date"], ["Description", "Payee"], amount=["Amount"], label="Bank of America"),
    "wells_fargo": Profile("wells_fargo", ["Date"], ["Description"], amount=["Amount"], label="Wells Fargo"),
    "citi": Profile("citi", ["Date"], ["Description"], debit=["Debit"], credit=["Credit"], label="Citi"),
    "discover": Profile("discover", ["Trans. Date", "Transaction Date"], ["Description"], amount=["Amount"], negate=True, label="Discover"),
    "apple_card": Profile("apple_card", ["Transaction Date"], ["Description", "Merchant"], amount=["Amount (USD)"], negate=True, label="Apple Card"),
    "monarch": Profile("monarch", ["Date"], ["Merchant", "Original Statement"], amount=["Amount"], label="Monarch export"),
    "mint": Profile("mint", ["Date"], ["Original Description", "Description"], amount=["Amount"], label="Mint export"),
    "india": _india("india", "Indian bank (any)"),
    "icici": _india("icici", "ICICI Bank"),
    "hdfc": _india("hdfc", "HDFC Bank"),
    "sbi": _india("sbi", "State Bank of India"),
    "axis": _india("axis", "Axis Bank"),
    "kotak": _india("kotak", "Kotak Mahindra Bank"),
}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _parse_amount(s: str) -> tuple[float | None, int]:
    """Parse '1,23,456.50', '(12.00)', '$5', '₹ 500.00 Cr', '250.00 DR', '100-'. Returns (value, sign_hint)."""
    s = (s or "").strip()
    if not s:
        return None, 0
    up = s.upper()
    hint = 0
    m = re.search(r"\b(CR|DR)\.?$", up)
    if m:
        hint = 1 if m.group(1) == "CR" else -1
        up = up[: m.start()]
    up = re.sub(r"INR|USD|RS\.?|[₹$£€,\s]", "", up)
    neg = up.startswith("(") and up.endswith(")") or up.endswith("-")
    up = up.strip("()").rstrip("-")
    try:
        v = float(up)
    except ValueError:
        return None, 0
    return (-v if neg else v), hint


def _parse_date(s: str, formats: list[str]) -> str | None:
    s = re.sub(r"\s+", " ", (s or "").strip())
    if not s:
        return None
    for f in formats:
        try:
            return datetime.strptime(s, f).strftime("%Y-%m-%d")
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s).strftime("%Y-%m-%d")
    except ValueError:
        return None


_DATEISH = re.compile(r"\d{1,4}\s*[/\-. ]\s*([A-Za-z]{3,9}|\d{1,2})\s*[/\-. ]\s*\d{2,4}")
FIELDS = ("date", "description", "dr_cr", "debit", "credit", "amount", "status")


def resolve_columns(header: list[str], profile: Profile) -> dict[str, int]:
    """Map our fields to column indexes. Exact (normalised) matches win over prefix matches."""
    norms = [_norm(h) for h in header]
    used: set[int] = set()
    cols: dict[str, int] = {}
    for fld in FIELDS:
        cands = [_norm(c) for c in getattr(profile, fld)]
        hit = None
        for c in cands:                       # candidates are in preference order
            for i, n in enumerate(norms):
                if i not in used and n and n == c:
                    hit = i; break
            if hit is not None:
                break
        if hit is None:
            for c in cands:
                if len(c) < 4:
                    continue
                for i, n in enumerate(norms):
                    if i not in used and n.startswith(c):
                        hit = i; break
                if hit is not None:
                    break
        if hit is not None:
            cols[fld] = hit
            used.add(hit)
    return cols


def _usable(cols: dict) -> bool:
    return "date" in cols and "description" in cols and ("amount" in cols or "debit" in cols or "credit" in cols)


def find_header(rows: list[list[str]], profile: Profile, scan: int = 60) -> tuple[int, dict[str, int]] | None:
    """Statements often start with account details; find the first row that looks like column headers."""
    for i, row in enumerate(rows[:scan]):
        if sum(1 for c in row if c.strip()) < 3:
            continue
        cols = resolve_columns(row, profile)
        if _usable(cols):
            return i, cols
    return None


def custom_profile(mapping: dict) -> Profile:
    """A profile from explicit column choices made in the import screen."""
    one = lambda k: [mapping[k]] if mapping.get(k) else []
    fmts = [mapping["date_format"]] if mapping.get("date_format") else INDIA_DATES + ["%m/%d/%Y", "%m/%d/%y"]
    return Profile("custom", one("date"), one("description"), amount=one("amount"), debit=one("debit"), credit=one("credit"),
                   dr_cr=one("dr_cr"), date_formats=fmts, negate=bool(mapping.get("negate")), status=[], label="Custom")


def _rows(text: str) -> list[list[str]]:
    text = text.lstrip("﻿")
    sample = text[:4096]
    delim = "\t" if sample.count("\t") > sample.count(",") else ("|" if sample.count("|") > sample.count(",") else ",")
    return list(csv.reader(io.StringIO(text), delimiter=delim))


def parse_csv(text: str, profile: Profile) -> tuple[list[dict], list[str]]:
    """Return (rows, errors). Each row: {date, amount, description, pending}."""
    rows, errors, _ = parse_csv_ex(text, profile)
    return rows, errors


def parse_csv_ex(text: str, profile: Profile) -> tuple[list[dict], list[str], dict]:
    table = _rows(text)
    found = find_header(table, profile)
    if not found:
        return [], ["Couldn't find the column headers. Expected columns like Date, Description/Narration and "
                    "Amount (or Withdrawal/Deposit). Choose the columns by hand instead."], {"header_row": None}
    hi, cols = found
    header = table[hi]
    out, errors, skipped = [], [], 0
    get = lambda row, f: row[cols[f]].strip() if f in cols and cols[f] < len(row) else ""
    for ln, row in enumerate(table[hi + 1:], start=hi + 2):
        if not any(c.strip() for c in row):
            continue
        date = _parse_date(get(row, "date"), profile.date_formats)
        desc = re.sub(r"\s+", " ", get(row, "description"))
        amt = None
        if "debit" in cols or "credit" in cols:
            d, _ = _parse_amount(get(row, "debit"))
            c, _ = _parse_amount(get(row, "credit"))
            if d:
                amt = -abs(d)
            elif c:
                amt = abs(c)
        if amt is None and "amount" in cols:
            a, hint = _parse_amount(get(row, "amount"))
            if a is not None:
                ind = get(row, "dr_cr").upper()
                if ind.startswith("D") or hint < 0:
                    a = -abs(a)
                elif ind.startswith("C") or hint > 0:
                    a = abs(a)
                amt = a
        if date is None:
            # Footer lines ("Opening balance", "Statement summary", page breaks) have no date: skip quietly,
            # but flag rows that look like transactions so a date-format problem isn't hidden.
            if amt and desc and _DATEISH.search(get(row, "date")):
                errors.append(f"line {ln}: unrecognised date {get(row, 'date')!r}")
            skipped += 1
            continue
        if amt is None or not desc:
            if amt is None and desc and not re.search(r"opening|closing|balance|total", desc, re.I):
                errors.append(f"line {ln}: no amount for {desc[:40]!r}")
            skipped += 1
            continue
        if profile.negate:
            amt = -amt
        status = get(row, "status").lower()
        out.append({"date": date, "amount": round(amt, 2), "description": desc, "pending": status in profile.pending_values})
    info = {"header_row": hi + 1, "headers": header, "columns": {k: header[v] for k, v in cols.items()}, "skipped": skipped}
    return out, errors, info


def inspect(text: str) -> dict:
    """What the import screen shows when it needs the user to pick columns."""
    table = _rows(text)
    profile = detect_profile(text)
    found = find_header(table, PROFILES[profile])
    if found:
        hi, cols = found
        header = table[hi]
        mapping = {k: header[v] for k, v in cols.items() if k != "status"}
    else:  # guess: the widest row near the top
        hi = max(range(min(len(table), 60)), key=lambda i: sum(1 for c in table[i] if c.strip()), default=0)
        header, mapping = (table[hi] if table else []), {}
    return {"profile": profile, "header_row": hi + 1, "headers": [h for h in header], "mapping": mapping,
            "sample": table[hi + 1: hi + 6]}


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

    columns: dict | None = None

    def as_dict(self) -> dict:
        return {"imported": self.imported, "duplicates": self.duplicates, "skipped": self.skipped,
                "errors": self.errors[:20], "transactions": self.transactions[:200], "columns": self.columns}


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
               dry_run: bool = False, mapping: dict | None = None) -> ImportResult:
    profile = custom_profile(mapping) if mapping else PROFILES.get(profile_name, PROFILES["generic"])
    rows, errors, info = parse_csv_ex(text, profile)
    res = import_rows(conn, account_id, rows, source="csv", dry_run=dry_run)
    res.errors = errors + res.errors
    res.skipped = info.get("skipped", 0)
    res.columns = info.get("columns")
    return res


INDIA_KEYS = {"india", "icici", "hdfc", "sbi", "axis", "kotak"}
INDIA_HINTS = ("narration", "withdrawalamt", "withdrawalamount", "depositamt", "depositamount", "particulars",
               "transactionremarks", "txndate", "trandate", "valuedate", "valuedt", "drcr", "chqrefno", "chqno",
               "refnochequeno", "closingbalance")


def detect_profile(text: str) -> str:
    table = _rows(text)
    # find the header row, not just line 1 (Indian statements start with account details)
    header = []
    for row in table[:60]:
        if sum(1 for c in row if c.strip()) < 3:
            continue
        norms = [_norm(c) for c in row]
        if any(n.startswith(h) for n in norms for h in INDIA_HINTS) and _usable(resolve_columns(row, PROFILES["india"])):
            return "india"
        if any(_usable(resolve_columns(row, p)) for k, p in PROFILES.items() if k not in INDIA_KEYS):
            header = row
            break
    if not header:
        return "india" if find_header(table, PROFILES["india"]) else "generic"
    joined = ",".join(c.strip().lower() for c in header)
    if "original statement" in joined:
        return "monarch"
    if "original description" in joined:
        return "mint"
    if "amount (usd)" in joined:
        return "apple_card"
    if "trans. date" in joined:
        return "discover"
    if "posting date" in joined:
        return "chase"
    if "transaction date" in joined and "debit" in joined:
        return "capital_one"
    if [c.strip().lower() for c in header] == ["date", "description", "amount"]:
        return "amex"  # Amex's bare 3-column export, charges positive
    return "generic"
