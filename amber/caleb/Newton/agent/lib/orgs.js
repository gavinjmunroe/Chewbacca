// Canonical org enum. Multiple tabs may create this file; content must match exactly.
export const ORGS = ["bma", "rytual", "personal", "amber"];
export function isValidOrg(v) {
  return ORGS.includes(v);
}
