import { requireAuth as auth } from '../lib/auth-session.js';
import { resolveAmberIdByPrivyDid } from '../db/store.js';
import { query, withTransaction } from '../db/sql.js';
const prompts = ['family', 'nearby', 'priorities'];
export const priorities = ['romantic', 'family', 'fitness', 'professional', 'academic', 'religious'];
export async function readOnboardingContext(owner, sql = query) {
  const { rows } = await sql("SELECT profile_extra->'onboardingVoice' AS context FROM users WHERE amber_id = $1 AND deleted_at IS NULL", [owner]);
  return rows[0]?.context ?? {};
}
export async function saveOnboardingContext(owner, input, transact = withTransaction) {
  return transact(async client => {
    // The audio/transcript must already be a durable memo owned by this account.
    const memo = await client.query(`SELECT m.content FROM conversations c
      JOIN conversation_messages m ON m.conversation_id = c.conversation_id AND m.owner_id = c.owner_id
      WHERE c.owner_id = $1 AND c.conversation_id = $2 AND c.deleted_at IS NULL
        AND m.deleted_at IS NULL AND m.role = 'user' AND m.metadata->>'source' = 'journal'
      ORDER BY m.id LIMIT 1`, [owner, input.memoId]);
    if (!memo.rows[0]?.content?.trim()) return { error: 'memo_not_found' };
    const ids = [...new Set(input.contactIds)];
    const contacts = await client.query('SELECT id FROM contacts WHERE owner_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL', [owner, ids]);
    if (contacts.rows.length !== ids.length) return { error: 'contact_not_found' };
    const previous = await client.query("SELECT profile_extra->'onboardingVoice'->($2::text) AS context FROM users WHERE amber_id = $1 AND deleted_at IS NULL FOR UPDATE", [owner, input.prompt]);
    const prior = previous.rows[0]?.context;
    const unchanged = prior?.memoId === input.memoId && JSON.stringify(prior.contactIds) === JSON.stringify(ids) && JSON.stringify(prior.priorities) === JSON.stringify(input.priorities);
    const value = { memoId: input.memoId, contactIds: ids, priorities: input.priorities, savedAt: unchanged ? prior.savedAt : new Date().toISOString() };
    // Atomic, scoped merge: other profile fields and the other prompts are preserved.
    const result = await client.query(`UPDATE users SET profile_extra = jsonb_set(
      COALESCE(profile_extra, '{}'::jsonb), '{onboardingVoice}',
      COALESCE(profile_extra->'onboardingVoice', '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb)), updated_at = now()
      WHERE amber_id = $1 AND deleted_at IS NULL RETURNING profile_extra->'onboardingVoice' AS context`, [owner, input.prompt, JSON.stringify(value)]);
    return result.rows[0] ? { context: result.rows[0].context } : { error: 'account_not_found' };
  });
}
export function registerOnboardingContextRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth ?? auth;
  const resolve = deps.resolveOwner ?? resolveAmberIdByPrivyDid;
  const read = deps.read ?? readOnboardingContext;
  const save = deps.save ?? saveOnboardingContext;
  const options = { preHandler: [requireAuth], config: { rateLimit: { max: 12, timeWindow: '1 minute' } } };
  async function owner(req, reply) {
    const did = req.privyUser?.userId;
    const id = did ? await resolve(did) : null;
    if (!id) reply.code(401).send({ error: 'auth_required' });
    return id;
  }
  app.get('/v1/me/onboarding-context', options, async (req, reply) => {
    const id = await owner(req, reply); if (!id) return;
    return { context: await read(id) };
  });
  app.put('/v1/me/onboarding-context/:prompt', { ...options, schema: {
    params: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string', enum: prompts } } },
    body: { type: 'object', additionalProperties: false, required: ['memoId', 'contactIds', 'priorities'], properties: {
      memoId: { type: 'string', format: 'uuid' },
      contactIds: { type: 'array', maxItems: 50, uniqueItems: true, items: { type: 'string', format: 'uuid' } },
      priorities: { type: 'array', maxItems: 6, uniqueItems: true, items: { type: 'string', enum: priorities } },
    } },
  } }, async (req, reply) => {
    const id = await owner(req, reply); if (!id) return;
    const result = await save(id, { ...req.body, prompt: req.params.prompt });
    if (result.error) return reply.code(404).send({ error: result.error });
    return result;
  });
}
