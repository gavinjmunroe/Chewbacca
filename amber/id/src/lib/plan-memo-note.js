import { createHash } from "node:crypto";
import { query } from "../db/sql.js";
import { insertObservation } from "../db/observations-store.js";
const fail = () =>
  Object.assign(Error("plan_or_memo_not_found"), { status: 404 });
/** Append reviewed evidence to an owned plan. Never replace its participants or provider fields. */
export async function appendPlanMemo(input, deps = {}) {
  const run = deps.query || query;
  const ids = [...new Set(input.contactIds || [])].sort();
  const scope = await run(
    `SELECT e.event_id FROM events e
    JOIN conversations c ON c.owner_id = e.owner_id AND c.conversation_id = $3
    WHERE e.owner_id = $1 AND e.event_id = $2 AND e.deleted_at IS NULL AND c.deleted_at IS NULL`,
    [input.ownerId, input.eventId, input.conversationId],
  );
  if (!scope.rows.length) throw fail();
  const contacts = ids.length
    ? await run(
        `SELECT id FROM contacts WHERE owner_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
        [input.ownerId, ids],
      )
    : { rows: [] };
  if (contacts.rows.length !== ids.length) throw fail();
  const hash = createHash("sha256")
    .update(
      JSON.stringify([input.ownerId, input.eventId, input.requestId, ids]),
    )
    .digest("hex");
  const observationId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const note = await (deps.insert || insertObservation)({
    ownerId: input.ownerId,
    observationId,
    kind: "note",
    body: input.text,
    source: "manual",
    sourceConversationId: input.conversationId,
    eventId: input.eventId,
    createEvent: false,
    participants: ids.map((contactId) => ({ contactId, role: "participant" })),
  });
  // Retrying after an interrupted participant insert is safe; no existing row is removed.
  if (ids.length)
    await run(
      `INSERT INTO event_participants (event_id, owner_id, contact_id, role)
    SELECT $2, $1, c.id, 'participant' FROM contacts c
    WHERE c.owner_id = $1 AND c.id = ANY($3::uuid[]) AND c.deleted_at IS NULL
    ON CONFLICT (event_id, contact_id) DO NOTHING`,
      [input.ownerId, input.eventId, ids],
    );
  return { ok: true, observationId: note.observationId };
}
