"""Merchant cleanup and rules-based auto-categorisation."""
from __future__ import annotations

import re
import sqlite3

_US_STATES = {"AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"}
_ACRONYMS = {"PG&E","CVS","UPS","USPS","IRS","DMV","ATM","AT&T","H-E-B","AMC","HBO","BART","MTA","IKEA","GEICO","NYT","DTE","SMUD","LADWP","HOA","ETF","IRA","401K"}
_NOISE = [
    r"\b(sq|tst|sp|py|ap|pp|dd|ic|www)\s*\*\s*",                 # processor prefixes: SQ *, TST*, PP*
    r"\b(pos|debit|credit|purchase|card|chk|ach|web|online|recurring|pymt|payment|authorized|auth|bill|mkt|inc|llc|corp)\b",
    r"\b\d{3}[-.]\d{3}[-.]\d{4}\b",                            # phone numbers
    r"\b\d{2}/\d{2}(/\d{2,4})?\b",                             # dates
    r"\.(com|net|org|co)\b(/\S*)?",                              # domains
    r"\b[a-z]{2}\s*\d{5}(-\d{4})?\b",                          # state + zip
    r"#\s*\d+", r"\*\s*(?=[a-z0-9]*\d)[a-z0-9]+",             # store / reference numbers (must contain a digit)
    r"\b(?=[a-z0-9]*\d)[a-z0-9]{6,}\b",                           # long alphanumeric reference ids
    r"\b\d{3,}\b",                                                # standalone numbers
    r"\bx{3,}\d*\b",                                              # masked card numbers
]
_NOISE_RE = [re.compile(p, re.I) for p in _NOISE]


# ---- Indian bank narrations -------------------------------------------------------------
_IN_START = re.compile(r"^\s*(UPI|NEFT|IMPS|RTGS|ATW|NWD|EAW|ATM|POS|ACH|NACH|ECS|MMT|INF|BIL|TO TRANSFER|BY TRANSFER|BY CLG|TRF|INB|MB|CMS)\b", re.I)
_IN_DROP = {"UPI", "DR", "CR", "P2A", "P2M", "NEFT", "IMPS", "RTGS", "MMT", "INF", "INB", "BIL", "ONL", "TRF", "TO", "BY", "FROM",
            "TRANSFER", "PAYMENT", "PAY", "PAID", "NA", "UPIINTENT", "COLLECT", "REQUEST", "MB", "IB", "CMS", "ACH", "NACH", "ECS",
            "D", "C", "CLG", "SENT", "RECEIVED", "REF", "REFNO", "TXN", "SBIN", "HDFC", "ICIC", "UTIB", "KKBK", "YESB", "PUNB",
            "BARB", "CNRB", "IDIB", "IOBA", "UBIN", "INDB", "FDRL", "IDFB", "PYTM", "AIRP", "JIOP", "PAYTM", "OK", "NO"}
_IN_SUFFIX = re.compile(r"\b(PRIVATE|PVT|LIMITED|LTD|TECHNOLOGIES|TECHNOLOGY|SERVICES|SOLUTIONS|INDIA|RETAIL|PAYMENTS|COMMERCE)\b\.?", re.I)


_BANK_PREFIX = re.compile(r"^\s*(TO|BY)\s+TRANSFER\s*-\s*(?=UPI|IMPS|NEFT|RTGS)", re.I)


def clean_indian_narration(description: str) -> str | None:
    """'UPI/DR/412345678901/SWIGGY LIMITED/YESB/swiggy@ybl/Payment' -> 'Swiggy'.
    'NEFT CR-ICIC0000104-ACME TECHNOLOGIES PVT LTD-SALARY' -> 'Acme'. Returns None if not an Indian narration."""
    if not _IN_START.match(description or ""):
        return None
    up = description.upper()
    if re.match(r"^\s*(ATW|NWD|EAW|ATM)\b", up) or "ATM WDL" in up or "CASH WDL" in up:
        return "ATM withdrawal"
    tokens = [t.strip(" .:") for t in re.split(r"[/\-|:*]+", description) if t.strip(" .:")]
    for t in tokens:
        tu = t.upper().replace(" ", "")
        if tu in _IN_DROP or "@" in t or all(w in _IN_DROP for w in t.upper().split()):
            continue
        if re.fullmatch(r"[A-Z]{4}0[A-Z0-9]{6}", tu):      # IFSC code
            continue
        if re.fullmatch(r"[A-Z]*\d[\dA-Z]*", tu) and sum(ch.isdigit() for ch in tu) >= 4:  # refs, card / account numbers
            continue
        if len(re.sub(r"[^A-Za-z]", "", t)) < 3:
            continue
        name = _IN_SUFFIX.sub(" ", t)
        name = re.sub(r"\s+", " ", name).strip()
        if len(name) < 3:
            continue
        return " ".join(w if w.upper() in _ACRONYMS else w.title() for w in name.split()[:4])
    vpa = next((t for t in tokens if "@" in t), None)  # fall back to the UPI ID, e.g. 'rahul.k@okhdfcbank'
    return vpa.split("@")[0].replace(".", " ").title() if vpa else None


def clean_merchant(description: str) -> str:
    """Turn 'SQ *BLUE BOTTLE COFFEE 0423 SAN FRANCISCO CA 94110' into 'Blue Bottle Coffee'."""
    indian = clean_indian_narration(description)
    if indian:
        return indian
    s = description
    for rx in _NOISE_RE:
        s = rx.sub(" ", s)
    s = re.sub(r"[^\w&'.\- ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" -.")
    if not s:
        s = description.strip()
    words = s.split(" ")
    out = []
    for w in words[:5]:
        if w.upper() in _US_STATES and len(out) >= 1:
            break  # a state code marks the start of the location suffix
        out.append(w if w.upper() in _ACRONYMS else w.title())
    return " ".join(out) or description.strip()


def merchant_key(merchant: str) -> str:
    """Normalised key used to group the same merchant across transactions."""
    return re.sub(r"[^a-z0-9]", "", merchant.lower())[:24]


class Categorizer:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.reload()

    def reload(self) -> None:
        rows = self.conn.execute(
            "SELECT id, pattern, is_regex, category_id, rename_to, priority FROM rules "
            "ORDER BY priority ASC, length(pattern) DESC, id ASC"
        ).fetchall()
        self.rules = []
        for r in rows:
            rx = re.compile(r["pattern"], re.I) if r["is_regex"] else None
            self.rules.append((r, rx))
        self.uncategorized_id = self.conn.execute(
            "SELECT id FROM categories WHERE name='Uncategorized'"
        ).fetchone()[0]

    def match(self, description: str, merchant: str) -> tuple[int | None, str | None, int | None]:
        """Return (category_id, rename_to, rule_id) for the highest-priority matching rule."""
        # SBI prefixes every UPI debit/credit with 'TO TRANSFER-' / 'BY TRANSFER-'; that's not a transfer.
        description = _BANK_PREFIX.sub("", description or "")
        hay = f"{description} || {merchant}".lower()
        for r, rx in self.rules:
            hit = rx.search(hay) if rx else (r["pattern"].lower() in hay)
            if hit:
                return r["category_id"], (r["rename_to"] or None), r["id"]
        return None, None, None

    def categorize(self, description: str, merchant: str | None = None) -> tuple[int, str]:
        merchant = merchant or clean_merchant(description)
        cat, rename, _ = self.match(description, merchant)
        return (cat if cat is not None else self.uncategorized_id), (rename or merchant)

    def apply_to_uncategorized(self, only_unreviewed: bool = True) -> int:
        """Re-run rules over transactions that are still Uncategorized. Returns count updated."""
        where = "category_id IS NULL OR category_id = ?"
        if only_unreviewed:
            where = f"({where}) AND reviewed = 0"
        rows = self.conn.execute(
            f"SELECT id, description, merchant FROM transactions WHERE {where}", (self.uncategorized_id,)
        ).fetchall()
        n = 0
        for r in rows:
            cat, rename, _ = self.match(r["description"], r["merchant"])
            if cat is not None:
                self.conn.execute(
                    "UPDATE transactions SET category_id=?, merchant=? WHERE id=?",
                    (cat, rename or r["merchant"], r["id"]),
                )
                n += 1
        self.conn.commit()
        return n

    def apply_rule_retroactively(self, rule_id: int) -> int:
        """Apply one rule to all matching non-reviewed transactions (used when a user creates a rule)."""
        r = self.conn.execute("SELECT * FROM rules WHERE id=?", (rule_id,)).fetchone()
        if not r:
            return 0
        rx = re.compile(r["pattern"], re.I) if r["is_regex"] else None
        rows = self.conn.execute(
            "SELECT id, description, merchant FROM transactions WHERE reviewed = 0"
        ).fetchall()
        n = 0
        for t in rows:
            hay = f"{t['description']} || {t['merchant']}".lower()
            if (rx.search(hay) if rx else r["pattern"].lower() in hay):
                self.conn.execute(
                    "UPDATE transactions SET category_id=?, merchant=? WHERE id=?",
                    (r["category_id"], r["rename_to"] or t["merchant"], t["id"]),
                )
                n += 1
        self.conn.commit()
        return n
