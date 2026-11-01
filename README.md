# Ledger

A self-hosted personal finance tracker in the spirit of Monarch Money: connect your bank accounts
(Plaid) or import CSVs, and get auto-categorized transactions, budgets, recurring-bill detection,
net worth tracking, goals, cash-flow reports and plain-English insights. Your data stays in one
SQLite file on your machine.

```
pip install -e .          # or: pip install -r requirements.txt
ledger demo               # seed 14 months of realistic sample data, incl. an INR account and transfers home (optional)
ledger serve              # open http://127.0.0.1:8765
```

## Made around you

The first time you open Ledger it asks a few questions: your name, your main currency and a second one you care
about (say, INR), how often you're paid, the cash cushion you never want to dip below, your emergency-fund and
savings-rate targets, and what you're working on (emergency fund, paying off debt, spending less, maxing out
retirement accounts, sending money home, saving for something big, growing net worth). Everything below adapts to
those answers, and you can change them any time in **Settings → Profile**.

- **Daily briefing.** The dashboard opens with a few plain-English lines: how this month's spending compares with
  the same point last month, when your next paycheck lands and which bills are due first, whether cash will dip
  below your cushion, how much you've sent home, and how your top goal is doing.
- **A dashboard arranged by your priorities.** Sixteen widgets; the ones that match your priorities come first and
  irrelevant ones are hidden. **Customize** lets you show, hide and reorder them, and rows always pack edge to edge.
- **Cash forecast.** Projects spendable cash (checking and cash minus card balances) day by day for 30, 60 or 90
  days using detected paychecks, bills, scheduled transfers and your typical everyday spending, and warns before you
  cross your cushion.
- **Money checkup.** A 0–100 score built from emergency-fund months, savings rate, credit utilisation, debt
  payments vs. income, budget discipline and retirement pace, each with a target, a status and specific advice.
- **Money home.** Tracks transfers abroad (Wise, Remitly, Western Union, Xoom, Remit2India and others), split
  between family support (counted as spending) and transfers to your own accounts (kept in net worth), shown in both
  currencies with an editable exchange rate.
- **Multi-currency.** Accounts can be held in any currency. Totals, net worth and reports convert to your main
  currency; INR amounts use Indian digit grouping (₹8,37,026). Rates refresh from ECB reference rates or can be set by hand.
- **Retirement contribution limits.** Mark accounts as 401(k), Roth 401(k), 403(b), IRA, Roth IRA or HSA to see
  how much room is left this year, whether you're on pace, and how much per paycheck maxes it out. Employer match
  doesn't count toward your limit. 2026 limits are built in and editable.
- **Credit utilisation** per card and overall, with the 10% and 30% thresholds that matter for your credit score.
- **Spending pace and daily heatmap.** Cumulative spending this month vs. last month vs. your budget, and a
  calendar heatmap of daily spending.

The interface has light and dark themes (follows your system, with a toggle), works on a phone, and needs no build step.

## What it does

| Area | Features |
|---|---|
| **Accounts** | Checking, savings, credit cards, loans, investments, cash. Plaid-linked, CSV-imported or manual. Balance history per account, net worth over time, assets vs. liabilities, exclude-from-net-worth flag, archiving. |
| **Transactions** | Search and filters, inline categorization, merchant renaming, notes, tags, splits across categories, hide from reports, bulk edit, mark-as-reviewed queue, manual entries, CSV export. |
| **Auto-categorization** | 140 built-in merchant rules plus the ones you create ("always categorize Trader Joe's as Groceries"). New rules apply retroactively to unreviewed transactions. Plaid's own categories are used as a fallback when no rule matches. |
| **Transfers** | Payments between your own accounts (card payoffs, savings moves, loan payments) are matched by amount and date and excluded from income/spending. |
| **Budget** | Monarch-style fixed / flexible / non-monthly groups, per-month overrides, rollover for lumpy categories (Travel, Gifts), expected income vs. planned spending ("left to budget"), and a "suggest from the last 3 months" starter. |
| **Recurring** | Detects weekly/biweekly/monthly/quarterly/yearly bills, subscriptions and income from history; shows a monthly calendar, next due dates, overdue items, monthly subscription cost. Confirm or dismiss guesses. |
| **Goals** | Save-up or pay-off goals, optionally linked to an account so progress tracks the balance. Shows required monthly contribution, ETA and on-track status. |
| **Reports** | Cash-flow sankey (income → groups → categories → saved), income vs. expenses, savings rate, spending by group/category/merchant, per-category 12-month trend, 1/3/6/12-month ranges. |
| **Investments** | Investment accounts in net worth; holdings, allocation and gain/loss pulled from Plaid where available. |
| **Insights** | Rule-based "advisor": budgets over or ahead of pace, new subscriptions, price increases on recurring charges, duplicate charges, unusually large transactions, categories trending up, low savings rate, cash shortfall vs. upcoming bills, idle cash, stale balances, uncategorized backlog. Dismissable. |
| **Safe to spend** | Checking balance minus card balances minus bills due before your next paycheck, on the dashboard. |

### Design choices that differ from Monarch

- **Local-first.** One SQLite file (`~/.ledger/ledger.db` by default, or `LEDGER_DB=...`). Back it up with `cp`.
- **Your edits win.** Once you touch a transaction it is marked reviewed and a later bank sync will not overwrite your category, merchant name or notes.
- **Rules are first-class.** Every manual categorization offers to become a rule, and rules are visible and editable in Settings.
- **Transfers are matched across accounts**, not just guessed from description text, so card payoffs never show up as "spending."
- **Insights say what to do**, not just what happened, and each one links to the screen where you can act.
- **No account required, no telemetry, no AI calls.** The insights engine is deterministic and explainable.

## Connecting banks with Plaid

1. Create a free Plaid account at <https://dashboard.plaid.com/signup>. Sandbox keys work immediately; production
   access requires a short application (Plaid's "Limited Production" tier gives you a handful of live Items for free).
2. Start the server with your keys:
   ```
   PLAID_CLIENT_ID=... PLAID_SECRET=... PLAID_ENV=sandbox ledger serve
   ```
   (`PLAID_ENV=production` once approved.)
3. In the app go to **Accounts → Connect a bank** (or **Settings**). Plaid Link opens in the browser; after you log in,
   the item is stored, accounts are created and transactions are synced using Plaid's cursor-based `/transactions/sync`.
4. Click **Sync** (sidebar) any time, or schedule it:
   ```
   ledger plaid sync     # e.g. from cron, every few hours
   ```
   Pending transactions are updated in place when they post; removed transactions are deleted unless you've edited them.
   If a bank requires re-authentication the item shows an error in Settings with a **Re-authenticate** button.

In the sandbox you can skip Link entirely: **Settings → Add sandbox test bank** or `ledger plaid sandbox-link`.

Plaid's access tokens are stored in the local database. Treat the `.db` file like a password file.

## Importing CSVs

Every bank lets you download transactions as CSV. In **Settings → Import a CSV**, pick the account and drop the file;
the format is auto-detected (Chase, Amex, Capital One, Bank of America, Wells Fargo, Citi, Discover, Apple Card, Mint
and Monarch exports, plus a generic Date/Description/Amount or Debit/Credit layout). Re-importing overlapping date
ranges is safe: duplicates are skipped by a hash of (account, date, amount, description).

```
ledger accounts --add "Everyday Checking" checking
ledger import 1 sample_data/chase_checking.csv --dry-run   # preview
ledger import 1 sample_data/chase_checking.csv
ledger balance 1 6200
```

Migrating from Monarch: export transactions from Monarch (Settings → Data → Download) and import the CSV with the
`monarch` profile; your Monarch merchant names are preserved.

## CLI

```
ledger init                         create the database
ledger demo [--force]               seed sample data
ledger serve [--port 8765]          web app
ledger accounts [--add NAME TYPE]   list / add accounts, show net worth
ledger balance ID AMOUNT [--date]   record a balance (enter what you owe for cards/loans)
ledger import ID FILE [--profile]   import a CSV
ledger categorize                   re-run rules on uncategorized rows + match transfers
ledger report budget|cashflow|spending|networth|recurring|insights [--month YYYY-MM] [--months N]
ledger plaid sync|sandbox-link|items
```

## HTTP API

The web app is a thin client over a JSON API (FastAPI; interactive docs at `/docs`). Useful if you want to script
things: `GET /api/overview`, `/api/transactions`, `/api/budgets`, `/api/recurring`, `/api/insights`,
`/api/reports/sankey`, `/api/export/transactions.csv`, `POST /api/import`, `POST /api/plaid/sync`.

## Layout

```
ledger/
  db.py          schema, default categories and rules
  importer.py    CSV profiles, parsing, dedupe
  categorize.py  merchant cleanup + rules engine
  transfers.py   cross-account transfer matching
  recurring.py   recurring detection
  reports.py     net worth, cash flow, spending, budgets, safe-to-spend
  personal.py    profile, dashboard layout, forecast, checkup, pace, remittances, retirement, briefing
  fx.py          exchange rates and currency formatting
  insights.py    advisor rules
  plaid.py       Plaid REST client + sync
  api.py         FastAPI app
  cli.py         command line
  demo.py        sample data generator
web/             index.html, app.js, styles.css (no build step)
tests/           pytest suite (run: pytest)
sample_data/     example bank CSVs
```

## Conventions

- Transaction amounts are signed from your point of view: positive = money in, negative = money out, regardless of
  how the bank's CSV expresses it.
- Account balances are signed for net worth: liabilities (credit, loan) are stored negative. The UI and CLI accept
  "what you owe" as a positive number and flip it for you.
- Months are `YYYY-MM`; a budget with `month = NULL` is the default for every month and a dated row overrides it.

## Running tests

```
pip install -e ".[dev]"
pytest
```
