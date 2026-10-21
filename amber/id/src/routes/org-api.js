/**
 * THE DOOR IN AND THE DOOR OUT.
 *
 * Two kinds of caller, two auth models, one file, because the second is
 * meaningless without the first.
 *
 * 1. MANAGEMENT (a signed-in admin, JWT)
 *      GET    /v1/org/api-keys            list, metadata only
 *      POST   /v1/org/api-keys            mint -- the raw key is in THIS
 *                                         response and no other, forever
 *      DELETE /v1/org/api-keys/:id        revoke
 *      GET    /v1/org/connectors          the catalog, with what is added
 *      POST   /v1/org/connectors          add one
 *      PATCH  /v1/org/connectors/:id      rename, pause, configure
 *      DELETE /v1/org/connectors/:id      remove
 *
 * 2. THE PUBLIC API (a machine, org key)
 *      GET  /v1/api/whoami                what this key is and may do
 *      GET  /v1/api/people                the roster
 *      GET  /v1/api/groups                the groups, with member counts
 *      GET  /v1/api/posts                 company-wide posts
 *      GET  /v1/api/files                 company-wide files
 *      GET  /v1/api/connections           the link map
 *      GET  /v1/api/export                all of the above, one document
 *      POST /v1/api/posts                 write a post
 *
 * THE ONE RULE THAT MAKES THIS SAFE TO SHIP. A key has no amber_id, so it has
 * no standing in the audience model, so every read here is filtered to
 * `visibility = 'org'` -- the work the company has deliberately made
 * company-wide. Anything addressed to a group or a person is not merely
 * hidden from a key, it is not expressible: there is no viewer to match
 * against, so the predicate that would admit it cannot be satisfied.
 *
 * That is a real product limit and it is the right one. An integration token
 * that can read every private channel because somebody pasted it into an
 * automation step is the single most common way a workspace leaks, and the
 * only reliable defense is for the token to never have been able to.
 *
 * EXPORT IS A FIRST-CLASS FEATURE, NOT A CONCESSION. A company that cannot get
 * its work back out has not adopted a tool, it has been captured by one, and
 * people can tell the difference before they commit. /v1/api/export returns
 * everything the key may read as one JSON document, which is also the
 * cheapest possible backup.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import {
  makeResolveActor,
  requireOrgAdmin,
  requireOrgMember,
} from "../lib/resolve-actor.js";
import { openTenantScope, withTenant } from "../db/tenant.js";
import { query } from "../db/sql.js";
import {
  addConnector,
  issueOrgKey,
  listConnectors,
  listOrgKeys,
  normalizeScopes,
  removeConnector,
  revokeOrgKey,
  touchOrgKey,
  updateConnector,
  verifyOrgKey,
} from "../db/org-api-store.js";
import { CONNECTOR_CATALOG } from "../lib/connector-catalog.js";
import { listGroups, listMembers } from "../db/org-store.js";

const MAX_LIMIT = 200;

/**
 * The kinds org_posts actually accepts.
 *
 * Mirrored from the CHECK constraint rather than invented here: a route that
 * offers a kind the column rejects turns a typo in this file into a 500 on
 * somebody else's integration.
 */
const POST_KINDS = new Set(["update", "question"]);

function clampLimit(v, fallback = 50) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_LIMIT);
}

/** `Authorization: Bearer <key>` or `x-amber-api-key: <key>`, as ingest does. */
function presentedKey(request) {
  const header = request.headers?.authorization;
  if (typeof header === "string" && /^bearer\s+/i.test(header)) {
    return header.replace(/^bearer\s+/i, "").trim();
  }
  const alt = request.headers?.["x-amber-api-key"];
  return typeof alt === "string" && alt.trim() ? alt.trim() : null;
}

/**
 * A CEILING PER KEY, PER MINUTE.
 *
 * Not primarily about load. A company API key is a bearer credential that
 * will end up pasted into a notes app, a CI variable and somebody's laptop,
 * and the realistic bad day is not a clever attack but a loop with no sleep
 * in it, or a leaked key being walked through /export over and over. A cap
 * turns "the workspace is down and the database is on fire" into "that
 * integration is getting 429s", which is a thing somebody notices and fixes.
 *
 * In memory and per process, which is a real limitation stated plainly: two
 * instances mean two buckets and an effective ceiling of twice this. That is
 * a backstop, not a quota system, and a correct distributed one belongs in
 * Redis on the day this needs billing-grade accuracy. A loose ceiling today
 * beats an exact one that does not exist.
 *
 * Keyed on the key id rather than the IP: the whole point is to bound what
 * one credential can do, and an integration behind a NAT shares an address
 * with everything else there.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
const buckets = new Map();

function overRate(keyId) {
  const now = Date.now();
  const b = buckets.get(keyId);
  if (!b || now - b.start > RATE_WINDOW_MS) {
    buckets.set(keyId, { start: now, n: 1 });
    // Opportunistic sweep, so a long-lived process does not accumulate a
    // bucket per key that was used once in March.
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now - v.start > RATE_WINDOW_MS) buckets.delete(k);
    }
    return null;
  }
  b.n += 1;
  if (b.n > RATE_MAX) return Math.ceil((RATE_WINDOW_MS - (now - b.start)) / 1000);
  return null;
}

export function registerOrgApiRoutes(app, opts = {}) {
  const requireAuth = opts.requireAuth ?? defaultRequireAuth;
  const resolveActor = makeResolveActor({ requireAuth });

  const asMember = {
    preHandler: [requireAuth, resolveActor, requireOrgMember, openTenantScope],
  };
  const asAdmin = {
    preHandler: [requireAuth, resolveActor, requireOrgAdmin, openTenantScope],
  };
  const org = (request) => request.actor.orgId;
  const who = (request) => request.actor.amberId;

  /* ====================================================== management ==== */

  app.get("/v1/org/api-keys", asAdmin, async (request) => ({
    keys: await listOrgKeys(org(request)),
  }));

  app.post(
    "/v1/org/api-keys",
    {
      ...asAdmin,
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            scopes: { type: "array", items: { type: "string" }, maxItems: 3 },
          },
        },
      },
    },
    async (request, reply) => {
      const { key, raw } = await issueOrgKey({
        orgId: org(request),
        name: request.body.name,
        scopes: normalizeScopes(request.body.scopes),
        createdBy: who(request),
      });

      /*
       * THE ONLY RESPONSE IN THIS SERVICE THAT CARRIES A LIVE CREDENTIAL, and
       * the one documented exception to "never return a token": it is going
       * to the admin who just asked for it, over their own authenticated
       * session, and there is no other way for a secret that is stored only
       * as a hash to reach the person who needs it. It is never logged and
       * never returned again -- a lost key is replaced, not recovered.
       */
      return reply.code(201).send({ key, secret: raw, shownOnce: true });
    },
  );

  app.delete("/v1/org/api-keys/:id", asAdmin, async (request, reply) => {
    const ok = await revokeOrgKey({
      orgId: org(request),
      keyId: request.params.id,
      revokedBy: who(request),
    });
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  /* ------------------------------------------------------- connectors --- */

  /**
   * The catalog and this company's state in one response.
   *
   * Two requests to render one page is two chances for the page to show a
   * tile as not-added for the half second before the second lands, which is
   * the kind of flicker that makes a product feel unfinished.
   */
  app.get("/v1/org/connectors", asMember, async (request) => ({
    catalog: CONNECTOR_CATALOG,
    added: await listConnectors(org(request)),
  }));

  app.post(
    "/v1/org/connectors",
    {
      ...asAdmin,
      schema: {
        body: {
          type: "object",
          required: ["provider"],
          properties: {
            provider: { type: "string", minLength: 1, maxLength: 60 },
            label: { type: ["string", "null"], maxLength: 120 },
            groupId: { type: ["string", "null"] },
            config: { type: "object" },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const connector = await addConnector({
          orgId: org(request),
          provider: request.body.provider,
          label: request.body.label ?? null,
          groupId: request.body.groupId ?? null,
          config: request.body.config ?? {},
          connectedBy: who(request),
        });
        return reply.code(201).send({ connector });
      } catch (err) {
        if (err?.message === "unknown_provider") {
          return reply.code(400).send({ error: "unknown_provider" });
        }
        throw err;
      }
    },
  );

  app.patch("/v1/org/connectors/:id", asAdmin, async (request, reply) => {
    const connector = await updateConnector({
      orgId: org(request),
      id: request.params.id,
      label: request.body?.label,
      status: request.body?.status,
      config: request.body?.config,
    });
    if (!connector) return reply.code(404).send({ error: "not_found" });
    return { connector };
  });

  app.delete("/v1/org/connectors/:id", asAdmin, async (request, reply) => {
    const ok = await removeConnector({ orgId: org(request), id: request.params.id });
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  /* ====================================================== the public API */

  /**
   * Key auth. Deliberately not folded into the session preHandler chain: a
   * single hook that accepts "a session OR a key" is how a key eventually
   * acquires a person's reach, and the two must never be able to stand in for
   * one another.
   */
  async function authenticateKey(request, reply, scope) {
    const raw = presentedKey(request);
    if (!raw) {
      reply
        .code(401)
        .header("www-authenticate", 'Bearer realm="amber", error="missing_key"')
        .send({ error: "missing_key", hint: "Authorization: Bearer amberorg_live_…" });
      return null;
    }

    let found;
    try {
      found = await verifyOrgKey(raw);
    } catch (err) {
      /*
       * A LOOKUP THAT THREW IS NOT A KEY THAT IS WRONG. Reporting a database
       * outage as 401 tells an integrator their credential is bad, and they
       * will rotate a perfectly good key at three in the morning. 503 with a
       * retry-after is the true answer, and it is the same correction already
       * made for the console's own sign-in path.
       */
      /*
       * The error only. NOT the request, not its headers, and above all not
       * the presented key -- a credential in a log file is a credential in
       * whatever aggregates that log file, and it outlives the incident that
       * put it there.
       */
      request.log?.warn?.({ err: String(err) }, "[org-api] key lookup failed");
      reply.code(503).header("retry-after", "2").send({ error: "lookup_unavailable" });
      return null;
    }

    if (!found) {
      reply.code(401).send({ error: "invalid_key" });
      return null;
    }
    if (!found.scopes.includes(scope)) {
      // Name the scope it lacks. "Forbidden" with no noun means somebody
      // guesses, and guessing ends with them minting an admin key.
      reply.code(403).send({ error: "insufficient_scope", need: scope, have: found.scopes });
      return null;
    }

    const retry = overRate(found.keyId);
    if (retry !== null) {
      reply
        .code(429)
        .header("retry-after", String(retry))
        .send({ error: "rate_limited", retryAfterSeconds: retry, limit: RATE_MAX, windowSeconds: 60 });
      return null;
    }

    touchOrgKey(found.orgId, found.keyId);
    return found;
  }

  /** Every machine request runs inside the key's tenant and nothing else's. */
  const keyed = (scope, handler) => async (request, reply) => {
    const key = await authenticateKey(request, reply, scope);
    if (!key) return reply;
    return withTenant(key.orgId, () => handler({ request, reply, key }));
  };

  app.get(
    "/v1/api/whoami",
    keyed("read", async ({ key }) => ({
      org: { id: key.orgId, name: key.orgName, slug: key.orgSlug },
      key: { id: key.keyId, name: key.name, scopes: key.scopes },
      /*
       * Said out loud rather than discovered. An integrator who learns the
       * audience limit from a confusing empty array files a bug; one who
       * reads it here designs around it.
       */
      reads:
        "Only work addressed to the whole company. Anything scoped to a group or a person is not visible to a key.",
    })),
  );

  app.get(
    "/v1/api/people",
    keyed("read", async ({ key }) => {
      const members = await listMembers(key.orgId);
      return {
        people: members.map((m) => ({
          id: m.amberId,
          name: m.fullName,
          email: m.email,
          role: m.role,
          status: m.status,
          title: m.title,
          joinedAt: m.joinedAt,
        })),
        count: members.length,
      };
    }),
  );

  app.get(
    "/v1/api/groups",
    keyed("read", async ({ key }) => {
      const groups = await listGroups(key.orgId);
      return {
        groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          purpose: g.purpose,
          memberCount: g.memberCount,
        })),
        count: groups.length,
      };
    }),
  );

  app.get(
    "/v1/api/posts",
    keyed("read", async ({ request }) => {
      const { rows } = await query(
        `SELECT p.id, p.kind, p.title, p.body, p.created_at, p.pinned_at, p.source,
                u.full_name AS author_name
           FROM org_posts p
           LEFT JOIN users u ON u.amber_id = p.author_id
          WHERE p.deleted_at IS NULL
            AND p.visibility = 'org'
          ORDER BY p.created_at DESC
          LIMIT $1`,
        [clampLimit(request.query?.limit)],
      );
      return { posts: rows, count: rows.length };
    }),
  );

  app.get(
    "/v1/api/files",
    keyed("read", async ({ request }) => {
      const { rows } = await query(
        `SELECT a.id, a.filename, a.content_type, a.byte_size, a.created_at,
                u.full_name AS uploaded_by_name
           FROM org_page_attachments a
           LEFT JOIN users u ON u.amber_id = a.uploaded_by
          WHERE a.deleted_at IS NULL
            AND a.status = 'ready'
            AND a.visibility = 'org'
          ORDER BY a.created_at DESC
          LIMIT $1`,
        [clampLimit(request.query?.limit)],
      );
      return { files: rows, count: rows.length };
    }),
  );

  app.get(
    "/v1/api/connections",
    keyed("read", async () => {
      const { rows } = await query(
        `SELECT c.id, c.label, c.url, c.provider, c.note, c.group_id,
                g.name AS group_name
           FROM org_connections c
           LEFT JOIN org_groups g ON g.org_id = c.org_id AND g.id = c.group_id
          ORDER BY c.position, c.created_at`,
      );
      return { connections: rows, count: rows.length };
    }),
  );

  /**
   * EVERYTHING THE KEY MAY READ, AS ONE DOCUMENT.
   *
   * The thing somebody runs on the day they are deciding whether to put their
   * company's work in here, and again on the day they wonder whether they
   * could get it out. Both answers should be "one curl".
   *
   * Sequential rather than Promise.all, on purpose: a tenant scope is one
   * connection, and a pg client carries one query at a time.
   */
  app.get(
    "/v1/api/export",
    keyed("read", async ({ key }) => {
      const people = await listMembers(key.orgId);
      const groups = await listGroups(key.orgId);
      const posts = await query(
        `SELECT id, kind, title, body, created_at, source
           FROM org_posts
          WHERE deleted_at IS NULL AND visibility = 'org'
          ORDER BY created_at DESC
          LIMIT 1000`,
      );
      const files = await query(
        `SELECT id, filename, content_type, byte_size, created_at
           FROM org_page_attachments
          WHERE deleted_at IS NULL AND status = 'ready' AND visibility = 'org'
          ORDER BY created_at DESC
          LIMIT 1000`,
      );
      const connections = await query(
        `SELECT id, label, url, provider, note, group_id
           FROM org_connections
          ORDER BY position, created_at`,
      );

      return {
        exportedAt: new Date().toISOString(),
        org: { id: key.orgId, name: key.orgName, slug: key.orgSlug },
        scope: "company-wide only",
        people: people.map((m) => ({
          id: m.amberId,
          name: m.fullName,
          email: m.email,
          role: m.role,
        })),
        groups: groups.map((g) => ({ id: g.id, name: g.name, purpose: g.purpose })),
        posts: posts.rows,
        files: files.rows,
        connections: connections.rows,
      };
    }),
  );

  /* ------------------------------------------------------------ writes -- */

  app.post(
    "/v1/api/posts",
    keyed("write", async ({ request, reply, key }) => {
      const body = String(request.body?.body ?? "").trim();
      if (!body) return reply.code(400).send({ error: "body_required" });

      const title = request.body?.title ? String(request.body.title).trim() : null;
      const kind = POST_KINDS.has(request.body?.kind) ? request.body.kind : "update";

      const { rows } = await query(
        /*
         * author_id IS NULL AND THAT IS THE TRUTHFUL ANSWER. A machine wrote
         * this. Attributing it to the admin who minted the key puts words in
         * a person's mouth; attributing it to a synthetic user puts a row in
         * the roster that cannot sign in. `source` carries the key's name, so
         * the feed can say "posted by Nightly CRM sync" and mean it.
         */
        `INSERT INTO org_posts (org_id, kind, title, body, author_id, visibility, source)
         VALUES ($1::uuid, $2, $3, $4, NULL, 'org', $5)
         RETURNING id, kind, title, body, created_at, source`,
        [key.orgId, kind, title, body, `key:${key.name}`],
      );
      return reply.code(201).send({ post: rows[0] });
    }),
  );
}
