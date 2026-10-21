/**
 * Rave Master ingest glue.
 *
 * Every inbound text we touch under the Rave Master path gets stored
 * twice in amber-id:
 *
 *   1. As an `interactions` audit row via `/v1/data/interactions` — this
 *      is the full inbound/outbound audit trail (lib/crm.js#logInteraction
 *      already does the same shape for the normal LLM path).
 *
 *   2. As a Pinecone-indexed agent ingest item with kind=`rave_event_item`
 *      tagged into the `social` health dimension (events are social by
 *      default; safety-flagged messages get the `physical` dimension).
 *      This lets `/knowledge/query-as` retrieve event context later.
 *
 * Side effects only — pure card updates live in event-card.js.
 *
 * IMPORTANT: per the build brief, we do NOT keep raw transcripts in
 * local files. We only push them through to amber-id; the amber-imessage
 * service holds no persistent transcript on its own filesystem.
 */

import { ingestToAmberID } from "../amber-id-ingest.js";
import { logInteraction } from "../crm.js";

function dimensionForClassification(classification) {
  if (!classification) return "social";
  if (classification.primary === "safety") return "physical";
  if (classification.isSubstanceContext) return "physical";
  return "social";
}

/**
 * Store an inbound message into amber-id as raw audit + classified
 * event item. Never throws; logs and returns null on failure.
 *
 * @param {Object} opts
 * @param {Object} opts.tenant
 * @param {string} opts.fromHandle - sender phone (E.164)
 * @param {string} opts.text - inbound text
 * @param {string|null} opts.replyText - Amber's reply (or null if none)
 * @param {Object|null} opts.classification - classifier.js output
 * @param {string} opts.eventId - card event_id
 */
export async function storeRaveInbound({
  tenant,
  fromHandle,
  text,
  replyText,
  classification,
  eventId,
}) {
  if (!tenant || !text) return null;

  // 1. Audit row. Same shape as the normal logInteraction call so
  // existing dashboards keep working.
  try {
    await logInteraction(
      fromHandle,
      text,
      replyText || "[no reply / draft only]",
      "rave-master",
      tenant,
    );
  } catch (err) {
    console.warn("[rave-master/ingest] logInteraction failed:", err.message);
  }

  // 2. Event-tagged ingest item for retrieval.
  const healthDimension = dimensionForClassification(classification);
  const slot = classification?.primary || "other";
  const isSafety = healthDimension === "physical";
  const baseText = isSafety
    ? `[event:safety] ${text}`
    : `[event:${slot}] ${text}`;
  try {
    return await ingestToAmberID({
      pipe: "agent",
      tenant,
      phone: tenant.phoneNumber,
      items: [
        {
          text: baseText.slice(0, 4000),
          healthDimension,
          kind: "rave_event_item",
          extra: {
            eventId,
            sourceHandle: fromHandle,
            slot,
            substanceContext: !!classification?.isSubstanceContext,
            ts: new Date().toISOString(),
          },
          createdAt: new Date().toISOString(),
        },
      ],
    });
  } catch (err) {
    console.warn("[rave-master/ingest] ingestToAmberID failed:", err.message);
    return null;
  }
}
