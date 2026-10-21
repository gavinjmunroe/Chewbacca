import { getUserByEmail } from "../db/user-store.js";
import { getUserByPrivyDid as getUserByDid } from "../db/user-store.js";
/**
 * Tenant routes: the core API that amber-agent consumes.
 *
 * GET  /tenants/resolve?sender_id=xxx  - Resolve tenant by sender ID (webhook path)
 * GET  /v1/tenants/by-email?email=...  - Resolve tenant by an email address linked to the Privy user (Slack Option B auto-link)
 * GET  /tenants/list?active=true       - List all tenants (admin); active=true filters to tenants with loopSenderId set
 * GET  /tenants/me                     - Get current tenant from Privy token (app path)
 * GET  /tenants/:did                   - Get tenant by Privy DID
 * POST /tenants/seed                   - Create/merge tenant idempotently by phone (admin)
 * POST /tenants/upsert                 - Alias of /tenants/seed (admin)
 * POST /tenants/:did/metadata          - Update tenant metadata (admin)
 */

import { randomUUID } from "crypto";
import {
  requireAuth,
  tenantIndex,
  normalizePhone,
  rowToTenant
} from "../lib/auth-session.js";
import { requireApiKey, validateDid, validatePhone } from "../lib/auth.js";
import { findTenantByOAuthEmail } from "../lib/tenant-email-resolver.js";
import { upsertTenant, setTenantMetadata } from "../db/store.js";

// RFC-5322-ish bounded email check. We only need to filter out obviously
// malformed inputs before we ship them to Privy; full deliverability
// validation is out of scope.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isLikelyEmail(s) {
  return (
    typeof s === "string" && s.length > 3 && s.length <= 254 && EMAIL_RE.test(s)
  );
}

// Privy customMetadata only accepts primitive values (string, number, boolean).
// We serialize nested objects (permissions, onboardingProfile) as JSON strings
// prefixed with this marker and parse them back on read.
const JSON_MARKER = "__json__:";

function toMetaValue(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    return v;
  return JSON_MARKER + JSON.stringify(v);
}

function fromMetaValue(v) {
  if (typeof v === "string" && v.startsWith(JSON_MARKER)) {
    try {
      return JSON.parse(v.slice(JSON_MARKER.length));
    } catch {
      return v;
    }
  }
  return v;
}

export function encodeMetadata(metadata) {
  const out = {};
  for (const [k, v] of Object.entries(metadata || {})) {
    const encoded = toMetaValue(v);
    if (encoded !== undefined) out[k] = encoded;
  }
  return out;
}

function decodeMetadata(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta || {})) {
    out[k] = fromMetaValue(v);
  }
  return out;
}

/**
 * Extract the tenant object shape from a Privy user.
 *
 * IMPORTANT for downstream consumers (amber-imessage, amber-agent):
 *   - `displayName` / `ownerName` describe the TENANT OWNER (the human
 *     who registered this Amber account), NOT any inbound contact.
 *   - `agentName` is the AGENT BRAND for this tenant (e.g. "Camber",
 *     "Samber"). It is also tenant-owner-scoped.
 *   - The user-facing agent brand across deployments is always "Amber".
 *     "Amber-Dvlp" and "Amber-Prod" are deployment/channel labels, not
 *     names to surface to users.
 *
 * When handling an inbound message from a phone number, the contact's
 * identity MUST come from /internal/users/:did/contacts/by-phone — never
 * from this object. The `kind: "tenant_owner"` discriminator makes that
 * boundary visible at the wire level.
 */
export function userToTenant(user) {
  const meta = decodeMetadata(user.customMetadata);
  return {
    kind: "tenant_owner",
    id: user.id,
    privyDid: user.id,
    displayName: meta.displayName || null,
    agentName: meta.agentName || meta.displayName || null,
    ownerName: meta.ownerName || null,
    phoneNumber: meta.phoneNumber || user.phone?.number || null,
    loopSenderId: meta.loopSenderId || null,
    loopSenderPhone: meta.loopSenderPhone || null,
    onboardingProfile: meta.onboardingProfile || {},
    permissions: meta.permissions || {},
    contextRepo: meta.contextRepo || null,
    // Tab 3 — ghost-writing doctrine slug ("bma" | "rytual" | null) and
    // org affiliation. Read by medha-platform tenant.js so the writing
    // doctrine block injects on long-form prompts.
    writingDoctrine: meta.writingDoctrine || null,
    org: meta.org || null,
    // Tab 6 — workspace docs registry (named Sheet/Doc lookup).
    workspaceDocs: Array.isArray(meta.workspaceDocs) ? meta.workspaceDocs : [],
    preferences: meta.preferences || {},
    checkInSchedule: meta.checkInSchedule || null,
    createdAt: user.createdAt,
  };
}

/**
 * Ensure a tenant exists for `phone` so the in-app agent path works for any
 * user the moment they sign in.
 *
 * Why this exists: OTP sign-in (`/v1/auth/verify*`) only minted a session JWT
 * and never wrote a tenant. A tenant is a Privy user (keyed by phone) carrying
 * `phoneNumber` + `loopSenderId`; without one, `/v1/me` returns null identity
 * and medha-platform's quick-call path 424s (`caller_not_provisioned`) so the
 * agent never runs. This provisions that tenant on first sign-in.
 *
 * Design:
 *  - Idempotent and sender-preserving: if a tenant already has a loopSenderId
 *    (e.g. a real iMessage user like Caleb), it is returned untouched. We never
 *    clobber an existing loop sender with a synthetic one.
 *  - App-only users get a SYNTHETIC loopSenderId (a stable UUID). The in-app
 *    quick-call path captures the reply over SSE and never sends an iMessage,
 *    so a synthetic sender is sufficient to resolve the tenant and run the
 *    agent. A real sender number can be assigned later via /numbers/assign for
 *    iMessage without disturbing anything here.
 *  - Never throws. Provisioning must not block sign-in; on failure the user
 *    still gets their session and we log and move on.
 *
 * @param {string} phone  E.164 phone from the verified session
 * @param {object} [opts] { displayName }
 * @returns {Promise<object|null>} the tenant shape, or null on failure
 */
export async function ensureTenantForPhone(phone, opts = {}) {
  const e164 = normalizePhone(phone);
  if (!e164) return null;
  try {
    // Already fully-provisioned (has a loop sender)? Return untouched — never
    // clobber a real iMessage sender with a synthetic one.
    const existing = tenantIndex.getByPhone(e164);
    if (existing?.customMetadata?.loopSenderId) {
      return userToTenant(existing);
    }

    // Synthesize a stable loop sender only when none exists yet. App-only
    // users never send an iMessage (the quick-call path captures the reply
    // over SSE), so a synthetic UUID is enough to resolve the tenant and run
    // the agent. A real sender number is assigned later via /numbers/assign.
    const loopSenderId = existing?.customMetadata?.loopSenderId || randomUUID();
    const metadata = {
      phoneNumber: e164,
      loopSenderId,
      displayName:
        opts.displayName || existing?.customMetadata?.displayName || "Medha",
      onboardingProfile: existing?.customMetadata?.onboardingProfile || {
        completed: true,
        owner: true,
        source: "otp-auto-provision",
      },
    };

    // upsertTenant get-or-creates the Cloud SQL user by phone and merges the
    // metadata; phone uniqueness makes double-create impossible, so no live
    // list scan is needed the way the Privy path required.
    const row = await upsertTenant({ phone: e164, metadata });
    if (!row) return null;
    await tenantIndex.forceRefresh();
    return userToTenant(rowToTenant(row));
  } catch (err) {
    console.warn(
      `[ensureTenantForPhone] provisioning failed for ${e164}: ${err.message}`,
    );
    return null;
  }
}

export function registerTenantRoutes(app) {
  /**
   * GET /tenants/resolve?sender_id=xxx
   * GET /tenants/resolve?phone=+1...
   *
   * The critical path: amber-agent sends the sender ID from the
   * webhook, amber-id returns the TENANT OWNER who owns that sender.
   * Also supports lookup by the tenant owner's E.164 phone, which
   * CLAUDE.md has documented as the resolution alias for when only a
   * phone is known.
   *
   * NOTE: phone here is the TENANT OWNER's phone (the human who owns
   * this Amber account), NOT an inbound message sender's phone. For
   * inbound contact identity, callers must hit
   * /internal/users/:did/contacts/by-phone instead.
   *
   * No user auth required (called server-to-server with API key).
   */
  app.get(
    "/tenants/resolve",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const senderId = request.query.sender_id;
      const phone = request.query.phone;

      if (!senderId && !phone) {
        return reply.code(400).send({
          error: "sender_id or phone query param required",
        });
      }

      if (senderId) {
        if (typeof senderId !== "string" || senderId.length === 0) {
          return reply
            .code(400)
            .send({ error: "sender_id query param required" });
        }
        if (senderId.length > 256 || /[\s/\\<>]/.test(senderId)) {
          return reply.code(400).send({ error: "sender_id format invalid" });
        }
      } else {
        const phoneErr = validatePhone(phone);
        if (phoneErr) {
          return reply
            .code(400)
            .send({ error: "invalid_phone", message: phoneErr });
        }
      }

      try {
        const match = senderId
          ? tenantIndex.getByLoopSenderId(senderId)
          : tenantIndex.getByPhone(phone);

        if (!match) {
          return reply.code(404).send({
            error: senderId
              ? "No tenant found for this sender ID"
              : "No tenant found for this phone",
          });
        }

        return { data: userToTenant(match) };
      } catch (err) {
        request.log.error(err, "Failed to resolve tenant");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );

  /**
   * GET /v1/tenants/by-email?email=<address>
   *
   * Look up a tenant by an email associated with their Amber account.
   * Powers the Slack Option B auto-link path: medha-imessage's Slack
   * transport pulls the inbound user's profile email from Slack, calls
   * this route, and if a tenant comes back it auto-binds the Slack
   * identity without ever showing the user the Option C "send me your
   * phone" ceremony.
   *
   * Two-stage lookup:
   *   1. Privy linked account email (the user signed in with this address)
   *   2. OAuth-connected account email stored in the tenant's secrets bag
   *      under `*_OAUTH_ACCOUNT_EMAIL` keys (Google, Microsoft, GitHub,
   *      Railway, Notion, Slack, …). This catches the "Sagar messages
   *      from caleb@bluemodernadvisory.com which is his Microsoft work
   *      email, not his Privy primary" case.
   *
   * Returns the same envelope as /tenants/resolve, plus `matchedVia` on
   * the data block so the caller can log how the match was made. Returns
   * 404 only when both stages miss. Service-to-service only (x-api-key).
   * The email is normalized to lowercase before lookup.
   *
   * NOTE: Same tenant_owner discriminator as /tenants/resolve — the
   * returned phoneNumber is the account holder's, not the email owner's
   * inbound contact phone. For Slack auto-bind, the phone we want IS
   * the tenant owner's, because the Slack user IS the tenant owner.
   */
  app.get(
    "/v1/tenants/by-email",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const email = request.query.email;
      if (!isLikelyEmail(email)) {
        return reply.code(400).send({ error: "invalid_email" });
      }
      try {
        // Stage 1: Privy primary / linked email.
        const user = await getUserByEmail(email);
        if (user) {
          return {
            data: { ...userToTenant(user), matchedVia: "privy_primary" },
          };
        }

        // Stage 2: OAuth-connected account email in the secrets bag.
        const hit = await findTenantByOAuthEmail(email, {
          // Cloud SQL, via the tenant index. Was Privy listAllUsers().
          listAllTenants: async () => tenantIndex.getAll(),
        });
        if (hit?.did) {
          const tenant = await getUserByDid(hit.did);
          if (tenant) {
            return {
              data: {
                ...userToTenant(tenant),
                matchedVia: "oauth_account",
                matchedKey: hit.matchedKey,
              },
            };
          }
        }

        return reply
          .code(404)
          .send({ error: "No tenant found for this email" });
      } catch (err) {
        request.log.error(err, "Failed to resolve tenant by email");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );

  /**
   * GET /tenants/me
   *
   * Returns the current user's tenant profile from their Privy token.
   * Used by iOS app and web dashboard.
   */
  app.get(
    "/tenants/me",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const match = tenantIndex.getByDid(request.privyUser.userId);
        if (!match) {
          return reply.code(404).send({ error: "User not found" });
        }
        return { data: userToTenant(match) };
      } catch (err) {
        request.log.error(err, "Failed to get tenant");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );

  /**
   * GET /tenants/:did
   *
   * Get any tenant by DID (Privy DID or did:amber:<amber_id>). Admin endpoint.
   */
  app.get(
    "/tenants/:did",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const didErr = validateDid(request.params.did);
      if (didErr) {
        return reply.code(400).send({ error: "invalid_did", message: didErr });
      }
      try {
        const match = tenantIndex.getByDid(request.params.did);
        if (!match) {
          return reply.code(404).send({ error: "Tenant not found" });
        }
        return { data: userToTenant(match) };
      } catch (err) {
        request.log.error(err, "Failed to get tenant");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );

  /**
   * POST /tenants/seed
   *
   * Admin-only: create a Privy user for a phone number and seed their
   * tenant metadata in one call. Idempotent on phone: if a Privy user
   * with this phone already exists, we update metadata on that user
   * instead of failing. Intended for bootstrapping real users like
   * Caleb + Sagar without the Privy sign-up UI.
   *
   * Body: { phoneNumber, displayName, loopSenderId, loopSenderPhone,
   *         contextRepo, permissions, onboardingProfile }
   */
  const seedSchema = {
    body: {
      type: "object",
      required: ["phoneNumber"],
      properties: {
        phoneNumber: { type: "string" },
        displayName: { type: "string" },
        agentName: { type: "string" },
        ownerName: { type: "string" },
        loopSenderId: { type: "string" },
        loopSenderPhone: { type: "string" },
        contextRepo: { type: "string" },
        permissions: { type: "object" },
        onboardingProfile: { type: "object" },
      },
    },
  };

  async function seedHandler(request, reply) {
    const {
      phoneNumber,
      displayName,
      agentName,
      ownerName,
      loopSenderId,
      loopSenderPhone,
      contextRepo,
      permissions,
      onboardingProfile,
    } = request.body;

    const phoneErr = validatePhone(phoneNumber);
    if (phoneErr) {
      return reply
        .code(400)
        .send({ error: "invalid_phone", message: phoneErr });
    }
    if (loopSenderPhone) {
      const lpErr = validatePhone(loopSenderPhone);
      if (lpErr) {
        return reply.code(400).send({
          error: "invalid_loop_sender_phone",
          message: lpErr,
        });
      }
    }

    // tenant_metadata is real jsonb — nested objects (permissions,
    // onboardingProfile) are stored natively, so no marker-encoding.
    const rawMetadata = {};
    if (displayName) rawMetadata.displayName = displayName;
    if (agentName) rawMetadata.agentName = agentName;
    if (ownerName) rawMetadata.ownerName = ownerName;
    if (phoneNumber) rawMetadata.phoneNumber = phoneNumber;
    if (loopSenderId) rawMetadata.loopSenderId = loopSenderId;
    if (loopSenderPhone) rawMetadata.loopSenderPhone = loopSenderPhone;
    if (contextRepo) rawMetadata.contextRepo = contextRepo;
    if (permissions) rawMetadata.permissions = permissions;
    if (onboardingProfile) rawMetadata.onboardingProfile = onboardingProfile;

    try {
      // Idempotent get-or-create-by-phone + jsonb merge in Cloud SQL.
      const row = await upsertTenant({ phone: phoneNumber, metadata: rawMetadata });
      if (!row) {
        return reply
          .code(500)
          .send({ error: "Could not create or update tenant" });
      }
      await tenantIndex.forceRefresh();
      return { data: userToTenant(rowToTenant(row)) };
    } catch (err) {
      request.log.error(err, "Failed to seed tenant");
      return reply
        .code(500)
        .send({ error: "Internal server error", detail: err.message });
    }
  }

  app.post(
    "/tenants/seed",
    { preHandler: [requireApiKey], schema: seedSchema },
    seedHandler,
  );

  /**
   * POST /tenants/upsert
   *
   * Alias of /tenants/seed. amber-agent's register-tenant.js CLI posts here.
   * Same idempotent-by-phone semantics.
   */
  app.post(
    "/tenants/upsert",
    { preHandler: [requireApiKey], schema: seedSchema },
    seedHandler,
  );

  /**
   * GET /tenants/list?active=true
   *
   * List all tenants. When active=true (default), returns only tenants whose
   * loopSenderId metadata is set — i.e. tenants actually wired to a Loop sender.
   * amber-agent's scheduler calls this to know which tenants to run check-ins for.
   */
  app.get(
    "/tenants/list",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const activeParam = request.query.active;
      const activeOnly = activeParam === undefined || activeParam === "true";

      try {
        // Refresh so the admin/scheduler list reflects the latest Cloud SQL
        // state rather than a stale 30s snapshot.
        await tenantIndex.forceRefresh();
        const users = tenantIndex.getAll();
        const tenants = users
          .map((u) => userToTenant(u))
          .filter((t) => (activeOnly ? Boolean(t.loopSenderId) : true));
        return { data: tenants };
      } catch (err) {
        request.log.error(err, "Failed to list tenants");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );

  /**
   * POST /tenants/:did/metadata
   *
   * Update tenant metadata (phone, loop sender, permissions, etc).
   * Admin-only via API key.
   */
  app.post(
    "/tenants/:did/metadata",
    {
      preHandler: [requireApiKey],
      schema: {
        body: {
          type: "object",
        },
      },
    },
    async (request, reply) => {
      const { did } = request.params;
      const didErr = validateDid(did);
      if (didErr) {
        return reply.code(400).send({ error: "invalid_did", message: didErr });
      }
      const metadata = request.body;

      if (!metadata || typeof metadata !== "object") {
        return reply
          .code(400)
          .send({ error: "Request body must be a JSON object" });
      }

      // Allowed metadata fields
      const allowed = [
        "displayName",
        "agentName",
        "ownerName",
        "phoneNumber",
        "loopSenderId",
        "loopSenderPhone",
        "permissions",
        "onboardingProfile",
        "contextRepo",
        "writingDoctrine",
        "org",
        // Tab 6 — tenant-registered Sheets/Docs registry consumed by
        // medha-platform's workspace_list_docs / workspace_read_doc tools.
        "workspaceDocs",
        "preferences",
        "checkInSchedule",
      ];
      const filtered = {};
      for (const key of allowed) {
        if (metadata[key] !== undefined) filtered[key] = metadata[key];
      }

      try {
        // Merge the patch into tenant_metadata jsonb SQL-side (no read-modify-
        // write race). Resolves did:privy / did:amber / bare amber_id.
        const row = await setTenantMetadata(did, filtered);
        if (!row) {
          return reply.code(404).send({ error: "Tenant not found" });
        }

        // Refresh the tenant index if the sender mapping changed in any way
        // — set, cleared (empty string), or replaced.
        if (
          Object.prototype.hasOwnProperty.call(filtered, "loopSenderId") ||
          Object.prototype.hasOwnProperty.call(filtered, "loopSenderPhone")
        ) {
          await tenantIndex.forceRefresh();
        }

        return { data: userToTenant(rowToTenant(row)) };
      } catch (err) {
        request.log.error(err, "Failed to update tenant metadata");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );
}
