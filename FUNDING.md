# Funding

Ledger is free to use and publicly funded. The only real running cost is **Plaid**, which charges per connected bank
account per month; hosting runs on Cloudflare's free tier, and Indian bank statement import costs nothing.

- Every donation and every expense is recorded in [`transparency.json`](transparency.json) and shown in the app under
  **Funding & costs**, next to the live number of connected banks from the relay's public `/relay/stats` endpoint.
- Changes to `transparency.json` go through pull requests, so the history is public and reviewable.
- Admins hold the Plaid and Cloudflare accounts and the GitHub secrets that deploy them. They're listed in
  `transparency.json` under `admins`.
- The per-person connection limit (`MAX_ITEMS_PER_USER`) keeps costs predictable. If funds run low, admins can lower it
  or switch the relay to invite-only (`ALLOWED_EMAILS`); statement import keeps working for everyone.

To donate, use the links on the Funding & costs page or the Sponsor button on the repository
(configure handles in `.github/FUNDING.yml`).
