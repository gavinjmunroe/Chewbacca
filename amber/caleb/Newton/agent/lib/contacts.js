/**
 * Contact and conversation management: per-contact memory, conversation history,
 * profile extraction, staleness warnings, and in-memory caching.
 */

import {
  CALEB_PHONE,
  MEMORY_CACHE_TTL,
  HISTORY_LIMIT,
  AMBER_ID_API_URL,
  AMBER_ID_API_KEY,
} from "./constants.js";
import { sbGet, sbUpsert } from "./data.js";
import { normalizeHandle } from "./permissions.js";
import {
  isOwnerOfTenant,
  getOwnerFirstName as getTenantOwnerFirstName,
  getOwnerName as getTenantOwnerName,
  getAgentName as getTenantAgentName,
} from "./tenant.js";
import { callPerplexityLight } from "./tiwari/context.js";

// Re-export normalizeHandle for convenience
export { normalizeHandle };

// In-memory cache for per-contact data. Keys are namespaced by tenant so
// one tenant's data can never bleed into another's. Format: `${tenantId|_}:${handle}`.
export const contactMemoryCache = new Map();
export const conversationMemoryCache = new Map();

function contactCacheKey(handle, tenant) {
  return `${tenant?.id || "_"}:${handle}`;
}
function convoCacheKey(chatKey, tenant) {
  return `${tenant?.id || "_"}:${chatKey}`;
}

// Names that must never be used as a contact's displayName. Includes the
// product brand, every known agent persona handle, and the owner's first
// and full names for the resolved tenant. Used at BOTH write-time
// (extractAndUpdateContactProfile) and read-time (sanitizeLoadedContact)
// so we self-heal historic rows that captured the owner name as a
// contact displayName.
const STATIC_FORBIDDEN_CONTACT_NAMES = new Set([
  "amber", "amber-dvlp", "amber-prod", "camber", "samber",
  "caleb", "caleb newton", "sagar", "sagar tiwari",
  "ai", "bot", "assistant",
]);

export function isForbiddenContactDisplayName(name, tenant = null) {
  if (typeof name !== "string") return false;
  const lc = name.trim().toLowerCase();
  if (!lc) return false;
  if (STATIC_FORBIDDEN_CONTACT_NAMES.has(lc)) return true;
  if (!tenant) return false;
  try {
    const own = (getTenantOwnerName(tenant) || "").toLowerCase().trim();
    const ownF = (getTenantOwnerFirstName(tenant) || "").toLowerCase().trim();
    const ag = (getTenantAgentName(tenant) || "").toLowerCase().trim();
    if (own && own === lc) return true;
    if (ownF && ownF === lc) return true;
    if (ag && ag === lc) return true;
  } catch {
    // ignore — fall back to static block list
  }
  return false;
}

function sanitizeLoadedContact(profile, tenant) {
  if (!profile || profile.isCaleb) return profile;
  if (profile.displayName && isForbiddenContactDisplayName(profile.displayName, tenant)) {
    console.warn(
      `[contacts] dropping forbidden displayName "${profile.displayName}" for ${profile.handle}`,
    );
    return { ...profile, displayName: null };
  }
  return profile;
}

/**
 * Load a contact profile from Supabase (with in-memory cache).
 */
/**
 * Load a contact profile from Supabase (with in-memory cache).
 * @param {string} handle - Phone number or email
 * @param {Object|null} tenant - Tenant object for multi-tenant owner detection
 */
export async function loadContact(handle, tenant = null) {
  const norm = normalizeHandle(handle);
  const cacheKey = contactCacheKey(norm, tenant);
  const cached = contactMemoryCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < MEMORY_CACHE_TTL) {
    return cached.data;
  }

  // Determine if this handle is the tenant owner
  const isOwnerHandle = tenant
    ? isOwnerOfTenant(norm, tenant)
    : norm === normalizeHandle(CALEB_PHONE);

  const defaultProfile = {
    handle: norm,
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    messageCount: 0,
    isCaleb: isOwnerHandle,
    notes: [],
    trustScore: 0.1,
  };

  if (!AMBER_ID_API_URL || !AMBER_ID_API_KEY) return defaultProfile;

  try {
    const row = await sbGet(
      "contacts",
      `handle=eq.${encodeURIComponent(norm)}`,
      tenant,
    );
    const raw = row
      ? { ...defaultProfile, ...row.profile, handle: norm }
      : defaultProfile;
    const data = sanitizeLoadedContact(raw, tenant);
    contactMemoryCache.set(cacheKey, { data, fetchedAt: Date.now() });
    return data;
  } catch (err) {
    console.error("[loadContact] supabase error:", err.message);
    return defaultProfile;
  }
}

/**
 * Save a contact profile to Supabase and update the cache.
 */
export async function saveContact(handle, profile, tenant = null) {
  const norm = normalizeHandle(handle);
  const updated = {
    ...profile,
    handle: norm,
    lastSeen: new Date().toISOString(),
  };
  contactMemoryCache.set(contactCacheKey(norm, tenant), {
    data: updated,
    fetchedAt: Date.now(),
  });

  if (!AMBER_ID_API_URL || !AMBER_ID_API_KEY) return;

  try {
    await sbUpsert("contacts", { handle: norm, profile: updated }, tenant);
  } catch (err) {
    console.error("[saveContact] supabase error:", err.message);
  }
}

/**
 * Load conversation history from Supabase (with in-memory cache).
 */
export async function loadConversationHistory(chatKey, tenant = null) {
  const cacheKey = convoCacheKey(chatKey, tenant);
  const cached = conversationMemoryCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < MEMORY_CACHE_TTL) {
    return [...cached.data];
  }

  if (!AMBER_ID_API_URL || !AMBER_ID_API_KEY) return [];

  try {
    const row = await sbGet(
      "conversations",
      `chat_key=eq.${encodeURIComponent(chatKey)}`,
      tenant,
    );
    const data = row ? row.messages || [] : [];
    conversationMemoryCache.set(cacheKey, { data, fetchedAt: Date.now() });
    return [...data];
  } catch (err) {
    console.error("[loadConversationHistory] supabase error:", err.message);
    return [];
  }
}

/**
 * Save conversation history to Supabase and update the cache.
 */
export async function saveConversationHistory(chatKey, history, tenant = null) {
  const trimmed = history.slice(-HISTORY_LIMIT);
  conversationMemoryCache.set(convoCacheKey(chatKey, tenant), {
    data: trimmed,
    fetchedAt: Date.now(),
  });

  if (!AMBER_ID_API_URL || !AMBER_ID_API_KEY) return;

  try {
    await sbUpsert(
      "conversations",
      { chat_key: chatKey, messages: trimmed },
      tenant,
    );
  } catch (err) {
    console.error("[saveConversationHistory] supabase error:", err.message);
  }
}

/**
 * Auto-profile extraction: learns about contacts from conversations.
 * Health-centric: every fact gets a confidence score and health dimension tags.
 */

// Consolidation threshold
const MIN_MESSAGES_FOR_EXTRACTION = 3;
const MAX_NOTES_PER_EXTRACTION = 3;

export async function extractAndUpdateContactProfile(
  contact,
  userMessage,
  amberReply,
  isGroup,
  tenant = null,
) {
  if (contact.isCaleb) return;
  const lastUpdated = contact._lastExtractedAt || 0;
  if (Date.now() - lastUpdated < 5 * 60 * 1000) return;

  // Check conversation depth
  if ((contact.messageCount || 0) < MIN_MESSAGES_FOR_EXTRACTION) return;

  try {
    const raw = await callPerplexityLight(
      `Contact: ${contact.handle}
Current profile: ${JSON.stringify({ displayName: contact.displayName, relationship: contact.relationship, notes: (contact.notes || []).slice(-5) })}

Message: "${userMessage}"
Amber replied: "${amberReply.slice(0, 200)}"
Context: ${isGroup ? "group chat" : "DM"}

RULES:
- Extract info about ${contact.handle} ONLY
- NEVER save the assistant's name ("Amber", "Camber", "Samber") as displayName
- NEVER save the tenant owner's name ("${(tenant && getTenantOwnerFirstName(tenant)) || "Caleb"}", "${(tenant && getTenantOwnerName(tenant)) || "Caleb Newton"}") as displayName — that is the OWNER, not this contact
- Only set displayName if THIS contact explicitly said their own name
- Tag every note with its health dimension(s)

Return JSON:
{
  "displayName": "name or null",
  "name_changed": false,
  "relationship": "relationship or null",
  "notes": [
    {"fact": "what you learned", "confidence": 0.8, "dimensions": ["social", "emotional"], "source": "stated or inferred"}
  ],
  "howCalebtexts": "texting style or null",
  "trustScore": 0.5,
  "learned_something": true
}

Confidence guide:
- 0.9-1.0: they explicitly said it ("I work at Google", "my name is Sarah")
- 0.7-0.8: strongly implied ("just left the gym" implies physical activity)
- 0.5-0.6: weak inference (don't include unless notable)

Return {"learned_something": false} if nothing new.`,
      {
        maxTokens: 400,
        system: `You extract contact profile info from iMessage conversations. Return ONLY valid JSON.

THE 6 DIMENSIONS OF HEALTH (tag every note with relevant dimensions):
social: connections, relationships, community
financial: stability, income, career
intellectual: learning, curiosity, growth
spiritual: faith, purpose, meaning
physical: energy, sleep, movement
emotional: mood, regulation, peace`,
      },
    );

    if (!raw) return;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    const extracted = JSON.parse(jsonMatch[0]);
    if (!extracted.learned_something) return;

    // Block contact displayName values that would (a) collide with an
    // agent persona handle, or (b) echo the tenant OWNER's name back as
    // the contact's display name. The latter is the Maggie-called-Sagar
    // regression: when "Sagar" is in conversation context, the extractor
    // sometimes "learned" the contact's name was Sagar. Both directions
    // are wrong — see lib/contacts.js#isForbiddenContactDisplayName.
    const isNameChange =
      extracted.name_changed === true || extracted.name_changed === "true";
    if (
      extracted.displayName &&
      (!contact.displayName || isNameChange) &&
      !isForbiddenContactDisplayName(extracted.displayName, tenant)
    ) {
      const prev = contact.displayName;
      contact.displayName = extracted.displayName;
      console.log(
        isNameChange
          ? `   [profile] Name updated: ${prev} -> ${extracted.displayName} (${contact.handle})`
          : `   [profile] Learned name: ${extracted.displayName} (${contact.handle})`,
      );
    }
    if (extracted.relationship && !contact.relationship) {
      contact.relationship = extracted.relationship;
    }

    // Process confidence-scored notes
    if (Array.isArray(extracted.notes) && extracted.notes.length > 0) {
      const existingNotes = contact.notes || [];
      const existingFacts = new Set(
        existingNotes.map((n) =>
          (typeof n === "string" ? n : n.fact || "").toLowerCase(),
        ),
      );

      const newNotes = extracted.notes
        .slice(0, MAX_NOTES_PER_EXTRACTION)
        .filter((n) => {
          const fact = (typeof n === "string" ? n : n.fact || "").toLowerCase();
          if (!fact || fact.length < 5) return false;
          if (existingFacts.has(fact)) return false;
          const conf = typeof n === "object" ? n.confidence || 0.5 : 0.5;
          return conf >= 0.6;
        })
        .map((n) => {
          if (typeof n === "string")
            return {
              fact: n,
              confidence: 0.7,
              dimensions: [],
              source: "inferred",
              timestamp: new Date().toISOString(),
            };
          return {
            fact: n.fact,
            confidence: n.confidence || 0.7,
            dimensions: n.dimensions || [],
            source: n.source || "inferred",
            timestamp: new Date().toISOString(),
          };
        });

      if (newNotes.length > 0) {
        contact.notes = [...existingNotes, ...newNotes]
          .sort((a, b) => {
            const confA = typeof a === "object" ? a.confidence || 0.5 : 0.5;
            const confB = typeof b === "object" ? b.confidence || 0.5 : 0.5;
            return confB - confA;
          })
          .slice(0, 15);
        console.log(
          `   [profile] ${newNotes.length} new note(s) for ${contact.handle}: ${newNotes.map((n) => n.fact).join("; ")}`,
        );
      }
    }

    if (extracted.howCalebtexts) {
      contact.howCalebtexts = extracted.howCalebtexts;
    }
    if (typeof extracted.trustScore === "number") {
      contact.trustScore = Math.min(
        1,
        Math.max(
          0,
          (contact.trustScore || 0.5) * 0.8 + extracted.trustScore * 0.2,
        ),
      );
    }
    contact._lastExtractedAt = Date.now();
    await saveContact(contact.handle, contact);
  } catch (e) {
    console.warn(
      `   [profile] Extract failed for ${contact.handle}:`,
      e.message,
    );
  }
}

/**
 * Staleness warnings: flag old contact data so the model doesn't assert stale facts.
 */
export function buildStalenessWarning(contact) {
  if (!contact.notes || contact.notes.length === 0) return "";
  const now = Date.now();
  const warnings = [];

  // Check note timestamps
  const oldNotes = contact.notes.filter((n) => {
    if (typeof n !== "object" || !n.timestamp) return false;
    const age = now - new Date(n.timestamp).getTime();
    return age > 7 * 24 * 60 * 60 * 1000; // older than 7 days
  });

  if (oldNotes.length > 0) {
    warnings.push(
      `${oldNotes.length} of your notes about this person are over 7 days old. They may be outdated. Verify before stating as current fact.`,
    );
  }

  // Check last interaction
  const lastSeen = contact.lastSeen ? new Date(contact.lastSeen) : null;
  if (lastSeen) {
    const daysSince = Math.floor(
      (now - lastSeen.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (daysSince > 14) {
      warnings.push(
        `You haven't heard from this person in ${daysSince} days. Their situation may have changed.`,
      );
    }
  }

  return warnings.length > 0
    ? `\nSTALENESS WARNING: ${warnings.join(" ")}`
    : "";
}
