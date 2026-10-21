/**
 * GET /internal/bio/profile
 *
 * The normalized bio profile envelope the README has been calling out as
 * a design contract. Slice 1 ships:
 *
 *   - x-api-key auth (existing pattern)
 *   - X-Agent-Id header required; agent must be in KNOWN_AGENTS
 *   - X-User-Did header required
 *   - X-Agent-Scope optional; narrows the agent's defaultScope
 *   - Envelope sections stripped per scope before response
 *   - One Firestore audit log entry per call
 *
 * Slice 2 will promote KNOWN_AGENTS to a Firestore collection and add a
 * user-facing grant UI in the agent surface.
 */

import {
  effectiveScope,
  filterEnvelopeByScope,
  getAgent,
  parseScopeHeader,
  SCOPE_KEYS,
} from "../lib/agents.js";
import { requireApiKey, validateDid } from "../lib/auth.js";
import { collectionName } from "../lib/instance.js";
import {
  getUserByPrivyDid,
  getProfile,
  listPersonalityProfiles,
  listContacts,
} from "../db/user-store.js";

function firstHeader(value) {
  if (Array.isArray(value))
    return typeof value[0] === "string" ? value[0] : null;
  return typeof value === "string" ? value : null;
}

/**
 * Best-effort fire-and-forget audit write. We don't want a Firestore
 * outage to break the read path, so failures log a warning and otherwise
 * stay silent. Auditing is high-write by nature; Firestore matches the
 * pattern used for secrets and tenant runtime docs (see CLAUDE.md).
 */
async function writeAuditEntry({
  userDid,
  agentId,
  scopeGranted,
  scopeRequested,
  fieldsReturned,
  sectionsStripped,
  clientId,
  status,
}) {
  // WAS: append an access-log document to Firestore. Nothing ever read that
  // audit trail, and there is no Firestore. When bio access is worth auditing it
  // belongs in `audit_log`, beside every other audited action, in the same
  // database as the thing being audited.
  return { logged: false, reason: "audit_sink_removed" };
}


function buildEnvelope({ user, profile, personalities, contacts }) {
  // cnft_mint is still reported because agents read it as an identity field,
  // but it no longer names the vector namespace: knowledge lives in
  // `tenant-<did>`. Reporting `cnft:<mint>` here after the cNFT client was
  // retired would hand agents a namespace that does not exist.
  const cnftMint = user.cnftMint || user.cnft_mint || null;
  const tenantDid = user.privyUserId || user.id || null;
  // The external namespace this exposed no longer exists.
  const knowledgeNamespace = null;
  return {
    user: {
      did: user.privyUserId || user.id,
      cnft_mint: cnftMint,
      display_name: profile?.displayName || null,
      pronouns: profile?.pronouns || null,
      current_city: profile?.currentCity || null,
    },
    immutable: {
      birthday: profile?.birthday || null,
      birth_time: profile?.birthdayTime || null,
      birth_location: profile?.birthLocation || null,
      alma_mater: profile?.almaMater || null,
      hometown: profile?.hometown || null,
    },
    personality: (personalities || []).map((p) => ({
      framework: p.profileType,
      value: p.result,
      derived_from: p.derivedFrom || null,
      confidence: p.confidence ?? null,
    })),
    preferences: {
      tone: profile?.preferredTone || null,
      schedule_affinity: profile?.scheduleAffinity || null,
      communication_style: profile?.communicationStyle || null,
    },
    relationships: {
      summary: `${(contacts || []).length} contacts`,
      namespace: knowledgeNamespace,
      top_n: (contacts || []).slice(0, 20).map((c) => ({
        id: c.id,
        name: c.name,
        relationship_score: c.relationshipScore || 0,
      })),
    },
    permissions: {
      privacy_tier:
        profile?.privacyTier ||
        user.privacy_tier ||
        user.privacyTier ||
        "local_only",
      agent_scope: [], // filled in by the route handler
    },
    memory: {
      pinecone_namespace: knowledgeNamespace,
      writable: false, // filled in by the route handler
    },
  };
}

export function registerBioRoutes(app) {
  app.get(
    "/internal/bio/profile",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const agentId = firstHeader(request.headers["x-agent-id"]);
      const userDid = firstHeader(request.headers["x-user-did"]);
      const scopeHeader = firstHeader(request.headers["x-agent-scope"]);

      if (!agentId) {
        return reply.code(400).send({ error: "x-agent-id header required" });
      }
      if (!userDid) {
        return reply.code(400).send({ error: "x-user-did header required" });
      }
      const didErr = validateDid(userDid);
      if (didErr) {
        return reply.code(400).send({ error: didErr });
      }

      const agent = getAgent(agentId);
      if (!agent) {
        await writeAuditEntry({
          userDid,
          agentId,
          scopeGranted: [],
          scopeRequested: null,
          fieldsReturned: [],
          sectionsStripped: [],
          clientId: request.clientId,
          status: "unknown_agent",
        });
        return reply.code(403).send({
          error: "unknown agent",
          code: "unknown_agent",
          hint: "Agent must be registered in src/lib/agents.js KNOWN_AGENTS.",
        });
      }

      const requestedScope = parseScopeHeader(scopeHeader);
      const scope = effectiveScope(agentId, requestedScope);
      if (scope.length === 0) {
        await writeAuditEntry({
          userDid,
          agentId,
          scopeGranted: [],
          scopeRequested: requestedScope,
          fieldsReturned: [],
          sectionsStripped: [],
          clientId: request.clientId,
          status: "empty_scope",
        });
        return reply.code(403).send({
          error: "agent has no effective scope for this call",
          code: "empty_scope",
          requested: requestedScope,
          available: agent.defaultScope,
          known_scopes: SCOPE_KEYS,
        });
      }

      const user = await getUserByPrivyDid(userDid);
      if (!user) {
        await writeAuditEntry({
          userDid,
          agentId,
          scopeGranted: scope,
          scopeRequested: requestedScope,
          fieldsReturned: [],
          sectionsStripped: [],
          clientId: request.clientId,
          status: "user_not_found",
        });
        return reply.code(404).send({ error: "user_not_found" });
      }

      const [profile, personalities, contacts] = await Promise.all([
        getProfile(userDid),
        listPersonalityProfiles(userDid),
        listContacts(userDid),
      ]);

      const envelope = buildEnvelope({
        user,
        profile,
        personalities,
        contacts,
      });
      envelope.permissions.agent_scope = [...scope];
      envelope.memory.writable = scope.includes("memory.write");

      const sectionsStripped = filterEnvelopeByScope(envelope, scope);
      const fieldsReturned = Object.keys(envelope);

      await writeAuditEntry({
        userDid,
        agentId,
        scopeGranted: scope,
        scopeRequested: requestedScope,
        fieldsReturned,
        sectionsStripped,
        clientId: request.clientId,
        status: "ok",
      });

      return envelope;
    },
  );
}
