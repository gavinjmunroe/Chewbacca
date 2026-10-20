import { env } from "./env.js";

/**
 * Pre-registered payees. Each `rhoName` MUST match the contact's display name in Rho
 * exactly so the generated bulk-transfer CSV lines up with an existing Rho payee. No
 * account or routing numbers ever live here or flow through Slack: the bank details
 * stay in Rho, and we only ever reference the payee by name.
 *
 * Add a row here for every employee/client who can receive a reimbursement.
 */
export interface Payee {
  /** Stable key used in Slack option values and the DB. */
  key: string;
  /** Human label shown in the Slack picker. */
  label: string;
  /** Exact Rho contact display name used in the payout CSV. */
  rhoName: string;
}

export const PAYEES: Payee[] = [
  // Example. Replace with the real Rho contact list from BMA.
  // { key: "archisha", label: "Archisha Sharma", rhoName: "Archisha Sharma" },
];

export function findPayee(key: string): Payee | undefined {
  return PAYEES.find((p) => p.key === key);
}

export function isApprover(slackUserId: string): boolean {
  return env.slack.approverIds.includes(slackUserId);
}
