import { onboardingBoost } from '../lib/onboarding-rank.js';
/** Read-only bridge for the redesigned Community. Reuses Amber ID's derived scores. */
import { requireAuth as auth } from '../lib/auth-session.js';
import { resolveAmberIdByPhone } from '../db/store.js';
import { query } from '../db/sql.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function readCommunityRanks(owner, sql = query) {
  const { rows } = await sql(`SELECT c.id AS contact_id, s.base_score, s.computed_at, u.profile_extra->'onboardingVoice' AS onboarding_context
    FROM contacts c LEFT JOIN contact_scores s ON s.contact_id = c.id AND s.owner_id = c.owner_id
    LEFT JOIN users u ON u.amber_id = c.owner_id
    WHERE c.owner_id = $1 AND c.deleted_at IS NULL
    ORDER BY s.base_score DESC NULLS LAST, c.id`, [owner]);
  return rows.map(r => {
    const initial = onboardingBoost(r.contact_id, r.onboarding_context);
    const baseScore = Number(r.base_score) || 0;
    return { contactId: String(r.contact_id), score: Math.min(1, baseScore + initial.boost), baseScore,
      onboardingBoost: initial.boost, onboardingReasons: initial.reasons, computedAt: r.computed_at ?? null };
  }).sort((a, b) => b.score - a.score);
}
export function mapContactDetails(row) {
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {};
  const meta = { ...raw, ...(row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) };
  if (row.birthday) meta.birthday = row.birthday;
  const fields = ['nickname', 'middleName', 'department', 'birthday', 'addresses', 'urls', 'dates', 'relationships', 'region', 'country'];
  const details = {};
  for (const field of fields) if (meta[field] != null) details[field] = meta[field];
  for (const field of ['location', 'linkedin_url', 'twitter_url', 'github_url', 'website']) if (row[field]) details[field] = row[field];
  return details;
}
export async function readContactDetails(owner, id, sql = query) {
  const { rows } = await sql(`SELECT metadata, raw, birthday, location, linkedin_url, twitter_url, github_url, website
    FROM contacts WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL`, [owner, id]);
  return rows[0] ? mapContactDetails(rows[0]) : null;
}
export function registerCommunityRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth ?? auth;
  const resolve = deps.resolveOwner ?? resolveAmberIdByPhone;
  const ranks = deps.readRanks ?? readCommunityRanks;
  const details = deps.readDetails ?? readContactDetails;
  async function owner(req, reply) {
    if (!req.privyUser?.userId || !req.privyUser?.phone) { reply.code(401).send({ error: 'auth_required' }); return null; }
    const id = await resolve(req.privyUser.phone);
    if (!id) { reply.code(401).send({ error: 'account_not_found' }); return null; }
    return id;
  }
  app.get('/v1/me/contact-ranks', { preHandler: [requireAuth] }, async (req, reply) => {
    const id = await owner(req, reply); if (!id) return;
    try { return { ranks: await ranks(id) }; }
    catch { return reply.code(503).send({ error: 'rank_unavailable' }); }
  });
  app.get('/v1/me/contacts/:id/details', { preHandler: [requireAuth] }, async (req, reply) => {
    const id = await owner(req, reply); if (!id) return;
    if (!UUID.test(req.params.id)) return reply.code(400).send({ error: 'invalid_contact_id' });
    try {
      const fields = await details(id, req.params.id);
      if (!fields) return reply.code(404).send({ error: 'contact_not_found' });
      return { contactId: req.params.id, details: fields };
    } catch { return reply.code(503).send({ error: 'contact_unavailable' }); }
  });
}
