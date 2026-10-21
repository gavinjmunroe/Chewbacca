import { query, withTransaction } from './sql.js';
export async function getClayJob(owner, id, queryFn = query) {
  const { rows } = await queryFn('SELECT * FROM clay_jobs WHERE owner_id=$1 AND id=$2', [owner,id]);
  return rows[0] || null;
}
export async function reserveClayJob(owner, { id, kind, input }, transaction = withTransaction) {
  return transaction(async db => {
    // Serialize admission globally: daily beta limits cannot be raced across workers.
    await db.query("SELECT pg_advisory_xact_lock(hashtext('amber-clay-beta'))");
    const { rows: existing } = await db.query('SELECT * FROM clay_jobs WHERE owner_id=$1 AND id=$2', [owner,id]);
    if (existing[0]) return { created:false, job:existing[0] };
    const { rows } = await db.query("SELECT count(*) total, count(*) FILTER (WHERE owner_id=$1) owned FROM clay_jobs WHERE created_at > now()-interval '24 hours'", [owner]);
    if (Number(rows[0].total) >= 100 || Number(rows[0].owned) >= 20) throw new Error('clay_quota');
    const { rows: inserted } = await db.query('INSERT INTO clay_jobs(owner_id,id,kind,input) VALUES($1,$2,$3,$4::jsonb) RETURNING *', [owner,id,kind,JSON.stringify(input)]);
    return { created:true, job:inserted[0] };
  });
}
export async function updateClayJob(owner, id, patch) {
  const { rows } = await query('UPDATE clay_jobs SET status=$3, output=$4::jsonb, updated_at=now() WHERE owner_id=$1 AND id=$2 RETURNING *', [owner,id,patch.status,JSON.stringify(patch.output)]);
  return rows[0];
}
