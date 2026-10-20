# BMA Expenses Bot

A Slack bot that runs Blue Modern Advisory's reimbursement workflow end to end:

1. **Request** — anyone runs `/reimburse`, fills a short modal (payee, amount, what it was for), and attaches receipt screenshots.
2. **Approve** — an approval card lands in `#bma-approvals` with the receipts and **Approve / Reject** buttons. Only Sagar and Karthik can act on it.
3. **Payout** — on approval, the bot DMs the approver a Rho-ready bulk-transfer CSV plus a **Mark paid** button. The actual money movement is a one-click send inside Rho (see "Why payout is human-confirmed" below).
4. **Record** — every approved request is appended to the accounting Google Sheet, and the row is updated to "paid" when the payout is confirmed.

## Why payout is human-confirmed

Rho does not expose a public API to send an ACH or wire to a person. Its public APIs cover only virtual-card issuing and vendor onboarding; real payouts are initiated through the Rho dashboard or a bulk-CSV transfer upload. So the bot does everything up to and including generating the exact payment, and a human makes the final "send money" click in Rho. This keeps a person on the money-movement step and avoids fragile, terms-violating browser automation. If Rho grants a private payout API later, swap `src/payout/rhoCsv.ts` for an API call and the Mark-paid step becomes automatic.

## Architecture

```
/reimburse (modal)  ->  Bolt app  ->  Supabase (state machine: pending/approved/rejected/paid)
                                  ->  receipts archived to Supabase Storage
                                  ->  approval card to #bma-approvals
Approve  ->  Google Sheet row appended  ->  approver DM: Rho CSV + Mark paid
Mark paid ->  Sheet row updated to paid
```

State lives in Supabase and is the single source of truth. Approve, reject, and mark-paid each use a status-guarded update so a double tap can never double-pay (see `transitionFromPending` / `markPaid` in `src/db/client.js`).

## Setup

### 1. Create the Slack app

At [api.slack.com/apps](https://api.slack.com/apps), create an app (from scratch). Then:

- **Slash command:** add `/reimburse` (request URL only needed in HTTP mode).
- **Interactivity:** enable it (request URL only needed in HTTP mode).
- **Bot token scopes:** `commands`, `chat:write`, `users:read`, `files:read`, `im:write`.
- **Socket Mode:** enable for local dev and create an app-level token with `connections:write`.
- Install to the workspace and copy the Bot User OAuth Token (`xoxb-`), Signing Secret, and App Token (`xapp-`).
- Invite the bot to your approvals channel and copy that channel's ID.

### 2. Supabase

- Run the migration in `supabase/migrations/0001_reimbursements.sql`.
- Create a **private** storage bucket named `receipts` (or set `SUPABASE_RECEIPTS_BUCKET`).
- Copy the project URL and the service-role key.

### 3. Google Sheet

- Create a Google Cloud service account, enable the Sheets API, download its JSON key.
- Share Archisha's accounting sheet with the service account's email (Editor).
- Set `GOOGLE_SHEET_ID`, the tab name, and either `GOOGLE_SERVICE_ACCOUNT_JSON` (the JSON as one line) or `GOOGLE_APPLICATION_CREDENTIALS` (path to the key file).

### 4. Payees and approvers

- Add each employee/client to `src/config.ts` as a `Payee`, with `rhoName` matching their Rho contact display name exactly.
- Set `APPROVER_SLACK_IDS` to Sagar's and Karthik's Slack user IDs.

### 5. Run

```bash
cp .env.example .env   # fill it in
npm install
npm run dev            # Socket Mode, no public URL needed
```

## Deploy (Railway)

Push to GitHub, create a Railway service from the repo, set every var from `.env.example` in the Railway dashboard, and set `SLACK_SOCKET_MODE=false` for production HTTP events (point Slack's request URLs at the Railway domain). Railway auto-deploys on push to main.

## Verify end to end

1. `/reimburse`, submit a test request: confirm a `pending` row in Supabase and a card in the approvals channel.
2. Approve as a non-approver: blocked. Approve as an approver: status `approved`, a new Sheet row, and a DM with the Rho CSV + Mark paid.
3. Reject: status `rejected`, requester notified, no Sheet row.
4. Mark paid: status `paid`, Sheet row updated. Re-tap any button: no double action.
