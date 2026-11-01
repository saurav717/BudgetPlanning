# Security and privacy

Ledger handles people's financial data, so this file spells out exactly where that data goes and who can see it.

## Where data lives

| Data | Where | Who can read it |
|---|---|---|
| Transactions, balances, budgets, goals, profile | One SQLite file, encrypted in the browser, stored in the user's own Google Drive (hidden app folder) | Only the user (needs their passphrase or recovery key) |
| Plaid access tokens for the user's banks | Inside that same encrypted file | Only the user |
| Hashed user id → hashed access token, connection counts | Cloudflare Workers KV | Admins (no names, emails or financial data) |
| Project Plaid keys | Cloudflare Worker secrets, GitHub Actions secrets | Repository admins |
| Funding and costs | `transparency.json` in this repository | Everyone |

## Encryption

- A random 256-bit data key encrypts the database with AES-256-GCM (fresh IV on every save, authenticated).
- The data key is wrapped twice: with a key derived from the passphrase (PBKDF2-SHA256, 600,000 iterations)
  and with a 160-bit recovery key shown once at setup. Either unlocks the vault.
- Everything happens in the browser with the Web Crypto API. The passphrase, recovery key and data key never
  leave the device. Google stores only ciphertext.
- Lost passphrase and recovery key means lost data. There is no reset, by design.

## What the relay (Cloudflare Worker) sees

- The relay exists because Plaid requires a secret key that can't be put in a browser.
- During a bank sync, Plaid's response (transactions, balances) passes **through** the relay in memory on its way
  to the user's browser. The relay does not store or log it. Anyone auditing a deployment can read
  `relay/src/index.js`, which is what runs.
- Only a fixed list of Plaid endpoints is forwarded. Each call needs a Google sign-in issued to this app. The relay
  sets the Plaid user id itself and checks that every access token belongs to the caller.
- Each person can link at most `MAX_ITEMS_PER_USER` banks, which bounds what any one account can cost the project.

## Google permissions

The app asks for `drive.appdata` (a private folder only this app can see; it cannot see any other Drive files),
plus the user's email and name. `drive.appdata` is a non-sensitive scope in Google's classification.

## Statement import

CSV and Excel files are read in the browser. They are not uploaded anywhere.

## Reporting a vulnerability

Please open a private report through GitHub's **Security → Report a vulnerability** on this repository rather
than a public issue. Admins will acknowledge it and coordinate a fix before disclosure.
