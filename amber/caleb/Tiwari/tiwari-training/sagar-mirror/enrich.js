/**
 * Sagar-mirror trainer — tiwari-enrich.
 *
 * For every contact Sagar touched today (any pipe), fuses their evidence
 * records using Dempster-Shafer + intentionality priors, and writes the
 * resulting per-contact belief vectors to amber-id scoring tables.
 *
 * Stub uses a tiny fixture; real implementation queries amber-id
 * /ingest read-side for records with t > now - 24h.
 */
import ds from "../../tiwari-enrich/src/ds.js";

export function defaultHyper() { return { window_hours: 24 }; }

function fixtureRecords() {
  // Simulated day: two checkin packets (trust 1.0) + one agent packet (0.65)
  return [
    { contact: "caleb", pipe: "checkin", healthDimension: "intellectual", relevance: 0.9, trust: 1.0 },
    { contact: "caleb", pipe: "agent",   healthDimension: "social",       relevance: 0.6, trust: 0.65 },
    { contact: "anna",  pipe: "checkin", healthDimension: "emotional",    relevance: 0.8, trust: 1.0 },
  ];
}

export async function train({ stamp, runId }) {
  const records = fixtureRecords();
  const byContact = new Map();
  for (const r of records) {
    if (!byContact.has(r.contact)) byContact.set(r.contact, []);
    byContact.get(r.contact).push(r);
  }

  const out = {};
  for (const [contact, recs] of byContact.entries()) {
    const bpas = recs.map((r) =>
      ds.discount(ds.recordToBPA(r), r.trust),
    );
    const fused = ds.combineMany(bpas);
    const beliefs = ds.beliefPlausibilityPerDim(fused.bpa);
    out[contact] = { beliefs, conflict: fused.conflict };
  }

  return {
    status: "ok",
    rowsRead: records.length,
    rowsTouched: byContact.size,
    deltaL2: 0,
    hyperAfter: defaultHyper(),
    state: { stamp, runId, contacts: out },
    notes: "stub: fixture 3-record day; wire amber-id /ingest read-side",
  };
}
