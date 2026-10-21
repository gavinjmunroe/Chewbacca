/**
 * POST /v1/chat — streaming chat that routes between plain Claude chat and the
 * existing PeopleRank pipeline, persisting turns to conversation_messages.
 *
 * Reuses, doesn't reinvent:
 *   - SSE streaming: the exact reply.hijack() / writeEvent / heartbeat / end
 *     pattern from src/routes/ask.js.
 *   - Anthropic calls: the raw-fetch pattern from src/jobs/memory-consolidator.js
 *     (x-api-key + anthropic-version), here extended with stream:true SSE parse.
 *   - PeopleRank: the same helpers me-people-rank.js uses —
 *     listContactsForRanking → filterRealContacts → dedupeContacts →
 *     buildMe(getProfile) → rankViaTogariSearch.
 *   - Store: appendMessage / listConversation (src/db/conversation-store.js).
 *   - Auth: requireAuth (src/lib/privy.js); user id from request.privyUser.userId.
 *
 * Everything is scoped to the caller's DID. Fail-safe: a router parse failure
 * routes to "chat" (never to an unwanted search); a PeopleRank failure on a
 * network query streams a graceful apology instead of 500-ing the stream.
 */

import crypto from "node:crypto";
import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { getProfile as defaultGetProfile } from "../db/user-store.js";
import { filterRealContacts } from "../lib/people-rank-realness.js";
import { dedupeContacts } from "../lib/people-rank-dedup.js";
import {
  rankViaTogariSearch as defaultRankViaTogariSearch,
  streamViaTogariSearch as defaultStreamViaTogariSearch,
  buildMe,
} from "../enrichment/togari-search-rank.js";
import { retrieveTopK, reembedContactSoon } from "../lib/contact-vectors.js";
import {
  retrieveByDimension as defaultRetrieveByDimension,
  applyRetrievalToContacts,
} from "../lib/dimension-retrieval.js";
import { recordVoiceCorrection, recordVoiceVocab } from "../lib/voice-vocab.js";
import { judgeNameMatches } from "../lib/name-judge.js";
import { contactsByAreaCode } from "../lib/area-codes.js";
import { gatherEverything } from "../db/gather.js";
import {
  summarizeAddressBook,
  contactsMatchingTopic,
  addressBookBrief,
  topicTermsFrom,
} from "../lib/address-book.js";
import { fastTagPeople } from "../lib/fast-tag.js";
import { findPlaces as defaultFindPlaces } from "../lib/place-search.js";
import { planQuery, LANE_LABELS, asksAboutTheirDay, orientationAsk } from "../lib/query-plan.js";
import { readAmberInventory as defaultReadAmberInventory } from "../db/inventory.js";
import { renderAmberBrief } from "../lib/amber-brief.js";
import { dayWindow, renderDayBrief } from "../lib/day-brief.js";
import {
  assumptionInstruction,
  buildSearchBrief as defaultBuildSearchBrief,
  startDateFor,
} from "../lib/search-brief.js";
import {
  listAgendaEvents as defaultListAgendaEvents,
  listScheduledReminders as defaultListScheduledReminders,
} from "../db/agenda.js";
import { listOpenReminders as defaultListOpenReminders } from "../db/schedule-store.js";
import { listCalendarAccounts as defaultListCalendarAccounts } from "../db/calendar-accounts.js";
import { markKnownWebPeople, countKnown } from "../lib/web-people-known.js";
import { recordLaneMs, orderLanesBySpeed } from "../lib/lane-speed.js";
import {
  getPreparedInput,
  setPreparedInput,
  invalidatePreparedInput,
} from "../lib/people-rank-prep-cache.js";
import { withSuggestionFloor } from "../lib/suggestion-floor.js";
import {
  appendMessage as defaultAppendMessage,
  mergeMessageMetadata as defaultMergeMessageMetadata,
  listConversation as defaultListConversation,
  listRecentConversations as defaultListRecentConversations,
} from "../db/csql-conversation-store.js";
import {
  resolveAmberIdByPhone,
  listContactsForRankingByAmberId,
  getUserProfileByAmberId,
  getPendingFactContext,
  getPendingFactContextById,
  listPendingFactContext,
  setPendingFactContext,
  updatePendingFactContext,
  clearPendingFactContextById,
  createContactForOwner,
  updateContactFields,
  getContactById,
  getContactsForResolution,
  searchContactsByName,
  getNetworkOverview,
  listAddressBookRows,
  searchContacts,
  listContactNamesForOwner,
  getContactContentForContacts,
  getPendingFactsByName,
  getUserFacts,
  getContactNameMemory,
  upsertContactNameMemory,
  updateFactContact,
  setNoteParticipants,
  setExperienceParticipants,
  getNoteById,
  getExperienceById,
} from "../db/store.js";
import { getCirclesForContact } from "../db/circles-store.js";
import { listFavorites } from "../db/favorites-store.js";
import { resolvePendingItem } from "../lib/resolve-pending.js";
import {
  exaSearch as defaultExaSearch,
  exaContents as defaultExaContents,
  exaFindPeople as defaultExaFindPeople,
  exaConfigured,
  looksLikePeopleSearch,
  urlsInMessage,
} from "../lib/exa-search.js";
// Typed-name matching, so a transposed letter does not become "you do not know
// anyone by that name". See the note at the top of that module for why the
// existing phoneticPool cannot do this.
import { fuzzyFindContactsByName } from "../lib/contact-name-match.js";
import { AMBER_IDENTITY } from "../lib/amber-identity.js";
import { SCHEDULE_HONESTY } from "../lib/schedule-honesty.js";
// Everything the user has ever recorded, in one query, with provenance. See the
// header of that module for why six tables had to become one question.
import {
  findPeopleByPlaceTerms as defaultFindPeopleByPlaceTerms,
  searchMemory,
  whoKnowsAboutNote,
} from "../db/memory-search.js";
import { peopleHintTerms, looksLikeAQuestion } from "../lib/people-hint.js";
import { groupAnswerPeople } from "../lib/answer-groups.js";
import {
  captureFromMessage,
  resolveContactByName,
  phoneticPool,
} from "../lib/fact-capture.js";

const _normName = (s) => (s || "").toLowerCase().trim();

// Hard guarantee for the no-em-dash rule: whatever the model emits, any em/en
// dash (with its surrounding spaces) becomes a comma-space before it is shown or
// stored. Belt to the prompt's suspenders.
const _stripDashes = (s) => (typeof s === "string" ? s.replace(/\s*[—–]\s*/g, ", ") : s);

// Join an array of names into a natural-language list: "A", "A and B", "A, B, and C".
function _joinNames(names) {
  if (!names || names.length === 0) return null;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

// Build the one-line acknowledgment text for a cleanly-captured outcome.
// Returns null for routes that need no announcement (shouldn't happen in practice).
/**
 * COLLAPSE A TURN'S CAPTURES TO ONE CARD PER PERSON.
 *
 * Exported for the test next to it. See the long note at the call site for what
 * this is fixing; the shape of it is simply that the client renders one card per
 * element of this array, so the array has to be keyed by person.
 *
 * Keying, in order of preference:
 *   contactId   a resolved contact. The only truly reliable key.
 *   "self"      every self_fact in the turn is the same subject: you.
 *   nothing     a note or experience carries participants rather than one
 *               person, so each keeps its own card and nothing merges.
 *
 * Merging keeps the FIRST card's identity (name, ids) and joins the distinct
 * `text` lines, so two facts about Shirley read as one confirmation with two
 * lines instead of two identical-looking cards. Order is preserved: the first
 * time a person appears is where their card stays.
 */
export function collapseCapturedByPerson(outcomes) {
  if (!Array.isArray(outcomes)) return [];
  const byKey = new Map();
  const out = [];
  for (const o of outcomes) {
    const key = o?.contactId ? `c:${String(o.contactId)}` : o?.isSelf ? "self" : null;
    if (key === null) {
      out.push(o);
      continue;
    }
    const seen = byKey.get(key);
    if (!seen) {
      // A copy, and `texts` from the start, so a single-fact card and a
      // merged one have the same shape and the client needs no special case.
      const first = { ...o, texts: o.text ? [o.text] : [] };
      byKey.set(key, first);
      out.push(first);
      continue;
    }
    if (o.text && !seen.texts.includes(o.text)) seen.texts.push(o.text);
    // Participants are additive: two signals about one contact can each name a
    // different second person.
    if (Array.isArray(o.participantIds) && o.participantIds.length > 0) {
      const merged = new Set([...(seen.participantIds ?? []), ...o.participantIds]);
      seen.participantIds = [...merged];
    }
    if (!seen.factId && o.factId) seen.factId = o.factId;
    if (!seen.name && o.name) seen.name = o.name;
  }
  // `text` stays the primary line so nothing reading the old field breaks; the
  // client can show the rest from `texts`.
  for (const card of out) {
    if (Array.isArray(card.texts) && card.texts.length > 0) card.text = card.texts[0];
  }
  return out;
}

function _captureAnnounceText(o) {
  if (o.route === "self_fact" || o.route === "self_field") {
    return "Got it, I'll note that about you.";
  }
  if (o.route === "contact_field") {
    return `Updated that for ${o.resolvedName ?? "them"}.`;
  }
  if (o.route === "fact") {
    return `Got it, I'll write that down for ${o.resolvedName ?? "them"}.`;
  }
  if (o.route === "note") {
    const list = _joinNames(Array.isArray(o.participantNames) ? o.participantNames.filter(Boolean) : []);
    return list ? `Got it, I'll write that down for ${list}.` : "Got it, I'll write that down.";
  }
  if (o.route === "experience") {
    const list = _joinNames(Array.isArray(o.participantNames) ? o.participantNames.filter(Boolean) : []);
    return list ? `Got it, I'll note that down with ${list}.` : "Got it, I'll note that down.";
  }
  return null;
}

// Render everything we hold on one contact into a compact dossier the model can
// answer from: identity, the circles they share with the user, and every saved
// note/fact. This is what turns "here is X, tap the card" into a real answer.
function _renderDossier(p, facts, circles) {
  const lines = [`Name: ${p.name}`];
  if (p.nickname) lines.push(`Goes by: ${p.nickname}`);
  if (p.title) lines.push(`Title: ${p.title}`);
  if (p.company) lines.push(`Company: ${p.company}`);
  if (p.city || p.region) lines.push(`Where: ${[p.city, p.region].filter(Boolean).join(", ")}`);
  if (p.birthday) lines.push(`Birthday: ${p.birthday}`);
  if (p.phone) lines.push(`Phone: ${p.phone}`);
  // THE NOTE THE USER TYPED ON THEIR OWN PHONE. It was not in the dossier at
  // all, so even when this path ran it described the person from their job title
  // and ignored the sentence the user had written about them.
  if (p.syncedNote) {
    lines.push(
      `What they wrote on this person's card in their phone: "${String(p.syncedNote).slice(0, 600)}"`,
    );
  }
  if (Array.isArray(circles) && circles.length > 0) {
    lines.push(
      `Circles you share with them: ${circles
        .map((c) => (c.description ? `${c.name} (${c.description})` : c.name))
        .join("; ")}`,
    );
  }
  const fx = Array.isArray(facts) ? facts : [];
  if (fx.length > 0) {
    lines.push("Notes and facts you have saved about them:");
    for (const f of fx) {
      const cat = f && f.category ? ` [${f.category}]` : "";
      const past = f && f.is_past ? " (past)" : "";
      lines.push(`- ${f.text}${cat}${past}`);
    }
  }
  return lines.join("\n");
}

// ── Same-name disambiguation scoring ─────────────────────────────
// When several contacts share the typed name, we pick who the user most likely
// means by scoring each on independent, owner-scoped signals. Every signal is
// normalized to 0..1, then combined with named weights that sum to 100, giving a
// 0..100 confidence. Kept deliberately simple to reason about and tune; deeper
// signals (interaction recency, PeopleRank, thread history) slot in later as new
// terms without changing the shape. Nothing here is contact- or user-specific:
// it reads only what THIS caller holds on THIS name.
const DISAMBIG_WEIGHTS = {
  nameMatch: 26, // typing more of the exact name is a strong intent signal
  notes: 30, // how much you've saved about them (engagement), weight-aware
  circles: 18, // an active, grouped relationship
  favorite: 12, // you explicitly marked them important
  connected: 8, // a real, linked Amber user
  enrichment: 6, // basic profile completeness (title / company)
};
// Guess confidently only when the top candidate clears this floor AND beats the
// runner-up by this margin; otherwise we ask which person they meant.
const DISAMBIG_MIN_LEAD = 12;
const DISAMBIG_MIN_MARGIN = 10;

// 0..1: how closely the typed query matches this contact's full name.
function _nameMatchScore(query, name) {
  const q = String(query || "").trim().toLowerCase();
  const n = String(name || "").trim().toLowerCase();
  if (!q || !n) return 0;
  if (q === n) return 1;
  const qWords = q.split(/\s+/).filter(Boolean);
  const nWords = n.split(/\s+/).filter(Boolean);
  if (n.startsWith(q)) return 0.85;
  const allPresent = qWords.every((w) => nWords.some((nw) => nw === w || nw.startsWith(w)));
  if (allPresent) return 0.7;
  return 0.5; // matched by the name search but only partially
}

// 0..1: engagement from saved facts, by summed per-fact weight (default 0.5),
// saturating so a few strong notes already read as "you know this person".
function _notesScore(facts) {
  const fx = Array.isArray(facts) ? facts : [];
  if (fx.length === 0) return 0;
  const weightSum = fx.reduce(
    (s, f) => s + (typeof f?.weight === "number" ? f.weight : 0.5),
    0,
  );
  return 1 - Math.exp(-weightSum / 2);
}

// Combine the normalized signals into a 0..100 confidence for one candidate.
function _scoreCandidate({ nameMatch, notes, circleCount, favorite, connected, hasTitle, hasCompany }) {
  const sub = {
    nameMatch,
    notes,
    circles: Math.min(1, (circleCount || 0) * 0.6),
    favorite: favorite ? 1 : 0,
    connected: connected ? 1 : 0,
    enrichment: Math.min(1, (hasTitle ? 0.5 : 0) + (hasCompany ? 0.5 : 0)),
  };
  let total = 0;
  for (const key of Object.keys(DISAMBIG_WEIGHTS)) total += DISAMBIG_WEIGHTS[key] * (sub[key] || 0);
  return total;
}

// ── Address-book name lookup ─────────────────────────────────────
// "who is Sagar", "contacts named Shirley", or a bare name typed on its own.
// A contact always has an id, so a name match is always answerable even when we
// hold no notes on the person. Two gates keep this from firing on ordinary
// network questions: the query must look like a lookup (or be a bare short name),
// AND it must actually match a contact by name.
const _LOOKUP_LEAD =
  /^(?:who\s+is|who's|whos|who\s+do\s+i\s+know\s+named|tell\s+me\s+about|what\s+do\s+(?:i|you)\s+know\s+about|do\s+i\s+know|find\s+me|find|contacts?\s+named|people\s+i\s+know\s+named|anyone\s+named|someone\s+named|show\s+me|search\s+for|look\s+up|lookup|pull\s+up)\s+/i;

function _extractLookupName(message) {
  if (!message || typeof message !== "string") return null;
  // Normalize smart punctuation FIRST: iOS auto-correct turns a straight
  // apostrophe into a curly one (' -> ’), so "who's Shirley" never matched
  // the straight-quote lead and slipped past this whole lookup. Fold every
  // apostrophe variant to a straight ' before the lead regex runs.
  const t = message
    .trim()
    .replace(/[‘’ʼ′`´]/g, "'")
    .replace(/[?.!]+$/g, "")
    .trim();
  let name;
  const lead = t.match(_LOOKUP_LEAD);
  if (lead) {
    name = t.slice(lead[0].length).trim();
    name = name.replace(/\b(?:online|in\s+my\s+(?:contacts|network|phone))\b.*$/i, "").trim();
  } else if (/^[a-z][a-z'’.\-\s]{1,40}$/i.test(t) && t.split(/\s+/).length <= 3) {
    name = t; // a bare short name typed on its own
  } else {
    return null;
  }
  name = name.replace(/[^a-z'’.\-\s]/gi, "").trim();
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 3 || name.length < 2) return null;
  return name;
}

// Returns true for conservative correction signals: "no", "actually", "I meant X", etc.
// Conservative by design — false-positives block the LLM call for a whole turn.
function _isCorrection(message) {
  if (!message || typeof message !== "string") return false;
  const t = message.trim().toLowerCase();
  if (/^(no|nope|nah|wrong|actually|not)\b/.test(t)) return true;
  if (t.includes("i meant") || t.includes("the other") || t.includes("that's the wrong") || t.includes("thats the wrong")) return true;
  return false;
}

// Try to find a display name for resolvedId by scanning the pending row's
// candidates JSON (handles all stored shapes: bare array, .names, .remainingCandidates,
// guessedId/guessedName). Returns null when not found rather than throwing.
const _CHAT_CONTACT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One contact's display name, owner-scoped. Null on anything unexpected. */
async function contactNameById(ownerId, contactId) {
  // uuid, not digits. contacts.id is a uuid, so this returned null for every
  // real contact and the name of a resolved person could never be looked up --
  // which is how a fact gets attributed to an id with no name beside it.
  if (!ownerId || !contactId || !_CHAT_CONTACT_ID_RE.test(String(contactId))) return null;
  try {
    const c = await getContactById(ownerId, String(contactId));
    const n = c?.name;
    return n ? String(n) : null;
  } catch {
    return null;
  }
}

/**
 * Every OTHER open pending row for the same spoken name.
 *
 * One rambled voice note ("Sam moved to SF and Sam is hiring") writes a
 * participant row, a field row and a fact row — three separate pending items
 * for one name. The user answers ONE card. Whatever that answer is, it has to
 * reach the other two, or the cards the user did not touch come straight back
 * on the next launch, which is exactly the "it keeps asking me the same thing"
 * complaint. Every branch that mutates a pending row sweeps its siblings.
 */
async function siblingPendingRows(ownerId, pending) {
  if (!ownerId || !pending) return [];
  try {
    const all = await listPendingFactContext(ownerId).catch(() => []);
    return all.filter(
      (p) =>
        p &&
        String(p.id) !== String(pending.id) &&
        _normName(p.raw_name) === _normName(pending.raw_name),
    );
  } catch {
    return [];
  }
}

/**
 * Turn one soft-confirm row ("did you mean Sam Chen?") into a full
 * "which one did you mean" row. Recomputed from the ROW's own metadata, not the
 * one the user tapped: siblings can be a different content_type (a note's
 * participant vs a fact's subject), and they downgrade to different awaiting
 * states.
 *
 * @returns {Promise<Array|null>} the candidate list now shown, or null when the
 *   row was not a soft confirm (siblings can be at different stages).
 */
async function downgradeSoftConfirmRow(ownerId, row) {
  if (!row || row.awaiting !== "soft_confirm") return null;
  let meta = null;
  try { meta = JSON.parse(row.candidates ?? "null"); } catch { /* ignore */ }
  const remaining = meta?.remainingCandidates ?? [];
  const isParticipant = row.content_type === "note" || row.content_type === "experience";
  const awaiting = isParticipant
    ? "which_participant"
    : meta?.kind === "field"
      ? "which_contact_field"
      : "which_contact";
  const candidates =
    !isParticipant && meta?.kind === "field"
      ? JSON.stringify({ field: meta.field, value: meta.value, names: remaining })
      : JSON.stringify(remaining);
  await updatePendingFactContext({
    id: row.id,
    ownerId,
    awaiting,
    candidates,
    reaskCount: 0,
  }).catch(() => null);
  return remaining;
}

/**
 * "Not either of those" — bump the re-ask counter, or give up and clear the row
 * once we have asked three times. Asking a fourth time is worse than losing the
 * tag.
 *
 * @returns {Promise<{gaveUp: boolean}>}
 */
async function bumpReaskRow(ownerId, row) {
  if (!row) return { gaveUp: false };
  if ((row.reask_count ?? 0) >= 3) {
    await clearPendingFactContextById(row.id, ownerId).catch(() => null);
    return { gaveUp: true };
  }
  await updatePendingFactContext({
    id: row.id,
    ownerId,
    reaskCount: (row.reask_count ?? 0) + 1,
  }).catch(() => null);
  return { gaveUp: false };
}

function _lookupNameInPendingMeta(pending, resolvedId) {
  let meta = null;
  try { meta = JSON.parse(pending.candidates ?? "null"); } catch { return null; }
  if (!meta) return null;
  const id = String(resolvedId);
  // soft_confirm shapes: guessedId + guessedName at the top level
  if (meta.guessedId != null && String(meta.guessedId) === id) return meta.guessedName ?? null;
  // remainingCandidates array — present in soft_confirm and NO-downgrade shapes
  if (Array.isArray(meta.remainingCandidates)) {
    const m = meta.remainingCandidates.find((c) => c && String(c.id) === id);
    if (m) return m.name ?? null;
  }
  // .names array — which_contact_field and which_participant shapes
  if (Array.isArray(meta.names)) {
    const m = meta.names.find((n) => typeof n === "object" && n && String(n.id) === id);
    if (m) return m.name ?? null;
  }
  // Bare array — which_contact (fact) shape: [{id, name}, ...]
  if (Array.isArray(meta)) {
    const m = meta.find((c) => c && String(c.id) === id);
    if (m) return m.name ?? null;
  }
  return null;
}

const ROUTER_MODEL = process.env.CHAT_ROUTER_MODEL || "claude-haiku-4-5-20251001";
const CHAT_MODEL = process.env.CHAT_MODEL || "claude-sonnet-4-6";

/**
 * HOW FAR AHEAD A CALENDAR QUESTION LOOKS.
 *
 * Eight days rather than seven: "what's on my calendar" asked on a Friday is
 * usually about the weekend and the week that follows it, and a seven-day
 * window ending on Friday cuts the answer off mid-question. Wide enough for
 * "what does next week look like", short enough that the block stays a
 * paragraph rather than a month of prompt.
 */
const DAY_BRIEF_DAYS = 8;
// THE SHORT ANSWERS THAT USED TO BE TEMPLATES. Small, fast, and streamed, so
// the first word lands sooner than the old fixed string did -- see the empty
// network answer below for why that is not a trade.
const FAST_CHAT_MODEL = process.env.FAST_CHAT_MODEL || "claude-haiku-4-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const INTENTS = ["chat", "network_query", "both", "overview", "search"];

const ROUTER_SYSTEM = [
  "You are a strict intent classifier for a personal assistant called Amber.",
  "Classify the user's NEWEST message and respond with ONLY a JSON object:",
  '{"intent":"chat","needs_web":false} — no prose, no markdown, no extra keys.',
  "For search, add a filters object, e.g.",
  '{"intent":"search","needs_web":false,"filters":{"company":"Google"}}.',
  "",
  "intent is one of:",
  '- "chat": general conversation, questions, help, advice — anything NOT asking',
  "  to find or identify people in the user's own network/contacts.",
  '  Examples: "hi", "what can you do", "I\'m building a deck in my backyard, any',
  '  tips?", "thanks".',
  '- "overview": asking for a SUMMARY or snapshot of their whole network or a',
  "  large grouping — totals, breakdowns, who they talk about most.",
  '  Examples: "tell me about my contacts", "summarize my network", "how many',
  '  people do I know", "who do I talk about most", "break my network down".',
  '- "search": asking WHO matches a STRUCTURED attribute — a company, job title,',
  "  or city — OR who is associated with a KEYWORD (a school, a club, a group, a",
  "  place, anything the user would have written down about them).",
  "  Put attributes in filters {company,title,city,name} and a keyword in",
  "  filters.q. q is searched across names, roles, notes and tags, so use it",
  "  whenever the ask is 'my <X> people' and X is not cleanly one of the four.",
  '  Examples: "who works at Google" -> {"company":"Google"}, "who do I know in',
  '  New York" -> {"city":"New York"}, "which of my contacts are designers" ->',
  '  {"title":"designer"}, "all my USC connections" -> {"q":"USC"}, "contacts',
  '  with USC in the name" -> {"q":"USC"}, "my Kappa people" -> {"q":"Kappa"},',
  '  "who did I meet at YC" -> {"q":"YC"}.',
  "  A remembered DETAIL is also a q search, because details live in notes:",
  '  "who likes Chinese food" -> {"q":"Chinese food"}, "who is vegetarian" ->',
  '  {"q":"vegetarian"}, "who did I say was raising" -> {"q":"raising"}, "who is my',
  '  boss" -> {"q":"boss"}, "who has kids" -> {"q":"kids"}.',
  "  A named person is a search too: \"who is Sagar Tiwari\" -> {\"name\":\"Sagar",
  '  Tiwari"}. Spelling may be wrong; pass it through as typed and the search',
  "  handles the typo.",
  '- "network_query": a VAGUE or semantic people-finding ask that is NOT a clean',
  "  attribute filter — ranking, reconnecting, fuzzy fit.",
  '  Examples: "who do I know in fintech", "who should I reconnect with", "find me',
  '  someone who does design".',
  '- "both": a network-finding ask that ALSO wants help framing/advising on top.',
  '  Examples: "who do I know that could help me build a deck, and how should I',
  '  approach them", "which of my contacts is in VC and what should I say to them".',
  "",
  "needs_web is true ONLY when answering requires CURRENT / real-time /",
  "post-training information that cannot be known reliably from training:",
  "live scores, current weather, today's news, recent events, real-time prices,",
  'anything phrased "latest" / "current" / "right now" / "today" / "this week".',
  "ALSO true for anything tied to a specific recent/named year or that changes",
  "over time and can't be known from training: rankings and superlatives (best /",
  'top / highest-rated X), "who is the current <role>", awards, openings/closings,',
  "prices, and any fact about the present or a recent year.",
  "needs_web is false for timeless or knowable facts (geography, history,",
  "definitions, how-to, general advice) — answered from knowledge, no search.",
  'Examples: "score of the Lakers game tonight" → true; "weather in NYC right now"',
  '→ true; "latest news on the merger" → true; "top rated restaurant in Manhattan',
  'in 2026" → true; "best sushi in LA" → true; "who is the mayor of NYC" → true;',
  '"tallest mountain in California" → false; "who wrote Hamlet" → false.',
  "ALSO true for ANY question about a specific place or local business — cafes,",
  "restaurants, bars, gyms, coworking, shops, venues — including what is good for",
  "a purpose (\"a cafe with wifi\", \"somewhere quiet to work\"), opening hours,",
  "whether somewhere is still open, how busy it is, and what it costs. These change",
  "constantly and cannot be known from training.",
  'Examples: "best cafe with wifi in the West Village" → true; "where can I work',
  'from in SoHo" → true; "is Balthazar open on Sunday" → true.',
  "For network_query (a people search), needs_web is almost always false.",
  "",
  "WHOSE PEOPLE. This is the distinction that decides between a people search and",
  "a web search, so check it explicitly. network_query / search / overview are ONLY",
  "for the user's OWN address book, and a message qualifies only if it actually says",
  'so — "my", "I know", "in my network", "my contacts", "who should I", "of mine".',
  "A people-finding ask with NO such reference is about the world, so it is",
  '"chat" with needs_web true.',
  'Examples: "who do I know in finance in NY" -> network_query, needs_web false;',
  '"list me ten VPs of finance in New York" -> {"intent":"chat","needs_web":true};',
  '"top healthcare VCs" -> {"intent":"chat","needs_web":true}; "which of my',
  'contacts are VPs of finance" -> search {"title":"VP of finance"}.',
  "When a message could be read either way, prefer the WEB reading: answering from",
  "the open web and being told it is not what they meant costs the user one tap,",
  "while searching an address book that cannot contain the answer wastes the turn.",
  "",
  'Use the recent conversation so follow-ups resolve (e.g. "which of them?" after',
  'a network query is "network_query" or "both"). When unsure about intent prefer',
  '"chat"; when unsure about needs_web prefer false.',
].join("\n");

// Shared answer style — clean, substantive Claude/Perplexity-grade prose.
// Tone + formatting ONLY; the people / web-grounding / marker contracts live in
// the per-mode prompts and WEB_GROUNDING and are unchanged.
const ANSWER_STYLE = [
  "Formatting and tone: write like a clean, substantive Claude/Perplexity answer —",
  "informative, well-organized, and easy to scan. Never use emojis. Be",
  "professional but warm, and concise. No filler exclamations (\"gorgeous!\",",
  "\"Enjoy it!\", \"Perfect weekend!\") and minimal exclamation marks — state the",
  "substance plainly. Use markdown that renders cleanly: **bold** for key terms or",
  "labels, \"- \" bullet points for lists of items, and short paragraphs. For",
  "multi-item answers (e.g. weather across several days) use a bulleted or",
  "bold-labeled structure like \"- **Saturday:** sunny, high 82F.\" rather than a",
  "chatty paragraph. Bold, bullets, numbered lists, checklists (\"- [ ] item\"),",
  "\"## Section\" headings, --- dividers, markdown links and GitHub-flavored markdown",
  "TABLES all render as real UI in the app, so PICK THE SHAPE THAT READS BEST and",
  "commit to it: a table whenever the answer is rows of things sharing the same",
  "two-to-four attributes; a checklist when the user is being handed things to DO; a",
  "numbered list when order or sequence matters; short ## sections when the answer",
  "splits into two or three distinct groups; plain prose when it is genuinely one",
  "thought. Never pour a list of items into a paragraph — if you catch yourself",
  "writing \"first..., then..., and also...\", that is a list. One shape per answer,",
  "no heading on a single-section reply, and no scaffolding for its own sake.",
  "",
  "WHAT THE APP CANNOT DRAW. These arrive on screen as literal characters, so they",
  "are worse than the plain text they were meant to decorate:",
  "NO backticks, inline or fenced — write a value or a name in **bold** instead.",
  "NO blockquotes (\"> \").",
  "NO nested or indented bullets — one flat level only. If a point needs",
  "sub-points, it is either its own short section or a table.",
  "NO images, footnotes, or raw HTML.",
  "TABLES: three or four columns, never more. A fifth scrolls off a phone and the",
  "reader has no way to know it is there. Keep cells to a few words — a sentence in",
  "a cell makes the row five lines tall.",
].join(" ");

// Non-negotiable house rules, appended to every reply-style prompt.
const HOUSE_RULES = [
  "ABSOLUTE RULES, no exceptions:",
  "(1) Never use em-dashes or en-dashes anywhere; use commas, periods, or separate sentences.",
  "(2) Never talk like an AI. Never say you are an AI, a model, an assistant, or a bot. Never say",
  "you \"don't have access\", \"can't browse the internet\", \"don't have the ability\", or otherwise",
  "describe your own limitations. You are Amber and you know the user and the people in their life.",
  "If something is missing, ask one short natural question or offer a next step instead of disclaiming.",
  "(3) NEVER state that you have saved, stored, noted, filed or recorded something.",
  "You do not know whether it was written: the save runs separately from this reply and",
  "confirms itself, on the person's own card. Saying \"Noted, saved as your boss\" when",
  "nothing persisted is the worst thing you can do to someone trusting you with their",
  "memory. Acknowledge what they told you and move the conversation on. Never promise",
  "the write, and never use the words saved/stored/noted/logged about their data.",
  "(4) YOU CANNOT SEND ANYTHING. No text, no email, no call, no calendar invite, no",
  "connection request goes out because you wrote it. When the person asks you to send,",
  "text, email, call or reply to somebody, write the message for them and SAY IN ONE",
  "SHORT LINE that they send it themselves. Rule (2) forbids talking about your own",
  "limitations and this is the one exception to it, because the alternative is worse:",
  "a reply that produces a message and never says who sends it reads exactly like a",
  "message that went out. Never say or imply it was sent, is sending, is on its way,",
  "or that you will send it.",
].join(" ");

const CHAT_SYSTEM = [
  AMBER_IDENTITY,
  "",
  "THIS TURN is ordinary conversation. Do NOT bring up the user's contacts,",
  "network, or specific people unless the user explicitly asked about people --",
  "with the one exception spelled out in your identity above, which is a question",
  "about YOU.",
  "Tone: be warm, natural, and varied. Never robotic or repetitive.",
  "HARD RULE: NEVER use em-dashes (—) or en-dashes (–) anywhere in your reply.",
  "Use periods, commas, or separate sentences instead. This is a strict rule.",
  "Do NOT open with canned AI phrases: never start with \"Got it\", \"That's great",
  "news\", \"Sounds like\", \"I noticed\", \"Absolutely\", \"Of course\", \"Great!\",",
  "\"Sure!\", or any similar filler opener. Just react naturally and get to the",
  "point. Write like a sharp friend texting, not an assistant. React genuinely to",
  "what the user shares: meet good news with warmth, a life update with interest,",
  "a hard thing with care. When the user mentions something about themselves or",
  "someone they know, acknowledge it naturally and, where there is a genuinely",
  "useful next step, offer it (not forced, just helpful, e.g. they moved to a new",
  "city, suggest something locally relevant if you know anything useful). Keep it",
  "concise, warm, and human. Plain punctuation. No dashes.",
  "Never end the conversation from your side. Always finish with a short question or an",
  "offer to go further, so the user can always keep the thread going.",
  // The "what can you do" carve-out MOVED INTO AMBER_IDENTITY, because it was
  // needed by every prompt and lived in this one. See that block.
  // DRAFTING. Reachable from the "Draft outreach to <name>" chip on a web answer, so
  // the person being written to is usually a stranger the answer just surfaced. A
  // generic template is worse than nothing here: the user will send this.
  "WHEN ASKED TO DRAFT A MESSAGE: write the message itself, ready to send, and",
  "nothing else around it. No preamble, no \"here's a draft\", no notes afterwards.",
  "Keep a cold approach under 90 words, open with the specific reason you are writing",
  "to THIS person (the role, the company, the thing they did or said that you know",
  "from the conversation above), make exactly one ask, and make it small and easy to",
  "say yes to. No flattery, no \"I hope this finds you well\", no \"I came across your",
  "profile\", no buzzwords. If a detail that would make the message land is missing,",
  "write the draft with the best version you can and put the one thing worth",
  "confirming in a single short line after it.",
  ANSWER_STYLE,
  HOUSE_RULES,
].join(" ");

// THE VOICE-NOTE REPLY. The user SPEAKS, and then READS the answer.
//
// This used to say "never write lists, bullet points, headings, or multiple
// paragraphs" and cap the reply at two to three sentences, on the theory that a
// voice reply should sound spoken. Amber never speaks back — it has no TTS and is
// not getting one — so the only thing that rule ever did was force a list the user
// dictated to be read back as a paragraph. Someone reciting six to-dos got one
// run-on sentence containing six to-dos, which is strictly harder to read than what
// they said. So the reply is now shaped like the content: ANSWER_STYLE decides, the
// same way it does everywhere else.
const VOICE_CHAT_SYSTEM = [
  AMBER_IDENTITY,
  "",
  "THIS TURN: the user just logged something out loud, and they are going to READ",
  "your reply, not hear it. Write for the eye.",
  "BE WORTH READING. The failure mode is a reply that just proves you were listening:",
  "'Got it, noted about Sagar.' That is a receipt, not an assistant. Reflect the",
  "specifics by name so it lands as heard, and then EARN the reply with something the",
  "user did not already know or had not put together — how this connects to someone",
  "else in their network, a tension or a deadline implied by what they said, what",
  "changed since the last time they mentioned this person, or the one thing that will",
  "be hard about the plan. One real observation beats three pleasant sentences.",
  "Say the useful thing even when it is mildly inconvenient: 'you have said you would",
  "email Priya twice now' is more valuable than agreeing.",
  "Vary your opening, and never open with a compliment on the note itself.",
  "When they dictated several discrete things — to-dos, people, plans — GIVE THEM BACK AS A",
  "STRUCTURED LIST, one per line, in their words, not compressed into a sentence.",
  "A checklist (\"- [ ] \") is right when the items are things to do; a table is right when",
  "each item has the same couple of attributes. One short line of acknowledgment above it is plenty.",
  "When they said one thing, answer in one or two sentences and do not invent structure for it.",
  "Then offer ONE concrete next step phrased as a short question, for example 'Want me to draft the intro to John and David?'.",
  "Keep the prose around it tight; the app already shows tappable suggestions and contact cards.",
  "HARD RULE: never use em-dashes or en-dashes. Use plain commas and periods. No emojis.",
  ANSWER_STYLE,
  HOUSE_RULES,
].join(" ");

const BOTH_SYSTEM = [
  AMBER_IDENTITY,
  "",
  "THIS TURN: the user asked something that",
  "involves people in their network; the relevant ranked people are provided to",
  "you. Help them with BOTH who to talk to and how to approach them, being specific",
  "and practical, and only reference the people provided.",
  ANSWER_STYLE,
  HOUSE_RULES,
].join(" ");

// Appended to the chat/both system prompt when live web results are supplied.
//
// This is the contract for a web-grounded answer, and it is deliberately specific.
// The old version said only "ground your answer and cite [1], [2]", which produced
// a correct-but-generic paragraph — the model would hedge, restate the question,
// and list places without saying anything that would actually make you pick one.
// Every clause below exists to kill one of those failure modes.
const WEB_GROUNDING = [
  "You are given current web results for this question, numbered [1], [2], ….",
  "Ground every specific claim in them and cite inline with those numbers.",
  "This answer is the user's alternative to opening Perplexity or Google. Match that",
  "bar: complete, specific, and structured so it can be read in one pass.",
  "",
  "SHAPE THE ANSWER TO THE ASK.",
  "Lead with the answer in the first sentence. Never open by restating the question",
  "or by narrating that you searched.",
  "KEEP IT SHORT ENOUGH TO ARRIVE. Every token is time the user spends watching text",
  "crawl onto a phone screen, and an answer that is still generating is worth nothing",
  "to them. Aim for under 200 words of prose. One table of at most five rows, and one",
  "or two sentences after it. Do not add a summary of the table, a \"how to choose\"",
  "section, and a closing question — pick the single most useful one.",
  "If the user asked for a LIST or a COUNT (\"list ten…\", \"top 5…\", \"who are the…\"),",
  "give exactly that many rows if the sources support it, and say how many you could",
  "actually verify if they do not. Use a GitHub-flavored markdown TABLE whenever each",
  "row has more than one attribute worth comparing — people (name, title, company,",
  "where), places (name, neighborhood, what it is good for, price), products (name,",
  "price, catch). Pick columns that answer the question; three or four, never more.",
  "For a recommendation, name three to five real options and, for each, the ONE",
  "detail that decides between them. For a factual question, give the figure and the",
  "date it applies to.",
  "",
  "READING A NAMED DOCUMENT. When the user pointed at a specific page, the answer",
  "comes from THAT page. Quote or paraphrase what it actually says, name the section",
  "or figure you took it from, and if the thing they asked about is not in it, say",
  "that it is not in it — do not answer from general knowledge and let them assume",
  "you read it. If the page was only partially retrieved, say which part you saw.",
  "",
  "EXTRACTING. When the sources contain the raw material rather than the answer —",
  "a directory, a staff page, a filing, a long article — do the work: pull out the",
  "rows, normalize them into the same shape, drop duplicates and near-duplicates",
  "(same person spelled two ways, same company under a parent), and say how many you",
  "could actually verify versus how many were asked for. Never pad a list to the",
  "requested length with guesses; a verified six beats a fabricated ten, and say",
  "which six they are and where each came from.",
  "",
  "WHEN VERIFIED PROFILES ARE SUPPLIED. The app is ALREADY showing those people as",
  "cards with their name, role, company and a working link. So do NOT restate them:",
  "no table of those same people, no bulleted roster, no name-role-company lines. The",
  "cards are the list; repeating it as a table renders the same information twice and",
  "leaves empty cells for anyone whose profile was thin.",
  "Instead write PROSE that only a reader of the whole set could write: say how many",
  "were found, then who to start with and why, what they have in common, which ones are",
  "a stretch, and what a sharper query would surface. Two short paragraphs.",
  "Name ONLY people from that list, never mention someone whose details you do not",
  "have, and if fewer came back than were asked for, say the number plainly.",
  "",
  "LINKS. Every named place, person, company or product gets a markdown link to its",
  "own source page — [Balthazar](https://…), not a bare citation number — so the user",
  "can go straight there. Inside a table, link the name cell. Only ever link a URL",
  "that appears in the results; never invent or guess one.",
  "",
  "SUBSTANCE.",
  "Prefer specifics over adjectives: a named street, a real price, an actual time.",
  "\"Charming\" and \"popular\" are not information. If two sources disagree, say so",
  "and say which you'd trust.",
  "Anything that moves week to week — hours, availability, prices, whether a place",
  "is still open, whether someone is still in a role — is reported as of the source,",
  "not as a standing fact.",
  "If the results do not cover part of the question, say that plainly rather than",
  "filling the gap from memory. A short list you can stand behind beats a long one",
  "you cannot.",
  "End with one short line the user can act on. Never end with a summary of what",
  "you just said.",
].join(" ");

/**
 * How many web results to pull for this question.
 *
 * A single number cannot serve both "is Balthazar open on Sunday" and "list ten VPs
 * of finance in New York". The second needs breadth — ten names will not come out of
 * five pages once duplicates and off-topic listicles are dropped — while the first
 * gets slower and no better past a handful. So: read the count the user asked for and
 * fetch enough pages to have a chance of filling it.
 */
const WEB_RESULTS_DEFAULT = 6;
const WEB_RESULTS_MAX = 20;
const _NUMBER_WORDS = {
  three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};
// ── HOW MANY PEOPLE DID THEY ASK FOR ─────────────────────────────────────────
//
// The people limit was hardcoded to 15 at both call sites, so "give me three
// people to talk to" and "who do I know in finance" got the same fifteen, and
// asking for five got fifteen.
//
// WHY THIS IS STRICTER THAN webResultCount. That one accepts any bare digit once
// the question looks list-shaped. A people question is ALWAYS list-shaped, so the
// same rule would read a count out of every number anyone mentions: "who do I
// know at 3M", "who do I know who turned 30", "who do I know in the 10th
// arrondissement". Each would silently cap the answer at 3, 30 and 10.
//
// So a number only counts when it is ADJACENT to a counting word: either it
// qualifies a person noun ("5 people", "three friends"), or it follows an
// explicit request ("top 5", "give me three", "list 10"). Everything else gets
// the default, which is the safe direction to fail -- returning the usual number
// of people is a mild miss; silently truncating to a year or a street number is
// not.
const PEOPLE_RESULTS_DEFAULT = 15;
const PEOPLE_RESULTS_MAX = 50;
const _PEOPLE_NOUNS = "people|persons|person|folks|friends|contacts|names|names|guys|humans";
const _ASK_VERBS = "top|first|best|give me|show me|list|name|suggest|recommend|find me";

export function peopleResultCount(message) {
  const text = String(message || "").toLowerCase();
  const words = Object.keys(_NUMBER_WORDS).join("|");
  const num = `(\\d{1,2}|${words})`;

  const toN = (tok) => {
    const d = Number(tok);
    if (Number.isFinite(d)) return d;
    return _NUMBER_WORDS[tok] ?? 0;
  };

  // "5 people", "three friends", "a couple of contacts"
  let m = text.match(new RegExp(`\\b${num}\\s+(?:${_PEOPLE_NOUNS})\\b`));
  // "top 5", "give me three", "list 10" — optionally followed by the noun.
  if (!m) m = text.match(new RegExp(`\\b(?:${_ASK_VERBS})\\s+${num}\\b`));
  if (!m) return PEOPLE_RESULTS_DEFAULT;

  const asked = toN(m[1]);
  // A count only counts if it is a plausible one to ask for. Outside the range
  // it is far likelier to be an address, a year or an age than a request.
  if (!Number.isFinite(asked) || asked < 1 || asked > PEOPLE_RESULTS_MAX) {
    return PEOPLE_RESULTS_DEFAULT;
  }
  return asked;
}

export function webResultCount(message) {
  const text = String(message || "").toLowerCase();
  // Is this a list-shaped ask at all? Checked FIRST, because a bare number in a
  // question is usually not a requested count — "a cafe in the 10th arrondissement"
  // and "revenue in 2026" both contain one, and neither wants twenty sources.
  const listy =
    /\b(list|top|best|rank|ranked|options|alternatives|compare|examples|names|who are|recommend|suggest|ideas|places|spots)\b/.test(
      text,
    );
  if (!listy) return WEB_RESULTS_DEFAULT;

  let asked = 0;
  const digits = text.match(/\b(\d{1,3})\b/);
  if (digits) asked = Number(digits[1]);
  if (!asked) {
    for (const [word, n] of Object.entries(_NUMBER_WORDS)) {
      if (new RegExp(`\\b${word}\\b`).test(text)) {
        asked = n;
        break;
      }
    }
  }
  // A count only counts if it is a plausible one to ask for. 50 is generous; a
  // year or a street number is not a request for 2,026 sources.
  if (asked > 0 && asked <= 50) {
    // Roughly two sources per requested row, because one page rarely yields one
    // clean row — floored at the default so "top 3" still gets real coverage.
    return Math.max(WEB_RESULTS_DEFAULT, Math.min(WEB_RESULTS_MAX, asked * 2));
  }
  // A listy ask with no number in it. Was 12, which is a very large prompt to
  // generate against — and prompt size is time-to-first-token, which the user
  // experiences as the answer crawling out. Eight covers a recommendation without
  // making every one of them slow.
  return 8;
}


// The chip offered when a people search comes up empty. The web is a genuinely
// different answer, not a retry, so it is the user's call — offering costs nothing
// and searching the open web for someone they asked about privately, without
// asking first, is not a call to make on their behalf.
const WEB_SEARCH_CHIP_LABEL = "Search the web";
const webSearchChip = (query) => ({
  type: "web_search",
  label: WEB_SEARCH_CHIP_LABEL,
  query: String(query || "").slice(0, 2000),
});

const GRACEFUL_NO_MATCHES =
  "I don't have anything saved that answers that yet, so I won't guess. Tell me " +
  "who comes to mind and why, and I'll remember it, so next time I can answer " +
  "right away.";

// Same situation, but said in a way that leads with the two options the user
// actually has right now.
//
// The FIRST is voicing something, and it is first on purpose: a web search cannot
// tell you who to invite to dinner, and the only thing that ever will is the user
// having said something about their own people. So the empty answer asks for that
// specific, small, sayable thing — "someone who moved to or is visiting SF" — not
// the unanswerable "tell me about your contacts".
//
// NAMING THE PLACE OR TOPIC BACK is what makes it feel like a next step rather
// than an error message. When the question named a region we know, we use its
// name; otherwise the invitation stays generic rather than inventing a place.
//
// The SECOND is the web, carried by a web_search chip holding their original
// question, so accepting is one tap and nothing has to be retyped.
function webOfferNoMatches(placeName) {
  const where = placeName ? ` to or visiting ${placeName}` : "";
  return (
    "Nothing in your contacts answers that yet, and I won't guess. Want to voice " +
    `something about someone who's moved${where}? Even one sentence — I'll pull ` +
    "the facts out of it and remember them, so next time the answer comes straight " +
    "from your own people. Or I can search the web for it right now."
  );
}

// Bail out of the ranker if any single step stalls, so a people-search can never
// leave the user staring at "Thinking…". On timeout we fall through to the
// graceful capture invite instead of grinding.
const RANK_STEP_TIMEOUT_MS = 7000;
const _RANK_TIMEOUT = Symbol("rank_timeout");
async function* _withStepTimeout(gen, ms) {
  const it = gen[Symbol.asyncIterator]();
  try {
    while (true) {
      let timer;
      const timeout = new Promise((res) => {
        timer = setTimeout(() => res(_RANK_TIMEOUT), ms);
      });
      let step;
      try {
        step = await Promise.race([it.next(), timeout]);
      } finally {
        clearTimeout(timer);
      }
      if (step === _RANK_TIMEOUT) return;
      if (step.done) return;
      yield step.value;
    }
  } finally {
    try {
      await it.return?.();
    } catch {
      /* generator cleanup best-effort */
    }
  }
}

function requirePrivyDid(request, reply) {
  const privyDid = request.privyUser?.userId;
  if (!privyDid) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  return privyDid;
}

/**
 * Map prior turns + the current message into Anthropic's messages[] form,
 * enforcing the alternation Anthropic requires: consecutive same-role turns are
 * merged, and any leading assistant turns are dropped so the array starts with
 * a user turn.
 */
export function toAnthropicMessages(history, current) {
  const out = [];
  const push = (role, content) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += "\n" + content;
    else out.push({ role, content });
  };
  for (const m of history || []) {
    if (m.role === "user" || m.role === "assistant") push(m.role, m.content);
  }
  push("user", current);
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

/**
 * Router: classify the newest message (Haiku, non-streaming, fast). Returns one
 * of INTENTS. Fail-safe: any missing key / non-ok / parse failure → "chat".
 * Network boundary (fetchImpl) injectable for tests.
 */
export async function classifyIntent({
  message,
  history = [],
  model = ROUTER_MODEL,
  apiKey = process.env.ANTHROPIC_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  // Fail-safe default returned on every error path below.
  //
  // EVERY ONE OF THESE PATHS NOW SAYS SO. `SAFE` is { intent: "chat", needsWeb: false },
  // which is indistinguishable from the router working correctly and deciding the
  // question needs no web search. So a retired ROUTER_MODEL id, a 429, a missing key or
  // a malformed reply all produced a confident, sourceless, ungrounded answer with no
  // trace anywhere — while the Sonnet chat path kept working, because it uses a
  // different model id. That is the whole reason web search "was wired up" and never
  // once ran.
  const SAFE = { intent: "chat", needsWeb: false };
  if (!apiKey) {
    console.error("[router] ANTHROPIC_API_KEY is not set — every turn will route to chat with no web");
    return SAFE;
  }
  if (typeof fetchImpl !== "function") return SAFE;
  const histText = (history || [])
    .slice(-6)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
  const user =
    (histText ? `Recent conversation:\n${histText}\n\n` : "") +
    `Classify this newest user message:\n"""${message}"""`;
  try {
    const resp = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 90, // room for {"intent":"search","needs_web":false,"filters":{...}}
        system: ROUTER_SYSTEM,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      const detail = await resp.text?.().catch(() => "");
      // The model id is printed because a retired one is the likeliest cause of a 404
      // here, and it is the one thing that is invisible from the outside.
      console.error(
        `[router] HTTP ${resp.status} model=${model}: ${String(detail || "").slice(0, 300)}`,
      );
      return SAFE;
    }
    const data = await resp.json();
    const text = (data?.content || [])
      .map((b) => (b && typeof b.text === "string" ? b.text : ""))
      .join(" ");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) {
      console.error(`[router] no JSON in reply: ${text.slice(0, 200)}`);
      return SAFE;
    }
    const parsed = JSON.parse(m[0]);
    const intent = INTENTS.includes(parsed?.intent) ? parsed.intent : "chat";
    // needs_web only meaningful for chat/both; a people search never searches web.
    const needsWeb =
      parsed?.needs_web === true && (intent === "chat" || intent === "both");
    // filters only meaningful for search; keep just the known string fields.
    let filters = null;
    if (intent === "search" && parsed?.filters && typeof parsed.filters === "object") {
      const f = parsed.filters;
      const pick = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
      filters = {
        company: pick(f.company),
        title: pick(f.title),
        city: pick(f.city),
        name: pick(f.name),
        // Free-text keyword, matched across names, roles, notes and tags. This
        // is what "all my USC connections" needs: USC is not a company, a title
        // or a city, and for most of these contacts it is in the NAME or a note.
        q: pick(f.q),
      };
    }
    return { intent, needsWeb, filters };
  } catch (e) {
    console.error(`[router] FAILED model=${model}: ${e?.name || ""} ${e?.message || e}`);
    return SAFE; // fail safe: chat, no web — never an unwanted search
  }
}

const REWRITE_SYSTEM = [
  "You convert a user's chat message into a concise SEARCH QUERY used to rank",
  "the user's OWN personal contacts. Use the recent conversation to resolve",
  'referents: if the message says "them", "those people", "rescore them", "that',
  'list", etc., figure out WHO the prior turns were about and carry that subject',
  "into the query. Extract the search intent — the kind of person sought",
  "(role / industry / skill) plus any location or attribute mentioned — and emit",
  "it as a SHORT NOUN PHRASE, not a sentence.",
  "",
  "Examples:",
  '- history about "finance people in the Bay Area" + message "I\'m in California',
  '  now, can you rescore them" → finance professionals in California Bay Area',
  '- message "who do I know in tech?" → people who work in technology',
  '- history about "engineers" + message "any of them in NYC?" → engineers in New York City',
  '- message "find me a designer" → product or graphic designers',
  "",
  "If the message is already a clean search phrase, return it mostly as-is",
  "(lightly normalized). Output ONLY the query string — no quotes, no preamble,",
  "no JSON, no explanation. Plain text, one line.",
].join("\n");

/**
 * Query understanding: rewrite a raw chat message into a concise contact-search
 * query, resolving referents ("rescore them") via the recent conversation.
 * Modeled on classifyIntent: same raw-fetch Claude call, ROUTER_MODEL (Haiku),
 * non-streaming. FAIL-SAFE: any missing key / error / empty / overlong result
 * returns the original `message` unchanged — ranking must never break here.
 */
export async function rewriteQuery({
  message,
  history = [],
  model = ROUTER_MODEL,
  apiKey = process.env.ANTHROPIC_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey || typeof fetchImpl !== "function") return message;
  const histText = (history || [])
    .slice(-6)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
  const user =
    `Conversation so far:\n${histText || "(none)"}\n\n` +
    `Current message: ${message}\n\n` +
    `Search query:`;
  try {
    const resp = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 120,
        system: REWRITE_SYSTEM,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return message;
    const data = await resp.json();
    const text = (data?.content || [])
      .map((b) => (b && typeof b.text === "string" ? b.text : ""))
      .join(" ");
    // First non-empty line, stripped of surrounding quotes/backticks.
    const firstLine = String(text || "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    const cleaned = (firstLine || "").replace(/^["'`]+|["'`]+$/g, "").trim();
    if (!cleaned || cleaned.length > 200) return message; // unusable → raw
    return cleaned;
  } catch {
    return message; // never break ranking
  }
}

/**
 * Stream a Claude reply (Anthropic Messages API, stream:true SSE). Calls
 * onToken(text) per content_block_delta and returns the full accumulated text.
 * Network boundary injectable for tests. Degrades to a one-line fallback when
 * no key / no stream body so the caller never hangs.
 */
/**
 * Normalize the `system` argument into what the API expects.
 *
 * A PLAIN STRING IS PASSED THROUGH UNCACHED, deliberately. Prompt caching is
 * PREFIX caching: it caches from the start of the prompt up to the breakpoint,
 * and a cache WRITE costs 1.25x normal input while a hit costs 0.1x. So marking
 * a prompt whose opening bytes change every turn does not save anything — it
 * makes that call 25% MORE expensive, every time, forever. Several system
 * prompts in this file are assembled with per-request lines FIRST and the stable
 * house rules last, which is the wrong order to cache and not worth reordering,
 * because instruction order changes model behavior.
 *
 * Caching is therefore OPT-IN per call site: pass an array of
 * `{ text, cache?: true }` blocks and mark only the genuinely stable prefix.
 * Anthropic also ignores a breakpoint under ~1024 tokens (~2048 on Haiku), so a
 * marked-but-short prefix is a silent no-op rather than an error — see the
 * measurements in the commit message for which prompts clear the floor.
 */
export function toSystemParam(system) {
  if (system == null) return undefined;
  if (typeof system === "string") return system;
  if (!Array.isArray(system)) return undefined;
  const blocks = [];
  for (const part of system) {
    const text = typeof part === "string" ? part : part?.text;
    if (typeof text !== "string" || text.length === 0) continue;
    const block = { type: "text", text };
    if (part && typeof part === "object" && part.cache) {
      block.cache_control = { type: "ephemeral" };
    }
    blocks.push(block);
  }
  return blocks.length > 0 ? blocks : undefined;
}

export async function streamChat({
  model = CHAT_MODEL,
  system,
  messages,
  maxTokens = 1024,
  apiKey = process.env.ANTHROPIC_API_KEY,
  fetchImpl = globalThis.fetch,
  onToken = () => {},
} = {}) {
  if (!apiKey || typeof fetchImpl !== "function") {
    const t = "I can't reach my language model right now. Please try again.";
    onToken(t);
    return t;
  }
  // A stalled model connection must never hang "Thinking…" forever. An abort
  // controller with two watchdogs guards it: the model has FIRST_TOKEN_MS to
  // start, and IDLE_MS between tokens once it has. Either lapse aborts the
  // fetch, the reader rejects, and we return whatever we have (or a short retry
  // line) so the client always resolves.
  const FIRST_TOKEN_MS = 18000;
  const IDLE_MS = 12000;
  const MAX_ATTEMPTS = 2; // one retry before falling back
  const RETRY_BACKOFF_MS = 500;
  let controller;
  let watchdog;
  const arm = (ms) => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      try {
        controller?.abort();
      } catch {
        /* already aborted */
      }
    }, ms);
  };

  // Attempt the streaming request up to MAX_ATTEMPTS times. Retrying here is
  // safe: nothing has been emitted to onToken yet, so the response contract is
  // unchanged — the caller still sees a single clean stream (or the fallback
  // line). Each failed attempt is logged with WHY (HTTP status + a truncated
  // body, or the thrown error) so a real Anthropic failure (bad model id, 429,
  // 529 overloaded, auth) is visible in prod instead of a silent fallback.
  let resp = null;
  let networkError = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Fresh controller per attempt — a watchdog abort on a prior attempt must
    // not poison the retry's fetch.
    controller = new AbortController();
    networkError = false;
    let failure = "";
    try {
      arm(FIRST_TOKEN_MS);
      resp = await fetchImpl(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          accept: "text/event-stream",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          stream: true,
          system: toSystemParam(system),
          messages,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      resp = null;
      networkError = true;
      failure = `fetch_threw: ${err?.message || err}`;
    }

    if (resp && resp.ok && resp.body) break; // success — stream below

    if (resp && !failure) {
      // Non-2xx or missing stream body — capture status + a truncated body.
      let bodyText = "";
      try {
        bodyText = (await resp.text()).slice(0, 500);
      } catch {
        bodyText = "<unreadable body>";
      }
      failure = resp.body
        ? `http_${resp.status}: ${bodyText}`
        : `http_${resp.status}: no_stream_body ${bodyText}`;
    }

    console.warn(
      `[chat] streamChat attempt ${attempt}/${MAX_ATTEMPTS} failed (model=${model}): ${failure}`,
    );

    resp = null;
    if (attempt < MAX_ATTEMPTS) {
      clearTimeout(watchdog);
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    }
  }

  if (!resp) {
    clearTimeout(watchdog);
    // Preserve the two original fallback strings so the response contract is
    // unchanged: transport failure vs a non-OK generation response.
    const t = networkError
      ? "I hit a problem reaching my language model. Please try again."
      : "I hit a problem generating a reply. Please try again.";
    onToken(t);
    return t;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  // Anthropic SSE: lines of "event: <type>\n" + "data: <json>\n\n". We only
  // act on data lines whose JSON is a content_block_delta text_delta.
  try {
    while (true) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch {
        break; // aborted by the watchdog, or the connection dropped
      }
      const { done, value } = chunk;
      if (done) break;
      arm(IDLE_MS); // progress — restart the idle watchdog
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let evt;
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }
        if (evt?.type === "content_block_delta" && evt.delta?.type === "text_delta") {
          const tok = evt.delta.text || "";
          if (tok) {
            full += tok;
            onToken(tok);
          }
        }
      }
    }
  } finally {
    clearTimeout(watchdog);
  }
  // Nothing came back before the model stalled — hand back a short retry line so
  // the client shows something instead of a dead "Thinking…" state.
  if (!full) {
    const t = "Give me one more shot at that.";
    onToken(t);
    return t;
  }
  return full;
}

/**
 * Load + clean the caller's contacts and build the `me` profile — everything the
 * ranker needs on the way in. Split out of runPeopleRank so the blocking and
 * streaming paths prepare their input identically (one pipeline, two transports).
 *
 * Returns { contacts, me } or null when the caller has no contacts to rank.
 */
export async function preparePeopleRankInput(
  did,
  { listContacts, getProfile, getFactsBatch, getUserFactsForMe },
) {
  // TWO ROUND-TRIPS, NOT FOUR. This was four sequential awaits — contacts, then the
  // profile, then the user's own facts, then the facts batch — and only the LAST one
  // actually depends on anything before it (it needs the contact ids). The other
  // three are independent reads that were serial purely because they were written on
  // consecutive lines. This runs before a single token is generated on any people
  // question, so the three saved round-trips come straight off the time to first
  // token.
  const [raw, profile, rawFacts] = await Promise.all([
    listContacts(did),
    getProfile(did).catch(() => null),
    getUserFactsForMe ? getUserFactsForMe().catch(() => []) : Promise.resolve([]),
  ]);
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const { kept } = filterRealContacts(raw);
  const realContacts = kept.length > 0 ? kept : raw;
  const { contacts } = dedupeContacts(realContacts);
  const me = buildMe(profile);
  if (me && getUserFactsForMe) {
    // NEWEST 20, NOT OLDEST 20. getUserFacts returns created_at ASC, so this
    // slice was handing the engine the twenty things the user said FIRST and
    // dropping everything since — the exact inverse of what a prior should be.
    const meFacts = rawFacts
      .filter((f) => f.factText && f.factText.trim())
      .slice(-20)
      .map((f) => ({
        text: f.factText,
        category: f.category ?? null,
        sentiment: null,
        sentiment_strength: null,
        certainty: null,
        is_past: false,
        weight: null,
        is_conditional: false,
        condition_text: null,
        observed_at: f.createdAt ? new Date(f.createdAt).toISOString() : null,
      }));
    if (meFacts.length > 0) me.facts = meFacts;
  }
  // One batched query for all contacts' resolved facts (full tag set), replacing
  // the previous N+1 per-contact getContactFacts loop. Facts arrive pre-shaped in
  // the PeopleRank FactIn snake_case schema — no stripping or re-mapping needed.
  const ids = contacts.map((c) => c.id);
  const factsMap = getFactsBatch ? await getFactsBatch(ids).catch(() => ({})) : {};
  const contactsWithFacts = contacts.map((c) => ({ ...c, facts: factsMap[String(c.id)] ?? [] }));
  return { contacts: contactsWithFacts, me };
}

/**
 * Run the exact PeopleRank pipeline me-people-rank.js uses, for one DID + query.
 * Returns { people, answer, citations } (empty people on no-contacts / engine
 * off / any failure — the caller turns that into a graceful no-matches reply).
 *
 * `answer: false` asks the engine to skip Stage 3 and return ranked people only
 * (~1.3s instead of ~6s) — used by the voice search tool, which phrases the
 * reply itself. Defaults to true, so existing callers are unchanged.
 */
export async function runPeopleRank(
  did,
  message,
  { limit = 15, answer = true, listContacts, getProfile, rankViaTogariSearch, getFactsBatch, getUserFactsForMe },
) {
  const prepared = await preparePeopleRankInput(did, {
    listContacts,
    getProfile,
    getFactsBatch,
    getUserFactsForMe,
  });
  if (!prepared) return { people: [], answer: null, citations: [] };
  const result = await rankViaTogariSearch({
    query: message,
    limit,
    contacts: prepared.contacts,
    me: prepared.me,
    answer,
  });
  if (!result || !Array.isArray(result.people)) {
    return { people: [], answer: null, citations: [] };
  }
  return {
    people: result.people,
    answer: result.answer ?? null,
    citations: Array.isArray(result.citations) ? result.citations : [],
  };
}

/** Render ranked people into a compact context block for the "both" synthesis. */
function peopleContextBlock(people, answer) {
  const lines = (people || [])
    .slice(0, 10)
    .map((p, i) => {
      const bits = [`${i + 1}. ${p.name || "Unknown"}`];
      if (p.title) bits.push(p.title);
      if (p.company) bits.push(`@ ${p.company}`);
      const head = bits.join(" ");
      return p.reason ? `${head} — ${p.reason}` : head;
    });
  const list = lines.length ? lines.join("\n") : "(none found)";
  return (answer ? `A first-pass note: ${answer}\n\n` : "") + list;
}

/** Split a finished string into small token-ish chunks for a streaming feel. */
function chunkText(text, wordsPerChunk = 5) {
  const words = String(text || "").split(/(\s+)/); // keep separators
  const chunks = [];
  let cur = "";
  let wordCount = 0;
  for (const part of words) {
    cur += part;
    if (/\S/.test(part)) {
      wordCount += 1;
      if (wordCount >= wordsPerChunk) {
        chunks.push(cur);
        cur = "";
        wordCount = 0;
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Collapse whitespace and truncate to n chars with an ellipsis. */
function oneLine(s, n = 80) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

/** Coarse "how long ago" label from a Date/ISO/ms value. Simple by design. */
function relativeTime(when, nowMs = Date.now()) {
  const ms =
    when instanceof Date
      ? when.getTime()
      : typeof when === "number"
        ? when
        : typeof when === "string"
          ? Date.parse(when)
          : NaN;
  if (!Number.isFinite(ms)) return "recently";
  const diff = Math.max(0, nowMs - ms);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

// Cap on the recent-recall digest so it stays a hint, not a transcript.
const PRIOR_CONTEXT_MAX_CHARS = 1500;
const PRIOR_RECENT_THREADS = 6; // fetch this many recent threads
const PRIOR_USED_THREADS = 4; // summarize at most this many (excluding current)
const PRIOR_MSGS_PER_THREAD = 6; // peek at this many msgs per thread for the gist

/**
 * Build a SHORT digest of the user's recent OTHER conversations (not the
 * current thread, not deep history) so "what did we talk about recently"
 * resolves. One line per thread: relative time + chat/network kind + a one-line
 * gist (the thread's first user message). Returns "" when there's nothing
 * useful, so the caller can skip injection entirely. Best-effort; never throws.
 */
/**
 * WHAT WE ALREADY KNOW ABOUT THE PEOPLE THIS MESSAGE NAMED.
 *
 * THE BUG THIS EXISTS FOR IS THE WHOLE PRODUCT FAILING FOR EVERYONE WHO IS NOT
 * KARTHIK.
 *
 * A user said "My dad and Sagar are cool", then "Karthik, Sagar, Shirley Park
 * BTG USC are all good people", and the server wrote every one of them:
 *
 *   FACT_CONTACT_FACT contact=508e6208 category=personality
 *   FACT_CONTACT_FACT contact=e873ee26 category=personality
 *   FACT_CONTACT_FACT contact=b474121a category=personality
 *
 * Two minutes later he asked "Who are Sagar, Karthik, and Shirley Park BTG
 * USC?" and Amber said:
 *
 *   "Those three names don't ring a bell yet from anything you've shared with
 *    me before."
 *
 * With their three contact cards rendered directly underneath it.
 *
 * Nothing was lost. The facts were in Postgres the whole time. The `chat` lane
 * simply never read them: everything it was given was CHAT_SYSTEM, today's
 * date, and buildPriorContext -- a digest of the FIRST USER MESSAGE of four
 * other threads, eighty characters each. There is no path on that lane by which
 * a single stored fact about a single person can reach the model. The answer was
 * honest about a prompt that contained nothing.
 *
 * WHY IT WORKS FOR KARTHIK AND NOT FOR ANYONE ELSE. Facts ARE loaded -- on the
 * network_query lane, by preparePeopleRankInput, via getFactsBatch. That lane is
 * reached when the question matches KNOWS_THEM or FIRST_PERSON in query-plan.js:
 * "who do I know", "my contacts", "any of my friends". Karthik asks that way,
 * because he wrote the ranker. Everyone else asks "what do you know about
 * Sagar?" and "who are Sagar, Karthik and Shirley?", which match no lane at all
 * -- laneForAsk returns null, the router says chat, and the app answers a
 * question about the user's own address book with no access to it.
 *
 * SO THE SIGNAL IS THE ONE ALREADY ON SCREEN. fastTagPeople has, before
 * generation starts, matched the names in the sentence against the address book
 * and returned real contact ids -- that is what drew the cards under the "don't
 * ring a bell". If a person was tagged, what we know about them goes in the
 * prompt. No model call, no ranker, no lane, one batched query.
 *
 * Ordered oldest-last so the newest facts are nearest the question, capped hard
 * because this rides the critical path in front of the first token, and it
 * returns "" when there is nothing -- an empty "Here is what you know" heading
 * invites the model to explain that it knows nothing, which is the failure this
 * is fixing.
 */
/**
 * A QUESTION ABOUT THE ADDRESS BOOK AT LARGE, WITH NOBODY NAMED IN IT.
 *
 * "Do you know anything about any of my contacts?" was answered with "Right now
 * I don't have any contacts or notes in front of me for you", against 1,231
 * contacts. Nobody is named, so there is nothing for fastTagPeople to match and
 * nothing for the per-person block below to load -- and the honest answer to
 * that question is not a shrug, it is a count and the names the user has said
 * the most about. getNetworkOverview already computes exactly that; it was
 * reachable only from the `overview` intent, which this question never hits.
 */
const ASKS_ABOUT_THE_BOOK =
  /\b(?:(?:any|all|some|my)\s+(?:of\s+my\s+)?contacts?|my\s+(?:address\s*book|network|people)|anything\s+about\s+(?:any|my)|how\s+many\s+(?:contacts?|people))\b/i;

/**
 * The one word to call the topic in the answer. The full question reads badly
 * inside a sentence, and the first surviving content word is almost always the
 * subject: "who in my contacts has worked at a tech company" -> "tech".
 */
function shortTopicLabel(message) {
  const terms = topicTermsFrom(message ?? "");
  return terms.length > 0 ? terms[0] : null;
}

export function asksAboutTheBook(message) {
  return ASKS_ABOUT_THE_BOOK.test(String(message || ""));
}

const TAGGED_MEMORY_MAX_PEOPLE = 8;
const TAGGED_MEMORY_MAX_PER_PERSON = 12;
const TAGGED_MEMORY_MAX_CHARS = 4000;

export async function buildTaggedMemory(
  ownerId,
  tagged,
  {
    loadContent = getContactContentForContacts,
    loadSelf = getUserFacts,
    loadOverview = getNetworkOverview,
    loadBook = listAddressBookRows,
    wantSelf = false,
    wantOverview = false,
    // The question itself, so a topic can be pulled out of it. Kept separate
    // from `tagged` because a topic question names nobody by definition.
    topicQuestion = null,
  } = {},
) {
  const people = (Array.isArray(tagged) ? tagged : [])
    .filter((p) => p && p.id != null)
    .slice(0, TAGGED_MEMORY_MAX_PEOPLE);

  const blocks = [];

  if (people.length > 0) {
    const byId = await loadContent(
      ownerId,
      people.map((p) => String(p.id)),
    ).catch(() => ({}));
    for (const person of people) {
      const rows = byId?.[String(person.id)] ?? [];
      const lines = rows
        .filter((r) => r && typeof r.text === "string" && r.text.trim())
        // Newest first out of the store; take the newest N, then print oldest
        // first so the block reads as a history rather than a stack.
        .slice(0, TAGGED_MEMORY_MAX_PER_PERSON)
        .reverse()
        .map((r) => `  - ${r.text.trim()}`);
      if (lines.length === 0) continue;
      const label = [person.name, person.title, person.company].filter(Boolean).join(" — ");
      blocks.push(`${label || "This contact"}:
${lines.join("\n")}`);
    }
  }

  if (wantSelf) {
    const mine = await loadSelf(ownerId).catch(() => []);
    const lines = (Array.isArray(mine) ? mine : [])
      .filter((r) => r && typeof (r.text ?? r.fact_text) === "string")
      .slice(0, TAGGED_MEMORY_MAX_PER_PERSON)
      .reverse()
      .map((r) => `  - ${String(r.text ?? r.fact_text).trim()}`)
      .filter((l) => l.length > 4);
    if (lines.length > 0) blocks.push(`The user themselves:\n${lines.join("\n")}`);
  }

  // ── THE FLOOR, AND IT IS THE WHOLE ANSWER FOR A NEW USER ─────────────────
  //
  // "As a new user with no information preset in the app, nothing loaded up
  //  other than his contacts synced in -- if he had asked that and Amber had
  //  given that response, he would have been blown away. But he wasn't."
  //
  // The first version of this floor printed a count and the most-noted people,
  // which for someone with zero notes is a count and nothing. Everything else
  // it needed was sitting in the contact rows and being thrown away: the words
  // the user typed into contact names to tell people apart ("Shirley Park BTG
  // USC"), and the area codes on their numbers. No PeopleRank, no observations,
  // no model -- see src/lib/address-book.js for how a tagline is told from a
  // name, which is the part that has to be right.
  //
  // Only when nothing else was found, so a question that DID name someone is
  // answered about them rather than about the book's size.
  if (blocks.length === 0 && wantOverview) {
    const rows = await loadBook(ownerId).catch(() => []);
    if (Array.isArray(rows) && rows.length > 0) {
      const factCounts = Object.fromEntries(
        rows.map((r) => [String(r.id), Number(r.fact_count ?? 0)]),
      );
      const summary = summarizeAddressBook(rows, { factCounts });
      const terms = topicTermsFrom(topicQuestion ?? "");
      // A topic only counts when the question actually named one. Without this
      // an answer about the book at large would carry a "nothing matches ''"
      // line, which is worse than no line.
      const hits = terms.length > 0 ? contactsMatchingTopic(rows, terms) : null;
      const brief = addressBookBrief(summary, {
        topicHits: hits,
        topic: hits ? shortTopicLabel(topicQuestion) : null,
      });
      if (brief) return brief;
    }
    // Nothing on the cards at all: fall back to the aggregate, which at least
    // knows the total.
    const ov = await loadOverview(ownerId).catch(() => null);
    if (ov && Number(ov.total) > 0) {
      return (
        "WHAT YOU KNOW ABOUT THIS USER'S ADDRESS BOOK. NEVER say you have no " +
        "contacts in front of you -- you have these.\n\n" +
        `The user has ${ov.total} contacts saved.`
      );
    }
  }

  if (blocks.length === 0) return "";
  const body =
    "WHAT YOU ALREADY KNOW ABOUT THE PEOPLE IN THIS MESSAGE. These are the " +
    "user's own saved notes and facts, from their address book. Use them " +
    "directly and specifically. NEVER say a name does not ring a bell, or that " +
    "you have nothing on someone, when they appear below.\n\n" +
    blocks.join("\n\n");
  return body.length > TAGGED_MEMORY_MAX_CHARS
    ? body.slice(0, TAGGED_MEMORY_MAX_CHARS)
    : body;
}

/**
 * THE LADDER'S RESULT, WRITTEN OUT FOR THE MODEL.
 *
 * Everything gatherEverything found, in evidence order, each layer labeled for
 * what it is -- plus, when it came up thin, the inventory of what was searched.
 *
 * THE LAYERS ARE NOT EXCLUSIVE, which is the instruction that matters:
 *
 *   "Only one person fits that perfectly according to your notes, but these
 *    people have area codes that might be appropriate as well. Would you want to
 *    reach out to any of them?"
 *
 * So the block leads with what the user actually said, offers the labels they
 * typed, and offers area codes as a guess called a guess. A chain that stopped
 * at the first non-empty layer would hide ten people worth texting behind the
 * one who matched a note.
 *
 * AND WHEN IT IS THIN IT SAYS WHAT IT DID. "I don't have any information" was
 * acceptable only because no answer path could describe its own search. This
 * hands over the counts including the zeros, and requires the reply to name them
 * and ask for what would help -- because a short shrug makes people close the
 * app, and a specific one tells them exactly what to type next.
 */
/**
 * EXPORTED SO IT CAN BE TESTED, and it is exported because it was not.
 *
 * This function is the entire bridge between the retrieval work and the answer
 * the user reads, and it had no test of any kind. Two bugs were sitting in it:
 * a prompt instruction containing leaked JavaScript source, and a fallback that
 * could not fire. Both are invisible unless something renders the block and
 * looks at it. See src/routes/gathered-block.test.js.
 */
export function renderGathered(g, { message } = {}) {
  if (!g || !g.shape) return "";
  const out = [];
  const line = (t) => out.push(t);

  const person = (r) =>
    [r.name, r.title, r.company, r.city].filter(Boolean).join(" — ");

  if (g.birthdays && g.birthdays.length > 0) {
    line(
      "BIRTHDAYS THAT MATCH, from their synced contacts: " +
        g.birthdays.map((b) => `${b.name} (${b.month}/${b.day})`).join("; ") +
        ". State these directly.",
    );
  } else if (g.birthdays && g.birthdays.length === 0) {
    line(
      `No contact in their book has a birthday on that date. ${g.shape.withBirthday} of ` +
        `${g.shape.total} contacts have a birthday saved at all, so say which of those two ` +
        "it is rather than saying you have nothing.",
    );
  }

  if (g.layers.stated.length > 0) {
    line(
      "WHAT THEY HAVE ACTUALLY SAID OR SAVED about people matching this question. " +
        "This is the strong evidence; lead with it and quote it:",
    );
    for (const r of g.layers.stated.slice(0, 15)) {
      line(`  - ${person(r)}  [${r.where}]`);
      for (const e of (r.excerpts ?? []).slice(0, 2)) line(`      "${e}"`);
    }
  }

  if (g.layers.labeled.length > 0) {
    line(
      "LABELS THEY TYPED INTO CONTACT NAMES themselves. Self-reported, so nearly " +
        "as good as a note -- for most address books it is the only structured " +
        "thing there is. Say how many and name them:",
    );
    for (const r of g.layers.labeled.slice(0, 20)) {
      // `r.matched ?? r.tags` LOOKED like a fallback and was not one: an empty
      // array is not nullish, so a blank `matched` rendered as "[tagged ]" and
      // the instruction above ("say how many and name them") had nothing to
      // name them by. The query is fixed too -- see labeledLayer in gather.js --
      // and this stays as a real fallback rather than a decorative one.
      const why = (r.matched?.length ? r.matched : r.tags) ?? [];
      line(`  - ${person(r)}${why.length ? `  [tagged ${why.join(", ")}]` : ""}`);
    }
  }

  if (g.layers.implied.length > 0) {
    line(
      "A GUESS FROM AREA CODES, and it must be offered as a guess. These people " +
        "have no stated city; their phone number's area code is in the region " +
        "asked about. Present them as 'might be' and offer to draft a message:",
    );
    for (const r of g.layers.implied.slice(0, 20)) {
      line(`  - ${person(r)}  [${r.areaCode} — ${r.metro}]`);
    }
  }

  // THE PEOPLE THE QUESTION NAMED. First, because it is the strongest match
  // there is: a name that is in the book means that person.
  if (Array.isArray(g.layers?.named) && g.layers.named.length > 0) {
    line("");
    line(
      "PEOPLE WHOSE NAME MATCHES WHAT THEY ASKED. This is the strongest kind of " +
        "match -- they typed a name and these are the people who have it. Lead with " +
        "them, and NEVER say you do not know somebody who appears here:",
    );
    for (const r of g.layers.named.slice(0, 20)) {
      line(
        `  - ${person(r)}${r.nickname ? ` (goes by ${r.nickname})` : ""}` +
          `${r.tags?.length ? `  [${r.tags.join(", ")}]` : ""}`,
      );
    }
    if ((g.totals?.named ?? 0) > g.layers.named.length) {
      line(`  (${g.totals.named} people match that name in total; the closest ${g.layers.named.length} are listed.)`);
    }
  }

  // Things the user said about somebody with no card. Placed before the shape so
  // it sits with the evidence rather than the statistics.
  if (Array.isArray(g.layers?.unfiled) && g.layers.unfiled.length > 0) {
    line("");
    line(
      "THE USER SAID THESE THINGS AND THEY ARE NOT FILED TO ANYONE'S CARD, because " +
        "the name did not match a contact when they said it. They are still the " +
        "user's own words and they still count as something you know. If one of them " +
        "answers the question, use it, and say in a few words that it is not filed to " +
        "anybody yet so they can confirm who it belongs to. NEVER say you know nothing " +
        "about a name that appears here:",
    );
    for (const u of g.layers.unfiled.slice(0, 8)) {
      line(`  - about "${u.rawName}": ${String(u.text).slice(0, 200)}`);
    }
  }

  const s2 = g.shape;
  // EVERY COUNT CARRIES ITS DENOMINATOR, AND THE REMAINDER IS SPELLED OUT.
  //
  // The old line read "2897 contacts; ... 0 they have told you about and 723
  // carrying a note that came in with the sync", which is accurate and was still
  // answered with "Every single one of them has notes captured against them,
  // which means you have a remarkably complete picture across the board." On a
  // 519-contact book with 134 notes it said "all 519 have saved notes".
  //
  // Two of four "tell me about my network" turns in the live-model run therefore
  // told the user a false statistic about their own address book, confidently, in
  // the first sentence. That is worse than answering nothing: it is the app being
  // wrong about the one thing it is supposed to be the authority on.
  //
  // A bare "N with a phone" invites the reader to treat N as the whole, because
  // in a list of five numbers next to one total there is nothing forcing the
  // comparison. "723 of 2897 (2174 have none)" cannot be read as "all of them".
  // Naming the gap is the part that does the work -- the model has to write a
  // sentence about 2174 people who have no note, and it stops saying "every".
  const outOf = (n) => `${n} of ${s2.total}`;
  line(
    `THE SHAPE OF THEIR BOOK. Exact counts, out of ${s2.total} contacts in total: ` +
      `${outOf(s2.withPhone)} have a phone, ${outOf(s2.withEmail)} have an email, ` +
      `${outOf(s2.withCompany)} have a company, ${outOf(s2.withBirthday)} have a birthday. ` +
      `On notes: ${outOf(s2.withAmberNote)} carry something the user told you directly ` +
      `(${Math.max(0, s2.total - s2.withAmberNote)} do not), and ` +
      `${outOf(s2.withSyncedNote)} carry a note that came in with the sync ` +
      `(${Math.max(0, s2.total - s2.withSyncedNote)} do not).`,
  );
  line(
    "  THESE NUMBERS ARE EXACT AND YOU MUST NOT ROUND THEM. Never write \"all\", " +
      "\"every\", \"each\", \"the whole book\" or \"none\" for a count that is not " +
      "literally the total or literally zero. If you state a count, state it as the " +
      "figure out of the total. Do not infer a count that is not listed here.",
  );
  if (s2.tags.length > 0) {
    line(
      "  Labels they use across more than one person: " +
        s2.tags.map((t) => `${t.count} tagged "${t.tag}"`).join(", ") +
        ".",
    );
  }
  if (s2.metros.length > 0) {
    line(
      "  Where their numbers are from, by area code: " +
        s2.metros.map((m) => `${m.count} in ${m.metro}`).join(", ") +
        ".",
    );
  }

  // AN EMPTY BOOK IS A DIFFERENT ANSWER FROM AN UNSUCCESSFUL SEARCH, and the
  // model cannot tell them apart from a list of zeros. Said plainly, because
  // this is a brand-new account's first ever reply.
  if ((g.shape.total ?? 0) === 0) {
    line("");
    line(
      "THIS USER HAS NO CONTACTS AT ALL -- not zero matches, zero contacts. They " +
        "have either not synced their address book yet or declined the permission. Do " +
        "NOT talk as though you searched and came up empty, and do NOT invite them to " +
        "record a note about somebody who moved: say you do not have their contacts " +
        "yet, and that syncing is what makes this answerable. Offer telling you about " +
        "one person out loud as the alternative, not as the main suggestion.",
    );
  } else if (g.inventory.thin) {
    line("");
    line(
      "NOTHING MATCHED, SO SAY WHAT YOU DID. You searched: " +
        g.inventory.searched.join("; ") +
        `. Found ${g.inventory.found.stated} in what they have said, ` +
        `${g.inventory.found.labeled} in the labels on their contact names, ` +
        `${g.inventory.found.implied} by area code. ` +
        // THE QUOTES HERE USED TO BE JAVASCRIPT AND THE MODEL READ THEM.
        // This line was inside a template literal and spelled the phrase as
        // `a short "I " +\n "don't have that"`, so the prompt that shipped
        // contained the source concatenation verbatim: `a short "I " +
        // "don't have that"`. Every thin answer -- exactly the turns that most
        // needed a clear instruction -- got a garbled one instead.
        "Do NOT reply with a short \"I don't have that\". " +
        "Name what you went through, give whatever you could " +
        "assemble from the shape above, and then ask for exactly what would help " +
        "-- offer to take a voice note about the people involved, or offer a web " +
        "search if the question is answerable from outside their book. End with a " +
        "concrete next step they can take in one tap.",
    );
  }

  // THE USER IS NOT A DEVELOPER AND HAS NEVER HEARD OF THE LADDER.
  //
  // Live-model turns came back saying "the names aren't resolving cleanly from
  // the data right now", "the data I have doesn't include a tag or category
  // labeled 'founders'", "no specific people came through with your request" and
  // "the data does not include connection or relationship mapping". Every one of
  // those is the model narrating this block back to the reader.
  //
  // It is a specific failure and not a style note: it moves the problem onto the
  // user, who now has to know what a tag is to make progress, and it reads as the
  // app apologising for itself. The instruction above ("say what you searched")
  // is what invites it, so the boundary has to be drawn here rather than assumed:
  // name the WORLD you looked through -- their notes, their contacts' jobs, where
  // their numbers are from -- never the mechanism that looked.
  line("");
  line(
    "HOW TO TALK ABOUT THIS BLOCK. Everything above is the user's own address " +
      "book. Speak about it as their people, not as data: \"nothing in your notes " +
      "says who works in healthcare\" is right, \"the data does not include a " +
      "healthcare tag\" is wrong. Never use the words data, field, tag, label, " +
      "record, filter, query, index, sync payload or database in the reply, and " +
      "never say something did not \"come through\", \"resolve\", \"return\" or " +
      "\"populate\". If a name looks malformed or a contact looks like a duplicate, " +
      "you may mention it once as something worth tidying -- but never present the " +
      "state of their book as a limitation of yours.",
  );

  return (
    "EVERYTHING YOU HOLD FOR THIS USER THAT COULD BEAR ON THEIR QUESTION, gathered " +
    "before you answered. NEVER say you have no information or cannot see their " +
    "contacts -- everything below is what you have. Use the strong evidence first " +
    "and label a guess as a guess.\n\n" +
    out.join("\n")
  );
}

async function buildPriorContext(
  did,
  currentConversationId,
  { listRecentConversations, listConversation, nowMs = Date.now() } = {},
) {
  let recent = [];
  try {
    recent = await listRecentConversations(did, {
      limit: PRIOR_RECENT_THREADS,
    });
  } catch {
    return "";
  }
  const others = (recent || [])
    .filter((t) => t && t.conversationId !== currentConversationId)
    .slice(0, PRIOR_USED_THREADS);
  if (others.length === 0) return "";

  // FOUR QUERIES AT ONCE, NOT ONE AFTER ANOTHER. This was a `for` loop with an
  // `await` in it, so four independent single-row reads ran strictly in series and
  // this function cost four round-trips instead of one — on the critical path,
  // before a single token of the reply is generated. Nothing here depends on the
  // thread before it; they were sequential only because a for-await is the easy way
  // to write it. Each still swallows its own failure, so one bad thread costs its
  // own line and not the digest.
  const peeks = await Promise.all(
    others.map((t) =>
      listConversation(did, t.conversationId, { limit: PRIOR_MSGS_PER_THREAD }).catch(
        () => [],
      ),
    ),
  );

  const lines = [];
  others.forEach((t, idx) => {
    const msgs = peeks[idx] || [];
    const firstUser = msgs.find((m) => m.role === "user");
    const gist = oneLine(firstUser?.content || msgs[0]?.content || "(empty)", 80);
    const kind = msgs.some(
      (m) => m.intent === "network_query" || m.intent === "both",
    )
      ? "network"
      : "chat";
    lines.push(`• ${relativeTime(t.lastAt, nowMs)} [${kind}]: ${gist}`);
  });
  const digest =
    "Recent prior conversations (most recent first):\n" + lines.join("\n");
  return digest.length > PRIOR_CONTEXT_MAX_CHARS
    ? digest.slice(0, PRIOR_CONTEXT_MAX_CHARS)
    : digest;
}

/** Prepend the recent-recall digest to a system prompt (no-op when empty). */
/**
 * Split the system prompt at the cache breakpoint instead of concatenating it.
 *
 * `baseSystem` is the same bytes on every turn for a given user and day
 * (CHAT_SYSTEM, which inlines ANSWER_STYLE + HOUSE_RULES, plus an optional
 * WEB_GROUNDING and today's date) -- roughly 1.4k tokens, or 2.4k with the web
 * grounding block. That clears Anthropic's minimum, so marking it caches a real
 * prefix and each later turn in the conversation re-reads it at a tenth of the
 * price.
 *
 * `priorContext` is the volatile half -- excerpts from THIS user's recent
 * conversations -- so it must come after the breakpoint. Appending it to the
 * same string, as this used to, would have made the cached prefix change on
 * every turn and turned the whole thing into a 25% surcharge.
 *
 * Returns blocks, which streamChat's toSystemParam() understands.
 */
function withPriorContext(baseSystem, priorContext) {
  const base = { text: baseSystem, cache: true };
  if (!priorContext) return [base];
  return [
    base,
    {
      text:
        "Context from the user's recent conversations (use only if relevant to " +
        "what they ask; do not volunteer it unprompted):\n" +
        priorContext,
    },
  ];
}

// The one chip that is always true of an answer: it can go to the people it is
// about. Sharing is the reason to have asked inside Amber rather than a browser.
// The sheet it opens picks a circle OR a person, which is why this is one chip and
// not two — two chips onto one sheet is a longer row saying the same thing.
const DEFAULT_CHIP = Object.freeze({ type: "share_note", label: "Send this to someone" });

const SUGGESTION_TYPES = new Set([
  "connect_people",
  "draft_message",
  "follow_up",
  // Hand this answer to a circle or a person. Not a query — it opens the sharing
  // sheet on the note this turn produced, which is why it carries no payload
  // beyond its label.
  "share_note",
  // Draft a cold approach to someone the answer NAMED but who is not in the user's
  // contacts. draft_message cannot cover this: it requires a real contactId, so the
  // moment an answer surfaced ten VPs of finance off the web there was no chip that
  // could act on any of them.
  "draft_outreach",
  // Go back to the web for more on what was just found. Same payload as a follow_up
  // plus the flag that makes the client re-ask with forceWeb, so a research pass
  // does not get re-classified as a question about the user's own contacts.
  "research_web",
  // Spin up a circle for the people this turn is about. A plan mentioning three
  // friends had no way to become a group — the user had to leave, go to Circles,
  // create one and re-add everybody by hand. Carries "contactIds" and "name" (a
  // suggested circle name), so tapping it opens the create sheet pre-filled.
  "create_circle",
  // Add a note against a specific person the turn named. draft_message writes TO
  // them; this records something ABOUT them. Carries "contactId" and "name".
  "add_note",
]);

const SUGGESTIONS_SYSTEM = [
  "You generate 0-4 follow-up suggestion chips for a personal assistant called",
  "Amber, shown after Amber answers. Suggestions MUST be drawn ONLY from these",
  "exact action types — never invent others:",
  "",
  '1. "connect_people" — surface people the user knows relevant to the topic.',
  '   Carries "query": a clean people-search that will return contacts (e.g.',
  '   "people I know in New York", "contacts interested in museums"). The "label"',
  "   is the user-facing ACTION text.",
  '2. "draft_message" — draft an intro/text to a SPECIFIC person. Offer ONLY when',
  "   a specific person is in context. You MUST use a contactId from the provided",
  '   people list — NEVER invent a contactId. Carries "contactId" and "name".',
  '3. "follow_up" — continue the thread with an action that produces something',
  '   useful. Carries "prompt": the exact request message sent when tapped.',
  '4. "share_note" — hand THIS answer to a circle or a person. Tapping it opens the',
  "   sharing sheet, so it needs no fields beyond a label. The label should name the",
  '   thing being shared and who might want it: "Send this to a circle", "Share',
  '   these spots with Sunday Run Club", "Send this plan to a friend". Emit AT MOST',
  "   ONE.",
  '5. "draft_outreach" — write a cold approach to someone the ANSWER named who is',
  "   NOT in the user's contacts (so no contactId exists). Carries \"name\" and",
  '   "prompt": the exact request sent when tapped, which must name the person and',
  "   what the message is for. Use this after any answer that surfaced people off the",
  '   web. Label like "Draft outreach to Dana Reed". Emit AT MOST ONE.',
  '6. "research_web" — go back to the web for more on what was just found. Carries',
  '   "prompt". Use it for a deeper pass on the specific people, companies or places',
  '   in the answer: "Find recent news and contact details for these five", "Look up',
  '   what each of these has said publicly about hiring". Label like "Dig deeper on',
  '   these five". Emit AT MOST ONE.',
  '7. "create_circle" — make a group for the people this turn is about. Offer it',
  "   whenever the answer involves TWO OR MORE of the user's contacts doing",
  '   something together — a dinner, a trip, an intro, a project. Carries',
  '   "contactIds" (from the provided people list, never invented) and "name": a',
  '   short, human circle name drawn from the plan ("Williamsburg dinner", "SF',
  '   trip"). Label like "Make a circle for this dinner". Emit AT MOST ONE.',
  '8. "add_note" — record something ABOUT a specific person (draft_message writes',
  '   TO them). Carries "contactId" and "name". Use it when the turn revealed',
  '   something worth keeping about one person. Label like "Add a note about Sam".',
  '   Emit AT MOST ONE.',
  "",
  "TWO HARD RULES:",
  "",
  "RULE A — ACTIONS, NOT QUESTIONS. Every suggestion is an ACTION AMBER PERFORMS",
  "when tapped, phrased as an imperative from the user's intent — NEVER a question",
  "directed at the user. The label is what Amber will DO; the query/prompt is what",
  "runs when tapped. Test: tapping the chip must let Amber ACT and produce",
  "something useful. If tapping it would just bounce a question back at the user,",
  "it is WRONG.",
  '  GOOD labels: "Show people you know in NYC", "Find people free this weekend",',
  '    "Suggest warm-weather activities", "Draft a text to Anna",',
  '    "Recommend things to do here".',
  '  BAD (never emit): "Which borough do you want to explore?", "What type of',
  '    activity interests you?", "Do you have a preference?" — these are questions',
  "    FOR the user and make no sense when tapped.",
  "",
  "RULE B — BIAS STRONGLY TOWARD THE USER'S PEOPLE / NETWORK. This is Amber's core",
  "purpose. For almost any answer, prefer a connect_people suggestion that ties the",
  "topic to people the user knows. Always ask: how does this connect to their",
  "network? Lead with that.",
  '  weather / activities / a place → "Show people you know in {place}" (query',
  '    "people I know in {place}") or "Find people in {place} who might want to join".',
  '  a topic / interest → "Find people you know into {topic}" (query "contacts',
  '    interested in {topic}").',
  "  Even follow_up prompts should move toward people or concrete help, never",
  "  abstract questions.",
  "  ANY answer worth keeping — a list of places, a plan, a recommendation, a",
  "  grounded web answer — should also offer share_note, because the point of",
  "  finding something out in Amber is that it goes to the people it is useful to.",
  "  Prefer a share_note whose label names a real circle or person when the answer",
  "  or the conversation makes an obvious one clear.",
  "",
  "RULE B2 — AN ANSWER THAT NAMED STRANGERS MUST BE ACTIONABLE ON THEM. When the",
  "answer surfaced people or companies from the WEB rather than from the user's",
  "contacts, the useful next steps are about those names, and connect_people /",
  "draft_message cannot reach them (draft_message needs a contactId the user does not",
  "have). So for that kind of answer emit BOTH:",
  "  - ONE draft_outreach for the single most relevant name, and",
  "  - ONE research_web for a deeper pass on the set.",
  "Reference the actual names from the answer in the labels and prompts, never",
  '"them" or "these people" alone.',
  "",
  // A QUESTION ABOUT THE USER'S OWN PEOPLE IS NEVER A QUESTION ABOUT STRANGERS.
  //
  // "Whose birthday is coming up" -- asked of an address book, about the user's
  // own contacts -- was answered with the chip "Search the web for upcoming
  // CELEBRITY birthdays". "Who should I follow up with this week" got "Search the
  // web for follow-up ideas". Both come from reading the words of the question
  // and losing the subject: the generator saw "birthday" and "follow up" and
  // reached for the web because the answer had found nobody.
  //
  // That is the worst moment to change the subject. The user asked about their
  // own life, Amber came up empty, and the chip then offers them trivia. The web
  // is a real way out of an empty answer, but only when the question is one the
  // web can answer.
  "RULE B4 — WHEN THE QUESTION IS ABOUT THE USER'S OWN PEOPLE, THE CHIPS STAY ON",
  "THEIR PEOPLE. A question containing \"I\", \"my\", \"who do I know\", \"my contacts\",",
  "\"my network\" or a possessive about somebody in their life is about THEM, and it",
  "stays about them even when the answer found nothing. Never emit a chip that",
  "re-points the same question at the open web about strangers, public figures or",
  "general advice: not \"celebrity birthdays\" for \"whose birthday is coming up\",",
  "not \"follow-up ideas\" for \"who should I follow up with\", not \"how to network\"",
  "for a question about their network. The right chips when their own question came",
  "up empty are the ones that make it answerable next time or narrow it now: adding",
  "the missing information about a person, searching their own contacts a different",
  "way, or naming a specific person. Only offer the web when the question genuinely",
  "has an answer out in the world, such as a place, a company, or a person the user",
  "does not have.",
  "",
  "RULE B3 — A PLAN IS A DIFFERENT KIND OF TURN. When the user is ARRANGING",
  "something with people — dinner, drinks, a trip, a birthday, a weekend, a",
  "meeting — the useful next steps are the decisions still open in that plan, not",
  "generic network questions. Amber has already shown venue cards above the chips",
  "when it found places, so do NOT emit a chip that just says \"find restaurants\"",
  "when the answer already listed them. Instead work the plan forward:",
  "  - NARROW IT when a choice is still open, as an ACTION not a question:",
  '    "Show Italian spots instead", "Find places that take a group of six",',
  '    "Show quieter places nearby" — each a follow_up whose prompt is the actual',
  "    request. Never \"What cuisine are you feeling?\" — that is RULE A.",
  '  - HELP BOOK IT: a follow_up with a prompt like "Draft a message asking the',
  '    group which of these three works" or "Write a reservation request for eight',
  '    at 7pm Saturday". Amber cannot call a restaurant, so the action is always',
  "    the message or the request TEXT, never a claim that a table is booked.",
  "  - ONE create_circle when two or more contacts are in the plan, named after",
  "    the plan itself.",
  "  - ONE draft_message to the person most central to the plan, or ONE add_note",
  "    when the turn revealed something about one of them worth keeping.",
  "A plan turn should NOT lead with connect_people: the people are already chosen.",
  "",
  "RULE C — VARIETY, NOT REPETITION. The set must MIX different action types, not",
  "repeat one. Emit AT MOST ONE draft_message — for the single most relevant (top)",
  "person only; NEVER produce multiple draft_message chips even when several people",
  "are in context. A strong set for a people answer is: ONE draft_message (top",
  "person) + ONE connect_people (\"find more people in {domain/place}\") + ONE",
  "topical follow_up that is a useful action (e.g. \"Suggest coworking spaces for",
  "tech in NYC\", \"Recommend places to meet up\"). If you would otherwise emit the",
  "same type more than once, replace the duplicates with a connect_people or a",
  "topical follow_up instead.",
  "",
  "Do NOT suggest anything else (no enrichment, reservations, calendar, etc.).",
  "If nothing fits, return [].",
  "",
  "Respond with ONLY a JSON array — no prose, no markdown. Each item:",
  '{ "type": "connect_people"|"draft_message"|"follow_up"|"share_note"|"draft_outreach"|"research_web"|"create_circle"|"add_note", "label": "<short',
  ' tappable ACTION text>", ...typed fields }. Example for a chat answer about',
  "NYC weather:",
  '[{"type":"connect_people","label":"Show people you know in NYC","query":"people I know in New York"},',
  ' {"type":"follow_up","label":"Suggest warm-weather activities in NYC","prompt":"Suggest warm-weather activities to do in NYC"},',
  ' {"type":"share_note","label":"Send this to a circle"}]',
  "Example for a people answer with several tech contacts (Anna c_1, Bo c_2, …) —",
  "ONE draft_message for the top person, then a MIX (not three draft_messages):",
  '[{"type":"draft_message","label":"Draft a text to Anna","contactId":"c_1","name":"Anna Shim"},',
  ' {"type":"connect_people","label":"Find more people you know in tech","query":"people I know in tech"},',
  ' {"type":"follow_up","label":"Suggest coworking spaces for tech in NYC","prompt":"Suggest coworking spaces for tech folks in NYC"}]',
  "Example for a WEB answer that listed strangers (Dana Reed, Lee Ortiz, … — none in",
  "the user's contacts):",
  '[{"type":"draft_outreach","label":"Draft outreach to Dana Reed","name":"Dana Reed","prompt":"Draft a short cold outreach message to Dana Reed, VP Finance at Acme in New York, introducing me and asking for 20 minutes"},',
  ' {"type":"research_web","label":"Dig deeper on these five","prompt":"Find recent news, role changes and public contact details for Dana Reed, Lee Ortiz, and the others you just listed"},',
  ' {"type":"share_note","label":"Send this list to a circle"}]',
  "Example for a PLAN — \"planning dinner in Williamsburg with Sam, Priya and Dev,",
  'thinking Asian" (Sam c_1, Priya c_2, Dev c_3), where Amber already showed three',
  "venue cards:",
  '[{"type":"create_circle","label":"Make a circle for this dinner","contactIds":["c_1","c_2","c_3"],"name":"Williamsburg dinner"},',
  ' {"type":"follow_up","label":"Show Japanese spots instead","prompt":"Show me Japanese restaurants in Williamsburg that can take four"},',
  ' {"type":"follow_up","label":"Draft a message asking which spot works","prompt":"Draft a short group message to Sam, Priya and Dev asking which of these three Williamsburg places works for dinner"},',
  ' {"type":"add_note","label":"Add a note about Priya","contactId":"c_2","name":"Priya Raman"}]',
].join("\n");

/**
 * Generate 0-4 follow-up suggestion chips AFTER the answer (Haiku, non-streaming,
 * raw fetch — mirrors classifyIntent). Only the executable types (connect_people /
 * draft_message / follow_up / share_note / draft_outreach / research_web) are
 * allowed; each item is validated and draft_message contactIds MUST exist in the
 * provided `people` list (invented ids are dropped). draft_outreach is the opposite
 * case by design — it is for someone with NO contactId — so it validates on having a
 * prompt instead. FAIL-SAFE: [] on any error / no key.
 */
/**
 * IS THIS TURN ACTUALLY ABOUT THIS PERSON?
 *
 * "Add a reminder to meet with Vega on Google Meet on Monday at noon" came back
 * with a chip reading "Add a note about Sagar". Sagar appears nowhere in that
 * sentence. He was in `people` because he was in the recent history, the id
 * validated, and every existing check passed -- the chip was well-formed and
 * about the wrong person.
 *
 * Validating the id was never the same as validating the subject. An id check
 * stops the model INVENTING a person; nothing stopped it picking a real one the
 * turn had nothing to do with, which is the more likely mistake and the one that
 * reads as Amber not listening.
 *
 * Matched against the message AND the answer, because "what did she say" plus an
 * answer naming Priya is legitimately about Priya. Matched on the first name
 * too, since that is how people are referred to and how the labels are written.
 */
export function turnMentions(name, message, answer) {
  const n = String(name || "").trim();
  if (!n) return false;
  const haystack = `${message || ""}\n${answer || ""}`.toLowerCase();
  const full = n.toLowerCase();
  if (haystack.includes(full)) return true;
  // A first name only when it is long enough to not collide with ordinary words.
  // "An" and "Jo" as substrings would match almost any sentence.
  const first = full.split(/\s+/)[0];
  return first.length >= 4 && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(haystack);
}

export async function generateSuggestions({
  message,
  answer,
  intent = "chat",
  people = [],
  history = [],
  model = ROUTER_MODEL,
  apiKey = process.env.ANTHROPIC_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey || typeof fetchImpl !== "function") return [];
  const validIds = new Set(
    (people || []).map((p) => p?.contactId).filter(Boolean).map(String),
  );
  // contactId → name, so a chip that carries an id but forgot the name still shows
  // a person instead of "Add a note about ". The label the user reads is generated
  // text; the name a sheet is TITLED with should come from our own data.
  const nameById = new Map(
    (people || [])
      .filter((p) => p?.contactId)
      .map((p) => [String(p.contactId), String(p.name || "")]),
  );
  const peopleText = (people || [])
    .slice(0, 10)
    .map((p) => `- ${p.name || "Unknown"} (contactId: ${p.contactId})`)
    .join("\n");
  const histText = (history || [])
    .slice(-4)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
  const user =
    (histText ? `Recent conversation:\n${histText}\n\n` : "") +
    `User's latest message: ${message}\n\n` +
    `Amber's answer: ${String(answer || "").slice(0, 1500)}\n\n` +
    (peopleText
      ? `People available (use these exact contactIds for draft_message):\n${peopleText}\n\n`
      : "No specific people are in context (do NOT emit draft_message).\n\n") +
    `Suggestions JSON array:`;
  try {
    const resp = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 250,
        system: SUGGESTIONS_SYSTEM,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const text = (data?.content || [])
      .map((b) => (b && typeof b.text === "string" ? b.text : ""))
      .join("");
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    let parsed;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    const out = [];
    let draftMessageAdded = false; // hard cap: at most ONE draft_message
    let shareNoteAdded = false; // and at most ONE share_note
    let outreachAdded = false; // one cold-outreach draft
    let researchAdded = false; // one deeper-web pass
    let circleAdded = false; // one circle-creation chip
    let noteAdded = false; // one add-note chip
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const type = item.type;
      if (!SUGGESTION_TYPES.has(type)) continue; // drop unknown types
      const label = typeof item.label === "string" ? item.label.trim() : "";
      if (!label) continue;
      if (type === "connect_people") {
        const query = typeof item.query === "string" ? item.query.trim() : "";
        if (!query) continue;
        out.push({ type, label, query });
      } else if (type === "draft_message") {
        if (draftMessageAdded) continue; // keep only the first valid draft_message
        const contactId = item.contactId != null ? String(item.contactId) : "";
        const name = typeof item.name === "string" ? item.name.trim() : "";
        if (!contactId || !validIds.has(contactId)) continue; // never invented ids
        // Same subject check as add_note, and it matters more here: this chip
        // opens a composer addressed to a real person.
        if (!turnMentions(name || nameById.get(contactId), message, answer)) continue;
        out.push({ type, label, contactId, name });
        draftMessageAdded = true;
      } else if (type === "follow_up") {
        const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
        if (!prompt) continue;
        out.push({ type, label, prompt });
      } else if (type === "share_note") {
        if (shareNoteAdded) continue; // one sharing chip, never a row of them
        out.push({ type, label });
        shareNoteAdded = true;
      } else if (type === "draft_outreach") {
        if (outreachAdded) continue;
        const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
        if (!prompt) continue;
        const name = typeof item.name === "string" ? item.name.trim() : "";
        out.push({ type, label, prompt, name });
        outreachAdded = true;
      } else if (type === "research_web") {
        if (researchAdded) continue;
        const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
        if (!prompt) continue;
        out.push({ type, label, prompt });
        researchAdded = true;
      } else if (type === "create_circle") {
        if (circleAdded) continue;
        // Same rule as draft_message: ids are validated against the people actually
        // in context, never taken on the model's word. A circle pre-filled with a
        // contact the turn never mentioned is worse than no chip.
        const ids = (Array.isArray(item.contactIds) ? item.contactIds : [])
          .map((v) => String(v))
          .filter((v) => validIds.has(v));
        // Two or more, or it is not a circle — one person is a conversation.
        if (ids.length < 2) continue;
        const name = typeof item.name === "string" ? item.name.trim().slice(0, 60) : "";
        out.push({ type, label, contactIds: ids, name });
        circleAdded = true;
      } else if (type === "add_note") {
        if (noteAdded) continue;
        const contactId = item.contactId != null ? String(item.contactId) : "";
        if (!contactId || !validIds.has(contactId)) continue;
        const name =
          (typeof item.name === "string" ? item.name.trim() : "") ||
          nameById.get(contactId) ||
          "";
        // The subject has to be someone this turn is about. Without this the
        // chip is drawn from whoever is in context, which produced "Add a note
        // about Sagar" on a turn entirely about Vega.
        if (!turnMentions(name || nameById.get(contactId), message, answer)) continue;
        out.push({ type, label, contactId, name });
        noteAdded = true;
      }
      if (out.length >= 4) break; // cap at 4
    }
    return out;
  } catch {
    return []; // best-effort; never block completion
  }
}

/**
 * Format retrieved pages into the numbered grounded-context block the model reads.
 *
 * The numbering here IS the citation contract: [1] in the answer means results[0],
 * which means sources[0] in the SSE frame, which means the first source chip in the
 * app. One list, one order, everywhere.
 *
 * Each entry carries, in the order the model needs it: what the page is, when it was
 * published (a claim about the present is only as good as its date, and the answer is
 * told to say so), the sentences Exa judged most relevant to the question, and then
 * the page text. Highlights go BEFORE the body deliberately — on a long page the
 * relevant lines would otherwise be buried in the middle of eight thousand
 * characters, which is exactly the failure the depth pass exists to fix.
 */
// A hard ceiling on the whole grounded block, independent of the per-page caps.
// Twelve pages at 5,000 characters, five of them re-read at 12,000, is around 95,000
// characters of prompt on a single turn. That fits, but nothing upstream GUARANTEES
// those numbers stay where they are, and the failure mode of finding out is a turn
// that costs a fortune or gets truncated at the model boundary. So the budget is
// enforced here, at the one place the block is built.
const WEB_BLOCK_MAX_CHARS = 90000;

function webResultsBlock(results) {
  const rows = results || [];
  // Divided evenly rather than first-come-first-served: giving page 1 everything and
  // page 12 nothing would silently drop the tail of the result set, and on a "list
  // ten" question the tail is half the answer.
  const perPage = rows.length > 0 ? Math.floor(WEB_BLOCK_MAX_CHARS / rows.length) : 0;
  return (
    "Current web results for this question. Cite these by their numbers:\n" +
    rows
      .map((r, i) => {
        const parts = [`[${i + 1}] ${r.title || "(untitled)"} — ${r.url || ""}`];
        if (r.publishedDate) parts.push(`published: ${r.publishedDate}`);
        // Highlights are kept whole and charged against the page's budget FIRST:
        // they are the lines that bear on the question, so they are the last thing
        // that should ever be trimmed.
        const highlights =
          Array.isArray(r.highlights) && r.highlights.length > 0
            ? r.highlights.join(" … ")
            : "";
        if (highlights) parts.push(`most relevant lines: ${highlights}`);
        const room = perPage - highlights.length - (r.title?.length || 0) - 200;
        if (r.text && room > 200) parts.push(`page text: ${r.text.slice(0, room)}`);
        return parts.join("\n    ");
      })
      .join("\n")
  );
}

/**
 * How much of each page to pull.
 *
 * A snippet is the TOP of a document — nav, headline, standfirst. That is plenty for
 * "is Balthazar open on Sunday" and useless for "list ten VPs of finance in New
 * York", where the names are in a table two thirds of the way down. So an extraction
 * question gets a much larger per-page budget on the SAME round trip, rather than a
 * second one: 12 pages x 5,000 characters is a large prompt and still only one call,
 * and one call is what keeps this usable.
 */
const EXTRACTION_RE =
  /\b(list|top|best|rank|ranked|compare|examples|names|who are|find|extract|scan|read|details|according to|summar(y|ise|ize)|breakdown|table|spreadsheet|csv|emails?|contacts?|numbers?|figures?|revenue|pricing)\b/i;
const SNIPPET_CHARS = 1200;
const EXTRACTION_CHARS = 5000;
export function webPageChars(message) {
  return EXTRACTION_RE.test(String(message || "")) ? EXTRACTION_CHARS : SNIPPET_CHARS;
}

/**
 * Did the breadth pass actually come back with anything to read?
 *
 * Exa returns a row per page even when it could not extract text from it — a
 * JS-rendered site, a PDF it has not indexed, a paywall. On an extraction question
 * that is the difference between ten names and none, and it is invisible from the
 * row count alone, so it is measured in characters. Under this, the depth pass is
 * worth the extra round trip; over it, it is not.
 */
const THIN_TEXT_CHARS = 2500;
export function isThin(results) {
  return (
    (results || []).reduce(
      (n, r) => n + (r?.text?.length || 0) + (r?.highlights || []).join(" ").length,
      0,
    ) < THIN_TEXT_CHARS
  );
}

export function registerChatRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const getProfile = deps.getProfile || defaultGetProfile;
  const rankViaTogariSearch =
    deps.rankViaTogariSearch || defaultRankViaTogariSearch;
  const streamRank =
    deps.streamViaTogariSearch || defaultStreamViaTogariSearch;
  const resolveOwner = deps.resolveAmberIdByPhone || resolveAmberIdByPhone;
  // The six dimensions on the read path. Injectable so tests can drive it
  // without a database or an embedding call.
  const retrieveRelevant = deps.retrieveByDimension || defaultRetrieveByDimension;
  const appendMessageRaw = deps.appendMessage || defaultAppendMessage;

  /**
   * EVERY STORED ASSISTANT TURN HAS AT LEAST ONE THING TO DO.
   *
   * Nine branches in this file persist an assistant message and exactly one of
   * them computes suggestion chips. The rest leaned on a fallback that wrote to
   * the socket and nowhere else — so those turns showed a chip once and had none
   * at all when the note was reopened, because rehydration reads
   * metadata.suggestions.
   *
   * Injected here rather than at nine call sites, because the tenth branch someone
   * adds would miss it too.
   */
  const appendMessage = (ownerId, msg) => {
    const hasChips = Array.isArray(msg?.metadata?.suggestions) && msg.metadata.suggestions.length > 0;
    if (msg?.role !== "assistant" || !msg?.content || hasChips) {
      return appendMessageRaw(ownerId, msg);
    }
    return appendMessageRaw(ownerId, {
      ...msg,
      metadata: { ...(msg.metadata || {}), suggestions: [DEFAULT_CHIP] },
    });
  };
  const mergeMessageMetadata = deps.mergeMessageMetadata || defaultMergeMessageMetadata;
  const listConversation = deps.listConversation || defaultListConversation;
  const listRecentConversations =
    deps.listRecentConversations || defaultListRecentConversations;
  const classify = deps.classifyIntent || classifyIntent;
  const stream = deps.streamChat || streamChat;
  const exa = deps.exaSearch || defaultExaSearch;
  const exaRead = deps.exaContents || defaultExaContents;
  const exaPeople = deps.exaFindPeople || defaultExaFindPeople;
  const suggest = deps.generateSuggestions || generateSuggestions;
  /**
   * THE DAY. Four reads, injectable together, because a question about the
   * calendar is answered from all four or answered wrong: the events Amber
   * captured and the ones a connected account synced (both in `events`), the
   * reminders that have a time, the ones that do not, and whether any calendar
   * is connected at all -- which is the difference between "you are free" and
   * "I cannot see your calendar yet".
   */
  const readAgendaEvents = deps.listAgendaEvents || defaultListAgendaEvents;
  const readTimedReminders = deps.listScheduledReminders || defaultListScheduledReminders;
  const readOpenReminders = deps.listOpenReminders || defaultListOpenReminders;
  const readCalendarAccounts = deps.listCalendarAccounts || defaultListCalendarAccounts;
  const readClock = deps.now || (() => new Date());
  // The account snapshot behind "tell me about my network" and "what can you do
  // for me". One query; see db/inventory.js.
  const readInventory = deps.readAmberInventory || defaultReadAmberInventory;
  // The pass that turns "VPs of finance to talk to" into a search written by
  // somebody who knows where this person lives. See lib/search-brief.
  const searchBrief = deps.buildSearchBrief || defaultBuildSearchBrief;

  /**
   * READ THEIR DAY, OR RETURN NOTHING AND SAY NOTHING.
   *
   * Every read is independently fail-safe. A calendar question is still worth
   * answering when one of the four is down -- a block missing its open
   * reminders beats a turn that 500s -- and none of them is allowed to hold up
   * the first token, which is why this is started beside the retrieval ladder
   * rather than awaited in front of it.
   */
  async function buildDayBrief(ownerId, timeZone) {
    // The clock is injected so a test can assert the exact window rather than
    // whatever today happens to be. Everything about this feature is "which day
    // is it where they are standing", and a test that cannot fix the instant
    // can only assert the shape of the answer.
    const win = dayWindow({ now: readClock(), timeZone, days: DAY_BRIEF_DAYS });
    const [events, timedReminders, openReminders, accounts] = await Promise.all([
      readAgendaEvents(ownerId, { from: win.fromISO, to: win.toISO }).catch(() => []),
      readTimedReminders(ownerId, {
        from: win.fromISO,
        to: win.toISO,
        // Something they were reminded about yesterday and never ticked off is
        // still owed today, and leaving it out is how the day reads emptier
        // than it is. Same rule the day view uses.
        includeOverdue: true,
      }).catch(() => []),
      readOpenReminders(ownerId, { onDate: win.todayKey }).catch(() => []),
      readCalendarAccounts(ownerId).catch(() => []),
    ]);
    return renderDayBrief({
      events,
      timedReminders,
      openReminders,
      connectedCalendars: Array.isArray(accounts) ? accounts.length : 0,
      timeZone: win.timeZone,
      todayKey: win.todayKey,
      days: win.days,
    });
  }
  // Injectable so the place-card path is testable without a live web search.
  const findPlaces = deps.findPlaces || defaultFindPlaces;
  // Injectable so instant tagging can be driven against a known address book.
  const contactNamesFor = deps.listContactNamesForOwner || listContactNamesForOwner;
  // Injectable so the place-recall side channel is testable without a database.
  const findPeopleByPlaceTerms = deps.findPeopleByPlaceTerms || defaultFindPeopleByPlaceTerms;
  const generateUuid = deps.generateUuid || (() => crypto.randomUUID());

  app.post(
    "/v1/chat",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["message"],
          properties: {
            message: { type: "string", minLength: 1, maxLength: 8000 },
            conversationId: { type: "string", maxLength: 200 },
            clarifyContactId: { type: "string" },
            timezone: { type: "string", maxLength: 80 },
            // "soundboard" = the voice surface: keep replies short and action-first.
            source: { type: "string", maxLength: 40 },
            // Set by the client when the user taps "Search the web" on an empty
            // people search, or otherwise explicitly asks for the open web. It
            // BYPASSES the router entirely — the intent is not in question, and
            // skipping that Haiku call is ~400ms off the answer.
            forceWeb: { type: "boolean" },
            // A FOLLOW-UP INSIDE SOMETHING ALREADY OPEN, rather than a fresh
            // capture. Set by the client when the surface already has turns:
            // opening a voice note and asking about it, or asking a second
            // question in a thread. It suppresses fact capture -- see the
            // capture branch below for why that is a correctness fix and not an
            // optimisation.
            followUp: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const did = requirePrivyDid(request, reply);
      if (!did) return;

      const phone = request.privyUser?.phone;
      const amberId = phone
        ? await resolveOwner(phone).catch(() => null)
        : null;
      if (!amberId) request.log?.warn?.({}, "[chat] no amberId — skipping history persist");

      const body = request.body || {};
      const message =
        typeof body.message === "string" ? body.message.trim() : "";
      if (!message) {
        return reply
          .code(400)
          .send({ error: "message_required", message: "message is required" });
      }
      const conversationId =
        typeof body.conversationId === "string" && body.conversationId.trim()
          ? body.conversationId.trim()
          : generateUuid();
      const reqTimezone =
        typeof body.timezone === "string" && body.timezone.trim()
          ? body.timezone.trim()
          : null;
      // The current date, in the user's timezone, so answers never guess the day
      // (e.g. claiming "it's Tuesday" for a Tuesday-only fact when it isn't).
      const todayLine = (() => {
        try {
          const d = new Date().toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            ...(reqTimezone ? { timeZone: reqTimezone } : {}),
          });
          return `Today is ${d}. Use this for any day/date reasoning; never assume a different day.`;
        } catch {
          return "";
        }
      })();
      // The voice soundboard sends source:"soundboard". It routes through this
      // same pipeline (same capture, same disambiguation), but its spoken-style
      // replies are short and lead with actions rather than long prose.
      const source = body.source === "soundboard" ? "soundboard" : "app_chat";
      const isVoice = source === "soundboard";

      // ── SSE setup (exact ask.js hijack pattern) ────────────────────────────
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      let clientGone = false;
      const onClose = () => {
        clientGone = true;
      };
      raw.on("close", onClose);
      raw.on("error", onClose);
      // Whether this turn has already sent a people event. A search or ranker
      // answer sends the AUTHORITATIVE people list (ordered, with citations), and
      // the capture-derived card below must never land on top of it -- the client
      // treats the last people event as final, so a later one with citations: []
      // would strip the [[p:n]] markers out of an answer that used them.
      // WHO THE FAST TAGGER FOUND, kept so the resolved set can be MERGED with it
      // rather than gated behind it.
      //
      // The instant-tagging pass below emits a people event. The later, richer
      // emission used to be guarded on "has this turn emitted people at all", which
      // meant the cards a plan turn shows were permanently the minimal {id,name}
      // pairs from the address-book lookup: no title, no company, and no card at all
      // for anyone the lookup refused to guess about but the extractor later
      // resolved. Replacing outright is just as wrong in the other direction — a turn
      // that fast-tagged three people and resolved one would lose two cards. So both
      // sets are kept and unioned, the resolved entry winning on conflict.
      let fastTagged = [];
      // True once the PeopleRank stream/blocking path has emitted its RANKED list.
      // Only the ranker locks the people slot, because only on a search turn is the
      // list of people itself the answer.
      let sentRankedPeople = false;
      // NO TURN ENDS WITHOUT A NEXT STEP.
      //
      // The main path computes suggestion chips and is careful about it. Every EARLY
      // RETURN — a correction, resolving a pending person, "who knows about this", the
      // network overview, a search that found results — streams its answer and then
      // completes with nothing, so those turns dead-end: the user reads a good answer
      // and the conversation just stops.
      //
      // Adding chips to nine separate return sites would mean nine chances to miss
      // one, and the next branch added would miss it too. writeEvent is the single
      // thing every branch goes through, so the fallback lives here: if a turn wrote
      // real text and never sent suggestions, it gets the one chip that always
      // applies before it is allowed to complete.
      let sentSuggestions = false;
      let wroteText = false;
      const writeEvent = (type, data) => {
        if (clientGone || raw.writableEnded) return false;
        if (type === "suggestions") sentSuggestions = true;
        if (type === "token") wroteText = true;
        if (type === "complete" && !sentSuggestions && wroteText) {
          // Set before writing, so a failed write cannot loop back through here.
          sentSuggestions = true;
          raw.write(
            `event: suggestions\ndata: ${JSON.stringify({ suggestions: [DEFAULT_CHIP] })}\n\n`,
          );
        }
        return raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const heartbeat = setInterval(() => {
        if (clientGone || raw.writableEnded) return;
        raw.write(`: ping\n\n`);
      }, 15000);

      const started = Date.now();
      let intent = "chat";
      let buf = "";
      let model = CHAT_MODEL;
      let peopleIds = [];
      let citations = [];
      let suggestPeople = []; // [{contactId,name}] for draft_message suggestions
      let turnPeople = []; // [{contactId,name,score,components}] persisted in metadata
      let pendingReaskText = null;

      // HARD DEADLINE — the definitive no-hang guarantee. No matter which internal
      // step wedges (a stuck DB query, an exhausted connection pool, a hung
      // upstream), the stream is force-completed and ended so the client ALWAYS
      // receives a `complete` and can never spin forever. The 15s heartbeat keeps
      // the socket alive, which is exactly why a client-side idle timer can't be
      // the only backstop — this server-side cap is.
      // ── WHAT IT IS DOING, WHILE IT IS DOING IT ───────────────────────────
      //
      // "It just keeps pondering and doing nothing... the buffering signal goes
      // away and I have to reload the app to know it's alive."
      //
      // A three-part question genuinely takes tens of seconds. The failure was
      // never the wait, it was a wait with nothing in it. `stage` frames name
      // each step and say when it is done, so the client can draw a checklist
      // and a bar; the three notes are the user's own escalation -- a word at
      // 20s, an honest "this is multi-step" at 40s, and "let me digest that"
      // past 75s.
      const stagesSent = new Set();
      const stage = (key, label, state = "start") => {
        if (clientGone || raw.writableEnded) return;
        const id = `${key}:${state}`;
        if (stagesSent.has(id)) return;
        stagesSent.add(id);
        writeEvent("stage", { key, label, state });
      };
      const say = (note) => {
        if (clientGone || raw.writableEnded) return;
        writeEvent("stage", { key: "note", note, state: "note" });
      };
      // ── NO STEP IS LEFT SPINNING ─────────────────────────────────────────
      //
      // "It showed them first, but it didn't execute and keep that there... it
      //  just kind of appeared once and then stopped working."
      //
      // A step is ticked by the lane that finishes it, and a lane that produced
      // nothing -- an Exa call with no usable results, a search that was skipped
      // after the plan was already announced -- never sent its `done`. So the
      // checklist stopped at two of three and sat there with a spinner next to a
      // part of the answer that was, in fact, finished. A progress bar that can
      // fail to reach the end is worse than none: it says the app is still
      // working when it is not.
      //
      // Called once at the end of every turn (and from the deadline path), with
      // the steps the plan actually promised. `stage` is already idempotent per
      // key+state, so a step that ticked itself is untouched.
      let announcedSteps = [];
      const closeOutStages = () => {
        for (const st of announcedSteps) stage(st.key, st.label, "done");
      };
      const waitNotes = [
        setTimeout(() => say("This one is a few searches deep — a moment while I look."), 20000),
        setTimeout(() => say("Multi-step answer. I am working through it in parts."), 40000),
        setTimeout(() => say("Still digesting all of that. Nearly there."), 75000),
      ];

      // ── WHAT WAS ACTUALLY ASKED, WORKED OUT IN CODE, BEFORE ANYTHING RUNS ─
      //
      // "It should be analyzed really quickly, not with an LLM or something,
      //  but just with code, very, very quickly and efficiently... to find that
      //  order of speed so it can do things in that order, and it should also
      //  find what needs web access and what doesn't."
      //
      // planQuery splits the message into its separate asks, gives each one a
      // lane (his own people / strangers on the web / places / the web), orders
      // the lanes by how fast they have MEASURED as being, and hands each lane
      // the text of its own ask. Cost: a handful of regexes, well under a
      // millisecond, before any network call is made.
      //
      // Two consequences, both of which were asked for in those words:
      //   - a question entirely about his own people spends no web call, and a
      //     question entirely about the world never loads the address book;
      //   - the place search is asked about coffee shops rather than about
      //     coffee shops AND VPs of engineering.
      //
      // It defers to the classifier wherever the classifier knows more -- see
      // the header of query-plan.js. It only takes work away from it for
      // multi-part questions, which one intent cannot describe at all.
      const qplan = planQuery(message, {
        isVoice,
        forceWeb: request.body?.forceWeb === true,
        pastedUrls: urlsInMessage(message),
      });
      request.log?.info?.(
        {
          asks: qplan.askCount,
          lanes: qplan.lanes.map((l) => l.key),
          router: qplan.routerNeeded,
          reason: qplan.reason,
        },
        "[chat] plan",
      );

      // 40s -> 90s. The ceiling was cutting off exactly the answers worth
      // waiting for: a question with three retrievals reached the deadline
      // mid-table and the user saw half a row. Nothing hangs on this number any
      // more -- the client terminates its own turn on any stream end now (see
      // lib/chat.ts) and the notes above keep the wait honest -- so it is back
      // to being what it should be: the point past which the answer is not
      // coming.
      const HARD_DEADLINE_MS = Number(process.env.CHAT_HARD_DEADLINE_MS) || 90000;
      const hardTimer = setTimeout(() => {
        if (raw.writableEnded || clientGone) return;
        try {
          // The deadline is the end of the turn too, so the checklist must not be
          // abandoned mid-spin: whatever did not land is not going to.
          closeOutStages();
          if (!buf) {
            raw.write(
              `event: token\ndata: ${JSON.stringify({ text: "Sorry, that took longer than it should have. Please try again." })}\n\n`,
            );
          }
          raw.write(
            `event: complete\ndata: ${JSON.stringify({ conversationId, intent, tookMs: Date.now() - started, timedOut: true })}\n\n`,
          );
        } catch {
          /* socket already gone */
        }
        clearInterval(heartbeat);
        for (const t of waitNotes) clearTimeout(t);
        try {
          if (!raw.writableEnded) raw.end();
        } catch {
          /* already ended */
        }
        request.log?.warn?.(`CHAT_HARD_DEADLINE owner=${amberId ?? "?"} intent=${intent} ms=${Date.now() - started}`);
      }, HARD_DEADLINE_MS);
      try {
        writeEvent("meta", { conversationId });

        // Load prior turns for context BEFORE persisting the new user message.
        const history = await listConversation(amberId, conversationId, {
          limit: 20,
        }).catch(() => []);
        const userMsg = await appendMessage(amberId, {
          conversationId,
          role: "user",
          content: message,
          // How this turn was ENTERED: "soundboard" (spoken) or "app_chat"
          // (typed). Persisted because the Today card labels the note, and a
          // typed note that reads "VOICE NOTE" is just wrong. Rows written
          // before this field existed carry no source at all; readers must
          // treat that as unknown rather than assume either one.
          metadata: { source },
        }).catch((err) => {
          request.log?.warn?.(
            { err: err?.message },
            "[chat] persist user msg failed",
          );
          return null;
        });
        // WHERE TO PUT THE RECORDING OF WHAT WAS JUST SAID.
        //
        // A spoken follow-up is uploaded AFTER the turn is under way -- the
        // audio is attached to the message, and the message does not exist
        // until the line above has run. The client cannot guess a bigserial and
        // must not have to re-read the thread to find out which row is its own,
        // so the id is handed back the moment it exists. Sent as its own event
        // rather than folded into `meta`, which is written before this and is
        // what tells the client the stream is alive at all.
        if (userMsg?.id != null) {
          writeEvent("user_message", {
            conversationId,
            messageId: String(userMsg.id),
          });
        }

        // ── INSTANT TAGGING ──────────────────────────────────────────────────
        //
        // The people chips used to wait on extractContactSignal: a Sonnet call with a
        // 30 second ceiling that decides what each mention MEANS. That work is worth
        // waiting for. Being told that a note saying "fundraising in SF with Sagar"
        // is about Sagar is not — the user's own address book answers that in about a
        // millisecond, and making them watch a spinner for it is why the chips landed
        // long after the transcript did.
        //
        // So a plain lookup runs first and publishes whatever it is certain of. It
        // refuses to guess between two people with the same first name, which is
        // exactly the case the disambiguation flow exists to ask about. The real
        // extraction still runs, still owns the meaning, and confirms or extends what
        // is already on screen — writeEvent("people") is emitted again later with the
        // resolved set, and the client replaces rather than appends.
        if (message) {
          const book = await contactNamesFor(amberId).catch(() => []);
          const quick = fastTagPeople(message, book);
          if (quick.length > 0 && !clientGone) {
            fastTagged = quick;
            // kind says WHY this person is on screen. "mentioned" is someone the
            // sentence named; "recalled" is someone the network turned up because
            // of what the sentence was about. They used to render identically, so
            // a contact who merely knows the neighborhood you mentioned looked
            // exactly like a person you had just tagged -- and there was no way to
            // tell the difference from the card.
            writeEvent("people", { people: quick.map((p) => ({ ...p, kind: "mentioned" })), citations: [] });
            request.log?.info?.(
              { count: quick.length },
              "[chat] fast-tagged people before generation",
            );
          }
        }

        // ── WHO DO I ALREADY KNOW THAT THIS IS ABOUT? ────────────────────────
        //
        // A turn used to be EITHER a conversation OR a people search: the router
        // only reaches the address book when the message says "my" / "I know" /
        // "who should I", and the handler is an if/else on that. So "help me plan a
        // dinner in San Francisco" got a good answer, restaurant cards, and nobody
        // — while every note the user ever recorded saying someone moved to SF sat
        // there unread. That is the exact thing the product exists to do.
        //
        // Rather than move intent classification (which would change behavior for
        // every existing query shape at once), this is a side channel. It names the
        // places in the message, looks through what the user has actually said and
        // through their contact records, and emits the people it finds as cards.
        //
        // STARTED HERE AND NEVER AWAITED ON THE HOT PATH. It is one indexed
        // statement plus a small lookup, kicked off before generation and collected
        // after, so it cannot delay a single token of the reply. It also emits
        // early, the moment it resolves, if nothing else has claimed the people
        // slot — so on a typed question the cards usually beat the answer.
        let hintPeople = [];
        // ONLY WHEN THE USER IS ASKING.
        //
        // Recalling "others connected to this" is an answer to a question. On an
        // anecdote it is the opposite of what the user wants: they are telling
        // Amber about four specific people, and the app replied with six more
        // they never mentioned -- which reads as the app inventing participants
        // and buries the ones who actually matter.
        // AND NOT ON A MULTI-PART QUESTION.
        //
        // "It just outputted Ajay and Beau's contacts as well for some reason.
        //  Ajay lives in New York, I guess, but he does not work in the industry
        //  I was requesting, and I never noted that about him... I'm definitely
        //  not sure why Beau showed up in this. He does not live in the city. He
        //  has no relation to this."
        //
        // This side channel matches the PLACE WORDS in a message against contact
        // records -- so a three-part question that happens to say "Manhattan"
        // and "New York" pulled in whoever the book associates with those words
        // and posted them as cards, unlabeled, next to the actual answers. On a
        // single question ("who do I know near Union Square?") that is the
        // feature. On a question with three separate asks in it, each of which
        // has a lane that answers it properly, it is noise arriving before the
        // answer and it made a stranger look like part of the reply.
        //
        // The ranker owns the people slot on those turns. So: only when the plan
        // found at most one ask.
        const hintTerms =
          message && looksLikeAQuestion(message) && !qplan.multi
            ? peopleHintTerms(message)
            : [];
        const hintPromise =
          hintTerms.length > 0 && amberId
            ? findPeopleByPlaceTerms(amberId, hintTerms, { limit: 8 })
                .then((found) => {
                  hintPeople = Array.isArray(found) ? found : [];
                  if (hintPeople.length > 0 && !clientGone && !sentRankedPeople) {
                    writeEvent("people", { people: hintPeople.map((p) => ({ ...p, kind: "recalled" })), citations: [] });
                  }
                  request.log?.info?.(
                    { terms: hintTerms.length, found: hintPeople.length },
                    "[chat] place-recall people",
                  );
                })
                .catch(() => {})
            : null;

        // PLACE CARDS, ALSO STARTED NOW. A planning turn ("dinner in Williamsburg,
        // thinking Asian") gets tappable venue cards rather than names buried in
        // prose. It is a web search plus a model call — up to twelve seconds — and
        // it used to be kicked off only AFTER the reply had finished generating, so
        // the cards landed ten-odd seconds after the answer the user was already
        // done reading. Nothing about it depends on the answer, so it starts here
        // with everything else and is collected at the end; by then it is usually
        // already done.
        //
        // Gated by the plan, whose places lane is wantsPlaces() -- an outing word,
        // an intent to plan one, and no past-time marker: a note about having HAD
        // dinner with someone must not spend a web search and a model call on
        // restaurants.
        // THE PLACE SEARCH IS ASKED ABOUT THE PLACES, AND NOTHING ELSE.
        //
        // It used to be handed the whole message, so "coffee shops in the East
        // Village, who do I know nearby, and VPs of engineering" went to Exa as
        // one query about all three -- and came back with pages that matched
        // none of them well. The plan hands this lane the text of its own ask.
        const wantsPlacesHere = qplan.needsPlaces;
        const placesQuery = qplan.laneQuery("places") || message;
        const placesT0 = Date.now();
        // Filled in by the place lane as soon as it lands; read (never awaited)
        // when the answer prompt is built. See the long note below.
        let placesForAnswer = null;
        const placesPromise = wantsPlacesHere
          ? findPlaces(placesQuery).catch(() => [])
          : null;

        // AND THEY GO OUT THE MOMENT THEY ARE READY.
        //
        // This promise already started here and was emitted at the very END of
        // the turn, after generation -- so cards that were ready in four seconds
        // appeared after a forty-second answer the user had finished reading.
        // The late block still runs, because that is where they are PERSISTED
        // onto the assistant message (which does not exist yet here); the flag
        // stops it sending them twice.
        let placesSent = false;
        // THE VENUES THE ANSWER IS ALLOWED TO NAME.
        //
        // The place search ran, found three real venues, sent them to the phone
        // as cards -- and was awaited only AFTER the reply had been written. So
        // the model composing the reply had no venues at all, said so, and then
        // filled the gap from memory: "the web results didn't return restaurant
        // listings... a reliable anchor in that area: Sightglass Coffee, and
        // Blue Bottle on Mint Plaza, a short walk and quieter mid-morning than
        // the Ferry Building location." Confident, specific, with walking
        // directions, about San Francisco, in an answer about Union Square in
        // New York, while three genuine New York cards sat on screen above it.
        //
        // Inventing a restaurant is worse than most hallucinations because the
        // user acts on it: they book it, or they walk there.
        //
        // Captured here rather than awaited, so nothing is added to the critical
        // path. The search starts near the top of the turn and generation begins
        // several seconds later, so this is usually populated by then; when it is
        // not, the instruction below forbids naming any venue at all and the
        // cards still arrive on their own.
        if (placesPromise) {
          void placesPromise.then((p) => { placesForAnswer = Array.isArray(p) ? p : []; }).catch(() => {});
        }
        if (placesPromise) {
          void placesPromise.then((places) => {
            if (clientGone || raw.writableEnded) return;
            if (Array.isArray(places) && places.length > 0) {
              placesSent = true;
              writeEvent("places", { places });
            }
            stage("places", "Places", "done");
            // What this lane actually cost, folded into the estimate that
            // orders the next multi-part answer. Measured, not assumed.
            recordLaneMs("places", Date.now() - placesT0);
          });
        }

        /**
         * The venue instruction for whichever answer prompt is about to be built.
         *
         * Three states, and the middle one is the one that was missing:
         *   - the lane did not run          → nothing to say, add nothing
         *   - it ran and landed in time     → here are the venues, use ONLY these
         *   - it ran and has not landed yet → cards are coming, name no venue
         *
         * The third case is a real answer, not a degraded one: "I have three
         * spots for you on the cards above" is useful and true, while a
         * remembered restaurant is neither.
         */
        const placesInstruction = () => {
          if (!wantsPlacesHere) return "";
          const p = placesForAnswer;
          if (Array.isArray(p) && p.length > 0) {
            const rows = p
              .slice(0, 6)
              .map((x) =>
                `  - ${x?.name ?? "?"}${x?.category ? ` (${x.category})` : ""}` +
                `${x?.address ? ` — ${x.address}` : ""}`,
              )
              .join("\n");
            return (
              "\nVENUES FOUND FOR THIS REQUEST. These are real and the user can see them as cards:\n" +
              rows +
              "\nName ONLY these when you talk about where to go. Do NOT add a venue from your own " +
              "knowledge, do NOT invent an address, opening hours, or how busy somewhere gets, and do " +
              "NOT say the search returned nothing. If none of them fit what was asked, say that plainly " +
              "and offer to look again with different terms."
            );
          }
          return (
            "\nThe user asked about places. Venue cards for this are being fetched and will appear " +
            "separately, so do NOT name any specific bar, restaurant or cafe yourself, and do not give " +
            "an address, hours or a recommendation about how busy one is. Refer to the cards, cover the " +
            "rest of the question, and offer to narrow the search."
          );
        };

        /**
         * EVERY REQUEST IN THE MESSAGE GETS AN ANSWER.
         *
         * planNarrative above enumerates the LANES a question needs -- people,
         * web, places -- which is not the same as the number of things asked.
         * A 206-word message with six requests in it is a single "both" lane
         * pair, so the plan says nothing about the six, and the reply answered
         * five: "whose birthday is coming up in the next month" was dropped
         * silently, with no acknowledgment that it had been asked.
         *
         * Silently is the part that matters. A person who dumps six things and
         * gets five back has no way to know which one was missed without
         * re-reading their own message against the answer, so they stop trusting
         * long messages -- and long messages are how people actually talk.
         *
         * Only added when the message really is multi-part, so ordinary turns
         * carry none of it.
         */
        const multiAskInstruction = (() => {
          const t = String(message || "");
          if (t.length < 180) return "";
          const questionMarks = (t.match(/\?/g) || []).length;
          const connectives = (t.match(/\b(also|and then|then |second|third|one more|another thing|separately|lastly|finally)\b/gi) || []).length;
          if (questionMarks < 2 && connectives < 2) return "";
          return (
            "\n\nTHIS MESSAGE CONTAINS SEVERAL SEPARATE REQUESTS. Before you finish, go back " +
            "through the user's message and make sure every single thing they asked for has been " +
            "addressed. Do not drop one silently because it was buried in the middle or arrived " +
            "last. If you cannot answer one of them, give it its own short line saying so and what " +
            "would let you answer it -- an unanswerable ask acknowledged is fine, an ask that " +
            "vanishes is not."
          );
        })();

        // ── CORRECTION DETECTION ──────────────────────────────────────────────
        // If the user corrects a prior capture ("no, I meant the other Mike"),
        // find the most-recent assistant announce that carries capturedOutcomes,
        // resolve the corrected contact from the message text, rewrite the stored
        // row (fact/note/experience), flip the name-memory pointer, announce the
        // fix, and short-circuit — no LLM call needed.
        if (amberId && message && _isCorrection(message)) {
          try {
            const correctionPrior = [...history].reverse().find(
              (m) => m.role === "assistant" && Array.isArray(m.metadata?.capturedOutcomes) && m.metadata.capturedOutcomes.length > 0,
            );
            if (correctionPrior) {
              const priorOutcomes = correctionPrior.metadata.capturedOutcomes;
              const corrContacts = await getContactsForResolution(amberId).catch(() => []);

              // Strip cue words to isolate the corrected name. Voice-to-text
              // produces lowercase, so capitalisation cannot be relied on.
              // For "no, not zhan, its campeau" prefer the last comma segment so
              // the phrase before the comma ("not zhan") doesn't pollute the query.
              const _CUE_RX = /^(?:no,?|nope,?|nah,?|wrong,?|actually,?|not|it'?s|its|i\s+meant|the\s+other|that'?s|thats|really|meant)\s+/i;
              const commaSegs = message.toLowerCase().split(",");
              let cleanedName = commaSegs[commaSegs.length - 1].trim();
              let _prev;
              do {
                _prev = cleanedName;
                cleanedName = cleanedName.replace(_CUE_RX, "").trim();
              } while (cleanedName !== _prev);

              if (cleanedName) {
                // Primary: handles exact full name and first-name token.
                let corrResolution = resolveContactByName(cleanedName, corrContacts);

                // Fallback: last-name / any-word-token match — unique hit only.
                // Handles "campeau" matching "Mike Campeau" when resolveContactByName
                // doesn't see it (it only checks first token / full name).
                if (corrResolution.status !== "resolved") {
                  const tokenMatches = corrContacts.filter(
                    (c) => _normName(c.full_name).split(/\s+/).includes(cleanedName),
                  );
                  if (tokenMatches.length === 1) {
                    corrResolution = {
                      status: "resolved",
                      contactId: tokenMatches[0].id,
                      matchedName: tokenMatches[0].full_name,
                      candidates: [],
                    };
                  }
                }

                if (corrResolution.status === "resolved") {
                  const correctedId = corrResolution.contactId;
                  const correctedName = corrResolution.matchedName;

                  // Pick the target outcome. When multiple correctable outcomes
                  // exist, require a unique first-name-token match to stay
                  // conservative — if uncertain, fall through to normal chat.
                  const correctableOutcomes = priorOutcomes.filter(
                    (o) => o.route === "fact" || o.route === "contact_field" || o.route === "note" || o.route === "experience",
                  );
                  let target = null;
                  if (correctableOutcomes.length === 1) {
                    target = correctableOutcomes[0];
                  } else if (correctableOutcomes.length > 1) {
                    const corrFirstTok = _normName(correctedName).split(/\s+/)[0];
                    const confident = correctableOutcomes.filter(
                      (o) => o.nameKey && _normName(o.nameKey).split(/\s+/)[0] === corrFirstTok,
                    );
                    if (confident.length === 1) target = confident[0];
                    // else: multiple or zero confident matches → fall through
                  }

                  if (target) {
                    let rewrote = false;
                    if ((target.route === "fact" || target.route === "contact_field") && target.factId) {
                      await updateFactContact({
                        factId: target.factId, contactId: correctedId,
                        status: "resolved", ownerId: amberId,
                      }).catch(() => null);
                      rewrote = true;
                    } else if (target.route === "note" && target.contentId) {
                      const corrNote = await getNoteById(amberId, target.contentId).catch(() => null);
                      if (corrNote) {
                        const existingIds = Array.isArray(corrNote.participant_ids) ? corrNote.participant_ids : [];
                        const newIds = existingIds.filter((nid) => String(nid) !== String(target.contactId));
                        newIds.push(correctedId);
                        await setNoteParticipants({ ownerId: amberId, id: target.contentId, participantIds: newIds }).catch(() => null);
                        rewrote = true;
                      }
                    } else if (target.route === "experience" && target.contentId) {
                      const corrExp = await getExperienceById(amberId, target.contentId).catch(() => null);
                      if (corrExp) {
                        const existingIds = Array.isArray(corrExp.participant_ids) ? corrExp.participant_ids : [];
                        const newIds = existingIds.filter((nid) => String(nid) !== String(target.contactId));
                        newIds.push(correctedId);
                        await setExperienceParticipants({ ownerId: amberId, id: target.contentId, participantIds: newIds }).catch(() => null);
                        rewrote = true;
                      }
                    }
                    if (rewrote) {
                      if (target.nameKey) {
                        // EXPLICIT: the user re-tagged this by hand.
                        await upsertContactNameMemory({
                          ownerId: amberId,
                          nameKey: target.nameKey,
                          chosenContactId: String(correctedId),
                          explicit: true,
                        }).catch(() => null);
                      }
                      const fixText = `Fixed — that's on ${correctedName} now.`;
                      await appendMessage(amberId, {
                        conversationId,
                        role: "assistant",
                        content: fixText,
                        intent: "chat",
                        metadata: { model },
                      }).catch(() => null);
                      if (!clientGone) writeEvent("token", { text: fixText });
                      if (!clientGone) writeEvent("complete", { conversationId, intent: "chat", tookMs: Date.now() - started });
                      return;
                    }
                  }
                }
              }
            }
          } catch {
            // Correction detection is best-effort — fail through to normal chat.
          }
        }

        // ── PENDING CLARIFICATION PRE-CHECK ──────────────────────────────────
        // Only runs when the client explicitly supplies body.pendingId — meaning
        // the user is deliberately answering a specific clarification question.
        // The most-recent-fallback (getPendingFactContext) has been removed: it
        // resurrected stale pendings onto unrelated fresh messages, causing the
        // "did you mean Sagar?" re-ask to fire on an Aidan message.
        const bodyPendingId = body.pendingId != null ? Number(body.pendingId) : null;
        if (amberId && bodyPendingId) {
          const pending = await getPendingFactContextById(bodyPendingId, amberId).catch(() => null);
          if (pending) {
            const clarifyContactId =
              typeof body.clarifyContactId === "string"
                ? body.clarifyContactId.trim() || null
                : null;

            let resolvedId = null;
            let resolvedName = null;

            if (clarifyContactId === "__skip__") {
              // The user chose not to link this mention to anyone. Leave the note
              // as-is (the name stays as a name-only chip) and clear the pending.
              await clearPendingFactContextById(pending.id, amberId).catch(() => null);
              const skipText = `Okay, I left ${pending.raw_name} unlinked for now.`;
              await appendMessage(amberId, {
                conversationId, role: "assistant", content: skipText, intent: "chat",
                metadata: { model },
              }).catch(() => null);
              if (!clientGone) writeEvent("token", { text: skipText });
              if (!clientGone) writeEvent("complete", { conversationId, intent: "chat", tookMs: Date.now() - started });
              return;
            } else if (clarifyContactId === "__new__") {
              // Create a brand-new contact from the spoken name and link it, so an
              // unrecognised person becomes a real contact (with an id) on the spot.
              const created = await createContactForOwner({
                ownerId: amberId,
                ownerPhone: phone ?? null,
                fullName: pending.raw_name,
                source: "amber_note",
              }).catch(() => null);
              if (created?.id != null) {
                resolvedId = String(created.id);
                resolvedName = pending.raw_name;
              }
            } else if (clarifyContactId) {
              // iOS tapped a card — trust it directly for all awaiting types.
              resolvedId = clarifyContactId;
              // Recover the full display name from the pending candidates so the
              // confirmation reads "…for Jake Boyarsky", not the bare "Jake".
              resolvedName = _lookupNameInPendingMeta(pending, resolvedId);
            } else if (pending.awaiting === "soft_confirm") {
              // Yes/no/other handling for soft-confirm typed replies.
              let softMeta = null;
              try { softMeta = JSON.parse(pending.candidates ?? "null"); } catch { /* ignore */ }
              const msgLower = message.toLowerCase().trim();
              const YES_WORDS = new Set(["yes","yeah","yep","yup","sure","correct","right","ya","yea","mhm","uh huh","definitely","exactly","that's him","thats him","that's her","thats her"]);
              const NO_WORDS = new Set(["no","nope","nah","not him","not her","wrong","negative","different"]);
              if (YES_WORDS.has(msgLower)) {
                resolvedId = softMeta?.guessedId ?? null;
                resolvedName = softMeta?.guessedName ?? null;
              } else if (NO_WORDS.has(msgLower)) {
                // Downgrade to full clarify — show remaining candidates. The
                // sibling rows for the same name were about to ask the identical
                // yes/no, so they downgrade with it; leaving them behind is what
                // made the same question reappear after it had been answered.
                const remaining = (await downgradeSoftConfirmRow(amberId, pending)) ?? [];
                for (const sib of await siblingPendingRows(amberId, pending)) {
                  await downgradeSoftConfirmRow(amberId, sib);
                }
                if (!clientGone) writeEvent("clarify", { question: "Which one did you mean?", candidates: remaining });
                if (!clientGone) writeEvent("complete", { conversationId, intent: "chat", tookMs: Date.now() - started });
                return;
              } else {
                // OTHER — fall through to normal chat, append re-ask after reply.
                const { gaveUp } = await bumpReaskRow(amberId, pending);
                for (const sib of await siblingPendingRows(amberId, pending)) {
                  await bumpReaskRow(amberId, sib);
                }
                if (!gaveUp) {
                  pendingReaskText = `(By the way, that note about ${pending.raw_name}: did you mean ${softMeta?.guessedName ?? pending.raw_name}?)`;
                }
              }
            } else if (pending.reask_count < 1) {
              // Try to match by name from the typed reply
              // (which_contact / which_contact_field / which_participant).
              let parsedCandidates = null;
              try {
                parsedCandidates = JSON.parse(pending.candidates ?? "null");
              } catch { /* ignore */ }
              const nameList = Array.isArray(parsedCandidates)
                ? parsedCandidates
                : parsedCandidates?.names ?? null;
              if (nameList && nameList.length > 0) {
                const allContacts = await getContactsForResolution(amberId).catch(() => []);
                const filtered = allContacts.filter((c) =>
                  nameList.some((n) =>
                    (typeof n === "string" ? n : n?.name) === c.full_name,
                  ),
                );
                const res = resolveContactByName(message, filtered);
                if (res.status === "resolved") {
                  resolvedId = res.contactId;
                  resolvedName = res.matchedName;
                }
              }
            }

            if (resolvedId) {
              // THE NAME AND THE THREAD BOTH MATTER HERE.
              //
              // resolvedName can be null when the reply matched by id alone, and
              // a null toName silently disables the transcript rewrite; and
              // without conversationId the fix reaches the derived note but not
              // the TRANSCRIPT the user is looking at, so the misheard name
              // stayed on screen after they had corrected it.
              resolvedName =
                resolvedName ?? (await contactNameById(amberId, resolvedId).catch(() => null));
              const { confirmText } = await resolvePendingItem({
                ownerId: amberId, pending, resolvedId, resolvedName, conversationId,
              });
              // Sweep sibling pending items for the same person — the note, the
              // experience, and the fact from one ramble each hold their own
              // pending row, but the user only answered once, so apply that
              // answer to all of them and clear them together.
              for (const sib of await siblingPendingRows(amberId, pending)) {
                await resolvePendingItem({
                  ownerId: amberId, pending: sib, resolvedId, resolvedName, conversationId,
                }).catch(() => null);
              }
              // CLOSE THE DICTIONARY LOOP ON THE TYPED PATH TOO. Correcting a
              // name by typing it is a correction like any other; only the card
              // tap was teaching the transcriber, so the same mishearing kept
              // coming back for anyone who answers in the thread.
              if (resolvedName) {
                void recordVoiceVocab(amberId, [resolvedName], resolvedId).catch(() => {});
                if (pending.raw_name && _normName(pending.raw_name) !== _normName(resolvedName)) {
                  void recordVoiceCorrection(amberId, pending.raw_name, resolvedName).catch(() => {});
                }
              }
              await appendMessage(amberId, {
                conversationId,
                role: "assistant",
                content: confirmText,
                intent: "chat",
                metadata: { model },
              }).catch(() => null);
              if (!clientGone) writeEvent("token", { text: confirmText });
              if (!clientGone) writeEvent("complete", { conversationId, intent: "chat", tookMs: Date.now() - started });
              return;
            } else if (pending.reask_count >= 1 && pending.awaiting !== "soft_confirm") {
              // Give up on which_contact / which_contact_field / which_participant after too many failed attempts.
              await clearPendingFactContextById(pending.id, amberId).catch(() => null);
            } else if (pending.awaiting !== "soft_confirm") {
              // Bump reask_count and fall through to normal chat.
              await updatePendingFactContext({
                id: pending.id,
                ownerId: amberId,
                reaskCount: (pending.reask_count ?? 0) + 1,
              }).catch(() => null);
            }
          }
        }

        // ── NAME LOOKUP ──────────────────────────────────────────────────────
        // Before routing: if this reads like "who is X" / "contacts named X",
        // search the ADDRESS BOOK by name and surface the contact card even when
        // there are no notes on the person. A miss here (no name match) falls
        // straight through to the normal router below.
        if (amberId) {
          const lookupName = _extractLookupName(message);
          if (lookupName) {
            const matches = await searchContactsByName(amberId, lookupName, 8).catch(() => []);
            if (matches.length > 0) {
              intent = "network_query";
              writeEvent("intent", { intent });

              const ids = matches.map((m) => String(m.id ?? m.contactId));
              // First-name key for the confidence pointer, so bare "Shirley" and
              // "Shirley Park" share one memory.
              const nameKey = _normName(String(lookupName).split(/\s+/)[0] || lookupName);

              // One parallel wait for every read the answer needs, instead of four
              // sequential round-trips: facts, shared circles, favorites, and the
              // name-memory pointer all resolve together. This is where the latency
              // was, not the model, so speeding it up keeps the answer quality.
              const [factsById, circleEntries, favorites, nameMemory] = await Promise.all([
                getContactContentForContacts(amberId, ids).catch(() => ({})),
                Promise.all(
                  ids.map((id) =>
                    getCirclesForContact(amberId, id)
                      .then((cs) => [id, cs])
                      .catch(() => [id, []]),
                  ),
                ),
                listFavorites(amberId).catch(() => []),
                matches.length > 1
                  ? getContactNameMemory(amberId, nameKey).catch(() => null)
                  : Promise.resolve(null),
              ]);
              const circlesById = Object.fromEntries(circleEntries);
              const factsFor = (id) => {
                const v = factsById?.[id];
                if (Array.isArray(v)) return v;
                if (v && Array.isArray(v.facts)) return v.facts;
                return [];
              };
              const hasCircle = (id) => (circlesById[id]?.length ?? 0) > 0;

              const people = matches.map((m) => ({
                contactId: String(m.id ?? m.contactId),
                name: m.name ?? m.full_name ?? "Unknown",
                title: m.title ?? null,
                company: m.company ?? null,
                phone: m.phone ?? null,
                // CARRIED SO THE ANSWER CAN USE THEM. Everything below decided
                // whether it had anything to say about a person from the title
                // and the company alone, so a card whose only content is the
                // note the user typed into their own phone -- or their city, or
                // their nickname -- was reported as empty. See `substantive`.
                city: m.city ?? null,
                region: m.region ?? null,
                nickname: m.nickname ?? null,
                birthday: m.birthday ?? null,
                syncedNote: m.apple_notes ?? m.appleNotes ?? m.notes ?? null,
                score: 0,
              }));

              // Score every same-name match on independent signals (see
              // _scoreCandidate) to decide who they most likely mean. Favorites
              // are one cheap batch read; notes, circles, name match, connection,
              // and enrichment come from data already loaded above.
              const pById = Object.fromEntries(people.map((p) => [p.contactId, p]));
              const mById = Object.fromEntries(
                matches.map((m) => [String(m.id ?? m.contactId), m]),
              );
              const favSet = new Set(
                (Array.isArray(favorites) ? favorites : []).map((f) => String(f.id)),
              );
              const confById = {};
              for (const id of ids) {
                confById[id] = _scoreCandidate({
                  nameMatch: _nameMatchScore(lookupName, pById[id]?.name),
                  notes: _notesScore(factsFor(id)),
                  circleCount: circlesById[id]?.length ?? 0,
                  favorite: favSet.has(id),
                  connected: Boolean(mById[id]?.linkedAmberId),
                  hasTitle: Boolean(pById[id]?.title),
                  hasCompany: Boolean(pById[id]?.company),
                });
              }
              const conf = (id) => confById[id] ?? 0;
              // "Substantive" = we hold real content to describe them (not just a
              // name match). Gates a written dossier vs the add-a-note prompt.
              // "Substantive" = we hold real content to describe them. It used to
              // mean a circle, a saved fact, a title or a company -- and NOTHING
              // ELSE, so a contact carrying the note the user typed into their
              // own address book, or a city, or a nickname, fell through to the
              // canned "you have nothing saved about them yet".
              //
              // Measured: a card whose only content was a note answered in 84ms
              // with "Odette Marsh is in your contacts, but you have nothing
              // saved about them yet" -- while the note sat on the card. That
              // gets worse the moment the Apple notes entitlement lands, because
              // then a large share of cards have a note and nothing else.
              const substantive = (id) =>
                hasCircle(id) ||
                factsFor(id).length > 0 ||
                Boolean(pById[id]?.title) ||
                Boolean(pById[id]?.company) ||
                Boolean(pById[id]?.syncedNote) ||
                Boolean(pById[id]?.city) ||
                Boolean(pById[id]?.nickname) ||
                Boolean(pById[id]?.birthday);

              // The confidence pointer (loaded above with the other reads): the
              // same-name contact you last confirmed, with a streak. Retrieval
              // honors it; an unambiguous resolution below writes it.
              const pointerId =
                nameMemory && ids.includes(String(nameMemory.currentContactId))
                  ? String(nameMemory.currentContactId)
                  : null;
              const pointerStreak = pointerId ? Number(nameMemory.stableStreak) || 0 : 0;

              // Who to lead with. A single match is the person. Among several, a
              // remembered pointer wins (that's the point of the streak); else the
              // confidence score leads only when the top clearly beats the runner
              // up, otherwise we show all cards and ask which one.
              let leadId = null;
              if (matches.length === 1) {
                leadId = ids[0];
              } else if (pointerId) {
                leadId = pointerId;
              } else {
                const sorted = [...ids].sort((a, b) => conf(b) - conf(a));
                const top = sorted[0];
                const secondConf = sorted[1] ? conf(sorted[1]) : 0;
                if (top && conf(top) >= DISAMBIG_MIN_LEAD && conf(top) - secondConf >= DISAMBIG_MIN_MARGIN) {
                  leadId = top;
                }
              }

              // Lead card first, then the rest by confidence.
              const orderedPeople = leadId
                ? [
                    pById[leadId],
                    ...people
                      .filter((p) => p.contactId !== leadId)
                      .sort((a, b) => conf(b.contactId) - conf(a.contactId)),
                  ]
                : [...people].sort((a, b) => conf(b.contactId) - conf(a.contactId));
              writeEvent("people", { people: orderedPeople, citations: [] });

              const emitToken = (t) => {
                if (!clientGone) writeEvent("token", { text: _stripDashes(t) });
              };

              let answerText = "";
              if (leadId && substantive(leadId)) {
                const p = pById[leadId] ?? orderedPeople[0];
                const others =
                  matches.length > 1
                    ? orderedPeople.filter((x) => x.contactId !== leadId).map((x) => x.name)
                    : [];
                const sys = [
                  AMBER_IDENTITY,
                  "",
                  "THIS TURN: the user asked about one person in their contacts.",
                  todayLine,
                  "Answer naturally and comprehensively using ONLY the dossier below. Never invent anything you were not given.",
                  "Lead with who they are and how they relate to the user: their role, any circle you share, and the standout saved notes.",
                  "If you share a circle, say so plainly and what it implies (for a work circle, that you work together).",
                  "Close with ONE concrete, fitting next step as a question, for example offering to draft a message or set up time with a coworker. Offer it, do not assume or take the action.",
                  "Keep it to a short warm paragraph. Never end the conversation.",
                  others.length === 0
                    ? ""
                    : pointerStreak >= 2
                      ? `Several contacts share this name, but they have confirmed THIS one before, so lead with confidence. Open by naming who you are going with (the ${p.name} they usually mean), give the answer, then note the other same-name contacts (${others.join(", ")}) exist so they can switch.`
                      : pointerStreak === 1
                        ? `Several contacts share this name and you believe it is THIS one but are not fully sure. Open by gently checking it is this ${p.name} and not another, give the answer, then note the others (${others.join(", ")}) exist so they can switch.`
                        : `Several contacts share this name. You are most confident about THIS one because you hold the most on them. Open by gently saying you are guessing they mean this person, give the answer, then note the others (${others.join(", ")}) exist so they can switch.`,
                  ANSWER_STYLE,
                  HOUSE_RULES,
                  "Dossier:",
                  _renderDossier(p, factsFor(leadId), circlesById[leadId]),
                ]
                  .filter(Boolean)
                  .join("\n");
                answerText = await stream({
                  model: CHAT_MODEL,
                  system: sys,
                  messages: [{ role: "user", content: message }],
                  maxTokens: 480,
                  onToken: emitToken,
                });
              } else if (matches.length > 1) {
                const rows = orderedPeople
                  .map((x) => {
                    const d = [];
                    const roleLine = [x.title, x.company].filter(Boolean).join(" at ");
                    if (roleLine) d.push(roleLine);
                    const cs = circlesById[x.contactId] ?? [];
                    if (cs.length > 0) d.push(`in your ${cs.map((c) => c.name).join(", ")} circle`);
                    const fc = factsFor(x.contactId).length;
                    if (fc > 0) d.push(`${fc} saved note${fc === 1 ? "" : "s"}`);
                    return `- ${x.name}${d.length ? `: ${d.join(", ")}` : " (nothing saved yet)"}`;
                  })
                  .join("\n");
                const sys = [
                  AMBER_IDENTITY,
                  "",
                  "THIS TURN: the user asked about someone by name and more than one contact matches.",
                  "Ask which one they mean, warmly and briefly. Use the distinguishing details below (shared circle, role, saved notes) to help them pick, and gently point to the most likely one when a circle or notes make it obvious.",
                  "Do not invent details. Never end the conversation.",
                  ANSWER_STYLE,
                  HOUSE_RULES,
                  "Candidates:",
                  rows,
                ].join("\n");
                answerText = await stream({
                  model: CHAT_MODEL,
                  system: sys,
                  messages: [{ role: "user", content: message }],
                  maxTokens: 320,
                  onToken: emitToken,
                });
              } else {
                // One match, nothing saved and no shared circle: stay cheap.
                answerText = _stripDashes(
                  `${orderedPeople[0].name} is in your contacts, but you have nothing saved about them yet. Open their card to see what you have. Want to tell me how you know them? Say it and I will keep it on their card.`,
                );
                emitToken(answerText);
              }

              // An unambiguous resolution (only one contact carries this name)
              // reinforces the pointer so a later bare "Shirley" resolves here
              // and the streak can climb to "assume". NOT explicit: nobody was
              // asked and nobody vouched — it climbs one step at a time.
              if (matches.length === 1 && leadId) {
                await upsertContactNameMemory({
                  ownerId: amberId,
                  nameKey,
                  chosenContactId: leadId,
                }).catch(() => null);
              }

              await appendMessage(amberId, {
                conversationId,
                role: "assistant",
                content: answerText,
                intent,
                metadata: {
                  model: CHAT_MODEL,
                  peopleIds: orderedPeople.map((p) => p.contactId),
                  people: orderedPeople,
                  citations: [],
                },
              }).catch(() => null);

              if (!clientGone) {
                writeEvent("complete", { conversationId, intent, tookMs: Date.now() - started });
              }
              return;
            }
          }
        }

        // ── WHO KNOWS ABOUT THIS ─────────────────────────────────────────────
        // "Who knows about this?" is a question about a note's AUDIENCE, and an
        // audience is a RELATION — note_shares pointing at a circle, a contact, or
        // the whole network — not text. So no amount of searching note bodies can
        // answer it, and the ranker will confidently answer from the wrong thing.
        //
        // Deliberately a regex and not a router intent: the answer is a database
        // lookup with exactly one correct result, and asking a model to classify
        // the question only adds a way to get it wrong. Resolved against CURRENT
        // membership, so someone who has left a circle is not reported as knowing.
        const WHO_KNOWS_RE =
          /\bwho (?:else )?(?:knows|has seen|saw|can see|is this shared with|did i (?:share|send) (?:this|it) (?:with|to))\b|\bwho (?:else )?have i (?:shared|sent) (?:this|it) (?:with|to)\b/i;
        if (amberId && conversationId && WHO_KNOWS_RE.test(message)) {
          intent = "chat";
          writeEvent("intent", { intent });
          const audience = await whoKnowsAboutNote(amberId, conversationId).catch(() => null);
          const named = (audience?.people ?? []).filter((p) => p.name);
          const people = named.map((p) => ({
            contactId: String(p.contactId),
            name: p.name,
            title: null,
            company: null,
            phone: null,
            score: 0,
          }));
          if (people.length > 0) writeEvent("people", { people, citations: [] });
          const sys = [
            AMBER_IDENTITY,
            "",
            "THIS TURN: the user asked who can see this note. Report ONLY what is below.",
            todayLine,
            !audience || !audience.shared
              ? "This note is PRIVATE. Nobody else can see it. Say that plainly, then offer to share it with a circle or a person."
              : audience.scopeType === "circle"
                ? `Shared with the circle "${audience.scopeName ?? "a circle"}". Everyone currently in it can see it. Members: ${named.map((p) => p.name).join(", ") || "no one is in that circle yet"}.`
                : audience.scopeType === "contact"
                  ? `Shared with one person: ${audience.scopeName ?? named[0]?.name ?? "a contact"}.`
                  : `Shared with their whole network — everyone they are connected to on Amber: ${named.map((p) => p.name).join(", ") || "no connections yet"}.`,
            "Name the people rather than giving a count. Never add anyone who is not listed.",
            "Close with a short, useful next step as a question.",
            ANSWER_STYLE,
            HOUSE_RULES,
          ].join("\n");
          const answerText = await stream({
            model: CHAT_MODEL,
            system: sys,
            messages: [{ role: "user", content: message }],
            maxTokens: 400,
            onToken: (t) => {
              if (clientGone) throw new Error("client_disconnected");
              writeEvent("token", { text: _stripDashes(t) });
            },
          });
          await appendMessage(amberId, {
            conversationId,
            role: "assistant",
            content: answerText,
            intent,
            metadata: {
              model: CHAT_MODEL,
              peopleIds: people.map((p) => p.contactId),
              people,
              citations: [],
            },
          }).catch(() => null);
          if (!clientGone) {
            writeEvent("complete", { conversationId, intent, tookMs: Date.now() - started });
          }
          return;
        }

        // ── THE ANSWER IS WRITTEN IN THE SAME SECTIONS THE CARDS ARE IN ─────
        //
        // "The answer should have been something like: here are the people you
        //  were looking for to add to your network... the other contacts that you
        //  don't have, I will show you in a way that you can add them... then the
        //  network response for people you want to have lunch with... finally the
        //  places you requested."
        //
        // The cards were already separated by lane; the PROSE was not. One
        // paragraph covering three unrelated asks is what made the sections read
        // as a jumble, because the text above them did not agree with their
        // order. This tells the model the order and the boundaries -- taken from
        // the plan, so the words and the cards cannot disagree about either.
        //
        // Only on a multi-part question: on a single ask it would turn a
        // two-sentence reply into a headed report, which is worse.
        const planNarrative = (() => {
          if (qplan.lanes.length < 2) return "";
          const named = {
            people: "the people he already knows",
            web_people: "people found on the web",
            places: "places",
            web: "what the web says",
          };
          const lines = qplan.lanes.map(
            (l, i) => `${i + 1}. ${named[l.key] || l.key}${l.ask ? ` — for "${l.ask}"` : ""}`,
          );
          return (
            "\n\nTHIS QUESTION HAS SEVERAL SEPARATE ASKS IN IT. Answer them in this " +
            "order, one short paragraph each, and keep them strictly apart — the app " +
            "is showing the cards for each part in this same order underneath you:\n" +
            `${lines.join("\n")}\n` +
            "Say which ask each paragraph is answering in its first few words. Never " +
            "mix people from one ask into the paragraph for another. If somebody " +
            "answers two of the asks, name them in the FIRST one they answer, say " +
            "that they also fit the other, and mention them first in that paragraph."
          );
        })();

        // ── THE PEOPLE PATH CAN START BEFORE THE CLASSIFIER ANSWERS ─────────
        //
        // The prep -- the address book, its facts, the owner's profile -- does
        // not depend on what was asked, and neither does the dimension
        // retrieval, which needs only the owner and the question text. Both used
        // to wait for the classifier hop anyway, because they were written after
        // it: 400ms of doing nothing on the single most common question there is.
        //
        // The plan (query-plan.js) already knows whether the question has a
        // people lane in it, in code, before any network call. When it does, the
        // load starts HERE, alongside the classifier rather than behind it. When
        // the plan is not sure -- ordinary conversation, a bare web hint -- the
        // classifier decides and startPeoplePrep() is called after it instead,
        // exactly as before.
        //
        // WHAT THIS COSTS WHEN IT IS WRONG, stated rather than glossed. The early
        // start only helps when the classifier is going to run at all -- that is
        // the hop it overlaps -- and for a single people ask the classifier
        // sometimes answers "search" with structured filters, which takes the
        // cheap SQL path and never touches this payload. That turn pays for one
        // address-book load it did not use. It is not thrown away: the prep is
        // cached per owner for a minute, so it serves the next people question
        // instead. Worth 400ms off the most common question there is.
        //
        // It is not blind speculation either: `planWantsPeople` means a
        // first-person people ask was MATCHED in the message, not that one might
        // be in there somewhere.
        const planWantsPeople = qplan.needsPeople;
        const peopleLimit = peopleResultCount(message);
        const rankDeps = {
          limit: peopleLimit,
          // deps.listContacts (tests) overrides the owner-scoped loader.
          listContacts: async () =>
            deps.listContacts
              ? deps.listContacts(amberId)
              : amberId
                ? listContactsForRankingByAmberId(amberId)
                : [],
          getProfile: async () => {
            const profile = amberId ? await getUserProfileByAmberId(amberId) : null;
            if (!reqTimezone) return profile;
            return { ...(profile || {}), timezone: reqTimezone };
          },
          getFactsBatch: async (ids) =>
            amberId ? getContactContentForContacts(amberId, ids) : {},
          getUserFactsForMe: async () =>
            amberId ? getUserFacts(amberId) : [],
          rankViaTogariSearch,
        };
        // WHERE THE TIME ACTUALLY GOES, measured rather than reasoned about.
        // Two rounds of inference about this path have been wrong; one line of
        // timing per phase settles it on the next real question.
        const rankT0 = Date.now();
        let prepMs = null;
        let prepCached = false;
        let retrievalMs = null;
        // THE PAYLOAD IS THE SAME FOR EVERY QUESTION IN THE SAME MINUTE.
        //
        // The address book and its facts do not depend on what was asked, and
        // they were being rebuilt from Postgres on the critical path of every
        // people question. Cached per owner, invalidated the moment a capture
        // writes something (see the capture block below), so the second
        // question of a session skips the load entirely.
        const prepKey = amberId ? `owner:${amberId}` : did ? `did:${did}` : null;
        let preparedPromise = null;
        let relevancePromise = null;
        // IDEMPOTENT, because two callers race for it by design: the plan may
        // start it before the classifier runs, and the classifier's answer may
        // be the first thing that knows it is needed. Whichever arrives first
        // owns the work; the second call is a no-op rather than a second load of
        // the same address book.
        const startPeoplePrep = () => {
          if (preparedPromise) return;
          const cachedPrep = prepKey ? getPreparedInput(prepKey) : null;
          preparedPromise = cachedPrep
            ? (() => {
                prepCached = true;
                prepMs = 0;
                return Promise.resolve(cachedPrep);
              })()
            : preparePeopleRankInput(did, rankDeps)
                .then((r) => {
                  prepMs = Date.now() - rankT0;
                  if (r && prepKey) setPreparedInput(prepKey, r);
                  return r;
                })
                .catch(() => {
                  prepMs = Date.now() - rankT0;
                  return null;
                });
          relevancePromise =
            amberId && typeof message === "string" && message.trim()
              ? retrieveRelevant({ ownerId: amberId, question: message, limit: 40 })
                  .then((r) => {
                    retrievalMs = Date.now() - rankT0;
                    return r;
                  })
                  .catch((err) => {
                    retrievalMs = Date.now() - rankT0;
                    console.warn(
                      `[chat] dimension retrieval failed: ${err?.message || err}`,
                    );
                    return null;
                  })
              : null;
        };
        if (planWantsPeople) startPeoplePrep();

        // ── ROUTE ────────────────────────────────────────────────────────────
        // A spoken voice note is a journal entry, NOT a people search. Routing it
        // through the ranker scans the entire address book (hundreds of contacts)
        // and is the real cause of the multi-minute "Thinking…" hang. Voice always
        // takes the fast chat path — a short acknowledgment — and skips the
        // router LLM call entirely.
        let needsWeb = false;
        let routedFilters = null;
        // Set to the user's question when a people search comes up empty, so the
        // suggestions block below can lead with a "Search the web" chip.
        let offerWebSearch = null;
        const forceWeb = request.body?.forceWeb === true;
        // A PASTED LINK IS A WEB REQUEST, full stop. "read this and tell me the
        // headcount" used to go to the router, which classified it as chat, which
        // answered from training knowledge about a page it had never seen. There is
        // nothing to classify here: the user named the document.
        const pastedUrls = urlsInMessage(message);
        if (!qplan.routerNeeded) {
          // THE CODE ALREADY KNOWS, so the classifier hop is not spent.
          //
          // This covers the pasted link and the "Search the web" tap it always
          // covered, and now also the two cases the classifier could not answer
          // as well: a multi-part question (one intent cannot describe three
          // asks) and a question with no first-person claim in it at all, which
          // by definition the address book cannot answer.
          //
          // The gain is not only the 400ms of the hop. For a multi-part
          // question the classifier used to pick ONE reading, and its own
          // instructions say to prefer the web one -- so "tell me who I know
          // nearby" in the middle of a three-part question was routinely
          // dropped. `both` keeps every part.
          intent = qplan.intent === "both" ? "both" : "chat";
          needsWeb = qplan.needsWeb;
          request.log.info(
            { intent, needsWeb, reason: qplan.reason, lanes: qplan.lanes.map((l) => l.key) },
            "[chat] routed by code",
          );
        } else if (isVoice) {
          intent = "chat";
        } else {
          const routed = await classify({ message, history, model: ROUTER_MODEL });
          request.log.info(
            { routed, msg: String(message || "").slice(0, 80) },
            "[chat] routed",
          );
          // Tolerate both the legacy string shape and the new { intent, needsWeb }
          // (defensive: an injected/older classifier may still return a string).
          intent = typeof routed === "string" ? routed : routed?.intent;
          if (!INTENTS.includes(intent)) intent = "chat";
          needsWeb = typeof routed === "object" && routed ? routed.needsWeb === true : false;
          routedFilters =
            typeof routed === "object" && routed && routed.filters ? routed.filters : null;
          // THE PLANNER'S VETO, and it is the one thing it keeps when the
          // classifier runs: every ask in this message is about the user's own
          // people, so there is nothing on the web that can contribute to it.
          // "If it's categorized as network, you do not need to look into the
          // web for the query." A stray needs_web here costs an Exa call and
          // several seconds on the fastest path there is.
          if (needsWeb && qplan.networkOnly) {
            needsWeb = false;
            request.log.info(
              { reason: qplan.reason },
              "[chat] web vetoed: every ask is about the user's own people",
            );
          }

          // ── THE PLAN'S PEOPLE VETO ─────────────────────────────────────────
          //
          // "Who in my contacts has worked at a tech company?" was answered with
          // "I don't have your contacts list in front of me right now."
          //
          // The planner had already read that question correctly -- lane=network,
          // needsPeople=true, "one ask, the user's own people" -- and the
          // classifier then said `chat`, which is a lane with no access to the
          // address book at all. needsPeople was used only to warm a cache that
          // the chat lane never reads, so the plan's conclusion was computed,
          // logged, and discarded.
          //
          // There is already a veto in the other direction, three lines up: the
          // planner overrules a stray needsWeb when every ask is about the user's
          // own people. This is the same rule applied to the thing that actually
          // matters. `both` rather than network_query on purpose -- it keeps the
          // conversational answer the classifier wanted AND runs the ranker, so
          // nothing that works today gets narrower.
          if (intent === "chat" && qplan.needsPeople) {
            intent = "both";
            request.log.info(
              { reason: qplan.reason, lanes: qplan.lanes.map((l) => l.key) },
              "[chat] promoted to both: the plan says this is about the user's own people",
            );
          }
        }

        /**
         * THE FIRST QUESTION ANYBODY ASKS GETS ONE ANSWER, NOT THREE.
         *
         *   "Tell me about my contacts."   "Tell me about my network."
         *   "What is Amber?"               "What can Amber do for me?"
         *
         * Every one of these used to land somewhere different depending on what
         * the classifier decided in the moment. "Tell me about my network" is
         * wall-to-wall people words, so the common outcome was the relationship
         * ranker: it has nothing to rank against the word "network", finds
         * nobody, and answers a beginner's opening question with "Nothing in
         * your contacts answers that yet" while holding a thousand people.
         * Sometimes it got the overview and its real counts instead. Same
         * words, three answers.
         *
         * DECIDED LAST, and on purpose: this overrides the planner, the
         * classifier and the promote-to-both rule above, all of which are
         * reading the same people words and reaching the wrong conclusion from
         * them. `overview` is the branch that already knows how to say a number
         * about somebody's own book without lying about it.
         */
        const orientation = orientationAsk(message);
        if (orientation) {
          intent = "overview";
          request.log.info({ orientation }, "[chat] orientation: answering from the account itself");
        }
        writeEvent("intent", { intent });

        // ── THE PLAN, SAID OUT LOUD, BEFORE ANY OF IT HAPPENS ───────────────
        //
        // "Recommend coffee shops in the East Village, tell me who I know
        //  nearby, and find me VPs of engineering to talk to about hardware"
        // is three questions, and it used to look like one long silence: every
        // section was collected and then emitted at the end.
        //
        // What was asked for, in the user's words: work out quickly that it is
        // complex, say so, show progress, and hand back the sections in the
        // order they can be got -- his own people first, because that is one
        // indexed query plus a ranking pass over rows he already owns, then the
        // web for places, then the hardest, strangers on the web.
        //
        // Derived from what the route already knows. No second model call to
        // decide a question is complex: that would itself be a second of the
        // wait it is trying to explain.
        //
        // FASTEST FIRST, WHICH IS ALSO THE ORDER THEY ARRIVE IN -- and the order
        // is now MEASURED rather than written down here. Every lane reports how
        // long it took (lane-speed.js), so the sequence follows what these calls
        // actually cost on this box today, with an address book this size, and
        // reorders itself if that changes. The seeds it starts from are the
        // observed shape of each lane:
        //
        //   your people        local queries + a ranker that streams its list
        //                      before it writes anything, and the payload is
        //                      cached per owner. Starts at the top of the turn
        //                      now, so it is no longer behind the web search.
        //                      IT IS THE FASTEST LANE. I claimed once that the
        //                      web would beat it; that was wrong.
        //   people on the web  ONE Exa call restricted to linkedin.com/in,
        //                      parsed deterministically. No model hop.
        //   the web            one Exa call, more page text than the LinkedIn
        //                      pass moves.
        //   places             a web search AND a model pass to turn pages into
        //                      cards -- two hops, reliably the slowest.
        //
        // The client renders its sections in this same order, so the screen
        // fills top to bottom instead of jumping around as parts land.
        //
        // The lanes come from the plan, so the steps shown are exactly the asks
        // that were made. Where the classifier ran it can still widen this --
        // an "overview" or a "search" is a people lane the regexes did not name
        // -- so those are folded in rather than overriding it.
        const planLaneKeys = new Set(qplan.lanes.map((l) => l.key));
        const peopleFromIntent =
          intent === "network_query" || intent === "both" || intent === "search" || intent === "overview";
        if (peopleFromIntent) planLaneKeys.add("people");
        if (looksLikePeopleSearch(message) && (needsWeb || forceWeb)) planLaneKeys.add("web_people");
        // Places have their own gate and it is not needsWeb: the place lane runs
        // whenever the question is about a place, so the checklist follows THAT
        // and not the classifier's opinion about the web.
        if (wantsPlacesHere) planLaneKeys.add("places");
        else planLaneKeys.delete("places");
        if ((needsWeb || forceWeb) && !wantsPlacesHere) planLaneKeys.add("web");
        // A STEP NOBODY IS GOING TO RUN MUST NOT SIT ON SCREEN WITH A SPINNER
        // NEXT TO IT. Each of these mirrors the condition that actually guards
        // the work below, so the checklist cannot promise more than the turn does.
        if (!needsWeb && !forceWeb) {
          planLaneKeys.delete("web");
          planLaneKeys.delete("web_people");
        }
        if (!looksLikePeopleSearch(message) && !qplan.needsWebPeople) planLaneKeys.delete("web_people");
        if (!peopleFromIntent) planLaneKeys.delete("people");
        // Each step carries the clause it answers, so the client can head that
        // section with the part of the question it belongs to rather than with a
        // category name alone. Taken from the plan where the plan matched the
        // ask; absent for a lane the classifier added, which has no clause of
        // its own to quote.
        const askByLane = new Map(qplan.lanes.map((l) => [l.key, l.ask]));
        const planSteps = orderLanesBySpeed(
          [...planLaneKeys].map((key) => ({
            key,
            label: LANE_LABELS[key] || key,
            ...(askByLane.get(key) ? { ask: askByLane.get(key) } : {}),
          })),
        );
        if (planSteps.length > 1) {
          // Kept so the turn can close out anything that never ticked itself.
          announcedSteps = planSteps;
          writeEvent("plan", {
            steps: planSteps,
            // Once, at the top, and deliberately not an apology: three things
            // were asked for and all three are coming.
            note: "A few parts to this — I will bring them back as they land.",
          });
          for (const st of planSteps) stage(st.key, st.label, "start");
        }

        // ── THE PEOPLE PATH STARTS NOW, NOT AFTER THE WEB ──────────────────
        //
        // This was strictly serial: the web search ran (2-12s), THEN the answer
        // path reached the people branch and only then began loading contacts,
        // their facts and the vector retrieval (about six seconds in the
        // observed logs). For a question with a web part AND a people part --
        // the exact three-part question this is all about -- the two halves
        // added up instead of overlapping, which is most of the ninety seconds.
        //
        // Nothing in the people prep depends on the web results, and nothing in
        // the web search depends on the people. So both start here and are
        // awaited where they were already awaited. Total time for a multi-part
        // turn becomes about max(web, people) rather than web + people.
        //
        // The retrieval ALSO no longer waits for the prep. It needs only the
        // owner and the question, so it ran second purely because it was
        // written second.
        // The people prep, the ranker's deps and the dimension retrieval all
        // moved ABOVE the route -- see "THE PEOPLE PATH CAN START BEFORE THE
        // CLASSIFIER ANSWERS". startPeoplePrep() is called there when the plan
        // already knows a people lane exists, and here when only the classifier
        // knew. It is idempotent: whichever call comes first owns the work.
        const peopleNeeded =
          planWantsPeople || intent === "network_query" || intent === "both";
        if (peopleNeeded) startPeoplePrep();

        // Light cross-thread recall: a short digest of the user's recent OTHER
        // threads, so "what did we talk about recently" works. Only built for
        // chat/both (a pure people search doesn't need it); fetched once here.
        let priorContext = "";
        // THE MEMORY THE CHAT LANE NEVER HAD. See buildTaggedMemory. Fetched
        // together with the digest rather than after it, because both are on the
        // critical path in front of the first token and neither depends on the
        // other.
        let taggedMemory = "";

        // ── THE LADDER RUNS FOR EVERY INTENT, AND IT DID NOT ────────────────
        //
        // gatherEverything was called inside `if (intent === "chat" || intent
        // === "both")`, one line under a comment claiming it ran for every
        // turn. It did not run for `network_query` -- which is the intent the
        // classifier gives to "who do I know that goes to USC?", "do I know
        // anyone in New York?", "who works at Stripe": the exact questions the
        // ladder was built to answer.
        //
        // On that path the tiers were: the ranker, then an older area-code
        // heuristic, then webOfferNoMatches -- a hardcoded "Nothing in your
        // contacts answers that yet". So for a tester whose PeopleRank had no
        // scores, every question about their own people reached that string,
        // while the contacts, the tags, the synced notes and the shape sat one
        // unused function call away. Every fix made to the retrieval this month
        // was unreachable from the questions it was made for.
        //
        // Started HERE, before the branch, so it overlaps the rest of the
        // critical path exactly as it did before and costs no extra latency.
        const gatherPromise = amberId
          ? gatherEverything(amberId, message).catch((err) => {
              request.log?.warn?.({ err: err?.message }, "[chat] gather failed");
              return null;
            })
          : Promise.resolve(null);

        /**
         * THEIR DAY, WHEN THEY ASKED ABOUT THEIR DAY.
         *
         *   "What's on my calendar?"
         *   "Calendar is something you'd manage through your phone or calendar
         *    app directly. What I hold is your people..."
         *
         * Said by an app holding the user's events, their connected Google and
         * Outlook accounts, and their reminders, one tab from the screen that
         * draws them. Nothing was broken: this turn was simply never handed the
         * day, so the model answered from the only thing it had been told it
         * was.
         *
         * GATED, NOT ALWAYS-ON. Four queries on every "how are you" would be a
         * latency tax on the common turn to serve the rare one, and a day
         * pasted into a prompt that did not ask for it is context the model has
         * to ignore. asksAboutTheirDay is the same predicate that keeps the
         * question out of the web lane -- one rule, one place.
         *
         * Started HERE, beside the ladder, so it overlaps the critical path and
         * costs nothing in front of the first token.
         */
        const wantsDay = Boolean(amberId) && asksAboutTheirDay(message);
        const dayPromise = wantsDay
          ? buildDayBrief(amberId, reqTimezone).catch((err) => {
              request.log?.warn?.({ err: err?.message }, "[chat] day brief failed");
              return "";
            })
          : Promise.resolve("");

        if (intent === "chat" || intent === "both") {
          // "what do you know about me", "what have I told you" -- the user's own
          // facts, which live in a different place from a contact's and were just
          // as unreachable from here.
          const asksAboutSelf = /\b(?:about me|about myself|my ?self|know about me|told you about me)\b/i.test(
            String(message || ""),
          );
          // WHEN THE ANSWER IS ABOUT THE BOOK RATHER THAN ABOUT A PERSON.
          //
          // Two shapes, and the second is the one that produced "I don't have
          // your contacts list in front of me right now":
          //
          //   "Do you know anything about any of my contacts?"  -> the book
          //   "Who in my contacts has worked at a tech company?" -> a topic
          //
          // The planner already reads the second as a question about the user's
          // own people (lane=network, needsPeople=true). Paired with a topic word
          // that survives the stopword list, that is enough to answer it off the
          // contact cards alone -- which is the point: it needs no ranking, no
          // notes, and no model, and it works on a user's first day.
          // THE LADDER RUNS FOR EVERY TURN. No regex decides whether to look.
          //
          // The old gates here -- asksAboutTheBook, plus needsPeople AND a topic
          // word -- were exactly the defect: a hand-written pattern deciding
          // whether the database gets read. "Who goes to USC?" matched none of
          // them and was answered "I don't have any information" by an app
          // holding thirty contacts tagged USC. So the question is no longer
          // whether to search; it is only what was found.
          //
          // THE GATE IS GONE, not just bypassed. It survived the change as
          // `const wantsBookBrief = ...`, assigned and never once read -- so
          // every turn still paid for asksAboutTheBook() and topicTermsFrom()
          // and threw the answer away, and anyone reading this function would
          // reasonably conclude the old path was still deciding something.
          let gathered = null;
          let dayBrief = "";
          [priorContext, taggedMemory, gathered, dayBrief] = await Promise.all([
            buildPriorContext(amberId, conversationId, {
              listRecentConversations,
              listConversation,
            }).catch(() => ""),
            amberId && (fastTagged.length > 0 || asksAboutSelf)
              ? buildTaggedMemory(amberId, fastTagged, {
                  wantSelf: asksAboutSelf,
                  wantOverview: false,
                  topicQuestion: message,
                }).catch(() => "")
              : Promise.resolve(""),
            // Started above, for every intent. One pass, every layer.
            gatherPromise,
            dayPromise,
          ]);

          /**
           * THE DAY GOES FIRST, ahead of the per-person memory and the ladder.
           *
           * Somebody who asked what is on their calendar is asking about the
           * day, not about whoever happens to be named inside it, and the block
           * nearest the question is the one that gets answered from.
           */
          if (dayBrief) {
            taggedMemory = [dayBrief, taggedMemory].filter(Boolean).join("\n\n");
            request.log?.info?.({ chars: dayBrief.length }, "[chat] day brief loaded");
          }

          if (gathered) {
            // THE PEOPLE THE LADDER FOUND ARE PEOPLE THE CHIPS CAN OFFER.
            //
            // suggestPeople was only ever filled from the ranker or from a web
            // search. A question the ladder answered entirely on its own --
            // "who do I know that goes to USC", 363 tagged contacts, answered
            // without the ranker running -- left it EMPTY, so the chip
            // generator was handed "No specific people are in context (do NOT
            // emit draft_message)" and produced generic filler. That is the
            // "shitty follow-ups and action chips" complaint, and its cause is
            // that the retrieval and the chips were reading different sources.
            //
            // Only seeded when nothing better is present, so the ranker's
            // ordering always wins where the ranker ran. Strongest layer first,
            // capped, because these become buttons and ten is already too many.
            if (suggestPeople.length === 0) {
              const seen = new Set();
              suggestPeople = [
                ...gathered.layers.stated,
                ...gathered.layers.labeled,
                ...gathered.layers.implied,
              ]
                .filter((r) => {
                  if (!r?.contactId || !r?.name || seen.has(r.contactId)) return false;
                  seen.add(r.contactId);
                  return true;
                })
                .slice(0, 10)
                .map((r) => ({ contactId: String(r.contactId), name: String(r.name) }));
            }
            const block = renderGathered(gathered, { message });
            if (block) {
              // The ladder's block goes AFTER the per-person memory, so a question
              // that named somebody still reads their file first.
              taggedMemory = [taggedMemory, block].filter(Boolean).join("\n\n");
            }
            request.log?.info?.(
              {
                terms: gathered.terms.length,
                stated: gathered.inventory.found.stated,
                labeled: gathered.inventory.found.labeled,
                implied: gathered.inventory.found.implied,
                birthdays: gathered.inventory.found.birthdays,
                contacts: gathered.inventory.found.totalContacts,
                thin: gathered.inventory.thin,
              },
              "[chat] gathered",
            );
          }
          if (taggedMemory) {
            request.log?.info?.(
              { people: fastTagged.length, chars: taggedMemory.length, self: asksAboutSelf },
              "[chat] memory for tagged people loaded into the prompt",
            );
          } else if (fastTagged.length > 0) {
            // Tagged, but nothing stored yet. Worth a line: it is the difference
            // between "the retrieval is broken" and "there is genuinely nothing
            // about this person", and those look identical from the answer.
            request.log?.info?.(
              { people: fastTagged.length },
              "[chat] tagged people have no stored facts yet",
            );
          }
        }

        // Selective web grounding: only for chat/both questions the router
        // flagged as needing CURRENT/real-time info. Exa is fail-safe ([] on any
        // error), so an empty result degrades cleanly to today's no-web answer.
        // network_query (a people search) never searches the web.
        let webBlock = "";
        /**
         * The one clause the answer owes the user about how it searched.
         *
         * Declared out here beside webBlock because it is read at the prompt
         * assembly nine hundred lines below, where the web block itself is
         * read. The brief that produced it is scoped to the search.
         */
        let searchAssumption = "";
        // Kept so the sources can be PERSISTED with the turn. Without this, reopening
        // a note showed the answer and its inline [1] markers with nothing behind
        // them — citations you cannot follow, which is worse than none.
        let webSources = [];
        // Parsed LinkedIn profiles for a people-shaped question. Persisted with the
        // turn so reopening a note keeps its cards.
        let webPeople = [];
        if ((intent === "chat" || intent === "both") && needsWeb) {
          // Reached on four paths now: the router flagged the question as needing
          // current information, the user tapped "Search the web" on an empty people
          // search, they pasted a link, or they SPOKE a question the router called
          // live. The spoken case matters — dictation lands in the same field, so a
          // question asked out loud takes exactly the same route as a typed one.
          /**
           * WHO THEY ARE, for the brief.
           *
           * The same read the ranker's closure makes, and it is a separate call
           * rather than a shared one on purpose: the ranker's copy lives inside
           * preparePeopleRankInput, which is not started at all on a web-only
           * turn. Cheap, cached by the pool, and fail-soft -- an unreadable
           * profile means an unpersonalized search, not a failed one.
           */
          const profileForSearch = async () => {
            if (!amberId) return null;
            const p = await getUserProfileByAmberId(amberId);
            return reqTimezone ? { ...(p || {}), timezone: reqTimezone } : p;
          };
          const chars = webPageChars(message);
          // ENTERED. Every component of this path has now been verified working in
          // isolation against the live environment — the key, the Exa client with the
          // app's exact parameters, and the router returning needsWeb true for these
          // questions — while the app still produced no sources. That leaves exactly
          // one unobserved question: does a real request reach this line? This log is
          // the answer, and it exists because three rounds of inference did not
          // substitute for one measurement.
          // WHAT THE WEB IS ASKED ABOUT IS NOT THE WHOLE MESSAGE ANY MORE.
          //
          // "If it's categorized as network, you do not need to look into the
          //  web for the query."
          //
          // The network clause used to be pasted into the Exa query along with
          // everything else, so a three-part question asked the web about "who
          // I know nearby" -- which the web cannot answer and which pulled the
          // results away from the parts it can.
          const webQuery = qplan.webGroundingQuery || message;
          const peopleQuery = qplan.laneQuery("web_people") || message;

          /**
           * WHO IS ASKING, BEFORE ANYTHING IS SEARCHED.
           *
           *   "There should be understanding of the person asking... If the
           *    user is like, 'I'm looking for VPs of finance to talk to and
           *    meet with,' even if they don't say New York, it should be like,
           *    'Okay, the user is in New York, so clearly they want people in
           *    New York.'"
           *
           * Until now the string above went to Exa verbatim. `webGroundingQuery`
           * is the user's own sentence with the clauses about their own people
           * filtered out and the rest re-joined -- no city, no industry, no idea
           * what they had been talking about a minute earlier. There is no
           * search provider whose results are good for that input.
           *
           * The profile and the situation are BOTH already in hand at this line:
           * priorContext, taggedMemory (which carries the day) and the retrieval
           * ladder all resolved a hundred lines above and were only ever handed
           * to the answering model. The brief is the first thing to consult them
           * BEFORE the search rather than after it.
           *
           * Fail-open by construction: on any error buildSearchBrief returns the
           * user's own words, which is exactly what this line used to send.
           *
           * ONE BRIEF PER LANE QUERY, NOT ONE PER TURN. A three-part question
           * asks the web about one thing and the people search about another,
           * and the lane scoping above is what keeps "coffee shops in the East
           * Village" out of a search for VPs of engineering. Briefing the whole
           * message once and handing that to both lanes would undo it -- which
           * is exactly what the first version of this did, and what the lane
           * test caught. Memoized, so the common single-lane turn still costs
           * one model call.
           */
          const briefs = new Map();
          const briefFor = (q) => {
            const key = String(q || "").trim();
            if (!briefs.has(key)) {
              briefs.set(
                key,
                Promise.resolve(profileForSearch())
                  .catch(() => null)
                  .then((profile) =>
                    searchBrief({
                      message: key,
                      profile,
                      situation: [taggedMemory, priorContext].filter(Boolean).join("\n\n"),
                    }),
                  )
                  .catch(() => null),
              );
            }
            return briefs.get(key);
          };

          const brief = await briefFor(webQuery);
          const briefQuery = brief?.queries?.[0] || webQuery;
          const briefStart = brief ? startDateFor(brief.recency) : null;
          searchAssumption = assumptionInstruction(brief);
          if (brief?.assumption) {
            request.log?.info?.(
              { assumption: brief.assumption, queries: brief.queries.length },
              "[chat] search brief",
            );
          }
          request.log.info(
            {
              intent,
              needsWeb,
              forceWeb,
              chars,
              pastedUrls: pastedUrls.length,
              scoped: webQuery !== message,
            },
            "[chat] web retrieval START",
          );

          // AND THE LINKEDIN PASS NO LONGER QUEUES BEHIND THE GENERAL SEARCH.
          //
          // These two are independent Exa calls -- one broad, one restricted to
          // linkedin.com/in -- and they ran strictly one after the other, so a
          // question with both parts paid for both in series. They start
          // together now and the cards go out the moment they land, exactly like
          // the place cards; the block handed to the model is still assembled
          // below, in the same order as before, so the prose is unchanged.
          const wantsWebPeople = looksLikePeopleSearch(message) || qplan.needsWebPeople;
          const webPeopleT0 = Date.now();
          let webPeopleSent = false;
          const webPeoplePromise = wantsWebPeople
            ? // A people search is the case the whole brief exists for: "VPs of
              // finance to talk to and meet with" is unanswerable without a
              // city and answerable with one. Briefed on ITS OWN lane query, so
              // a multi-part question does not send the other half along.
              briefFor(peopleQuery).then((b) =>
                exaPeople({
                  query: b?.queries?.[0] || peopleQuery,
                  limit: Math.min(10, Math.max(5, webResultCount(message) / 2)),
                }),
              )
                .then(async (found) => {
                  recordLaneMs("web_people", Date.now() - webPeopleT0);
                  const raw0 = Array.isArray(found) ? found : [];
                  if (raw0.length === 0) return [];
                  // SOMEONE HE ALREADY KNOWS IS NOT SOMEONE TO ADD.
                  //
                  // "Since I already have that contact, it should just be shown
                  //  to me as something I already have."
                  //
                  // The LinkedIn pass knows nothing about the address book, so a
                  // profile that IS one of his contacts came back as a stranger
                  // with an "add" button -- while the same person also appeared,
                  // correctly, as a card he owns. markKnownWebPeople says which
                  // is which and puts the known ones first, which is also the
                  // order he asked for: "one of your contacts actually fits this
                  // perfectly, so I will show you their contact card first."
                  //
                  // The book is already loaded for this owner on most turns; on
                  // a web-only question it is one indexed read of id+name and it
                  // is worth it to avoid offering to duplicate a contact.
                  const book = amberId ? await contactNamesFor(amberId).catch(() => []) : [];
                  const marked = markKnownWebPeople(raw0, book);
                  const knownCount = countKnown(marked);
                  if (knownCount > 0) {
                    request.log?.info?.(
                      { known: knownCount, total: marked.length },
                      "[chat] web people already in the address book",
                    );
                  }
                  if (!clientGone && !raw.writableEnded) {
                    webPeopleSent = true;
                    writeEvent("web_people", { people: marked, known: knownCount });
                    stage("web_people", "People on the web", "done");
                  }
                  return marked;
                })
                .catch(() => [])
            : null;
          const webT0 = Date.now();
          let results = [];

          if (pastedUrls.length > 0) {
            // NAMED DOCUMENT: read it, do not search for it. Searching would return
            // pages that talk ABOUT the link instead of the link's own contents, and
            // the whole request was "look at this one".
            results = await exaRead({
              urls: pastedUrls,
              maxCharacters: 24000,
              highlightQuery: message,
            }).catch(() => []);
            // Only if the page could not be read at all do we fall back to searching
            // for it — better than telling the user nothing.
            if (results.length === 0) {
              results = await exa({
                query: message,
                numResults: 6,
                maxCharacters: chars,
                highlightQuery: message,
              }).catch(() => []);
            }
          } else {
            // BREADTH. One call: candidate pages, plus the sentences in each that
            // bear on the question rather than each page's opening lines.
            results = await exa({
              query: briefQuery,
              numResults: webResultCount(message),
              maxCharacters: chars,
              // The HIGHLIGHTS still come from what the user actually asked.
              // The query decides which pages; the highlight decides which
              // sentences of those pages, and the user's own words are the
              // better question to ask of a page that has already been found.
              highlightQuery: webQuery,
              category: brief?.category ?? null,
              startPublishedDate: briefStart,
            }).catch(() => []);

            // DEPTH, only when it will change the answer. Exa returns a row per page
            // even when it extracted no text from it (JS-rendered site, unindexed
            // PDF, paywall), so an extraction question can come back with ten
            // sources and nothing in them. That is the one case worth a second round
            // trip: re-read the best few pages properly.
            if (results.length > 0 && chars === EXTRACTION_CHARS && isThin(results)) {
              const deep = await exaRead({
                urls: results.slice(0, 5).map((r) => r.url),
                maxCharacters: 12000,
                highlightQuery: webQuery,
              }).catch(() => []);
              if (deep.length > 0) {
                // Merge on url, preferring whichever copy actually has text, and keep
                // the ORIGINAL order — the citation numbers are already committed to
                // it by the time this runs for a streaming client.
                const byUrl = new Map(deep.map((d) => [d.url, d]));
                results = results.map((r) => {
                  const d = byUrl.get(r.url);
                  if (!d) return r;
                  return {
                    ...r,
                    text: (d.text || "").length > (r.text || "").length ? d.text : r.text,
                    highlights:
                      (d.highlights || []).length > (r.highlights || []).length
                        ? d.highlights
                        : r.highlights,
                  };
                });
              }
            }
          }

          recordLaneMs("web", Date.now() - webT0);
          request.log.info(
            { count: results.length, firstUrl: results[0]?.url ?? null, ms: Date.now() - webT0 },
            "[chat] web retrieval DONE",
          );
          stage("web", "The web", "done");
          if (results.length > 0) {
            webBlock = webResultsBlock(results);
            webSources = results.map((r) => ({ title: r.title, url: r.url }));
            writeEvent("sources", { sources: webSources });
          } else {
            // The one case that used to be invisible. A question routed to the web that
            // came back with nothing means the model is about to answer from training
            // knowledge with no sources and no links — which is exactly what "it gave
            // me five VPs and nothing to verify" looked like. Say which failure it was.
            request.log.error(
              { needsWeb, forceWeb, exaConfigured: exaConfigured(), pasted: pastedUrls.length },
              "[chat] web search produced NO results — answer will be ungrounded",
            );
          }

          // PEOPLE GET PROFILE CARDS, NOT PROSE.
          //
          // "List out 5 VPs of finance in NYC" is not answerable from a general web
          // search: it returns listicles and vendor pages, so the model either hedges
          // or invents names, and either way there is nothing to click. A second pass
          // restricted to linkedin.com/in/ returns actual profiles, and their titles
          // are parsed — not summarized by a model — into cards the user can open and
          // check. Nothing on a card is generated, so nothing on a card can be wrong.
          if (webPeoplePromise) {
            // Already in flight since the top of this block, and usually already
            // finished by now.
            const found = await webPeoplePromise;
            stage("web_people", "People on the web", "done");
            if (found.length > 0) {
              webPeople = found;
              // Sent the moment they landed; this is the fallback for the case
              // where the client was still catching up then.
              if (!webPeopleSent) {
                writeEvent("web_people", { people: found, known: countKnown(found) });
              }
              // Handed to the model too, so the prose agrees with the cards instead of
              // listing a different five people underneath them.
              //
              // AND IT IS TOLD WHICH ONES HE ALREADY KNOWS. Without this the
              // answer introduces his own contact as a stranger to reach out to
              // cold, which is both wrong and the opposite of useful -- the
              // whole value of that person is the warm intro. The instruction is
              // explicit about the ORDER for the same reason he gave: "one of
              // your contacts actually fits this perfectly, so I will show you
              // their contact card first."
              const knownHere = countKnown(found);
              webBlock =
                `${webBlock ? `${webBlock}\n\n` : ""}` +
                "Verified LinkedIn profiles for this question. These are the ONLY people " +
                "you may name, and the app is already showing them to the user as cards:\n" +
                found
                  .map(
                    (x, i) =>
                      `(${i + 1}) ${x.name}${x.title ? ` — ${x.title}` : ""}` +
                      `${x.company ? ` at ${x.company}` : ""} — ${x.url}` +
                      `${x.existingContactId ? " — ALREADY ONE OF THE USER'S CONTACTS" : ""}`,
                  )
                  .join("\n") +
                (knownHere > 0
                  ? `\n\nLead with the ${knownHere === 1 ? "one who is" : `${knownHere} who are`} ` +
                    "already a contact: say so plainly, treat them as a warm introduction " +
                    "rather than a cold outreach, and never suggest adding them — the user " +
                    "already has their card. Introduce the rest as new people worth adding."
                  : "");
            } else {
              request.log.warn(
                { exaConfigured: exaConfigured() },
                "[chat] people search found no LinkedIn profiles",
              );
            }
          }
        }

        // ── BRANCH ───────────────────────────────────────────────────────────
        // Fact capture is independent of the reply, so start it here and let its
        // ~1s Haiku call overlap token generation instead of running after it.
        // This is a normal turn (corrections / pending resolution already
        // short-circuited above). It is awaited below, so the clarify /
        // soft_confirm events still emit in exactly the same place and order.
        // FOLLOW-UPS ARE NOT CAPTURES, and this is the user's own rule:
        //
        //   "When I open up one of the things on my homepage and start talking
        //    in the search bar there, that stuff does not need to be logged.
        //    Follow-ups inside of chats do not need to be logged. If it's typed
        //    directly on the homepage or directly on the profile page, or if
        //    it's voiced, then those should show up."
        //
        // And he is right about the mechanism, not just the noise: a follow-up
        // is a QUESTION. "Recommend the best coffee shops in the East Village"
        // went through the whole capture pipeline -- FACT_CAP_IN, a Haiku
        // extraction pass, a 974-contact resolution sweep -- to conclude
        // `count=0`, having spent about three seconds of the answer's latency to
        // learn that a question contains no facts. Worse, when it does think it
        // found something, it files a made-up fact about a real person from a
        // sentence that was only ever a request.
        //
        // The first message of a thread still captures: that is the voice note,
        // or the thing typed on Home or on a profile, which is exactly where
        // people say things worth keeping.
        const isFollowUp = request.body?.followUp === true;

        // ── EXCEPT THAT A FOLLOW-UP CAN STILL NAME PEOPLE ────────────────────
        //
        // The rule above is right about questions and wrong about this, and the
        // logs show exactly how it failed. A user opened the voice chat and said:
        //
        //   "My dad, Karthik, Sagar, and Joel from A2F are all cool people and
        //    so is Duncan from A2F."
        //
        //   [chat] fast-tagged people before generation
        //   [chat] routed by code
        //   (no FACT_CAP_IN. no signals. nothing.)
        //
        // Five people named, zero captured, because it arrived with
        // followUp:true. On the Today feed it became a JOURNAL card -- the label
        // for a note about nobody -- with no FILED TO chips, next to two NOTE
        // cards from the same minute that had them. The user's read of it was
        // exact: "it didn't tag people because it went in as a journal entry,
        // even though it explicitly mentioned people."
        //
        // And his rule now supersedes the old one: "everything that mentions
        // someone should tag people, simple as that."
        //
        // So the discriminator stops being WHERE the message was typed and
        // becomes WHAT IS IN IT, which is what it should always have been:
        //
        //   fastTagged.length > 0   the address book already matched a real
        //                           contact in this sentence, in about a
        //                           millisecond, before generation started. It
        //                           is the cheapest possible proof that a person
        //                           is named, and it is already computed above.
        //
        //   not a question          the original concern survives intact. "What
        //                           did I say about Sagar?" names a person and
        //                           must still not be captured -- it is a query,
        //                           not a statement. Questions keep costing
        //                           nothing.
        //
        // A follow-up that names nobody, and every follow-up question, still
        // skip capture exactly as before.
        const followUpNamesPeople =
          isFollowUp &&
          fastTagged.length > 0 &&
          !!message &&
          !/\?\s*$/.test(String(message).trim());
        if (followUpNamesPeople) {
          request.log?.info?.(
            { people: fastTagged.length },
            "[chat] follow-up names people — capturing anyway",
          );
        }

        const capturePromise = amberId && message && (!isFollowUp || followUpNamesPeople)
          ? captureFromMessage({
              ownerId: amberId,
              messageText: message,
              spaceId: conversationId,
              source,
              log: request.log,
            }).catch((err) => {
              request.log?.warn?.({ err: err?.message }, "[chat] capture failed");
              return null;
            })
          : null;

        // ── OVERVIEW ──────────────────────────────────────────────────────────
        // A real snapshot of the whole network: totals, source split, how much is
        // captured, and who the user holds the most on. Only aggregates are read.
        if (intent === "overview") {
          /**
           * THE WHOLE ACCOUNT, NOT JUST THE ADDRESS BOOK.
           *
           * getNetworkOverview answers "how big is my book and who do I hold
           * the most on", which is the right answer to half of what reaches
           * here and half of the answer to the rest. "What can Amber do for
           * me?" is answered by what she is ALREADY holding for them: their
           * circles, their connected calendars, the week in front of them, what
           * they still owe themselves. One extra round trip, in parallel with
           * the one this branch already made.
           */
          const [ov, inventory] = await Promise.all([
            getNetworkOverview(amberId).catch(() => null),
            readInventory(amberId).catch(() => null),
          ]);
          const people = (ov?.topNoted ?? []).map((t) => ({
            contactId: t.id,
            name: t.name,
            title: t.title ?? null,
            company: t.company ?? null,
            phone: null,
            score: 0,
          }));
          if (people.length > 0) writeEvent("people", { people, citations: [] });

          const dataLines = [];
          if (ov) {
            dataLines.push(`Total contacts: ${ov.total}`);
            if (ov.bySource.length > 0) {
              dataLines.push(
                `By source: ${ov.bySource.map((s) => `${s.count} of ${ov.total} ${s.source}`).join(", ")}`,
              );
            }
            // THE COUNT THAT THE APP GOT WRONG ABOUT THE USER'S OWN BOOK.
            //
            // This line read "Contacts with saved notes: 723" under a line
            // reading "Total contacts: 2897", and the reply was "all 2,897 have
            // saved notes, meaning you have captured context on every single
            // person, which is rare and genuinely useful." On a 519-contact book
            // holding 134 notes it said "Contacts with notes: 519". Two of four
            // live "tell me about my network" turns stated a false figure about
            // the user's own address book, in the first two sentences, with
            // praise attached.
            //
            // A bare numerator next to a total, one line apart, is read as the
            // whole. Carrying the denominator and naming the remainder makes the
            // wrong sentence impossible to write: there is no way to phrase
            // "2174 have none" as "every single person".
            const noted = Number(ov.withNotes ?? 0);
            dataLines.push(
              `Contacts carrying at least one note: ${noted} of ${ov.total}. ` +
                `The remaining ${Math.max(0, Number(ov.total ?? 0) - noted)} have no note at all.`,
            );
            // A NAMELESS ROW IS NOT A PERSON TO REPORT.
            //
            // topNoted came back with blank names and the reply said "The top
            // five people by note count each carry 5 notes, though the names did
            // not come through cleanly in the data, so I cannot tell you who they
            // are right now." The user does not need to hear that. Either there
            // are people to name or the line is not worth printing.
            // A row whose "name" holds no letter or digit is not a person to
            // report: "...", "- " and a bare quote mark all reached the top of
            // this list and the reply had to apologize for them. Requiring one
            // letter or number, in any script, keeps every real name.
            const namedTop = (ov.topNoted ?? []).filter((t) =>
              /[\p{L}\p{N}]/u.test(String(t?.name ?? "")),
            );
            if (namedTop.length > 0) {
              dataLines.push(
                `People you hold the most on: ${namedTop
                  .map((t) => `${t.name}${t.notes ? ` (${t.notes} notes)` : ""}`)
                  .join(", ")}`,
              );
            }
          }
          /**
           * THE ACCOUNT BLOCK, AND WHY IT IS ITS OWN THING.
           *
           * dataLines below is the address book: totals, sources, who they hold
           * the most on. The brief is everything else they own -- circles,
           * calendars, the week, what they still owe -- and it carries its own
           * instructions because the two questions that reach here want
           * different emphasis from the same facts. Rendered by a pure function
           * so the sentences it produces are testable without a database.
           */
          const accountBrief = renderAmberBrief(inventory, orientation || "about_theirs");

          const sys = [
            AMBER_IDENTITY,
            "",
            orientation === "about_amber"
              ? "THIS TURN: they asked what you are and what you can do for them. Answer it with what you are already holding for THEM."
              : "THIS TURN: they asked for a snapshot of their whole network.",
            todayLine,
            "Summarize from ONLY the data below. Lead with the total, then the source split, then how much they have captured, then who they hold the most on. Never invent numbers or names.",
            "EVERY COUNT BELOW IS EXACT AND CARRIES ITS DENOMINATOR. Report it that way.",
            "Never write \"all\", \"every\", \"each\", \"everyone\" or \"none\" for a figure that is not",
            "literally the total or literally zero, and never praise the coverage as complete unless",
            "the two numbers are actually equal. Getting a count wrong about their own address book is",
            "worse than saying less.",
            "Speak about their people, never about the mechanics. Do not use the words data, field,",
            "record, source split, sync payload or database in the reply, and never say a name did not",
            "\"come through\" or \"resolve\". If something is missing, leave it out.",
            "Close by offering a useful next step as a question, for example digging into a group or adding notes on someone. Keep it to a short, clean paragraph. Never end the conversation.",
            ANSWER_STYLE,
            HOUSE_RULES,
            "What you know about their book:",
            dataLines.length > 0 ? dataLines.join("\n") : "No contacts found yet.",
            accountBrief ? "" : null,
            accountBrief || null,
          ]
            .filter((l) => l !== null)
            .join("\n");
          const answerText = await stream({
            model: CHAT_MODEL,
            system: sys,
            messages: [{ role: "user", content: message }],
            maxTokens: 400,
            onToken: (t) => {
              if (clientGone) throw new Error("client_disconnected");
              writeEvent("token", { text: _stripDashes(t) });
            },
          });
          await appendMessage(amberId, {
            conversationId,
            role: "assistant",
            content: answerText,
            intent,
            metadata: {
              model: CHAT_MODEL,
              peopleIds: people.map((p) => p.contactId),
              people,
              citations: [],
            },
          }).catch(() => null);
          if (!clientGone) {
            writeEvent("complete", { conversationId, intent, tookMs: Date.now() - started });
          }
          return;
        }

        // ── SEARCH ────────────────────────────────────────────────────────────
        // Structured attribute search: who works at X, who lives in Y, who is a Z.
        // Only the matching contacts are ever touched. With no usable filter, we
        // fall back to the semantic ranker below.
        if (intent === "search") {
          const f = routedFilters || {};
          const filterKeys = ["company", "title", "city", "name", "q"];
          if (filterKeys.some((k) => f[k])) {
            // SHOW_ROWS is what the model is allowed to name; PAGE is what we read.
            // total comes from the query, not from the page, because the model
            // reporting the LIMIT as the total is exactly how "you've got 25
            // matches" happened to someone with far more than 25.
            const SHOW_ROWS = 40;
            const PAGE = 60;
            const found = await searchContacts(amberId, { ...f, limit: PAGE }).catch(() => ({
              rows: [],
              total: 0,
              narrowed: false,
            }));
            let results = found.rows;
            let total = found.total;
            // TYPO FALLBACK. An exact substring search for a NAME that matches
            // nobody is usually a misspelling, not an absent person — "Sagar
            // tieari" for Sagar Tiwari. Rather than telling the user they do not
            // know someone they do, match token-by-token on an edit budget and
            // offer the closest people as a "did you mean".
            let didYouMean = false;
            let correctedFrom = null;
            const typedName = f.name || (results.length === 0 ? f.q : null);
            if (results.length === 0 && typedName) {
              const book = await contactNamesFor(amberId).catch(() => []);
              const near = fuzzyFindContactsByName(typedName, book, { limit: 5 });
              if (near.length > 0) {
                results = near;
                total = near.length;
                // ONE CANDIDATE IS NOT A QUESTION. If a misspelling lands on exactly
                // one person, or on one that is clearly closer than the next, asking
                // "did you mean Sagar Tiwari?" when Sagar Tiwari is the only Sagar in
                // the book is friction for its own sake. Answer about them and say
                // the spelling once, so the user learns the real name without being
                // interrogated. Only genuine ambiguity -- two plausible people --
                // gets a question.
                const top = near[0];
                const runnerUp = near[1];
                const unambiguous =
                  near.length === 1 || (top.score >= 0.8 && top.score - runnerUp.score >= 0.12);
                if (unambiguous) {
                  results = [top];
                  total = 1;
                  correctedFrom = typedName;
                } else {
                  didYouMean = true;
                }
                request.log?.info?.(
                  {
                    typed: typedName,
                    matched: near.map((n) => `${n.name}:${n.score.toFixed(2)}`),
                    unambiguous,
                    bookSize: book.length,
                  },
                  "[chat] name search fell back to fuzzy matching",
                );
              }
            }

            // WHAT THEY TOLD ME ABOUT SOMEONE WHO IS NOT IN THEIR CONTACTS.
            //
            // "I met Wren Halloway last night, partner at Northlight Capital,
            // does health infrastructure, she said to email her" was captured
            // correctly and filed under the raw name, because Wren is not a
            // contact and Amber does not invent contacts from a mention. Two
            // turns later, "tell me about Wren Halloway" answered: "Nobody in
            // your contacts goes by Wren Halloway, so there is nothing on file
            // to share about them." The sentence was in the database, keyed by
            // that exact name, and nothing read it.
            //
            // Being told something and then denying it is the worst failure a
            // memory can have -- worse than never hearing it, because the user
            // watched it arrive. So when the name matches no contact, the facts
            // filed under that name are the answer.
            // AND ALSO WHEN THE CONTACT DOES EXIST.
            //
            // "Priya, the LA one not the Flatiron one, is pregnant and due in
            // February" filed under the bare name "Priya", because that is the
            // subject the extractor kept -- the disambiguation the user took the
            // trouble to give was dropped. Priya Sundaram IS a contact, so this
            // lookup was skipped, and "is Priya Sundaram pregnant" answered
            // "that's not something I have any information on."
            //
            // The parked row is the user's own sentence about a Priya. Surfacing
            // it next to the contact, labeled as not yet filed to anyone, is
            // honest and useful; hiding it because a same-named card exists is
            // neither.
            // THE STRUCTURED SEARCH IS NOT THE ONLY THING THAT KNOWS ANYTHING.
            //
            // searchContacts matches contact COLUMNS -- name, company, title,
            // city. It cannot see a note. So "what does Sisi do again", right
            // after the user said "everyone calls Şirin Öztürk 'Sisi'",
            // classified as a name search, found no contact named Sisi, and
            // answered "nobody in your contacts shows up under that name" --
            // while the retrieval ladder, run for this same turn and sitting in
            // gatherPromise, had already matched the note and returned Şirin.
            //
            // This is the same shape as the bug where gatherEverything sat inside
            // the chat branch and network questions never got it. One branch
            // over. The ladder runs for every turn either way; this branch just
            // was not reading it.
            let ladderRows = [];
            if (results.length === 0) {
              const led = await gatherPromise;
              ladderRows = led
                ? [...(led.layers.named ?? []), ...led.layers.stated, ...led.layers.labeled].slice(0, 12)
                : [];
              if (ladderRows.length > 0) {
                request.log?.info?.(
                  { rows: ladderRows.length },
                  "[chat] structured search empty, answering from the ladder",
                );
                // writeEvent directly rather than emitPeople: that helper is
                // declared further down this handler, in the ranked-people
                // block, so calling it from here is a reference before its
                // initialization. scripts/tdz-check.mts exists because that
                // exact mistake once made the whole gated group unopenable.
                const ladderPeople = ladderRows
                  .filter((r) => r.contactId)
                  .map((r) => ({
                    contactId: String(r.contactId),
                    name: r.name,
                    title: r.title ?? null,
                    company: r.company ?? null,
                    phone: null,
                    score: 0,
                  }));
                if (ladderPeople.length > 0 && !clientGone) {
                  writeEvent("people", { people: ladderPeople, citations: [] });
                }
              }
            }

            let pendingAbout = [];
            if (typedName) {
              pendingAbout = await getPendingFactsByName(amberId, typedName, { limit: 8 }).catch(
                () => [],
              );
              if (pendingAbout.length > 0) {
                request.log?.info?.(
                  { name: typedName, facts: pendingAbout.length },
                  "[chat] no contact, answering from what the user said about them",
                );
              }
            }
            const people = results.map((r) => ({
              contactId: r.id,
              name: r.name,
              title: r.title ?? null,
              company: r.company ?? null,
              phone: r.phone ?? null,
              score: 0,
            }));
            if (people.length > 0) writeEvent("people", { people, total, citations: [] });
            const filterText = filterKeys
              .filter((k) => f[k])
              .map((k) => (k === "q" ? `keyword: ${f[k]}` : `${k}: ${f[k]}`))
              .join(", ");
            // WHAT THEY ACTUALLY WROTE DOWN. The contact search above matches
            // columns; this matches every surface a memory can live on -- facts,
            // notes, experiences, things said about themselves, and the raw
            // transcript of what they said to Amber. "This person likes Chinese
            // food" is stored as a NOTE, so a question that only reads columns
            // finds nothing and Amber looks like it forgot. Each hit keeps its
            // source so the answer can say where it knows this from.
            const memory = f.q
              ? await searchMemory(amberId, { q: f.q, limit: 40 }).catch(() => ({
                  total: 0,
                  hits: [],
                  skipped: [],
                }))
              : { total: 0, hits: [], skipped: [] };
            let memoryLines = [];
            if (memory.hits.length > 0) {
              // Resolve the ids on each hit to names, so a recalled note reads
              // "Sagar Tiwari: likes Sichuan" and not "contact 7".
              const book = await contactNamesFor(amberId).catch(() => []);
              const nameById = new Map(book.map((c) => [String(c.id), c.name]));
              const KIND_LABEL = {
                fact: "you noted",
                note: "you wrote on their card",
                experience: "you logged",
                self: "about you",
                said: "you told Amber",
              };
              memoryLines = memory.hits.slice(0, 25).map((h) => {
                const who = h.contactIds.map((id) => nameById.get(id)).filter(Boolean).join(", ");
                const when = h.at ? new Date(h.at).toISOString().slice(0, 10) : null;
                const src = KIND_LABEL[h.kind] || h.kind;
                return `- ${who ? `${who} — ` : ""}${String(h.text).replace(/\s+/g, " ").slice(0, 240)} (${src}${when ? `, ${when}` : ""})`;
              });
              // Anyone named in a memory but missing from the column search still
              // belongs in the answer AND on a card -- they are the whole point of
              // asking. Without this, "who likes Chinese food" recalls the note and
              // then shows no one to tap.
              const already = new Set(results.map((r) => String(r.id)));
              for (const h of memory.hits) {
                for (const id of h.contactIds) {
                  if (already.has(id)) continue;
                  const row = book.find((c) => String(c.id) === id);
                  if (!row) continue;
                  already.add(id);
                  results.push(row);
                }
              }
            }
            // Memory can add people the column search never matched, so the count
            // has to follow. Reporting the column total while showing more rows
            // than that is the same lie as reporting the LIMIT.
            if (results.length > total) total = results.length;
            const shown = results.slice(0, SHOW_ROWS);
            const rows = shown
              .map((r) => {
                const d = [r.title, r.company, r.city].filter(Boolean).join(", ");
                return `- ${r.name}${d ? ` (${d})` : ""}`;
              })
              .join("\n");
            // Say the number ONCE and say the real one. When the page is smaller
            // than the total, the model is told both so it can offer the rest
            // instead of silently presenting a page as the whole answer.
            const countLine =
              total > shown.length
                ? `${total} contacts matched. Here are ${shown.length} of them; the user can ask for more.`
                : `${total} contact${total === 1 ? "" : "s"} matched — this is all of them.`;
            const sys = [
              AMBER_IDENTITY,
              "",
              "THIS TURN: they searched their contacts.",
              todayLine,
              didYouMean
                ? `Several people could match "${typedName}" — the spelling does not match anyone exactly. Ask which of the people below they meant, by name. Do NOT say you found no one; you found near matches. Never invent people.`
                : correctedFrom
                  ? `They typed "${correctedFrom}", which is a misspelling of exactly one person in their contacts — the one below. Answer about that person as if they had spelled it right. Mention the correct spelling ONCE, lightly, as a correction and not a question ("Sagar Tiwari — got him."). Do NOT ask them to confirm; there is only one candidate.`
                  : `They filtered on ${filterText || "an attribute"}. Report who matched from ONLY the list below. State the count EXACTLY as given — never recount the rows, never round, never treat the listed rows as the total. Name a few standouts. With none, say so plainly and offer to widen the search. Never invent people.`,
              // AN EMPTY BOOK IS NOT A NARROW SEARCH.
              //
              // A brand-new account with zero contacts asked "who do I know in
              // New York" and was told "No contacts in your list matched New York
              // when the filter ran just now", followed by three ways to widen
              // the search: nearby cities, no city filter, state-level. There is
              // nothing to widen. It is the first thing this person ever reads
              // from the app, and it sends them off to adjust a filter over an
              // empty book.
              //
              // The count is already known by the time this prompt is built, so
              // the branch does not have to guess which kind of empty it is.
              // ...unless they have already told you about this person, in which
              // case that is the answer and the empty book is a footnote.
              pendingAbout.length === 0 && (await gatherPromise)?.shape?.total === 0
                ? "THEY HAVE NO CONTACTS AT ALL — not zero matches, zero contacts. They have " +
                  "not synced their address book yet or declined the permission. Do NOT talk " +
                  "about the search, the filter, or widening anything: say plainly that you do " +
                  "not have their contacts yet and that syncing is what makes this answerable. " +
                  "Offer telling you about one person out loud as the smaller alternative."
                : null,
              // Same boundary as the gathered block: name their people, never the
              // machinery. This branch produced "No contacts in your list matched
              // New York when the filter ran just now" and offered a "No city
              // filter" option to a user who has never heard the word filter.
              "Speak about their people, not the mechanism. Never use the words filter, query, " +
                "field, record, database or \"the data\" in your reply, and never describe the " +
                "search running. \"Nobody in your contacts is in New York\" is right; \"no " +
                "contacts matched when the filter ran\" is wrong.",
              found.narrowed
                ? "Only names, companies, titles and cities could be searched this time, so say the notes were not included."
                : null,
              memoryLines.length > 0
                ? [
                    "You ALSO remember these, and they are the better answer when the question is about a",
                    "detail rather than a job title. Use them, name the people in them, and say where you",
                    "know it from in plain words (\"you wrote that on his card\"). Never state a memory that",
                    "is not listed here.",
                    ...memoryLines,
                  ].join("\n")
                : null,
              memory.skipped.length > 0
                ? `Some of your records could not be read this time (${memory.skipped.join(", ")}), so say the answer may be incomplete.`
                : null,
              "Close with a short, useful next step as a question. Never end the conversation.",
              ANSWER_STYLE,
              HOUSE_RULES,
              pendingAbout.length > 0 && results.length === 0
                ? "THEY ARE NOT A CONTACT, BUT THE USER HAS TOLD YOU ABOUT THEM. These are the " +
                  "user's own words, from earlier:\n" +
                  pendingAbout.map((f) => `  - ${f.text}`).join("\n") +
                  "\nAnswer from these. Do NOT say you have nothing on this person and do NOT say " +
                  "they are not in the contacts as though that settled it -- say what you know, then " +
                  "mention once that they do not have a card yet and offer to make one."
                : null,
              pendingAbout.length > 0 && results.length > 0
                ? "THE USER ALSO SAID THESE THINGS ABOUT SOMEONE WITH THIS NAME, and they are not " +
                  "filed to anybody's card yet because the name was ambiguous when they said it:\n" +
                  pendingAbout.map((f) => `  - "${f.text}" (said about "${f.rawName}")`).join("\n") +
                  "\nIf one of them plainly concerns the person being asked about, say it and note " +
                  "in a few words that you were not sure which person it belonged to, so they can " +
                  "confirm. Never assert it as settled, and never claim to know nothing when a line " +
                  "above answers the question."
                : null,
              ladderRows.length > 0
                ? "THE COLUMN SEARCH MATCHED NOBODY, BUT THESE PEOPLE MATCH WHAT WAS ASKED " +
                  "through their name or through something the user saved about them. Answer " +
                  "from these and do NOT say nobody matched:\n" +
                  ladderRows
                    .map((r) => {
                      const bits = [r.name, r.title, r.company, r.city].filter(Boolean).join(" — ");
                      const why = r.excerpts?.length
                        ? ` — you saved: "${String(r.excerpts[0]).slice(0, 160)}"`
                        : r.matched?.length
                          ? ` — labeled ${r.matched.join(", ")}`
                          : "";
                      return `  - ${bits}${why}`;
                    })
                    .join("\n")
                : null,
              results.length > 0
                ? `${countLine}\nMatches:\n${rows}`
                : ladderRows.length > 0
                  ? null
                  : "No contacts matched.",
            ]
              .filter(Boolean)
              .join("\n");
            const answerText = await stream({
              model: CHAT_MODEL,
              system: sys,
              messages: [{ role: "user", content: message }],
              maxTokens: 450,
              onToken: (t) => {
                if (clientGone) throw new Error("client_disconnected");
                writeEvent("token", { text: _stripDashes(t) });
              },
            });
            // An attribute search that matched nobody is the same dead end as an
            // empty semantic search, so it gets the same one-tap way out. This
            // branch returns early and never reaches the shared suggestions block
            // below, which is why the chip is emitted (and persisted) here.
            const searchSuggestions =
              results.length === 0 ? [webSearchChip(message)] : [];
            if (!clientGone && searchSuggestions.length > 0) {
              writeEvent("suggestions", { suggestions: searchSuggestions });
            }
            await appendMessage(amberId, {
              conversationId,
              role: "assistant",
              content: answerText,
              intent,
              metadata: {
                model: CHAT_MODEL,
                peopleIds: people.map((p) => p.contactId),
                people,
                citations: [],
                suggestions: searchSuggestions,
              },
            }).catch(() => null);
            if (!clientGone) {
              writeEvent("complete", { conversationId, intent, tookMs: Date.now() - started });
            }
            return;
          }
          intent = "network_query"; // no clean filter — let the ranker handle it
        }

        if (intent === "chat") {
          model = CHAT_MODEL;
          // When web results were fetched, prepend them to the user turn and add
          // the citation instruction; otherwise behave exactly as before.
          const userContent = webBlock ? `${webBlock}\n\n${message}` : message;
          const messages = toAnthropicMessages(history, userContent);
          const baseSystemRaw = webBlock
            ? `${CHAT_SYSTEM} ${WEB_GROUNDING}`
            : isVoice
              ? VOICE_CHAT_SYSTEM
              : CHAT_SYSTEM;
          const baseSystem =
            (todayLine ? `${baseSystemRaw}\n${todayLine}` : baseSystemRaw) +
            planNarrative +
            placesInstruction() +
            multiAskInstruction +
            /**
             * IT CANNOT SCHEDULE, SO IT MUST NOT IMPLY THAT IT DID.
             *
             * There is no write path from here to events or reminders -- the
             * client calls /v1/reminders/parse separately -- and with nothing
             * said about that, the model invented a constraint ("calendar
             * writes confirm themselves in the app") and printed a formatted
             * Event/Date/Time block for a reminder that was never created.
             * See lib/schedule-honesty.js.
             */
            `\n${SCHEDULE_HONESTY}` +
            /**
             * WHAT THE SEARCH ASSUMED, SO THEY CAN CORRECT IT.
             *
             * Adding "New York" to somebody's search is putting words in their
             * mouth. Done silently, a wrong guess is invisible: they see thin
             * results and conclude the search is bad rather than that it looked
             * in the wrong city. One clause, in the answer, in Amber's own
             * words. Empty string when nothing was assumed.
             */
            (webBlock ? searchAssumption : "");
          // The stored memory rides with priorContext, on the volatile side of
          // the cache breakpoint, because it changes per message.
          const volatileContext = [priorContext, taggedMemory].filter(Boolean).join("\n\n");
          buf = await stream({
            model,
            system: withPriorContext(baseSystem, volatileContext),
            messages,
            // Voice replies stay tight but not bare: enough room for a specific
            // reaction plus a concrete offer, still small enough to stream fast.
            //
            // A WEB-GROUNDED answer gets 2400. A ten-row table with links in the
            // name cells does not fit in 1024, and the failure mode is the worst
            // one available: the answer streams beautifully and then simply stops
            // mid-row, which reads as a bug rather than as a limit.
            // 320 was the real reason voice replies read as thin, and no amount of
            // prompting could have fixed it: 320 tokens is about 240 words, so a
            // five-item checklist plus one useful observation did not FIT and came
            // back truncated or pre-compressed by the model to survive the ceiling.
            // The ceiling is not a length target — the prompt still says be tight,
            // and most replies stay short — it is only the point at which a genuinely
            // substantial answer gets cut off mid-sentence.
            // 1100, NOT 2400. The ceiling was a length TARGET in practice: the model
            // filled it, a grounded restaurant answer ran to a table plus prose plus
            // a "how to choose" section plus a follow-up question, and generating
            // that took past the 40-second hard deadline — the client gave up and
            // the user saw a half-drawn table and nothing else. A tight table and
            // two sentences is both faster and the better answer.
            maxTokens: isVoice ? 1200 : webBlock ? 1100 : 1024,
            onToken: (t) => {
              if (clientGone) throw new Error("client_disconnected");
              writeEvent("token", { text: _stripDashes(t) });
            },
          });
        } else {
          // network_query or both: run the PeopleRank pipeline. Pass the user's
          // raw message — PeopleRank Stage 1 handles intent, temporal context,
          // and referents itself. Failure → empty.
          // rankDeps, peopleLimit, the prep and the retrieval are all started
          // at the top of the turn now -- see the note there. This branch only
          // collects them.

          // Emitting the ranked people also records what the turn persists and
          // what post-answer suggestions may reference. Called once when the
          // ranker's people arrive, then again on `done` with the final order
          // and the citations (which only exist after the answer is written).
          let people = [];
          const emitPeople = (list, cits) => {
            people = Array.isArray(list) ? list : [];
            citations = Array.isArray(cits) ? cits : [];
            peopleIds = people.map((p) => p.contactId).filter(Boolean);
            turnPeople = people.map((p) => ({
              contactId: p.contactId,
              name: p.name,
              score: p.score,
              components: p.components,
            }));
            // Carry id+name so post-answer draft_message suggestions reference
            // real contacts (and only real ones).
            suggestPeople = people
              .map((p) => ({ contactId: p.contactId, name: p.name }))
              .filter((p) => p.contactId);
            // THE RANKER OWNS THE PEOPLE SLOT once it has spoken. On a search
            // answer the ranked list IS the answer, so the mention-merge after
            // generation must not overwrite it with whoever happened to be named.
            sentRankedPeople = true;
            writeEvent("people", { people, citations });
            // ONE LINE THAT SAYS WHERE THE SIX SECONDS WENT: the contacts +
            // facts load, the vector retrieval, and the ranker itself, plus how
            // much was shipped. Guessing at this path has been wrong twice.
            request.log?.info?.(
              `PEOPLERANK_TIMING owner=${amberId ?? "?"} intent=${intent} ` +
                `prep=${prepMs ?? "-"}ms${prepCached ? "(cached)" : ""} ` +
                `retrieval=${retrievalMs ?? "-"}ms ` +
                `firstPeople=${Date.now() - rankT0}ms ` +
                `contacts=${rankContacts.length} sent=${people.length}`,
            );
            // FIRST OUT, ON PURPOSE. The owner's own contacts are the cheapest
            // of the three retrievals -- rows they already have, one indexed
            // query and a ranking pass -- and the one they care most about, so
            // this section lands while the web is still being read.
            //
            // AND THAT CLAIM IS NOW CHECKED RATHER THAN ASSERTED. The time this
            // lane took goes into the estimate that orders the next multi-part
            // answer, so if the address book ever grows to where it is no longer
            // the fastest lane, the order changes by itself instead of being
            // wrong until somebody notices.
            recordLaneMs("people", Date.now() - rankT0);
            stage("people", "Your people", "done");
          };

          // ── Streaming path ────────────────────────────────────────────────
          // Relay the engine's own answer deltas so the text appears as it is
          // written, instead of blocking ~6s and then fake-chunking a finished
          // string. `both` consumes the same stream but does NOT relay its
          // tokens — there, the ranker's answer is only context for the Sonnet
          // synthesis that streams its own tokens (unchanged).
          const relayTokens = intent === "network_query";
          let streamedAnswer = "";
          let sawStreamEvent = false;
          let relayedText = false; // did the client already receive answer text?

          const prepared = await preparedPromise;
          // Vector pre-filter (flag-gated, fail-open): retrieve the top-K most
          // relevant contacts by embedding similarity and rank ONLY those,
          // instead of shipping the whole address book to the ranker cold. Any
          // miss (flag off, no index, no rows) leaves the full set untouched.
          let rankContacts = prepared?.contacts || [];
          // ── THE SIX DIMENSIONS, FINALLY ON THIS PATH ────────────────────────
          //
          // Facts have been tagged with dimensions on write, embedded, and rolled
          // up into contact_dimension_state for a while. lib/ask.js was the ONLY
          // caller of retrieveHybrid in the codebase, so none of it reached
          // /v1/chat: the ranker got every contact's facts in no order at all.
          //
          // This does two jobs from one retrieval: WHICH contacts are relevant to
          // this question, and WHICH of their facts made the case -- scored by
          // pgvector similarity blended with the dimension match.
          //
          // ADDITIVE BY DEFAULT. Without PEOPLERANK_VECTOR_PREFILTER the contact
          // set is UNCHANGED -- every contact the ranker used to see it still
          // sees. Relevant ones move to the front and carry ranked facts.
          // Narrowing is opt-in because only 53 of 5,249 contacts hold any fact:
          // filtering to retrieval hits would make the other 5,196 unreachable
          // and break asking about somebody by name.
          //
          // Every failure -- no key, empty index, a throw -- returns null and
          // leaves the old behavior exactly in place, including the contact
          // vector prefilter that used to live here.
          if (prepared && relevancePromise) {
            const narrow = process.env.PEOPLERANK_VECTOR_PREFILTER === "1";
            // Already in flight since the top of the turn.
            const relevance = await relevancePromise;

            if (relevance) {
              rankContacts = applyRetrievalToContacts(prepared.contacts, relevance, {
                narrow,
              });
              const top = Object.entries(relevance.dimensionWeights || {})
                .sort((a, b) => b[1] - a[1])[0];
              console.log(
                `[chat] dimension retrieval: ${relevance.contactIds.length} contact(s) ` +
                  `from ${relevance.observationCount} observation(s), ` +
                  `vector=${relevance.usedVector}, top dimension=${top ? top[0] : "flat"}, ` +
                  `narrow=${narrow}`,
              );
            } else if (narrow) {
              // Retrieval had nothing to say. Fall back to the contact-vector
              // prefilter this block used to be, rather than shipping the whole
              // address book when the caller asked for a bounded payload.
              const topIds = await retrieveTopK(amberId, message, 40).catch(() => null);
              if (Array.isArray(topIds) && topIds.length > 0) {
                const keep = new Set(topIds.map(String));
                const filtered = prepared.contacts.filter((c) => keep.has(String(c.id)));
                if (filtered.length > 0) rankContacts = filtered;
              }
            }
          }
          if (prepared) {
            try {
              for await (const evt of _withStepTimeout(streamRank({
                query: message,
                    limit: peopleLimit,
                contacts: rankContacts,
                me: prepared.me,
              }), RANK_STEP_TIMEOUT_MS)) {
                if (clientGone) break;
                if (evt.type === "people") {
                  sawStreamEvent = true;
                  emitPeople(evt.data?.people || [], evt.data?.citations || []);
                } else if (evt.type === "token") {
                  const t = evt.data?.text || "";
                  if (!t) continue;
                  sawStreamEvent = true;
                  streamedAnswer += t;
                  if (relayTokens) {
                    writeEvent("token", { text: _stripDashes(t) });
                    relayedText = true;
                  }
                } else if (evt.type === "done") {
                  sawStreamEvent = true;
                  if (typeof evt.data?.answer === "string" && evt.data.answer.trim()) {
                    streamedAnswer = evt.data.answer;
                  }
                  // Final order + the citations the answer produced.
                  emitPeople(
                    Array.isArray(evt.data?.people) && evt.data.people.length
                      ? evt.data.people
                      : people,
                    evt.data?.citations || citations,
                  );
                }
              }
            } catch (err) {
              request.log?.warn?.(
                { err: err?.message },
                "[chat] ranker stream failed",
              );
            }
          }

          // ── Blocking fallback ─────────────────────────────────────────────
          // Only when the stream produced nothing at all (engine off, not
          // configured, unreachable, no contacts). Once anything has been
          // emitted we keep what the client already has rather than re-emitting.
          let rank = { people: [], answer: null, citations: [] };
          if (!sawStreamEvent) {
            const empty = { people: [], answer: null, citations: [] };
            // Bounded too: if the blocking ranker stalls, fall to the graceful
            // capture invite rather than making the user wait on a dead search.
            rank = await Promise.race([
              runPeopleRank(did, message, rankDeps).catch(() => empty),
              new Promise((res) => setTimeout(() => res(empty), RANK_STEP_TIMEOUT_MS)),
            ]);
            emitPeople(rank.people || [], rank.citations || []);
          }

          const rankedAnswer = streamedAnswer.trim()
            ? streamedAnswer
            : rank.answer;

          if (intent === "network_query") {
            model = "togari-search";
            let answer;
            if (people.length && rankedAnswer) {
              answer = rankedAnswer;
            } else {
              // ── THE LADDER, BEFORE ANY HEURISTIC AND BEFORE GIVING UP ────
              //
              // The ranker found nothing. That is NOT the same as there being
              // nothing: it scores relationships, and a tester whose scores
              // have not been computed yet has an empty ranker and a full
              // address book. Below this used to be an area-code guess and then
              // a hardcoded "Nothing in your contacts answers that yet", and
              // that string is what testers were reading while holding 1,179
              // contacts, thirty of them tagged USC.
              //
              // So the tier above the guess is what the user actually has: what
              // they told Amber, what came in with their synced notes, the
              // labels they typed into names, the companies and titles and
              // cities on their cards. Composed here by hand rather than by the
              // model because this path relays the ranker's own tokens and has
              // no synthesis pass -- which is exactly how the area-code branch
              // below already writes its sentence.
              const led = await gatherPromise;
              const ladderRows = led
                ? [...led.layers.stated, ...led.layers.labeled, ...led.layers.implied]
                : [];
              if (ladderRows.length > 0) {
                // A NAME MATCH IS THE STRONGEST EVIDENCE THERE IS, so the named layer
                // leads. Without it, asking about a person by name on this path
                // fell through to the area-code guess.
                const strong = [...(led.layers.named ?? []), ...led.layers.stated, ...led.layers.labeled];
                const shown = (strong.length > 0 ? strong : led.layers.implied).slice(0, 12);
                const ladderPeople = shown
                  .filter((r) => r.contactId)
                  .map((r) => ({ contactId: String(r.contactId), name: r.name, score: 0 }));
                if (ladderPeople.length > 0) emitPeople(ladderPeople, []);

                // THE TWO LAYER TOTALS OVERLAP, so adding them can exceed the
                // book. Each is a `count(*) OVER ()` inside its own layer and a
                // contact can be in both -- noted in a note AND labeled in the
                // name -- so the sum double counts them. Capped at the book,
                // which is the one bound that is certainly true.
                const bookTotal = led.shape?.total ?? 0;
                const total = strong.length > 0
                  ? Math.min(
                      Math.max(led.totals.stated + led.totals.labeled, strong.length),
                      bookTotal || Number.MAX_SAFE_INTEGER,
                    )
                  : led.totals.implied;
                const names = shown.map((r) => r.name).filter(Boolean).join(", ");
                // ATTRIBUTE THE QUOTE OR DROP IT.
                //
                // It read "Your note on one of them says 'said not to call after
                // 9, text only'" -- a real quote from the user's own book, about
                // a person the sentence refuses to name, next to a list of twelve
                // names. It is unusable (which one?) and slightly unnerving. If
                // the row carrying the excerpt has a name, the name goes in.
                const quoted = led.layers.stated.find((r) => r.excerpts?.length && r.name);
                const quote = quoted?.excerpts?.[0] ?? null;

                if (strong.length > 0) {
                  // A COUNT THAT IS ALMOST THE WHOLE BOOK IS NOT AN ANSWER.
                  //
                  // "2897 of your contacts match that, here are 12: ..." was the
                  // live reply to "who do I know that works in tech" on a book
                  // where nearly every note mentions tech. The number is correct
                  // and it tells the user nothing, the twelve are in no order
                  // they can perceive, and the whole thing reads broken. Any
                  // common term on any large book lands here.
                  //
                  // So when the match is saturated, stop reporting it as a match:
                  // say the term is too broad to narrow on, show a few anyway so
                  // the turn is not empty, and ask for the one thing that would
                  // actually cut it down.
                  const saturated = bookTotal > 40 && total >= Math.floor(bookTotal * 0.9);
                  // THE DETERMINISTIC SENTENCE, KEPT AS THE FLOOR ONLY.
                  //
                  // This branch composed the answer by hand, and a fixed sentence
                  // cannot obey an instruction in the question. Asked for
                  // "exactly three people, no more and no fewer, as a numbered
                  // list", it answered "18 of your contacts match that, here are
                  // 12: ..." -- twelve names, no numbering, in 939ms. Fast, and
                  // not what was asked for. Same for "just the top two", "one
                  // sentence each", "only the ones in Brooklyn".
                  //
                  // So the rows go to the model, which can read the question, and
                  // the sentence below survives for the case where the model
                  // returns nothing at all. Costs a couple of seconds on this
                  // branch and buys an answer that responds to what was typed.
                  const floor = saturated
                    ? `That matches almost everyone in your book, so it does not narrow ` +
                      `anything down on its own. A few of them: ${names}. ` +
                      `Give me one more thing to go on and I can actually pick: a city, a ` +
                      `company, how you know them, or roughly when you last spoke.`
                    : `${total} of your contacts match that${total > shown.length ? `, here are ${shown.length}` : ""}: ${names}.` +
                      (quote
                        ? ` Your note on ${quoted.name} says "${String(quote).slice(0, 160)}".`
                        : "") +
                      ` Want me to draft a message to one of them, or add a note about any of them?`;

                  const rowsBlock = shown
                    .map((r) => {
                      const bits = [r.name, r.title, r.company, r.city].filter(Boolean).join(" — ");
                      const why = r.excerpts?.length
                        ? ` — you saved: "${String(r.excerpts[0]).slice(0, 140)}"`
                        : r.matched?.length
                          ? ` — labeled ${r.matched.join(", ")}`
                          : r.termsHit
                            ? " — their name matches what you asked"
                            : "";
                      return `  - ${bits}${why}`;
                    })
                    .join("\n");
                  const matchSystem = [
                    todayLine,
                    AMBER_IDENTITY,
                    "",
                    "THIS TURN: these are the people in the user's own address book that match",
                    "what they just asked. Answer from these and nothing else.",
                    saturated
                      ? `Nearly every contact they have matches this (${total} of ${bookTotal}), so the ` +
                        "count is not useful. Say plainly that it does not narrow anything down, show a " +
                        "few, and ask for the one more thing that would."
                      : `${total} of their contacts match; the ${shown.length} best are listed below.` +
                        (total > shown.length ? " Say the total honestly if you give a number." : ""),
                    "DO EXACTLY WHAT THE QUESTION ASKED FOR. If they asked for a specific number of",
                    "people, give that many and no more. If they asked for a numbered list, a table, or",
                    "one line each, give them that shape. If they asked you to leave something out,",
                    "leave it out. A correct answer in the wrong shape is a wrong answer.",
                    "Never name anybody who is not listed below, and never invent a detail about one.",
                    "Close with one short, useful next step.",
                    ANSWER_STYLE,
                    HOUSE_RULES,
                    "The matching people:",
                    rowsBlock,
                  ]
                    .filter(Boolean)
                    .join("\n");
                  let written = null;
                  try {
                    written = await stream({
                      model: FAST_CHAT_MODEL,
                      system: matchSystem,
                      messages: [{ role: "user", content: message }],
                      maxTokens: 600,
                      onToken: (t) => {
                        if (clientGone) throw new Error("client_disconnected");
                        writeEvent("token", { text: _stripDashes(t) });
                      },
                    });
                  } catch (err) {
                    request.log?.warn?.({ err: err?.message }, "[chat] ladder-match stream failed");
                  }
                  if (written && written.trim()) {
                    answer = written;
                    relayedText = true;
                  } else {
                    answer = floor;
                  }
                } else {
                  // The floor, and labeled as the guess it is.
                  answer =
                    `Nothing you have saved says that outright, but ${total} of your contacts ` +
                    `have area codes for that region, which is a hint rather than a fact since ` +
                    `numbers stick after a move: ${names}. ` +
                    `Want me to message any of them to check, or would you rather I searched the web?`;
                }
                buf = answer;
                if (!relayedText) {
                  writeEvent("token", { text: answer });
                  relayedText = true;
                }
                stage("people", "Your people", "done");
              } else if (led?.shape && led.shape.total === 0) {
                // ── NO CONTACTS AT ALL IS NOT "NOTHING MATCHED" ──────────────
                //
                // A brand-new account, or one that denied the contacts
                // permission, holds zero contacts -- and every question was
                // answered with webOfferNoMatches: "Nothing in your contacts
                // answers that yet... Want to voice something about someone
                // who's moved?"
                //
                // To somebody who has not synced anything that is a
                // non-sequitur, and it is the FIRST thing they ever read from
                // this app. The app knows the count is zero. Say that, and say
                // the one thing that fixes it.
                answer =
                  "I don't have any of your contacts yet, so there is nothing for me to look " +
                  "through. Sync your contacts and I can answer this from your own address " +
                  "book straight away. If you would rather not, tell me about someone out " +
                  "loud and I'll remember them from that instead.";
                buf = answer;
                if (!relayedText) {
                  writeEvent("token", { text: answer });
                  relayedText = true;
                }
                stage("people", "Your people", "done");
              } else if (led?.shape && led.shape.total > 0 && (led.aboutTheBook || led.terms.length === 0)) {
                // ── THE QUESTION WAS ABOUT THE BOOK, ON THIS PATH TOO ────────
                //
                // "How many people do I know?" and "Do you know anything about
                // any of my contacts?" are classified network_query, produce no
                // search terms at all, and so found no ranked people and no
                // ladder rows -- and fell straight to "Nothing in your contacts
                // answers that yet." For a question whose entire answer is a
                // number this app already has.
                //
                // The chat path learned this today (see aboutTheBook in
                // db/gather.js). This is the same tier for the network path.
                const sh = led.shape;
                const labels = (sh.tags ?? []).slice(0, 4).map((t) => `${t.count} tagged "${t.tag}"`).join(", ");
                const metros = (sh.metros ?? []).slice(0, 3).map((m) => `${m.count} in ${m.metro}`).join(", ");
                const titles = (sh.titles ?? []).slice(0, 3).map((t) => `${t.count} ${t.title}`).join(", ");
                answer =
                  `You have ${sh.total} contacts saved. ${sh.withPhone} have a phone number, ` +
                  `${sh.withEmail} an email, ${sh.withCompany} a company, and ${sh.withBirthday} a birthday. ` +
                  `${sh.withAmberNote} you have told me about directly and ${sh.withSyncedNote} came in ` +
                  `carrying a note from your phone.` +
                  (labels ? ` Labels you use on more than one person: ${labels}.` : "") +
                  (metros ? ` By area code: ${metros}.` : "") +
                  (titles ? ` Job titles I can see: ${titles}.` : "") +
                  ` Ask me about any of those, or tell me about someone and I'll remember it.`;
                buf = answer;
                if (!relayedText) {
                  writeEvent("token", { text: answer });
                  relayedText = true;
                }
                stage("people", "Your people", "done");
              } else {
              // Last-resort tier: no saved info, no ranked matches, nothing in
              // the book, and not a question about the book -- so fall back to
              // the area-code heuristic. If
              // the query names a region and some contacts carry that region's
              // area codes, surface them as a hint (not a fact) and offer to
              // enrich or reach out.
              const ac = contactsByAreaCode(message, prepared?.contacts || []);
              if (ac.region && ac.matches.length > 0) {
                const shown = ac.matches.slice(0, 12);
                const acPeople = shown
                  .filter((m) => m.id)
                  .map((m) => ({ contactId: String(m.id), name: m.name, score: 0 }));
                if (acPeople.length > 0) emitPeople(acPeople, []);
                const names = shown.map((m) => m.name).filter(Boolean).join(", ");
                answer =
                  `I don't have anything saved yet about who's in ${ac.region.name}, ` +
                  `but ${shown.length} of your contacts have ${ac.region.name} area codes — ` +
                  `that's a hint, not a fact, since numbers stick after a move. ${names}. ` +
                  `Want me to enrich them to confirm, or would you rather message them to ask?`;
              } else {
                // ── THE FORM LETTER, AND WHY IT IS GONE ──────────────────────
                //
                // Nothing saved, no ranked match, no area-code hint. The honest
                // answer is still "I don't know". It was a fixed string, and in
                // thirty live turns five of them got it -- byte for byte
                // identical, to five unrelated questions. "Whose birthday is
                // coming up" was answered "Want to voice something about someone
                // who's MOVED?", because the only slot in the template is a
                // place name and there was no place in the question.
                //
                // ON SPEED, WHICH IS THE REASON IT WAS A TEMPLATE. The template
                // was not fast. Those five turns took 3.0 to 4.5 seconds, all of
                // it spent before this line: the intent router, the ranker race,
                // dimension retrieval. The fixed string then appeared all at
                // once at the end. A streamed Haiku answer starts arriving
                // several hundred milliseconds after this point, so the user
                // SEES the first words earlier than they used to, and the reply
                // is about their actual question. That is why this is not a
                // trade of latency for quality.
                //
                // It is grounded in the same material the model already gets on
                // every other path -- what was searched, the counts including
                // the zeros, the shape of the book -- so it can say what it went
                // through rather than shrugging. And it keeps the web chip, so
                // the one-tap way out is unchanged.
                offerWebSearch = message;
                const groundedThin = led ? renderGathered(led, { message }) : "";
                const thinSystem = [
                  // WITHOUT THIS THE REPLY ASKS THE USER WHAT DAY IT IS.
                  //
                  // The first live run of this branch answered "whose birthday is
                  // coming up" by listing twelve birthdays correctly and then
                  // finishing "To know whose birthday is actually coming up
                  // soonest, I'd need to know today's date. What's today." Every
                  // other prompt in this file already carries todayLine; this one
                  // was new and did not.
                  todayLine,
                  AMBER_IDENTITY,
                  "",
                  "THIS TURN: the user asked about the people they know and you found nothing",
                  "that answers it. Do not pretend otherwise and do not guess at a name.",
                  "Write three or four sentences of plain prose, no lists, no headings.",
                  "First, say specifically what you went through and came up empty on, in",
                  "their words, not yours.",
                  "Then give the single most useful thing you CAN say from what is below,",
                  "if there is one.",
                  "Then ask for the one piece of information that would let you answer next",
                  "time, and make it small and sayable: one sentence about one person.",
                  "Finally note they can have you search the web for this instead.",
                  "Never repeat a sentence you would write for a different question. The",
                  "reply must be about THIS question.",
                  ANSWER_STYLE,
                  HOUSE_RULES,
                  groundedThin,
                ]
                  .filter(Boolean)
                  .join("\n");
                let thinText = null;
                try {
                  thinText = await stream({
                    model: FAST_CHAT_MODEL,
                    system: thinSystem,
                    messages: [{ role: "user", content: message }],
                    maxTokens: 320,
                    onToken: (t) => {
                      if (clientGone) throw new Error("client_disconnected");
                      writeEvent("token", { text: _stripDashes(t) });
                    },
                  });
                } catch (err) {
                  request.log?.warn?.(
                    { err: err?.message },
                    "[chat] thin-answer stream failed",
                  );
                }
                if (thinText && thinText.trim()) {
                  answer = thinText;
                  relayedText = true;
                } else {
                  // THE FLOOR IS STILL THERE. A dead model must not produce an
                  // empty bubble, so the old string remains as the last resort
                  // and nothing else -- reached only when the stream returns
                  // nothing at all.
                  answer = webOfferNoMatches(ac.region?.name || null);
                }
              }
              }
            }
            buf = answer;
            // Send the text only if the client hasn't already received it live.
            // Covers the fallback path and a stream that produced an answer on
            // `done` without token frames. A stream that died mid-answer keeps
            // its partial text rather than re-sending the whole thing on top of
            // what iOS already drew.
            if (!relayedText) {
              for (const chunk of chunkText(answer)) {
                if (clientGone) break;
                writeEvent("token", { text: chunk });
              }
            }
          } else {
            // both: synthesize over the ranked people with Sonnet.
            model = CHAT_MODEL;
            const ctx =
              (webBlock ? `${webBlock}\n\n` : "") +
              `Here are the relevant people from my network:\n` +
              `${peopleContextBlock(people, rankedAnswer)}\n\n` +
              `My request: ${message}\n\n` +
              `Help me with both who to talk to and how to approach them.`;
            const messages = toAnthropicMessages(history, ctx);
            const bothSystemRaw = webBlock
              ? `${BOTH_SYSTEM} ${WEB_GROUNDING}`
              : BOTH_SYSTEM;
            const bothSystem =
              (todayLine ? `${bothSystemRaw}\n${todayLine}` : bothSystemRaw) +
              planNarrative +
              placesInstruction() +
              multiAskInstruction;
            buf = await stream({
              model,
              system: withPriorContext(
                bothSystem,
                [priorContext, taggedMemory].filter(Boolean).join("\n\n"),
              ),
              messages,
              // Same reason as the chat branch: a web-grounded "both" answer
              // carries people AND a grounded list, and the default ceiling cuts
              // it off mid-row.
              maxTokens: webBlock ? 1100 : 1024,
              onToken: (t) => {
                if (clientGone) throw new Error("client_disconnected");
                writeEvent("token", { text: _stripDashes(t) });
              },
            });
          }
        }

        // ── LABELED SECTIONS ────────────────────────────────────────────────
        // Started HERE, the instant the answer text is final, so its model call
        // overlaps the suggestion call and the capture merge below rather than
        // adding six seconds on top of a turn that is otherwise finished. Awaited
        // next to the place cards, which is the last thing the turn does.
        //
        // Only the ranked people, and only when the RANKER owned the people slot:
        // a note's "filed to" chips are not a search result and have no sections
        // to recover. Fails closed to the flat list; see lib/answer-groups.js.
        const groupsPromise =
          sentRankedPeople && turnPeople.filter((p) => p.contactId).length >= 3
            ? groupAnswerPeople({
                answer: buf,
                people: turnPeople
                  .filter((p) => p.contactId)
                  .map((p) => ({ contactId: String(p.contactId), name: p.name })),
              }).catch(() => null)
            : null;

        // Resolve capture now (it was kicked off before the reply) so we can
        // attach EVERY person this note involves — resolved, soft-confirm, or
        // still ambiguous — to the thread metadata. That is what draws the
        // "filed to" chips on the Today voice-note cards for journal-style notes
        // ("Sagar, Shirley and Maggie…"), not just for clean people-searches.
        if (capturePromise) {
          const capForPeople = await capturePromise.catch(() => null);
          if (capForPeople && Array.isArray(capForPeople.outcomes)) {
            const seen = new Set(turnPeople.map((p) => _normName(p.name || "")));
            const addInvolved = (name, contactId) => {
              if (!name) return;
              const key = _normName(name);
              if (!key || seen.has(key)) return;
              seen.add(key);
              const cid = contactId != null ? String(contactId) : null;
              turnPeople.push({ contactId: cid, name, score: 0 });
              if (cid) peopleIds.push(cid);
            };
            for (const o of capForPeople.outcomes) {
              // A single-name mention (fact / field / one-participant resolution).
              addInvolved(o.resolvedName || o.guessedName || o.rawName || null, o.contactId || o.guessedId || null);
              // Multi-person notes/experiences carry every resolved participant
              // by name (and id), which is how "Sagar, Shirley and Maggie" get
              // their chips.
              const names = Array.isArray(o.participantNames) ? o.participantNames : [];
              const ids = Array.isArray(o.participantIds) ? o.participantIds : [];
              names.forEach((nm, idx) => addInvolved(nm, ids[idx]));
            }

            // Keep the vector index fresh: any contact that just had a fact /
            // note / experience WRITTEN gets re-embedded (fire-and-forget, off
            // the response path). Unchanged contacts hash-match and are skipped.
            const changed = new Set();
            for (const o of capForPeople.outcomes) {
              if (o.status !== "captured") continue;
              if (o.contactId != null) changed.add(String(o.contactId));
              for (const pid of Array.isArray(o.participantIds) ? o.participantIds : []) {
                if (pid != null) changed.add(String(pid));
              }
            }
            for (const id of changed) {
              reembedContactSoon(amberId, id, () =>
                getContactContentForContacts(amberId, [Number(id)])
                  .then((m) => m?.[String(id)] || [])
                  .catch(() => []),
              );
            }
          }
        }

        // Surface a contact card and enable draft/intro suggestions for the people
        // you actually named that resolve to REAL contacts. New or ambiguous people
        // get no card here on purpose; their confirmation card on the feed is the
        // action.
        //
        // THIS USED TO BE GATED ON isVoice, and that was the bug behind "it doesn't
        // show their contact card": typing "save that Sagar Tiwari is my boss" is
        // source app_chat, so isVoice was false and a successful capture showed
        // nothing at all. Naming a person is naming a person whether you said it or
        // typed it. Gated instead on this turn NOT already having emitted its own
        // people event, so a search/network answer is not overwritten.
        {
          // Collected, not started, here — it has been running since before
          // generation, so by now this is almost always already resolved.
          if (hintPromise) await hintPromise;
          const resolvedInvolved = turnPeople.filter((p) => p.contactId);
          // The resolved set first, then anyone the fast tagger surfaced who is not
          // already in it. Order matters: the client renders in array order, and the
          // person the note was actually ABOUT should not fall below a passing
          // mention just because the lookup saw it a second earlier.
          // ONE CARD PER PERSON, KEYED ON THE CONTACT, NOT THE NAME.
          //
          // addInvolved() above dedupes turnPeople by normalized NAME, so the same
          // contact arriving under two labels -- "Spencer" from a soft-confirm's
          // rawName and "Spencer Blume" from a captured outcome's participantNames
          // -- passes as two people. resolvedInvolved was then trusted as-is here:
          // `seen` was BUILT from it, so add() protected fastTagged and hintPeople
          // from it while never checking it against itself. The client renders one
          // PersonBlock per entry, so the user saw Spencer twice.
          //
          // Deduped on contactId, keeping the first occurrence because the order
          // above is meaningful: who the note is ABOUT before who it mentioned.
          const seen = new Set();
          const dedupeById = (list) =>
            list.filter((p) => {
              const id = p?.contactId ? String(p.contactId) : "";
              if (!id || seen.has(id)) return false;
              seen.add(id);
              return true;
            });
          const add = dedupeById;
          // Order is the ranking the user reads: people this note is ABOUT, then
          // people it named in passing, then people recalled from the place it
          // mentioned. A recalled contact is a real answer but a weaker one than
          // someone the sentence actually names.
          // Same ordering as before -- about, then named in passing, then
          // recalled -- now carrying the reason so the client can say it.
          const merged = [
            ...dedupeById(resolvedInvolved).map((p) => ({ ...p, kind: "mentioned" })),
            ...add(fastTagged).map((p) => ({ ...p, kind: "mentioned" })),
            ...add(hintPeople).map((p) => ({ ...p, kind: "recalled" })),
          ];
          if (resolvedInvolved.length > 0) {
            suggestPeople = merged.map((p) => ({ contactId: String(p.contactId), name: p.name }));
          }
          // Emitted whenever this turn has anything to show and the RANKER has not
          // already owned the people slot — a search answer's ranked list is the
          // answer, and must not be overwritten by mentions.
          if (merged.length > 0 && !clientGone && !sentRankedPeople) {
            writeEvent("people", { people: merged, citations: [] });
          }
        }


        // COLLECTED BEFORE THE CHIPS, because the chips are about the card.
        // This used to be awaited further down, next to where it is emitted, so
        // the suggestion floor below could not see the venue and offered nothing
        // about the restaurant the user had just named. Awaited once, here, and
        // reused at the emit site rather than awaited twice.
        const turnPlaces = placesPromise ? await placesPromise.catch(() => []) : [];

        // Follow-up suggestion chips, computed BEFORE persisting so they SURVIVE
        // a reload of the note (stored in metadata) and still show even if the
        // client disconnected mid-reply. Best-effort — any failure yields none.
        let suggestions = [];
        try {
          const s = await suggest({
            message, answer: buf, intent,
            people: suggestPeople, history, model: ROUTER_MODEL,
          });
          if (Array.isArray(s)) suggestions = s;
        } catch { /* best-effort */ }
        // SHARING IS ALWAYS ON THE TABLE. The model is told to offer it, but a
        // suggestion model that quietly returns two chips instead of three is not a
        // thing to leave to chance when "share this with a circle" is the whole
        // point of answering inside Amber rather than in a browser. So if the turn
        // produced a real answer and no sharing chip came back, add one.
        //
        // Skipped when the turn is offering a web search: that turn has exactly one
        // sensible next move and it is not sharing an answer that does not exist yet.
        // EVERY TURN ENDS WITH SOMETHING TO DO, and the guaranteed ones are added
        // FIRST so the cap cannot eat them.
        //
        // This was the bug: the forced share chip was appended and then
        // `slice(0, 4)` truncated it straight back off, so it only ever appeared
        // when the model happened to return three or fewer of its own. And the
        // 40-character floor meant a short answer — the case that needs a next step
        // most — got nothing.
        //
        // Two are guaranteed:
        //   - SHARE. Finding something out inside Amber is only worth more than
        //     finding it in a browser because it can go to the people it is about.
        //     One chip, not two, because the sheet it opens picks a circle OR a
        //     person; two chips onto one sheet is a longer row saying one thing.
        //   - ADD A NOTE, whenever this turn actually named someone. It carries a
        //     real contactId because both this validator and the client require one,
        //     so it is offered for the person the turn is most about rather than as
        //     a chip that opens a picker nobody asked for.
        {
          const forced = [];
          if (buf && buf.trim().length > 0 && !offerWebSearch) {
            forced.push({ type: "share_note", label: "Send this to someone" });
          }
          const noteTarget = (suggestPeople || []).find((p) => p?.contactId && p?.name);
          if (noteTarget) {
            forced.push({
              type: "add_note",
              label: `Add a note about ${String(noteTarget.name).trim().split(/\s+/)[0]}`,
              contactId: String(noteTarget.contactId),
              name: noteTarget.name,
            });
          }
          // Forced first, model's own after, deduped by type for the two singleton
          // types so a model that also produced one does not double it up.
          const seenType = new Set(forced.map((f) => f.type));
          suggestions = [
            ...forced,
            ...suggestions.filter((x) => !(x && seenType.has(x.type))),
          ];
        }
        if (offerWebSearch) {
          // First chip, and never duplicated: this is the answer's actual call to
          // action, so it must not sit behind three generated follow-ups.
          suggestions = [
            webSearchChip(offerWebSearch),
            ...suggestions.filter((x) => x?.type !== "web_search"),
          ];
        }
        // AND A FLOOR UNDER IT, not just a cap over it.
        //
        // The generated chips come from a best-effort model call inside a bare
        // catch. When it returns nothing -- which is not rare for a small router
        // model -- the turn ends with only the two forced chips, and both of
        // those are about FILING what just happened rather than doing it. "Send
        // this to someone" and "Add a note about Drew" is not a plan.
        //
        // withSuggestionFloor tops the row up to three from what the turn
        // actually produced: the people it resolved and the venue it found.
        // Nothing invented, and a model that did its job is left untouched.
        suggestions = withSuggestionFloor(
          suggestions,
          { people: suggestPeople || [], places: turnPlaces, message },
          { floor: 3, cap: 5 },
        );
        if (!clientGone && suggestions.length > 0) {
          writeEvent("suggestions", { suggestions });
        }

        // ── THE ANSWER HAS TO SURVIVE THIS WRITE ────────────────────────────
        //
        // "After I saw the response, closed the chat, closed the app, and
        //  reopened the chat, the entire response disappeared. After a response
        //  renders, it needs to stay there. Even if I check back 10 years later."
        //
        // The log said `[chat] persist assistant msg failed` and nothing else --
        // the error object was passed to the logger and the platform's line
        // renderer dropped it, so the ONE fact needed to fix it was the one fact
        // not recorded. A 26-second turn's whole answer was gone, and the client
        // had already thrown its copy away by then.
        //
        // Three changes, in order of how much they matter:
        //
        //   1. The failure now says WHAT failed -- code, constraint, and the
        //      message -- in the message text itself, not in an object beside it.
        //   2. It RETRIES. The plausible causes here are transient by nature: a
        //      saturated pool (max 20, 5s to acquire) on a turn that fired a
        //      dozen concurrent queries, or a statement killed by the 15s
        //      timeout. One retry after a breath costs nothing and covers both.
        //   3. If it fails again, the PROSE IS SAVED WITHOUT THE METADATA. The
        //      cards, chips and citations are a nice-to-have; the answer is the
        //      thing the user waited half a minute for. A turn that reopens with
        //      its text and no place cards is a small loss. A turn that reopens
        //      empty is the app having forgotten, which is the one thing a
        //      memory product may never do.
        const assistantBody = _stripDashes(buf);
        const assistantMetadata = {
          model,
          peopleIds,
          people: turnPeople,
          citations,
          suggestions,
          // Only present on a web-grounded turn; absent (not empty) otherwise, so
          // an older stored turn reads the same as a non-web one.
          ...(webSources.length > 0 ? { sources: webSources } : {}),
          ...(webPeople.length > 0 ? { webPeople } : {}),
        };
        const describeWriteError = (err) =>
          `${err?.code ? `${err.code} ` : ""}${err?.constraint ? `[${err.constraint}] ` : ""}` +
          `${err?.message || err}`;
        const persistAssistant = async (metadata) =>
          appendMessage(amberId, {
            conversationId,
            role: "assistant",
            content: assistantBody,
            intent,
            metadata,
          });
        let assistantMsg = null;
        try {
          assistantMsg = await persistAssistant(assistantMetadata);
        } catch (err) {
          request.log?.error?.(
            `CHAT_PERSIST_FAILED owner=${amberId ?? "?"} conv=${conversationId} ` +
              `chars=${assistantBody.length} attempt=1 ${describeWriteError(err)}`,
          );
          await new Promise((r) => setTimeout(r, 400));
          try {
            assistantMsg = await persistAssistant(assistantMetadata);
            request.log?.warn?.(
              `CHAT_PERSIST_RECOVERED owner=${amberId ?? "?"} conv=${conversationId} on retry`,
            );
          } catch (err2) {
            request.log?.error?.(
              `CHAT_PERSIST_FAILED owner=${amberId ?? "?"} conv=${conversationId} ` +
                `chars=${assistantBody.length} attempt=2 ${describeWriteError(err2)}`,
            );
            try {
              // THE WORDS, AT LEAST. If the metadata is what the database is
              // refusing, this is the write that still saves the answer.
              assistantMsg = await persistAssistant({ model, degraded: true });
              request.log?.error?.(
                `CHAT_PERSIST_DEGRADED owner=${amberId ?? "?"} conv=${conversationId} ` +
                  `— the answer is stored, its cards and chips are not`,
              );
            } catch (err3) {
              request.log?.error?.(
                `CHAT_PERSIST_LOST owner=${amberId ?? "?"} conv=${conversationId} ` +
                  `chars=${assistantBody.length} ${describeWriteError(err3)} ` +
                  `— the user has an answer on screen that no longer exists anywhere`,
              );
            }
          }
        }
        // AND THE CLIENT IS TOLD WHETHER IT WAS SAVED, so it can keep its own
        // copy of an answer the server does not have. Sent on every turn rather
        // than only on failure: "no news" is indistinguishable from a dropped
        // frame, and the client needs a positive signal to trust the server's
        // copy over its own.
        if (!clientGone) {
          writeEvent("persisted", {
            conversationId,
            messageId: assistantMsg?.id != null ? String(assistantMsg.id) : null,
            saved: !!assistantMsg?.id,
          });
        }

        // Collect the venue cards started before the chips. Emitted and then merged
        // into the turn's stored metadata, so reopening the note shows the same cards
        // rather than an answer that has lost half of itself.
        if (groupsPromise) {
          const groups = await groupsPromise;
          if (Array.isArray(groups) && groups.length > 1) {
            if (!clientGone) writeEvent("groups", { groups });
            if (assistantMsg?.id) {
              await mergeMessageMetadata(amberId, assistantMsg.id, { groups });
            }
            request.log?.info?.(
              { sections: groups.length },
              "[chat] answer grouped into sections",
            );
          }
        }

        {
          const places = turnPlaces;
          if (Array.isArray(places) && places.length > 0) {
            if (!clientGone && !placesSent) writeEvent("places", { places });
            if (assistantMsg?.id) {
              await mergeMessageMetadata(amberId, assistantMsg.id, { places });
            }
            request.log?.info?.({ count: places.length }, "[chat] place cards");
          }
        }

        // Smart fact capture — started before the reply (above) so it overlaps
        // token generation; awaited here so clarify/soft_confirm events emit per
        // outcome in the same order as before.
        if (capturePromise) {
          try {
            const cap = await capturePromise;
            // SOMETHING WAS JUST WRITTEN, so the cached ranking payload is out
            // of date -- and the next question is very often about exactly the
            // thing that was captured.
            if (cap?.status === "captured" && prepKey) invalidatePreparedInput(prepKey);
            request.log?.info?.(`CHAT_CAP owner=${amberId} intent=${intent} clientGone=${clientGone} status=${cap?.status} outcomes=${(cap?.outcomes || []).map((o) => `${o.route}:${o.status}`).join(",")}`);
            if (cap && Array.isArray(cap.outcomes)) {
              const capturedTexts = [];
              const capturedOutcomes = [];
              // One person, one card. When the same name is ambiguous across
              // several captured signals in a single turn (a note AND an
              // experience AND a fact all mentioning "Jake"), ask about them
              // once, not once per signal. Sibling pending rows are still
              // created below; answering the one card resolves them together via
              // the sweep in the resolution handler.
              const askedNames = new Set();
              const askOnce = (rawName) => {
                const k = _normName(rawName);
                if (askedNames.has(k)) return false;
                askedNames.add(k);
                return true;
              };
              for (const o of cap.outcomes) {
                if (o.status === "captured") {
                  const text = _captureAnnounceText(o);
                  if (text) capturedTexts.push(text);
                  // A FACT ABOUT THE OWNER IS ABOUT YOU, NOT ABOUT "SOMEONE".
                  //
                  // self_fact carries no contact by definition -- fact-capture
                  // strips "self" before contact lookup, correctly. But the card
                  // falls back to the literal string "Someone" when it has
                  // neither a name nor participants, so "I'm really focusing on
                  // Amber" rendered as a mystery person the user never mentioned,
                  // sitting between two real contacts. Naming it is the whole fix;
                  // the row itself was right.
                  const isSelf = o.route === "self_fact";
                  capturedOutcomes.push({
                    route: o.route,
                    contactId: o.contactId ?? null,
                    factId: o.factId ?? null,
                    contentId: o.contentId ?? null,
                    nameKey: o.resolvedName ? _normName(o.resolvedName) : null,
                    name: o.resolvedName ?? (isSelf ? "You" : null),
                    isSelf,
                    participantNames: o.participantNames ?? null,
                    // Sent so the client can drop these people from the flat
                    // list below: a person confirmed as LOGGED does not also need
                    // a suggestion card two rows down saying they are "in your
                    // contacts". That is what made one note show Sagar twice.
                    participantIds: (o.participantIds ?? []).map(String),
                    text: o.text ?? null,
                  });
                  continue;
                }
                // NOTE: do not break on clientGone here. The pending row MUST be
                // written whether or not the socket is still open, so the
                // confirmation card is waiting on the Today feed even when the
                // reply was slow or the overlay was closed. Only the live SSE
                // events below are gated on the client still being connected.

                if (o.route === "note" || o.route === "experience") {
                  // Participant resolution for an already-written note/experience row.
                  const question = o.status === "soft_confirm"
                    ? `For that note about ${o.rawName}, you mean ${o.guessedName}, right?`
                    : `Who did you mean by ${o.rawName}?`;
                  const candidatesPayload = o.status === "soft_confirm"
                    ? JSON.stringify({
                        contentType: o.contentType,
                        contentId: o.contentId,
                        guessedId: o.guessedId,
                        guessedName: o.guessedName,
                        remainingCandidates: (o.candidates ?? []).filter(
                          (c) => String(c.id) !== String(o.guessedId),
                        ),
                      })
                    : JSON.stringify({
                        contentType: o.contentType,
                        contentId: o.contentId,
                        names: o.candidates ?? [],
                      });
                  const pendingId = await setPendingFactContext({
                    ownerId: amberId,
                    awaiting: o.status === "soft_confirm" ? "soft_confirm" : "which_participant",
                    factId: null,
                    rawName: o.rawName,
                    questionAsked: question,
                    candidates: candidatesPayload,
                    reaskCount: 0,
                    contentType: o.contentType,
                    contentId: o.contentId,
                  });
                  if (!clientGone && askOnce(o.rawName)) {
                    if (o.status === "soft_confirm") {
                      writeEvent("soft_confirm", { question, contact: { id: o.guessedId, name: o.guessedName }, pendingId });
                    } else {
                      writeEvent("clarify", { question, candidates: o.candidates ?? [], pendingId });
                    }
                  }
                } else {
                  // fact / contact_field resolution — one pending row per outcome, pendingId echoed.
                  if (o.status === "ambiguous") {
                    // noMatch = the person matched NO existing contact. The card's
                    // only options are "add as new" / "skip", so the copy must ask
                    // who they are, not imply a list of same-named contacts exists.
                    const question = o.noMatch
                      ? `Who is ${o.rawName}? Add them as a new contact?`
                      : `I found a few contacts named ${o.rawName}. Which one did you mean?`;
                    const candidatesPayload = o.kind === "field"
                      ? JSON.stringify({ field: o.field, value: o.value, names: o.candidates ?? [] })
                      : JSON.stringify(o.candidates ?? []);
                    const pendingId = await setPendingFactContext({
                      ownerId: amberId,
                      awaiting: o.kind === "field" ? "which_contact_field" : "which_contact",
                      factId: o.factId,
                      rawName: o.rawName,
                      questionAsked: question,
                      candidates: candidatesPayload,
                      reaskCount: 0,
                      contentType: "fact",
                      contentId: o.factId ?? null,
                    });
                    if (!clientGone && askOnce(o.rawName)) {
                      writeEvent("clarify", { question, candidates: o.candidates ?? [], pendingId });
                    }
                  } else if (o.status === "soft_confirm") {
                    const question = `You mean ${o.guessedName}, right?`;
                    const candidatesPayload = JSON.stringify({
                      guessedId: o.guessedId,
                      guessedName: o.guessedName,
                      kind: o.kind,
                      field: o.field,
                      value: o.value,
                      remainingCandidates: (o.candidates ?? []).filter(
                        (c) => String(c.id) !== String(o.guessedId),
                      ),
                    });
                    const pendingId = await setPendingFactContext({
                      ownerId: amberId,
                      awaiting: "soft_confirm",
                      factId: o.factId,
                      rawName: o.rawName,
                      questionAsked: question,
                      candidates: candidatesPayload,
                      reaskCount: 0,
                      contentType: "fact",
                      contentId: o.factId ?? null,
                    });
                    if (!clientGone && askOnce(o.rawName)) {
                      writeEvent("soft_confirm", { question, contact: { id: o.guessedId, name: o.guessedName }, pendingId });
                    }
                  }
                  // Zero-match facts now arrive here as status:"ambiguous" with
                  // noMatch=true (a "who is X? / add new" card), so they are no
                  // longer silently dropped. No other status reaches this else.
                }
              }
              // Tell the client exactly what got logged and to whom, so it can
              // show a confirmation card per person with a checkmark. Only the
              // cleanly-captured ones (ambiguous/pending become clarify cards).
              // ── ONE PERSON, ONE CARD ─────────────────────────────────────
              //
              // "Shirley Park BTG USC are all good people" produced two signals
              // about the SAME contact, and both were right:
              //
              //   FACT_CONTACT_FACT contact=b474121a category=personality
              //   FACT_CONTACT_FACT contact=b474121a category=who
              //
              // Two facts, one person -- "she is a good person" and "she is at
              // BTG USC". The rows are correct and both should exist. What was
              // wrong is that this list carried one entry per SIGNAL, so the
              // turn rendered Shirley twice, in a row, as if the app had lost
              // count of her. The user saw exactly that: "it showed some contact
              // cards twice. It showed Shirley's twice and mine twice."
              //
              // So the card list is keyed by WHO, not by what was written. Facts
              // about the same contact collapse into one card carrying both
              // lines; self-facts collapse together as "You"; a note or
              // experience with several participants keeps its own card, since it
              // is one event rather than a person.
              const collapsed = collapseCapturedByPerson(capturedOutcomes);
              if (!clientGone && collapsed.length > 0) {
                writeEvent("captured", { captured: collapsed });
              }

              // Persist the announce row so the client sees it on re-render after
              // "complete" fires. Do NOT emit a token event — the LLM has already
              // streamed its own response, and a second token event would duplicate
              // the announce text (token during stream + DB row on re-render = twice).
              if (capturedTexts.length > 0) {
                const announceText = capturedTexts.join(" ");
                await appendMessage(amberId, {
                  conversationId,
                  role: "assistant",
                  content: announceText,
                  intent: "chat",
                  metadata: { model, capturedOutcomes: collapseCapturedByPerson(capturedOutcomes) },
                }).catch(() => null);
              }
            }
          } catch (err) {
            // Fact capture is best-effort and must never break the response --
            // but a BARE catch here meant a capture that threw was
            // indistinguishable from one that found nothing to save, which is
            // precisely why "it said Noted and saved nothing" was unexplainable.
            request.log?.warn?.(
              { err: err?.message, stack: err?.stack },
              "[chat] fact capture threw after the reply",
            );
          }
        }

        // (Suggestions were computed and emitted above, before persisting.)

        if (pendingReaskText && !clientGone) {
          writeEvent("token", { text: " " + pendingReaskText });
        }

        // Every promised part is finished by definition once the turn is: tick
        // whatever never ticked itself, so the bar always reaches the end.
        closeOutStages();
        if (!clientGone) {
          writeEvent("complete", {
            conversationId,
            intent,
            tookMs: Date.now() - started,
          });
        }
      } catch (err) {
        if (err?.message !== "client_disconnected") {
          request.log?.error?.({ err }, "[chat] failed");
          writeEvent("error", { error: "chat_failed", message: err.message });
        }
      } finally {
        clearTimeout(hardTimer);
        clearInterval(heartbeat);
        for (const t of waitNotes) clearTimeout(t);
        raw.off("close", onClose);
        raw.off("error", onClose);
        if (!raw.writableEnded) raw.end();
      }
    },
  );

  // ── POST /v1/chat/resolve ───────────────────────────────────────────────────
  // Resolves one pending clarification item by id without a chat turn.
  // Returns plain JSON (no SSE). Auth + owner scope identical to /v1/chat.
  // Security: getPendingFactContextById scopes WHERE id=$1 AND owner_id=$2, so
  // a caller can only ever fetch or resolve their own pending rows — wrong owner
  // gets 404 before any write occurs.
  app.post(
    "/v1/chat/resolve",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["pendingId"],
          properties: {
            pendingId: { type: ["integer", "string"] },
            contactId: { type: "string" },
            decision: { type: "string", enum: ["yes", "no", "other"] },
            // Full details for "add this person", so a contact created from a
            // spoken name is not left as a bare name with nothing on it. Every
            // field optional; only fullName is used if that is all there is.
            newContact: {
              type: "object",
              properties: {
                fullName: { type: "string" },
                phone: { type: "string" },
                email: { type: "string" },
                company: { type: "string" },
                title: { type: "string" },
                city: { type: "string" },
              },
              additionalProperties: false,
            },
            // The thread the confirmation was answered in, when the caller has
            // one. Optional: a pending row knows which NOTE it belongs to, not
            // which conversation, so a card answered from the Today feed has no
            // thread to name. Supplying it lets the fix reach the TRANSCRIPT the
            // user is looking at, not just the derived note.
            conversationId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      // Auth + owner scope — identical to /v1/chat.
      const did = requirePrivyDid(request, reply);
      if (!did) return;
      const phone = request.privyUser?.phone;
      const amberId = phone ? await resolveAmberIdByPhone(phone).catch(() => null) : null;
      if (!amberId) return reply.code(401).send({ error: "no_amber", message: "Auth required" });

      const body = request.body || {};
      const pendingId = body.pendingId != null ? Number(body.pendingId) : null;
      if (!pendingId) return reply.code(400).send({ error: "bad_pending_id" });
      // WAS UNDECLARED, AND EVERY TAP ON A "WHO DID YOU MEAN" CARD 500ED.
      //
      // Three call sites below pass `conversationId` to resolvePendingItem. In an
      // ESM module that is a ReferenceError, not undefined, so the handler threw
      // before it could clear the pending row — which is why answering the card
      // appeared to do nothing and the same question came back on every launch,
      // and why picking "Add \"Sam\"" created the contact (that happens first) and
      // then returned a 500 with no id for the app to open.
      //
      // Optional by design: resolvePendingItem already defaults it to null.
      const conversationId =
        typeof body.conversationId === "string" && body.conversationId.trim()
          ? body.conversationId.trim()
          : null;

      const pending = await getPendingFactContextById(pendingId, amberId).catch(() => null);
      // ALREADY ANSWERED IS NOT AN ERROR.
      //
      // The same question is deliberately shown on the Today feed and in the
      // chat -- one queue, two surfaces -- and the surface the user did not use
      // still has the card on screen until it refetches. Tapping that stale card
      // 404ed, so the app said "Could not save that. Try again," for a question
      // that had just been answered correctly, and the user retried something
      // that had already worked.
      //
      // The row being gone means the intent is satisfied. Say so, and let the
      // client drop the card.
      if (!pending) {
        return reply.send({ ok: true, resolved: true, pendingId, alreadyResolved: true });
      }

      // a0. Sentinels from the resolution UI.
      const rawContactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
      if (rawContactId === "__skip__") {
        // Clear this row AND every sibling for the same name, so dismissing a
        // merged card never leaves an orphan row that pops back on the feed.
        await clearPendingFactContextById(pending.id, amberId).catch(() => null);
        for (const sib of await siblingPendingRows(amberId, pending)) {
          await clearPendingFactContextById(sib.id, amberId).catch(() => null);
        }
        return reply.send({ ok: true, resolved: false, pendingId, skipped: true });
      }
      // Apply the SAME choice to every other pending row for the same name, so a
      // person mentioned as both a participant and a fact in one note gets tagged
      // everywhere from a single tap — not just on the card you pressed.
      const _sweep = async (resolvedId, resolvedName) => {
        for (const sib of await siblingPendingRows(amberId, pending)) {
          await resolvePendingItem({
            ownerId: amberId, pending: sib, resolvedId, resolvedName, conversationId,
          }).catch(() => null);
        }
      };

      if (rawContactId === "__new__") {
        // WHAT THE USER TYPED WINS OVER WHAT WAS HEARD. "Add Sam" used to create a
        // contact whose entire content was the transcript's spelling of a first
        // name — no surname, no number, nothing to reach them by — and left the
        // user to go and fill it in later, which nobody does. The form now collects
        // the details up front and they are applied at creation.
        const nc = body.newContact && typeof body.newContact === "object" ? body.newContact : {};
        const _clean = (v, max = 200) =>
          typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
        const fullName = _clean(nc.fullName, 120) ?? pending.raw_name;
        const created = await createContactForOwner({
          ownerId: amberId, ownerPhone: phone ?? null,
          fullName,
          phonePrimary: _clean(nc.phone, 40),
          source: "amber_note",
        }).catch(() => null);
        if (!created?.id) return reply.code(500).send({ error: "create_failed" });
        const resolvedId = String(created.id);
        // The rest of the form, best-effort: a field that fails to write must not
        // cost the user the contact they just created.
        const extra = {};
        for (const k of ["email", "company", "title", "city"]) {
          const v = _clean(nc[k]);
          if (v) extra[k] = v;
        }
        if (Object.keys(extra).length > 0) {
          await updateContactFields({ ownerId: amberId, contactId: resolvedId, ...extra }).catch(
            () => null,
          );
        }
        const { confirmText } = await resolvePendingItem({
          ownerId: amberId, pending, resolvedId, resolvedName: fullName, conversationId,
        });
        await _sweep(resolvedId, fullName);
        // TWO DIFFERENT LESSONS, and they were being confused for one.
        //
        // recordVoiceVocab writes the "use these exact spellings" bias list handed
        // to Whisper. Passing pending.raw_name into it taught the transcriber the
        // MISHEARING — say "Ajay", get "AJ", correct it, and the next transcription
        // was biased toward "AJ" harder than before.
        //
        // recordVoiceCorrection is the other half: a heard→intended pair, applied
        // deterministically to future transcripts. It was never called from here at
        // all, which is why the loop never closed.
        void recordVoiceVocab(amberId, [fullName], resolvedId).catch(() => {});
        if (pending.raw_name && _normName(pending.raw_name) !== _normName(fullName)) {
          void recordVoiceCorrection(amberId, pending.raw_name, fullName).catch(() => {});
        }
        return reply.send({ ok: true, resolved: true, pendingId, confirmText, createdContactId: resolvedId });
      }

      // a. Direct resolve — card tap or explicit contactId (any awaiting type).
      if (rawContactId) {
        const resolvedId = rawContactId;
        // FALL BACK TO THE CONTACT ITSELF WHEN THE NAME IS NOT IN THE BLOB.
        //
        // "Choose another contact" sends an id from a typeahead over the whole
        // address book, which is by definition NOT one of the pending row's stored
        // candidates — so this returned null, and null then silently disabled every
        // downstream step: no text rewrite (correctNameInContent bails on an empty
        // toName), no dictionary pair, and a confirmation that quoted the misheard
        // name back at the user. That path exists precisely for the names the
        // transcriber gets wrong, so it was broken exactly where it was needed.
        const resolvedName =
          _lookupNameInPendingMeta(pending, resolvedId) ??
          (await contactNameById(amberId, resolvedId).catch(() => null));
        const { confirmText } = await resolvePendingItem({ ownerId: amberId, pending, resolvedId, resolvedName, conversationId });
        await _sweep(resolvedId, resolvedName);
        // Learn the CANONICAL spelling you picked so future transcriptions bias to
        // it (you just told us "that spoken name means this person, spelled this way").
        if (resolvedName) {
          void recordVoiceVocab(amberId, [resolvedName], resolvedId).catch(() => {});
          // The same pair on the ordinary "you meant this person" path, which is
          // where nearly every correction actually happens.
          if (pending.raw_name && _normName(pending.raw_name) !== _normName(resolvedName)) {
            void recordVoiceCorrection(amberId, pending.raw_name, resolvedName).catch(() => {});
          }
        }
        return reply.send({ ok: true, resolved: true, pendingId, confirmText });
      }

      // b. decision: "yes" — resolve to the guessed contact from soft_confirm meta.
      if (body.decision === "yes") {
        let meta = null;
        try { meta = JSON.parse(pending.candidates ?? "null"); } catch { /* ignore */ }
        const resolvedId = meta?.guessedId ?? null;
        if (!resolvedId) return reply.code(409).send({ error: "no_guess" });
        const { confirmText } = await resolvePendingItem({
          ownerId: amberId, pending,
          resolvedId, resolvedName: meta?.guessedName ?? null, conversationId,
        });
        await _sweep(resolvedId, meta?.guessedName ?? null);
        return reply.send({ ok: true, resolved: true, pendingId, confirmText });
      }

      // c. decision: "no" — downgrade soft_confirm to full clarify (chat NO branch).
      if (body.decision === "no") {
        // "No" answers the QUESTION, not just this card: every sibling row for
        // the same name was about to ask the identical yes/no, so all of them
        // downgrade to the candidate list together.
        const remaining = (await downgradeSoftConfirmRow(amberId, pending)) ?? [];
        for (const sib of await siblingPendingRows(amberId, pending)) {
          await downgradeSoftConfirmRow(amberId, sib);
        }
        return reply.send({
          ok: true, resolved: false, pendingId,
          clarify: { question: "Which one did you mean?", candidates: remaining },
        });
      }

      // d. decision: "other" — reask bump / give-up at >= 3 (chat OTHER branch).
      if (body.decision === "other") {
        // Same reasoning as "no": the sibling rows are asking the same question,
        // so they age out on the same clock instead of outliving the card the
        // user actually dismissed.
        const { gaveUp } = await bumpReaskRow(amberId, pending);
        for (const sib of await siblingPendingRows(amberId, pending)) {
          await bumpReaskRow(amberId, sib);
        }
        return gaveUp
          ? reply.send({ ok: true, resolved: false, pendingId, gaveUp: true })
          : reply.send({ ok: true, resolved: false, pendingId, reasked: true });
      }

      // e. No contactId and no valid decision.
      return reply.code(400).send({ error: "no_action" });
    },
  );

  // ── GET /v1/me/pending-resolutions ──────────────────────────────────────────
  // Open "who did you mean" items for the caller, normalized so the app can
  // render PERSISTENT confirmation cards on the feed. This is what makes
  // reconciliation reliable: a note recorded then abandoned leaves its pending
  // rows here, and they wait on the feed until confirmed — no dependence on the
  // live SSE stream. Resolving goes through POST /v1/chat/resolve.
  app.get(
    "/v1/me/pending-resolutions",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = requirePrivyDid(request, reply);
      if (!did) return;
      const phone = request.privyUser?.phone;
      const amberId = phone ? await resolveAmberIdByPhone(phone).catch(() => null) : null;
      if (!amberId) return { pending: [] };
      const rows = await listPendingFactContext(amberId).catch(() => []);
      // Contacts loaded once so each card's candidates are re-resolved with the
      // CURRENT matcher. Rows written before a matcher fix keep their old (often
      // junk) candidate list frozen in JSON; recomputing here means every card
      // shows a clean, correct list regardless of when the row was created.
      const freshContacts = await getContactsForResolution(amberId).catch(() => []);
      const normCand = (c) => {
        if (!c || typeof c !== "object") return null;
        const id = c.id != null ? String(c.id) : null;
        if (!id || id === "__new__" || id === "__skip__") return null;
        return { id, name: c.name ?? c.full_name ?? "" };
      };
      const _key = (s) => (s || "").toLowerCase().trim();

      // Group by spoken name so ONE card covers a person even when a single
      // ramble produced several pending rows (an event participant AND a field
      // update both name "Lizzy"). Resolving one sweeps the siblings server-side,
      // so a single card and a single tap settle the whole name.
      const groups = new Map();
      for (const p of rows) {
        let meta = null;
        try { meta = JSON.parse(p.candidates ?? "null"); } catch { /* ignore */ }
        const rawName = p.raw_name ?? "someone";
        const key = _key(rawName);
        let g = groups.get(key);
        if (!g) {
          g = { rawName, pendingId: p.id, guess: null, question: null, cands: new Map() };
          groups.set(key, g);
        }
        if (p.awaiting === "soft_confirm") {
          const guessId = meta?.guessedId != null ? String(meta.guessedId) : null;
          if (guessId && !g.guess) {
            g.guess = { id: guessId, name: meta?.guessedName ?? "" };
            g.pendingId = p.id; // prefer the soft row as representative
            g.question = p.question_asked || g.question;
          }
          for (const c of (Array.isArray(meta?.remainingCandidates) ? meta.remainingCandidates : []).map(normCand).filter(Boolean)) {
            if (!g.cands.has(c.id)) g.cands.set(c.id, c);
          }
        } else {
          const list = Array.isArray(meta) ? meta : (meta?.names ?? []);
          for (const c of list.map(normCand).filter(Boolean)) {
            if (!g.cands.has(c.id)) g.cands.set(c.id, c);
          }
          if (!g.question) g.question = p.question_asked;
        }
      }

      // ONE ROUND TRIP FOR ALL OF THEM, NOT ONE EACH.
      //
      // The judge is a model call with an 8s timeout. Awaiting it inside the loop
      // made this polled endpoint take (number of unresolved names x latency) —
      // five open cards was a 5-40s feed load, and the app polls it. The groups
      // are independent, so they judge concurrently and the endpoint costs one
      // judge latency no matter how many names are open.
      const pending = (
        await Promise.all(
          [...groups.values()].map(async (g) => {
            // Two-stage matching: a high-recall algorithmic pool, then the Claude
            // phonetic judge prunes and ranks it to the true cross-accent
            // sound-alikes (generalizes to cultural names/spellings without
            // hardcoded rules). Fail-open: if the judge can't run, we keep the
            // algorithmic pool.
            const pool = phoneticPool(g.rawName, freshContacts, 25);
            let real;
            if (pool.length >= 2) {
              const ids = await judgeNameMatches({ spoken: g.rawName, candidates: pool }).catch(
                () => pool.map((c) => String(c.id)),
              );
              const byId = new Map(pool.map((p) => [p.id, p]));
              real = ids.map((id) => byId.get(id)).filter(Boolean);
              // Judge pruned everything (or hiccuped to empty) but the pool had
              // close matches — keep the closest few rather than showing none.
              if (real.length === 0) real = pool.slice(0, 3);
            } else {
              real = pool;
            }
            // Fall back to the stored candidates only if the pool was empty entirely.
            if (real.length === 0) real = [...g.cands.values()];
            // Drop the soft guess from the alternatives so it isn't listed twice.
            if (g.guess) real = real.filter((c) => String(c.id) !== String(g.guess.id));
            real = real.slice(0, 8);
            // Every card is escapable: real matches, then "add new", then "not now".
            const candidates = [
              ...real,
              { id: "__new__", name: g.rawName },
              { id: "__skip__", name: g.rawName },
            ];
            return {
              pendingId: g.pendingId,
              kind: g.guess ? "soft" : "clarify",
              rawName: g.rawName,
              question:
                g.question ||
                (g.guess
                  ? `Is ${g.rawName} ${g.guess.name}?`
                  : `Who did you mean by ${g.rawName}?`),
              guess: g.guess,
              candidates,
            };
          }),
        )
      ).filter(Boolean);
      return { pending };
    },
  );
}
