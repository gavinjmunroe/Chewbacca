import { z } from 'zod';
import { query as sqlQuery } from '../../db/sql.js';
import { ownerFromDid } from './_resolve.js';
import { ok, errorResult } from './_result.js';

export const name = 'search_plans';
export const requiresOwnerDid = true;
export const config = {
  title: 'Search your plans',
  description: 'Find scheduled plans stored in your Amber account, including synced Google events. Device-only Apple events are unavailable until imported. Read-only; never searches the web or changes calendars. Dates must include a timezone.',
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  inputSchema: {
    did: z.string().min(1).optional(),
    query: z.string().max(200).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(50).default(10),
  },
};

export async function searchOwnerPlans(ownerId, input = {}, query = sqlQuery) {
  const text = (input.query || '').trim().replace(/[\\%_]/g, '\\$&');
  const { rows } = await query(
    `SELECT event_id AS id, title, scheduled_at AS "startsAt", ends_at AS "endsAt", place,
      source AS provider FROM events
     WHERE owner_id=$1 AND deleted_at IS NULL AND scheduled_at IS NOT NULL
       AND modality IN ('planned','actual')
       AND ($2::text='' OR title ILIKE $2 OR description ILIKE $2 OR place ILIKE $2)
       AND ($3::timestamptz IS NULL OR scheduled_at >= $3)
       AND ($4::timestamptz IS NULL OR scheduled_at < $4)
     ORDER BY abs(extract(epoch FROM (scheduled_at-now()))), event_id LIMIT $5`,
    [ownerId, text ? '%' + text + '%' : '', input.from || null, input.to || null, Math.min(50, Math.max(1, input.limit || 10))],
  );
  return rows;
}

export async function handler(input, deps = {}) {
  const owner = await (deps.owner || ownerFromDid)(input.did);
  if (!owner.ok) return errorResult(owner.code, owner.message);
  if (input.from && input.to && Date.parse(input.from) >= Date.parse(input.to)) {
    return errorResult('invalid_window', 'The end of the date range must follow its start.');
  }
  try {
    const plans = await (deps.search || searchOwnerPlans)(owner.ownerId, input);
    return ok({ plans, count: plans.length, source: 'amber', includesDeviceOnlyEvents: false });
  } catch {
    return errorResult('plans_unavailable', 'Plans could not be loaded. Try again; an unavailable calendar is not an empty calendar.');
  }
}
