/**
 * THE SMOKE-TEST CONNECTION, AND THE TWO LOCKS ON IT.
 *
 * Every smoke script in this directory starts by TRUNCATE-ing the tables it is
 * about to exercise. That is correct for a scratch database and catastrophic
 * anywhere else, and the distance between the two is one shell command:
 *
 *     railway run node scripts/observations-smoke.mjs
 *
 * would have wiped users, contacts and observations in production. Those scripts
 * only ever survived because they imported "./db/sql.js", a path that does not
 * exist under scripts/, so they threw before reaching the TRUNCATE. An import
 * error is not a safety mechanism.
 *
 * So the connection is refused unless BOTH of these are true, and neither can be
 * true of production by accident:
 *
 *   1. SMOKE_DATABASE_URL is set. There is deliberately no fallback to the app's
 *      pool -- not DATABASE_URL, not the Cloud SQL connector. A smoke script
 *      cannot reach the real database because it does not know how to.
 *
 *   2. The target contains a table called `smoke_marker`. You create it by hand,
 *      once, on a database you are willing to destroy:
 *
 *          CREATE TABLE smoke_marker (note text);
 *
 *      Nobody creates that on production, and no migration does either.
 */

import pg from "pg";

const dsn = process.env.SMOKE_DATABASE_URL;
if (!dsn) {
  console.error(
    "\n  SMOKE_DATABASE_URL is not set.\n\n" +
      "  Smoke scripts TRUNCATE the tables they test, so they will not connect to\n" +
      "  anything they were not explicitly pointed at. Point this at a scratch\n" +
      "  database you are willing to destroy:\n\n" +
      "      SMOKE_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/scratch \\\n" +
      "        node scripts/<name>-smoke.mjs\n",
  );
  process.exit(2);
}

export const pool = new pg.Pool({ connectionString: dsn, max: 4 });

{
  const { rows } = await pool.query(
    `SELECT current_database() AS db,
            to_regclass('public.smoke_marker') IS NOT NULL AS marked`,
  );
  if (!rows[0].marked) {
    console.error(
      `\n  Refusing to run against "${rows[0].db}": no smoke_marker table.\n\n` +
        "  This is the second lock. A scratch database opts IN to being wiped:\n\n" +
        "      CREATE TABLE smoke_marker (note text);\n\n" +
        "  If you just typed that against production, stop and read scripts/smoke-db.mjs.\n",
    );
    await pool.end();
    process.exit(2);
  }
}

export async function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function closePool() {
  await pool.end();
}
