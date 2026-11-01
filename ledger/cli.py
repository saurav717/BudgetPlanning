"""Command line interface: `ledger --help`."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from . import db, importer, plaid, recurring, reports, insights, demo
from .categorize import Categorizer
from .transfers import match_transfers


def _conn(args):
    return db.connect(args.db)


def cmd_init(args):
    c = _conn(args)
    print(f"Database ready at {args.db or db.DEFAULT_DB}")
    print(f"{c.execute('SELECT COUNT(*) FROM categories').fetchone()[0]} categories, "
          f"{c.execute('SELECT COUNT(*) FROM rules').fetchone()[0]} rules")


def cmd_demo(args):
    path = Path(args.db or db.DEFAULT_DB)
    if path.exists() and not args.force:
        sys.exit(f"{path} already exists; pass --force to add demo data to it anyway.")
    c = _conn(args)
    r = demo.seed(c)
    print(f"Seeded {r['accounts']} accounts, {r['transactions']} transactions, {r['transfer_pairs']} transfer pairs.")
    print("Run `ledger serve` and open http://127.0.0.1:8765")


def cmd_serve(args):
    import uvicorn
    if args.db:
        os.environ["LEDGER_DB"] = args.db
    print(f"Ledger running at http://{args.host}:{args.port}  (db: {args.db or db.DEFAULT_DB})")
    uvicorn.run("ledger.api:app", host=args.host, port=args.port, reload=args.reload)


def cmd_accounts(args):
    c = _conn(args)
    if args.add:
        name, type_ = args.add
        c.execute("INSERT INTO accounts (name, type, institution) VALUES (?,?,?)", (name, type_, args.institution or ""))
        c.commit()
    for a in reports.account_balances(c):
        flag = " (archived)" if a["archived"] else ""
        print(f"{a['id']:>3}  {a['name']:<34} {a['type']:<11} {a['balance']:>12,.2f}  {a['tx_count']} tx{flag}")
    nw = reports.net_worth(c)
    print(f"\nNet worth: {nw['net_worth']:,.2f}  (assets {nw['assets']:,.2f}, liabilities {nw['liabilities']:,.2f})")


def cmd_balance(args):
    c = _conn(args)
    acct = c.execute("SELECT type FROM accounts WHERE id=?", (args.account_id,)).fetchone()
    if not acct:
        sys.exit("No such account")
    bal = -abs(args.amount) if acct["type"] in reports.LIABILITY_TYPES else args.amount
    from datetime import date
    c.execute("INSERT OR REPLACE INTO balance_snapshots (account_id, date, balance) VALUES (?,?,?)",
              (args.account_id, args.date or date.today().isoformat(), bal))
    c.commit()
    print("ok")


def cmd_import(args):
    c = _conn(args)
    text = Path(args.file).read_text(encoding="utf-8-sig")
    profile = args.profile if args.profile != "auto" else importer.detect_profile(text)
    res = importer.import_csv(c, args.account_id, text, profile, dry_run=args.dry_run)
    pairs = 0 if args.dry_run else match_transfers(c)
    print(f"profile={profile} imported={res.imported} duplicates={res.duplicates} transfer_pairs={pairs}")
    for e in res.errors[:10]:
        print("  !", e)
    if args.dry_run:
        for t in res.transactions[:25]:
            print(f"  {t['date']} {t['amount']:>10,.2f}  {t['merchant']:<28} {t['description'][:40]}")


def cmd_categorize(args):
    c = _conn(args)
    n = Categorizer(c).apply_to_uncategorized()
    print(f"categorized {n} transactions; matched {match_transfers(c)} transfer pairs")


def cmd_report(args):
    c = _conn(args)
    month = args.month or reports.this_month()
    if args.kind == "budget":
        bs = reports.budget_status(c, month)
        print(f"Budget for {month}  (income {bs['summary']['expected_income']:,.0f}, planned {bs['summary']['planned_spending']:,.0f}, "
              f"left to budget {bs['summary']['left_to_budget']:,.0f})")
        for r in bs["rows"]:
            if r["kind"] != "expense":
                continue
            b = f"{r['available']:>9,.0f}" if r["has_budget"] else "        -"
            bar = ""
            if r["pct"] is not None:
                filled = min(20, int(r["pct"] * 20))
                bar = "[" + "#" * filled + "." * (20 - filled) + "]"
            print(f"  {r['category']:<30} {r['actual']:>9,.0f} / {b}  {bar}")
    elif args.kind == "cashflow":
        for r in reports.cashflow(c, args.months):
            sr = f"{r['savings_rate']:.0%}" if r["savings_rate"] is not None else "-"
            print(f"  {r['month']}  in {r['income']:>10,.0f}  out {r['expenses']:>10,.0f}  saved {r['savings']:>9,.0f}  ({sr})")
    elif args.kind == "spending":
        s, e = reports.month_bounds(month)
        for g in reports.spending_by_group(c, s, e):
            print(f"  {g['group']:<16} {g['spent']:>10,.2f}")
            for cat in g["categories"]:
                print(f"      {cat['category']:<28} {cat['spent']:>10,.2f}  ({cat['count']})")
    elif args.kind == "networth":
        for r in reports.net_worth_history(c, args.months):
            print(f"  {r['month']}  {r['net_worth']:>12,.0f}   assets {r['assets']:>12,.0f}  liabilities {r['liabilities']:>12,.0f}")
    elif args.kind == "recurring":
        for r in recurring.detect_recurring(c):
            print(f"  {r['next_date']}  {r['amount']:>9,.2f}  {r['cadence']:<9} {r['merchant']:<28} ({r['occurrences']}x, {r['status']})")
    elif args.kind == "insights":
        for i in insights.generate(c):
            print(f"  [{i['severity']}] {i['title']}\n      {i['body']}")


def cmd_plaid(args):
    c = _conn(args)
    client = plaid.PlaidClient()
    if not client.configured:
        sys.exit("Set PLAID_CLIENT_ID and PLAID_SECRET (and PLAID_ENV=sandbox|production).")
    if args.action == "sync":
        for r in plaid.sync_all(c, client):
            print(json.dumps(r))
        print(f"matched {match_transfers(c)} transfer pairs")
    elif args.action == "sandbox-link":
        pt = client.sandbox_public_token(args.institution)["public_token"]
        r = plaid.link_item(c, client, pt)
        print(json.dumps(r, indent=2))
        print(json.dumps(plaid.sync_item(c, client, r["item_id"])))
    elif args.action == "items":
        for r in c.execute("SELECT id, institution_name, last_synced_at, last_error FROM plaid_items"):
            print(dict(r))


def main(argv=None):
    p = argparse.ArgumentParser(prog="ledger", description="Self-hosted personal finance tracker")
    p.add_argument("--db", help=f"SQLite file (default {db.DEFAULT_DB} or $LEDGER_DB)", default=os.environ.get("LEDGER_DB"))
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init", help="create the database").set_defaults(fn=cmd_init)
    d = sub.add_parser("demo", help="seed a year of sample data"); d.add_argument("--force", action="store_true"); d.set_defaults(fn=cmd_demo)
    s = sub.add_parser("serve", help="start the web app"); s.add_argument("--host", default="127.0.0.1"); s.add_argument("--port", type=int, default=8765)
    s.add_argument("--reload", action="store_true"); s.set_defaults(fn=cmd_serve)
    a = sub.add_parser("accounts", help="list accounts / add one"); a.add_argument("--add", nargs=2, metavar=("NAME", "TYPE"))
    a.add_argument("--institution"); a.set_defaults(fn=cmd_accounts)
    b = sub.add_parser("balance", help="record an account balance"); b.add_argument("account_id", type=int); b.add_argument("amount", type=float)
    b.add_argument("--date"); b.set_defaults(fn=cmd_balance)
    i = sub.add_parser("import", help="import a bank CSV"); i.add_argument("account_id", type=int); i.add_argument("file")
    i.add_argument("--profile", default="auto", choices=["auto", *importer.PROFILES]); i.add_argument("--dry-run", action="store_true"); i.set_defaults(fn=cmd_import)
    sub.add_parser("categorize", help="re-run rules on uncategorized transactions").set_defaults(fn=cmd_categorize)
    r = sub.add_parser("report", help="print a report"); r.add_argument("kind", choices=["budget", "cashflow", "spending", "networth", "recurring", "insights"])
    r.add_argument("--month"); r.add_argument("--months", type=int, default=12); r.set_defaults(fn=cmd_report)
    pl = sub.add_parser("plaid", help="Plaid sync"); pl.add_argument("action", choices=["sync", "sandbox-link", "items"])
    pl.add_argument("--institution", default="ins_109508"); pl.set_defaults(fn=cmd_plaid)
    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
