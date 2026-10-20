import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";
import { env } from "../env.js";
import type { Reimbursement } from "../db/types.js";
import { formatCents } from "../lib/money.js";

const HEADERS = [
  "Request ID",
  "Date submitted",
  "Requester",
  "Pay to (Rho)",
  "Amount",
  "Currency",
  "Memo",
  "Status",
  "Approved by",
  "Approved at",
  "Paid at",
  "Receipts",
];

let cachedSheets: sheets_v4.Sheets | null = null;

function getAuth() {
  const scopes = ["https://www.googleapis.com/auth/spreadsheets"];
  if (env.sheets.serviceAccountJson) {
    const creds = JSON.parse(env.sheets.serviceAccountJson);
    return new google.auth.GoogleAuth({ credentials: creds, scopes });
  }
  // Falls back to GOOGLE_APPLICATION_CREDENTIALS path on disk.
  return new google.auth.GoogleAuth({ scopes });
}

async function client(): Promise<sheets_v4.Sheets> {
  if (cachedSheets) return cachedSheets;
  const auth = getAuth();
  cachedSheets = google.sheets({
    version: "v4",
    auth: (await auth.getClient()) as never,
  });
  return cachedSheets;
}

async function ensureHeaderRow(sheets: sheets_v4.Sheets): Promise<void> {
  const range = `${env.sheets.tab}!A1:L1`;
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId: env.sheets.sheetId,
    range,
  });
  if (!current.data.values?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: env.sheets.sheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
  }
}

function rowValues(r: Reimbursement): (string | number)[] {
  return [
    r.id,
    r.created_at,
    r.requester_name,
    r.payee_rho_name,
    formatCents(r.amount_cents, r.currency),
    r.currency,
    r.memo,
    r.status,
    r.approver_slack_id ?? "",
    r.approved_at ?? "",
    r.paid_at ?? "",
    r.receipt_urls.join(" | "),
  ];
}

/**
 * Append the approved request as a new ledger row. Returns the 1-based sheet row index so
 * later updates (status -> paid) can target the same row.
 */
export async function appendRow(r: Reimbursement): Promise<number> {
  const sheets = await client();
  await ensureHeaderRow(sheets);
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: env.sheets.sheetId,
    range: `${env.sheets.tab}!A:L`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [rowValues(r)] },
  });
  // updatedRange looks like "Reimbursements!A7:L7" — pull the row number.
  const updated = res.data.updates?.updatedRange ?? "";
  const match = updated.match(/![A-Z]+(\d+):/);
  return match ? Number(match[1]) : 0;
}

/** Rewrite an existing ledger row in place (used when status flips to paid). */
export async function updateRow(
  r: Reimbursement,
  sheetRow: number,
): Promise<void> {
  if (!sheetRow) return;
  const sheets = await client();
  await sheets.spreadsheets.values.update({
    spreadsheetId: env.sheets.sheetId,
    range: `${env.sheets.tab}!A${sheetRow}:L${sheetRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [rowValues(r)] },
  });
}
