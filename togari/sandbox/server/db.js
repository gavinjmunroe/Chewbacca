import pg from "pg";

const { Pool } = pg;

let pool = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS wiki_pages (
    slug        TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS togari_api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email  TEXT NOT NULL,
    label       TEXT NOT NULL,
    key_hash    TEXT NOT NULL UNIQUE,
    key_prefix  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ
  );
`;

export async function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  // Traffic to *.railway.internal never leaves Railway's private network, so it
  // needs no TLS. Anything else is crossing the public internet and must verify.
  // DATABASE_SSL_INSECURE exists only for local runs against the public proxy,
  // whose cert is self-signed; never set it in a deployed environment.
  const isPrivateNetwork = connectionString.includes(".railway.internal");
  const ssl = isPrivateNetwork
    ? false
    : { rejectUnauthorized: process.env.DATABASE_SSL_INSECURE !== "1" };

  pool = new Pool({ connectionString, max: 5, ssl });

  await pool.query(SCHEMA);
  return pool;
}

const rowToPage = (row) => ({
  slug: row.slug,
  title: row.title,
  body: row.body,
  attachments: row.attachments,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  updatedBy: row.updated_by,
  updatedAt: row.updated_at.toISOString(),
});

export async function listPages() {
  const db = await getPool();
  const { rows } = await db.query(
    "SELECT * FROM wiki_pages ORDER BY title ASC",
  );
  return rows.map(rowToPage);
}

export async function upsertPage({ slug, title, body, attachments, email }) {
  const db = await getPool();
  const { rows } = await db.query(
    `INSERT INTO wiki_pages (slug, title, body, attachments, created_by, updated_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $5)
     ON CONFLICT (slug) DO UPDATE SET
       title       = EXCLUDED.title,
       body        = EXCLUDED.body,
       attachments = EXCLUDED.attachments,
       updated_by  = EXCLUDED.updated_by,
       updated_at  = now()
     RETURNING *`,
    [slug, title, body, JSON.stringify(attachments), email],
  );
  return rowToPage(rows[0]);
}

export async function deletePage(slug) {
  const db = await getPool();
  await db.query("DELETE FROM wiki_pages WHERE slug = $1", [slug]);
}

export async function listApiKeys(email) {
  const db = await getPool();
  const { rows } = await db.query(
    `SELECT id, label, key_prefix, created_at, last_used_at
       FROM togari_api_keys
      WHERE user_email = $1 AND revoked_at IS NULL
      ORDER BY created_at DESC`,
    [email],
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    prefix: r.key_prefix,
    createdAt: r.created_at.toISOString(),
    lastUsedAt: r.last_used_at ? r.last_used_at.toISOString() : null,
  }));
}

export async function insertApiKey({ email, label, hash, prefix }) {
  const db = await getPool();
  const { rows } = await db.query(
    `INSERT INTO togari_api_keys (user_email, label, key_hash, key_prefix)
     VALUES ($1, $2, $3, $4)
     RETURNING id, label, key_prefix, created_at`,
    [email, label, hash, prefix],
  );
  const r = rows[0];
  return {
    id: r.id,
    label: r.label,
    prefix: r.key_prefix,
    createdAt: r.created_at.toISOString(),
  };
}

export async function revokeApiKey({ email, id }) {
  const db = await getPool();
  const { rowCount } = await db.query(
    `UPDATE togari_api_keys SET revoked_at = now()
      WHERE id = $1 AND user_email = $2 AND revoked_at IS NULL`,
    [id, email],
  );
  return rowCount > 0;
}

export async function findApiKeyByHash(hash) {
  const db = await getPool();
  const { rows } = await db.query(
    `SELECT id, user_email, label FROM togari_api_keys
      WHERE key_hash = $1 AND revoked_at IS NULL`,
    [hash],
  );
  if (!rows[0]) return null;
  db.query("UPDATE togari_api_keys SET last_used_at = now() WHERE id = $1", [
    rows[0].id,
  ]).catch(() => {});
  return { id: rows[0].id, email: rows[0].user_email, label: rows[0].label };
}
