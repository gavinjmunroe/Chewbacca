import type { Reimbursement } from "../db/types.js";

/**
 * Rho's bulk-transfer import expects a contact that already exists in Rho (matched by name)
 * plus an amount and memo. We never carry account/routing numbers: those live in Rho against
 * the contact. Column order mirrors Rho's bulk-payment template; adjust headers here if Rho
 * changes their template.
 */
export const RHO_CSV_HEADERS = [
  "Contact Name",
  "Amount",
  "Currency",
  "Memo",
] as const;

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** A single CSV data line (no header) for one approved reimbursement. */
export function buildCsvLine(r: Reimbursement): string {
  const cells = [
    r.payee_rho_name,
    (r.amount_cents / 100).toFixed(2),
    r.currency,
    r.memo || "Reimbursement",
  ];
  return cells.map((c) => escapeCsv(String(c))).join(",");
}

/** Full CSV (header + one line) ready to paste/upload into Rho's bulk importer. */
export function buildCsv(r: Reimbursement): string {
  return `${RHO_CSV_HEADERS.join(",")}\n${buildCsvLine(r)}\n`;
}
