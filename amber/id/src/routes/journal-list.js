import { listJournalRecordings } from '../db/journal-list.js';
export function registerJournalList(app, { requireAuth, resolveOwner, list = listJournalRecordings }) {
  app.get('/v1/me/journal', {
    preHandler: [requireAuth],
    schema: { querystring: { type: 'object', additionalProperties: false, properties: {
      from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' },
      before: { type: 'string', format: 'date-time' }, beforeId: { type: 'string', format: 'uuid' },
    } } },
  }, async (request, reply) => {
    if (!request.privyUser?.userId || !request.privyUser?.phone)
      return reply.code(401).send({ error: 'no_user' });
    const owner = await resolveOwner(request.privyUser.phone);
    if (!owner) return reply.code(401).send({ error: 'no_user' });
    const { from, to, before, beforeId } = request.query;
    if (!!from !== !!to || !!before !== !!beforeId || (from && Date.parse(from) >= Date.parse(to)))
      return reply.code(400).send({ error: 'invalid_window' });
    return list(owner, { from, to, before, beforeId });
  });
}
