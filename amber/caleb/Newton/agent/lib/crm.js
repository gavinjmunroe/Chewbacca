/**
 * CRM integrations — stub.
 * Clay CRM, Firestore logging, and BMA Slack routing have been removed.
 * Contact enrichment now comes from togari-PeopleRank via the togari tool.
 * Interaction logging goes to Firestore via amber-id (lib/data.js).
 */

// Stub exports so nothing breaks if agent.js still references them
export function isBmaProspect() {
  return false;
}

export async function postSlack() {}

export async function getClayProfile() {
  return null;
}

export function logInteraction() {}
