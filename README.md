# Ledger

A free, open-source, privacy-first money tracker in the spirit of Monarch Money. Connect US banks through Plaid,
import statements from any bank (including ICICI, HDFC, SBI, Axis and Kotak), and get budgets, a cash forecast,
recurring-bill detection, net worth, goals, a money checkup and plain-English insights.

**Your data stays yours.** It's encrypted in your browser with a passphrase only you know and saved to a private
folder in your own Google Drive. The people running Ledger can't read it, and neither can Google.
Ledger is publicly funded; every cost is published under **Funding & costs** ([FUNDING.md](FUNDING.md)).

## How it works

```
 Browser ──────────────────────────────────────────────────────────┐
 │  Web app (HTML/JS)                                              │
 │  Python engine (this repo's ledger/ package) running in         │
 │  Pyodide/WebAssembly in a Web Worker, on an in-memory SQLite DB │
 │  Web Crypto: AES-256-GCM, key from your passphrase              │
 └────────┬───────────────────────────────┬────────────────────────┘
          │ encrypted file                 │ Plaid calls (no secrets in the browser)
          ▼                               ▼
   Your Google Drive              Cloudflare Worker (relay/)  ──►  Plaid
   (hidden app folder)            · serves the site · adds the project's Plaid keys
                                  · checks Google sign-in and per-user limits
                                  · stores only hashed ids and counts
```

- **One engine, two ways to run it.** The same Python code and FastAPI routes run in the browser (static site) or
  as a normal server (`ledger serve`) for people who prefer to self-host.
- **Bank connections** go through Plaid via the relay, paid for by the project and capped per person.
- **Indian banks** have no free aggregator API for individuals, so Ledger reads their statement downloads
  (CSV or Excel). It finds the header row under the account preamble, understands Withdrawal/Deposit and Dr/Cr
  columns and day-first dates, and turns narrations like `UPI/DR/4123…/SWIGGY/YESB/swiggy@ybl` into "Swiggy".
  Anything unusual can be mapped column by column.

See [SECURITY.md](SECURITY.md) for exactly what is stored where and who can see it.

## Features


| Area | Features |
|---|---|
| **Accounts** | Checking, savings, credit cards, loans, investments, cash. Plaid-linked, CSV-imported or manual. Balance history per account, net worth over time, assets vs. liabilities, exclude-from-net-worth flag, archiving. |
| **Transactions** | Search and filters, inline categorization, merchant renaming, notes, tags, splits across categories, hide from reports, bulk edit, mark-as-reviewed queue, manual entries, CSV export. |
| **Auto-categorization** | 285 built-in merchant rules (US and Indian) plus the ones you create ("always categorize Trader Joe's as Groceries"). New rules apply retroactively to unreviewed transactions. Plaid's own categories are used as a fallback when no rule matches. |
| **Transfers** | Payments between your own accounts (card payoffs, savings moves, loan payments) are matched by amount and date and excluded from income/spending. |
| **Budget** | Monarch-style fixed / flexible / non-monthly groups, per-month overrides, rollover for lumpy categories (Travel, Gifts), expected income vs. planned spending ("left to budget"), and a "suggest from the last 3 months" starter. |
| **Recurring** | Detects weekly/biweekly/monthly/quarterly/yearly bills, subscriptions and income from history; shows a monthly calendar, next due dates, overdue items, monthly subscription cost. Confirm or dismiss guesses. |
| **Goals** | Save-up or pay-off goals, optionally linked to an account so progress tracks the balance. Shows required monthly contribution, ETA and on-track status. |
| **Reports** | Cash-flow sankey (income → groups → categories → saved), income vs. expenses, savings rate, spending by group/category/merchant, per-category 12-month trend, 1/3/6/12-month ranges. |
| **Investments** | Investment accounts in net worth; holdings, allocation and gain/loss pulled from Plaid where available. |
| **Insights** | Rule-based "advisor": budgets over or ahead of pace, new subscriptions, price increases on recurring charges, duplicate charges, unusually large transactions, categories trending up, low savings rate, cash shortfall vs. upcoming bills, idle cash, stale balances, uncategorized backlog. Dismissable. |
| **Safe to spend** | Checking balance minus card balances minus bills due before your next paycheck, on the dashboard. |

## Personalised


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

## Deploying (for admins)

Everything deploys as **one Cloudflare Worker** from GitHub Actions. You need accounts with Google Cloud, Cloudflare
and Plaid. Only repository admins can see the secrets.

1. **Google sign-in.** In Google Cloud Console create a project, configure the OAuth consent screen (app name, privacy
   policy URL, support email), and add the scopes `.../auth/drive.appdata`, `.../auth/userinfo.email`,
   `.../auth/userinfo.profile`. Create an OAuth client of type **Web application** and add your site's URL
   (e.g. `https://ledger.example.org`) under *Authorized JavaScript origins*. Enable the **Google Drive API**.
   These are non-sensitive scopes, so publishing needs only Google's basic brand verification.
2. **Cloudflare.** Create an API token with *Workers Scripts: Edit* and *Workers KV Storage: Edit*, and a KV namespace:
   ```
   npx wrangler kv namespace create LEDGER_KV
   ```
3. **Plaid.** Copy the client ID and secret from dashboard.plaid.com. Start with `PLAID_ENV=sandbox`; apply for
   Production when ready (for big banks such as Chase, also complete OAuth registration in the Plaid dashboard).
4. **GitHub.** In *Settings → Secrets and variables → Actions* add
   - secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, `USER_SALT` (any long random string)
   - variables: `GOOGLE_CLIENT_ID`, `CLOUDFLARE_KV_ID`, `PLAID_ENV`, `MAX_ITEMS_PER_USER`, `ADMIN_EMAILS`, `ALLOWED_EMAILS` (empty = open to everyone)
   Optionally add required reviewers to the `production` environment so deploys need an admin's approval.
5. Push to `main` (or run the **Deploy to Cloudflare** workflow). The Worker serves the site and `/relay/*`.

Usage without names or financial data is at `/relay/stats` (public) and `/relay/admin/usage` (admins).
Update `transparency.json` by pull request as money comes in and goes out.

## Developing

```
pip install -e ".[dev]"
pytest                              # Python engine
node --test tests/js/*.test.*       # relay + encryption
```

Run the static site locally, exactly as it deploys, with Google and Plaid mocked:

```
LEDGER_GOOGLE_CLIENT_ID=test-client python scripts/build_web.py
node tests/e2e/host.mjs 8799        # then open http://127.0.0.1:8799 and choose "Explore with sample data"
node tests/e2e/browser.e2e.cjs      # full end-to-end test (needs: npm i playwright)
```

Or run the classic self-hosted server, with all data in a local SQLite file:

```
ledger demo && ledger serve         # http://127.0.0.1:8765
```

### Layout

```
ledger/            Python engine: db, importer (incl. Indian banks), categorize, transfers, recurring,
                   reports, personal (forecast, checkup, …), insights, plaid, fx, api (FastAPI),
                   browser.py (runs the API inside Pyodide), webhttp.py, cli, demo
web/               index.html, app.js (UI), vault.js (Google + Drive + unlock), vault-crypto.js,
                   py-worker.js (Pyodide), styles.css
relay/src/         Cloudflare Worker: static assets + Plaid relay
scripts/           build_web.py → dist/
tests/             pytest suite, tests/js (node:test), tests/e2e (Playwright)
transparency.json  public funding & costs
```

## License

[MIT](LICENSE).
