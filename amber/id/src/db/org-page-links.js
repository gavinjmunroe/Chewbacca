/**
 * A LINK THAT TAKES ONE PAGE OUTSIDE THE COMPANY.
 *
 * WHY THIS IS SMALL ON PURPOSE. There is exactly one kind of share here --
 * anybody with the link can open it -- because that is the only promise a
 * URL can actually keep. "Anyone at the company with the link" is a sentence
 * products write and browsers do not enforce, and a permission model that
 * claims something it cannot do is worse than one that claims less.
 *
 * SO THE HONESTY IS IN TWO PLACES: the screen says plainly what a link does
 * at the moment somebody makes one, and revoking is one press and immediate.
 *
 * NOTHING IS COPIED. A link points at a page that already exists, so the
 * shared thing changes when the page changes, revoking is sufficient, and
 * deleting the page takes its links with it.
 */

import { randomBytes } from "node:crypto";
import { query, withTransaction } from "./sql.js";

/**
 * 32 bytes, base64url. Long enough that guessing is not a strategy and
 * short enough to paste into a message without wrapping.
 */
function mintToken() {
  return randomBytes(24).toString("base64url");
}

export async function createPageLink({ orgId, pageId, createdBy = null } = {}) {
  if (!orgId || !pageId) return { ok: false, reason: "bad_input" };

  /*
   * ONE LIVE LINK PER PAGE, reused. Pressing the button twice should hand
   * somebody the same URL rather than quietly minting a second one that
   * then has to be revoked separately -- a page with four live links is a
   * page nobody can actually turn off.
   */
  const { rows: existing } = await query(
    `SELECT id, token, created_at, views, last_seen
       FROM org_page_links
      WHERE org_id = $1::uuid AND page_id = $2::uuid AND revoked_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [orgId, pageId],
  );
  if (existing[0]) return { ok: true, link: existing[0], reused: true };

  const { rows } = await query(
    `INSERT INTO org_page_links (org_id, page_id, token, created_by)
     VALUES ($1::uuid, $2::uuid, $3::text, $4::uuid)
     RETURNING id, token, created_at, views, last_seen`,
    [orgId, pageId, mintToken(), createdBy],
  );
  return { ok: true, link: rows[0], reused: false };
}

export async function listPageLinks({ orgId, pageId } = {}) {
  if (!orgId || !pageId) return [];
  const { rows } = await query(
    `SELECT id, token, created_at, views, last_seen
       FROM org_page_links
      WHERE org_id = $1::uuid AND page_id = $2::uuid AND revoked_at IS NULL
      ORDER BY created_at DESC`,
    [orgId, pageId],
  );
  return rows;
}

/** Off, now. The row stays so a dead link can say it was revoked. */
export async function revokePageLink({ orgId, linkId } = {}) {
  if (!orgId || !linkId) return { ok: false, reason: "bad_input" };
  const { rowCount } = await query(
    `UPDATE org_page_links
        SET revoked_at = now()
      WHERE org_id = $1::uuid AND id = $2::uuid AND revoked_at IS NULL`,
    [orgId, linkId],
  );
  return { ok: rowCount > 0, reason: rowCount > 0 ? null : "not_found" };
}

/**
 * THE PUBLIC READ. One transaction, one flag, one page.
 *
 * The flag is transaction-local, so it dies with the transaction and cannot
 * leak onto the next request sharing a pooled connection -- which is the
 * failure that makes a clever permission trick into an incident. The
 * policies in migration 094 are what actually limit this to the one row;
 * this function only names which row it is asking about.
 */
export async function readPublicPage(token) {
  const t = String(token ?? "").trim();
  if (t.length < 20 || t.length > 200) return null;

  try {
    return await withTransaction(async (client) => {
      /*
       * TRANSACTION-LOCAL, which is the whole safety of this. `true` means
       * the setting dies with the transaction, so it cannot leak onto the
       * next request that borrows this pooled connection -- the failure that
       * turns a clever permission trick into an incident.
       *
       * The policies in migration 094 are what limit this to one row; naming
       * the token here only says WHICH row is being asked about.
       */
      await client.query(`SELECT set_config('amber.link_token', $1::text, true)`, [t]);

      const { rows } = await client.query(
        /*
         * NO JOIN TO organizations, for two reasons that point the same
         * way. The tenant policy on that table admits nothing when no org
         * is set -- which is exactly the case here -- so the join would
         * silently return no rows and the link would 404. And the company's
         * name is not something a share link needs to hand out: the page is
         * what was shared.
         */
        `SELECT p.id, p.title, p.summary, p.body, p.updated_at
           FROM org_page_links l
           JOIN org_pages p ON p.org_id = l.org_id AND p.id = l.page_id
          WHERE l.token = $1::text
            AND l.revoked_at IS NULL
            AND p.archived_at IS NULL
          LIMIT 1`,
        [t],
      );

      if (!rows[0]) return null;

      /* Evidence that a link is being used, which is what somebody wants
         before deciding whether to revoke it. */
      await client.query(
        `UPDATE org_page_links
            SET views = views + 1, last_seen = now()
          WHERE token = $1::text AND revoked_at IS NULL`,
        [t],
      );

      return rows[0];
    });
  } catch (err) {
    console.warn(`[page-links] public read failed: ${err?.message ?? err}`);
    return null;
  }
}
