import { query } from './sql.js';

/** One query per page, anchored to the original recording, never the latest reply. */
export async function listJournalRecordings(ownerId, options = {}, run = query) {
  const { from = null, to = null, before = null, beforeId = null } = options;
  const limit = 40;
  const { rows } = await run(`
    SELECT c.conversation_id, c.created_at, m.content, m.metadata->>'voice' AS voice, m.created_at AS recorded_at,
           to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_cursor
      FROM conversations c
      JOIN LATERAL (
        SELECT content, metadata, created_at FROM conversation_messages
         WHERE conversation_id = c.conversation_id AND owner_id = $1
           AND role = 'user' AND deleted_at IS NULL
         ORDER BY created_at, id LIMIT 1
      ) m ON true
     WHERE c.owner_id = $1 AND c.deleted_at IS NULL
       AND (m.metadata->>'voice' = 'true'
         OR (c.kind = 'note' AND m.metadata->>'voice' IS NULL))
       AND ($2::timestamptz IS NULL OR m.created_at >= $2::timestamptz)
       AND ($3::timestamptz IS NULL OR m.created_at < $3::timestamptz)
       AND ($4::timestamptz IS NULL OR (m.created_at, c.conversation_id) < ($4::timestamptz, $5::uuid))
     ORDER BY m.created_at DESC, c.conversation_id DESC LIMIT $6`,
    [ownerId, from, to, before, beforeId, limit + 1]);
  const page = rows.slice(0, limit);
  const conversations = page.map(row => ({
    conversationId: row.conversation_id, kind: 'note', voice: row.voice === 'true' ? true : null,
    createdAt: new Date(row.recorded_at).toISOString(),
    lastAt: new Date(row.recorded_at).toISOString(),
    title: String(row.content || 'Voice memo').slice(0, 60),
    preview: String(row.content || '').slice(0, 240), messageCount: 0,
  }));
  const last = conversations.at(-1);
  return { conversations, next: rows.length > limit && last
    ? { before: page.at(-1).recorded_cursor || last.createdAt, beforeId: last.conversationId } : null };
}
