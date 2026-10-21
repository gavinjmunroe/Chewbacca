import { registerJournalList } from './journal-list.js';
import { requireAuth as defaultRequireAuth } from '../lib/auth-session.js';
import { resolveAmberIdByPhone } from '../db/store.js';
import { saveJournalMemo, correctJournalMemo } from '../db/journal-store.js';

// Saving privately is separate from the explicit contact/calendar actions.
// Nothing here extracts facts, sends notifications, or shares a recording.
export function registerJournalRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const resolveOwner = deps.resolveOwner || resolveAmberIdByPhone;
  const save = deps.save || saveJournalMemo;
  const correct = deps.correct || correctJournalMemo;
  registerJournalList(app, { requireAuth, resolveOwner, list: deps.list });
  app.put('/v1/me/journal/:id', {
    preHandler: [requireAuth],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object', required: ['text', 'createdAt', 'voice'], additionalProperties: false,
        properties: {
          text: { type: 'string', maxLength: 32000 },
          createdAt: { type: 'string', format: 'date-time' },
          voice: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    if (!request.privyUser?.userId || !request.privyUser?.phone)
      return reply.code(401).send({ error: 'no_user' });
    const ownerId = await resolveOwner(request.privyUser.phone);
    if (!ownerId) return reply.code(401).send({ error: 'no_user' });
    const { text, createdAt, voice } = request.body;
    const at = Date.parse(createdAt);
    if ((!voice && !text.trim()) || at < 0 || at > Date.now() + 300000)
      return reply.code(400).send({ error: 'invalid_memo' });
    const result = await save(ownerId, {
      id: request.params.id.toLowerCase(), text, voice, createdAt: new Date(at).toISOString(),
    });
    if (!result.ok) return reply.code(409).send({ error: 'memo_conflict' });
    return reply.code(result.created ? 201 : 200).send(result);
  });
  app.patch('/v1/me/journal/:id', {
    preHandler: [requireAuth],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: { type: 'object', required: ['text', 'previousText'], additionalProperties: false,
        properties: { text: { type: 'string', maxLength: 32000 }, previousText: { type: 'string', maxLength: 32000 } } },
    },
  }, async (request, reply) => {
    if (!request.privyUser?.userId || !request.privyUser?.phone)
      return reply.code(401).send({ error: 'no_user' });
    const ownerId = await resolveOwner(request.privyUser.phone);
    if (!ownerId) return reply.code(401).send({ error: 'no_user' });
    const result = await correct(ownerId, { id: request.params.id.toLowerCase(), ...request.body });
    if (!result.ok) return reply.code(result.error === 'memo_not_found' ? 404 : 409).send({ error: result.error });
    return result;
  });

}
