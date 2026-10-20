/**
 * In-memory contact accumulator threaded through the enrichment agent's tools.
 *
 * The agent never writes directly to BigQuery — every tool that produces a
 * candidate contact pushes onto this accumulator. After the agent run the
 * caller persists the accumulated set in a single batch, which keeps the
 * agent loop fast and lets us run quality / cross-source scoring against
 * the full candidate pool before any DB write.
 *
 * Mirrors autotier's ContactAccumulator. The `source` tag records which
 * tool produced each contact (exa, crustdata, perplexity, grata, etc).
 */

import type { ContactInfoJson } from "./types";

export interface AccumulatedContact {
  contact: ContactInfoJson;
  source: string;
}

export interface ContactAccumulator {
  contacts: AccumulatedContact[];
}

export function createAccumulator(): ContactAccumulator {
  return { contacts: [] };
}

export function pushContact(
  accumulator: ContactAccumulator,
  source: string,
  contact: ContactInfoJson,
): void {
  accumulator.contacts.push({ source, contact });
}

export function pushContacts(
  accumulator: ContactAccumulator,
  source: string,
  contacts: ContactInfoJson[],
): void {
  for (const contact of contacts) {
    accumulator.contacts.push({ source, contact });
  }
}
