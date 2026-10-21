import { withTransaction } from './sql.js';

// The same conversations/messages Main reads. A stable client UUID makes a
// retry after a dropped response safe, without model calls or duplicate notes.
export async function saveJournalMemo(ownerId, memo, transact = withTransaction) {
  return transact(async (client) => {
    const inserted = await client.query(
      `INSERT INTO conversations (conversation_id, owner_id, kind, created_at, updated_at)
       VALUES ($1, $2, 'note', $3, $3)
       ON CONFLICT (conversation_id) DO NOTHING RETURNING conversation_id`,
      [memo.id, ownerId, memo.createdAt],
    );
    if (!inserted.rowCount) {
      const existing = await client.query(
        `SELECT m.id, m.content, m.metadata, m.created_at
           FROM conversations c JOIN conversation_messages m
             ON m.conversation_id = c.conversation_id AND m.owner_id = c.owner_id
          WHERE c.conversation_id = $1 AND c.owner_id = $2
            AND c.deleted_at IS NULL AND m.deleted_at IS NULL
            AND m.role = 'user' AND m.metadata->>'source' = 'journal'
          ORDER BY m.id LIMIT 1`,
        [memo.id, ownerId],
      );
      const row = existing.rows[0];
      if (!row || (row.content !== memo.text && row.metadata?.originalTranscript !== memo.text) || row.metadata?.voice !== memo.voice)
        return { ok: false, error: 'memo_conflict' };
      return { ok: true, conversationId: memo.id, createdAt: row.created_at, created: false, text: row.content };
    }
    await client.query(
      `INSERT INTO conversation_messages
         (conversation_id, owner_id, role, content, metadata, created_at)
       VALUES ($1, $2, 'user', $3, $4::jsonb, $5)`,
      [memo.id, ownerId, memo.text, JSON.stringify({ source: 'journal', voice: memo.voice }), memo.createdAt],
    );
    return { ok: true, conversationId: memo.id, createdAt: memo.createdAt, created: true, text: memo.text };
  });
}

/** Correct a transcript with compare-and-set semantics; a dropped response can be retried. */
export async function correctJournalMemo(ownerId, memo, transact = withTransaction) {
  return transact(async (client) => {
    const existing = await client.query(
      `SELECT m.id, m.content, m.metadata FROM conversations c
         JOIN conversation_messages m ON m.conversation_id = c.conversation_id AND m.owner_id = c.owner_id
        WHERE c.conversation_id = $1 AND c.owner_id = $2
          AND c.deleted_at IS NULL AND m.deleted_at IS NULL
          AND m.role = 'user' AND m.metadata->>'source' = 'journal'
        ORDER BY m.id LIMIT 1 FOR UPDATE OF m`,
      [memo.id, ownerId],
    );
    const row = existing.rows[0];
    if (!row) return { ok: false, error: 'memo_not_found' };
    if (row.content === memo.text) return { ok: true, conversationId: memo.id, text: memo.text };
    if (row.content !== memo.previousText) return { ok: false, error: 'memo_conflict' };
    const metadata = { ...row.metadata, originalTranscript: row.metadata.originalTranscript ?? row.content,
      correctedAt: new Date().toISOString() };
    await client.query(
      `UPDATE conversation_messages SET content = $3, metadata = $4::jsonb WHERE id = $1 AND owner_id = $2`,
      [row.id, ownerId, memo.text, JSON.stringify(metadata)],
    );
    await client.query(`UPDATE conversations SET updated_at = now() WHERE conversation_id = $1 AND owner_id = $2`, [memo.id, ownerId]);
    return { ok: true, conversationId: memo.id, text: memo.text };
  });
}
