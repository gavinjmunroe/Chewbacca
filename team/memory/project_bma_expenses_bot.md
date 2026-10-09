---
name: project_bma_expenses_bot
description: "BMA Expenses Slack bot Archisha requested, reimbursement workflow (request/approve/Rho payout/Sheets), built and pushed to amber-organization"
metadata:
  node_type: memory
  type: project
  originSessionId: 551310d7-ba18-4b1b-af6a-2a07baedca9e
---

Archisha Sharma asked Caleb (6/3) to build a Slack bot automating BMA's reimbursement workflow: employee/client submits a request with receipt screenshots in Slack → Sagar/Karthik approve → payout from Rho checking → recorded in a Google Sheet for accounting/taxes.

**Key constraint:** Rho has NO public API to send ACH/wire to a person (only virtual-card issuing + vendor-onboarding APIs; real payouts go through the dashboard or a bulk-CSV upload). So payout is **bot-prepped, human-confirmed**: the bot generates a Rho bulk-transfer CSV and DMs the approver a "Mark paid" button; a human does the final send in Rho.

**Locked decisions:** in-Slack Approve/Reject buttons (not email); recipient bank details stay as pre-registered Rho contacts (referenced by name, never collected in Slack).

**Stack:** Node + @slack/bolt (TS), Supabase (state machine pending/approved/rejected/paid, idempotent status-guarded transitions), Google Sheets via googleapis (accounting ledger), receipts archived to Supabase Storage. Deploy target Railway.

**Repo:** github.com/amber-organization/bma-expenses-bot (private). Builds + typechecks clean as of first commit. NOT yet wired live, still needs: Slack app + tokens, Supabase project + migration (`supabase/migrations/0001_reimbursements.sql`) + `receipts` bucket, Google service account + sheet share, real PAYEES filled into `src/config.ts`, and APPROVER_SLACK_IDS. See README for setup. Plan: ~/.claude/plans/magical-wibbling-sedgewick.md.

Related: [[project_amber_vision]], a private note, [[feedback_readme_footer_org_exception]] (this is an amber-org repo so NO glory footer).
