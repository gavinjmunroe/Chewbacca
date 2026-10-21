/**
 * Event memory helpers for the Rave Master surface (and any future
 * event-scoped workflow). Pure functions, no I/O — they are imported by
 * src/routes/events.js and tested in src/lib/events.test.js.
 *
 * Event model (v1, Sagar-only EDC 2026):
 *
 *   event_id = "event:<owner_did>:<slug>:<year>"
 *
 * The event card is a single Firestore doc keyed by event_id; event items
 * (classified messages, drafts, group memories) live in an append-only log
 * collection. visibility is locked to "private" — a non-private value is
 * rejected at the API boundary.
 *
 * Substance guardrail (see /home/user/workspace/amber_rave_master_build_brief.md):
 *
 *   - Procurement / distribution / dosing / hiding / use-logistics requests
 *     are blocked outright.
 *   - Harm-reduction (hydration, buddy checks, ride home, emergency contact,
 *     consent, "tell the host", "do not answer the door") is allowed and
 *     gets tagged `safety_status: "safety_context"` so downstream callers
 *     can route it to the safety layer instead of generic logistics.
 */

import crypto from "node:crypto";

export const EVENT_VISIBILITIES = Object.freeze(["private"]);

/**
 * Personal-event lifecycle. Defaults to "planning" until the owner
 * explicitly flips. Used by /v1/me/events when `status` is patched.
 */
export const EVENT_STATUSES = Object.freeze([
  "planning",
  "confirmed",
  "completed",
  "cancelled",
]);

/**
 * Task lifecycle. Kept tiny on purpose — adding states (in_progress,
 * deferred, etc.) compounds across the agent tools and the dashboard, so
 * keep this list short until a real need lands.
 */
export const EVENT_TASK_STATUSES = Object.freeze(["open", "done", "blocked"]);

/**
 * The structured event-card shape. Free-form fields are stored as strings;
 * ledgers / lists are arrays of small objects. Producers are expected to
 * keep individual fields small — the card is meant to fit in one prompt.
 *
 * Personal-planning fields (description, start_date, end_date, location,
 * status, attendees, host_did) coexist with the Rave Master logistics
 * fields. A given card uses whichever subset matches its kind — the
 * Sagar EDC card uses the ledgers; the Rytual retreat card uses
 * description + dates + attendees + tasks (via the items subcollection).
 */
export const EVENT_CARD_FIELDS = Object.freeze([
  "event_id",
  "owner_did",
  "title",
  "year",
  "slug",
  "visibility",
  // Personal-planning fields
  "description",
  "start_date",
  "end_date",
  "location",
  "status",
  "attendees",
  "host_did",
  "task_count",
  "task_open_count",
  // Rave Master logistics fields
  "source_chats",
  "latest_plan",
  "next_meetup",
  "ticket_ledger",
  "payment_ledger",
  "transport_plan",
  "lodging_plan",
  "supply_list",
  "safety_status",
  "open_loops",
  "last_scanned_at",
  "created_at",
  "updated_at",
]);

export const EVENT_ITEM_KINDS = Object.freeze([
  "scan_extraction", // a classified message slot
  "group_memory", // group-scoped consolidated note
  "draft_update", // a group/personal update draft awaiting approval
  "approval_request", // direct iMessage to Sagar asking for sign-off
  "friend_reply", // record of a reply to a trusted friend
  "safety_context", // harm-reduction note (no procurement!)
  "plan_snapshot", // a captured "latest_plan" for retrieval history
  "task_audit", // append-only audit for personal-event task changes
]);

/**
 * Slugify a title to a short lower-kebab form suitable for the event id.
 * Strips accents, collapses non-alphanumerics, caps at 32 chars. We avoid
 * the `unorm` / Intl normalize dance to keep the lib dependency-free; the
 * inputs are short human-typed titles.
 */
export function slugifyTitle(title) {
  if (typeof title !== "string") return "";
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/**
 * Build the canonical event_id. We deliberately keep DIDs in the id even
 * though it makes the string long — it means an event_id is globally
 * unique without a registry lookup, and a leaked id can never be confused
 * for another tenant's event.
 */
export function buildEventId({ ownerDid, title, year, slug }) {
  if (!ownerDid || typeof ownerDid !== "string") {
    throw new Error("ownerDid required to build event_id");
  }
  const useSlug =
    slug && typeof slug === "string" && slug.length
      ? slugifyTitle(slug)
      : slugifyTitle(title || "");
  if (!useSlug) throw new Error("title or slug required to build event_id");
  const useYear = Number.isInteger(year) ? year : new Date().getUTCFullYear();
  return `event:${ownerDid}:${useSlug}:${useYear}`;
}

/**
 * Parse an event_id back into its components. Returns null if the shape
 * does not match — callers can use this to validate caller-supplied ids.
 *
 * The DID itself contains colons (e.g. "did:privy:abc"), so we split from
 * the right: the last segment is the year, the second-to-last is the slug,
 * and everything between the leading "event:" and that pair is the DID.
 */
export function parseEventId(eventId) {
  if (typeof eventId !== "string" || !eventId.startsWith("event:")) return null;
  const tail = eventId.slice("event:".length);
  const lastColon = tail.lastIndexOf(":");
  if (lastColon < 0) return null;
  const yearStr = tail.slice(lastColon + 1);
  const year = parseInt(yearStr, 10);
  if (!Number.isInteger(year) || year < 1970 || year > 9999) return null;
  const head = tail.slice(0, lastColon);
  const slugColon = head.lastIndexOf(":");
  if (slugColon < 0) return null;
  const slug = head.slice(slugColon + 1);
  const ownerDid = head.slice(0, slugColon);
  if (!slug || !ownerDid) return null;
  return { ownerDid, slug, year };
}

/**
 * Validate visibility — v1 only accepts "private". Any other value is a
 * caller bug and we 400 rather than silently downgrade.
 */
export function assertPrivateVisibility(visibility) {
  if (visibility === undefined || visibility === null) return "private";
  if (visibility !== "private") {
    const err = new Error(
      `visibility must be "private" in v1 — got ${JSON.stringify(visibility)}`,
    );
    err.statusCode = 400;
    err.code = "visibility_unsupported";
    throw err;
  }
  return "private";
}

/**
 * Substance-procurement guardrail. Returns one of:
 *
 *   { decision: "allow" }
 *   { decision: "safety_context", reason }   — harm-reduction language
 *   { decision: "block", reason, code }      — procurement / distribution
 *
 * We deliberately err on the side of routing borderline content into
 * `safety_context` (which is stored but flagged) rather than blocking
 * outright. Block fires only when the text explicitly asks for or
 * coordinates obtaining/dosing/hiding controlled substances.
 *
 * This is a lexical check — not a model. It exists so the surface has a
 * non-bypassable boundary even if amber-imessage forgets to classify. The
 * caller (amber-imessage) is expected to also run its own classifier.
 */
const PROCUREMENT_VERBS = [
  "buy",
  "score",
  "pick up",
  "pickup",
  "cop",
  "get me",
  "grab",
  "snag",
  "deliver",
  "drop off",
  "front",
  "dealer",
  "plug",
  "hook up",
  "sell",
];

const SUBSTANCE_TERMS = [
  "molly",
  "mdma",
  "ecstasy",
  "coke",
  "cocaine",
  "ket",
  "ketamine",
  "acid",
  "lsd",
  "shrooms",
  "mushrooms",
  "weed",
  "kush",
  "xan",
  "xanax",
  "perc",
  "percocet",
  "addy",
  "adderall",
  "meth",
  "heroin",
  "fent",
  "fentanyl",
];

const DOSING_TERMS = [
  "redose",
  "re-dose",
  "double drop",
  "boof",
  "line of",
  "key of",
  "cap of",
  "tab of",
];

const HARM_REDUCTION_TERMS = [
  "hydrate",
  "hydration",
  "buddy check",
  "check on",
  "check-in",
  "ride home",
  "ride-home",
  "uber home",
  "emergency contact",
  "find me",
  "where are you",
  "consent",
  "test kit",
  "test strip",
  "fentanyl test",
  "naloxone",
  "narcan",
  "tell the host",
  "do not answer",
  "don't answer",
];

/**
 * Match a list of terms with word-boundary awareness so "ket" doesn't
 * fire on "ticket" and "addy" doesn't fire on "daddy". Multi-word terms
 * (e.g. "ride home") are matched as plain substrings since they already
 * contain spaces.
 */
function containsAny(text, terms) {
  return terms.some((t) => {
    if (t.includes(" ") || t.includes("-")) return text.includes(t);
    const re = new RegExp(`(?:^|[^a-z0-9])${t}(?:[^a-z0-9]|$)`, "i");
    return re.test(text);
  });
}

export function classifySubstanceRisk(text) {
  if (typeof text !== "string" || text.length === 0) {
    return { decision: "allow" };
  }
  const lower = text.toLowerCase();
  const substance = containsAny(lower, SUBSTANCE_TERMS);
  const procurement = containsAny(lower, PROCUREMENT_VERBS);
  const dosing = containsAny(lower, DOSING_TERMS);
  const harmReduction = containsAny(lower, HARM_REDUCTION_TERMS);

  if (substance && (procurement || dosing)) {
    return {
      decision: "block",
      code: "substance_procurement_blocked",
      reason:
        "request appears to coordinate procurement, distribution, or dosing of controlled substances; safety/harm-reduction framing is supported instead",
    };
  }
  if (substance || harmReduction) {
    return {
      decision: "safety_context",
      reason:
        "substance-adjacent or harm-reduction content — stored as safety context only",
    };
  }
  return { decision: "allow" };
}

/**
 * Build a stable dedupe key for an event item. Mirrors the imessage helper
 * pattern: caller-supplied id wins, else hash the message id, else hash
 * the kind+text+occurred_at.
 */
export function deriveEventItemKey(item) {
  if (item && typeof item.id === "string" && item.id.trim()) {
    return item.id.trim().slice(0, 64);
  }
  if (item && typeof item.message_id === "string" && item.message_id.trim()) {
    return crypto
      .createHash("sha256")
      .update(`msg|${item.message_id}|${item.kind || ""}`)
      .digest("hex")
      .slice(0, 32);
  }
  const base = [
    item?.kind || "unknown",
    item?.occurred_at || "",
    (item?.text || item?.summary || "").slice(0, 256),
  ].join("|");
  return crypto.createHash("sha256").update(base).digest("hex").slice(0, 32);
}

/**
 * Normalize a card patch — drop unknown keys, force visibility=private,
 * stamp updated_at. Used by POST /v1/me/events and PATCH endpoints.
 */
export function normalizeCardPatch(input, { ownerDid } = {}) {
  const out = {};
  const src = input && typeof input === "object" ? input : {};
  for (const key of EVENT_CARD_FIELDS) {
    if (key in src) out[key] = src[key];
  }
  out.visibility = assertPrivateVisibility(out.visibility);
  if (ownerDid) out.owner_did = ownerDid;
  out.updated_at = new Date().toISOString();
  return out;
}

/**
 * Validate an event item shape before write. Returns an array of error
 * strings — empty array means valid.
 */
export function validateEventItem(item) {
  const errs = [];
  if (!item || typeof item !== "object") {
    errs.push("item must be an object");
    return errs;
  }
  if (typeof item.kind !== "string" || !EVENT_ITEM_KINDS.includes(item.kind)) {
    errs.push(`kind must be one of [${EVENT_ITEM_KINDS.join(", ")}]`);
  }
  const text = item.text || item.summary || "";
  if (typeof text !== "string" || text.length === 0) {
    errs.push("text or summary required");
  }
  if (text && text.length > 8000) {
    errs.push("text too long (max 8000 chars)");
  }
  return errs;
}

// ── Personal-planning task primitives ───────────────────────────────────────
//
// Tasks are sibling docs to the event card, stored under
//   agent_data/{tenantDid}/event_tasks/{task_id}
// and joined to their parent event via the embedded event_id field. Each
// write also appends a `task_audit` row to agent_log for transcript
// continuity. Task ids look like:
//
//   task:<event_id>:<order>:<slug>
//
// where event_id is the full event:<did>:<slug>:<year> string and `order`
// is a zero-padded 3-digit ordinal (000-999). The ordinal keeps a
// natural sort across the list while the slug keeps the id readable.

export const MAX_TASKS_PER_EVENT = 200;

/**
 * Build a task id from its parent event_id and a 1-based ordinal. The
 * slug is derived from the title and capped so caller-typed titles never
 * blow past Firestore's 1500-byte document id limit.
 */
export function buildTaskId({ eventId, order, title }) {
  if (typeof eventId !== "string" || !eventId.startsWith("event:")) {
    throw new Error("eventId required to build task id");
  }
  const ord = Number.isInteger(order) ? order : 0;
  if (ord < 0 || ord > 999) {
    throw new Error("task order must be 0..999");
  }
  const slug = slugifyTitle(title || "").slice(0, 32) || "task";
  return `task:${eventId}:${String(ord).padStart(3, "0")}:${slug}`;
}

/**
 * Parse a task id back into { eventId, order, slug }. Returns null for
 * malformed input. Mirrors parseEventId: the embedded event_id itself
 * contains colons, so we split from the right.
 */
export function parseTaskId(taskId) {
  if (typeof taskId !== "string" || !taskId.startsWith("task:")) return null;
  const tail = taskId.slice("task:".length);
  // tail looks like "event:<did>:<slug>:<year>:<order>:<task-slug>"
  const lastColon = tail.lastIndexOf(":");
  if (lastColon < 0) return null;
  const slug = tail.slice(lastColon + 1);
  const head = tail.slice(0, lastColon);
  const orderColon = head.lastIndexOf(":");
  if (orderColon < 0) return null;
  const orderStr = head.slice(orderColon + 1);
  const order = parseInt(orderStr, 10);
  if (!Number.isInteger(order) || order < 0 || order > 999) return null;
  const eventId = head.slice(0, orderColon);
  if (!eventId.startsWith("event:") || !slug) return null;
  return { eventId, order, slug };
}

/**
 * Validate a task payload before write. Returns an array of error strings
 * — empty array means valid. Caller decides which path to write (create
 * vs patch); both go through this gate so the shape stays consistent.
 */
export function validateEventTask(task, { requireTitle = true } = {}) {
  const errs = [];
  if (!task || typeof task !== "object") {
    errs.push("task must be an object");
    return errs;
  }
  if (requireTitle) {
    if (typeof task.title !== "string" || !task.title.trim()) {
      errs.push("title is required");
    } else if (task.title.length > 500) {
      errs.push("title too long (max 500 chars)");
    }
  } else if (
    task.title !== undefined &&
    (typeof task.title !== "string" || task.title.length > 500)
  ) {
    errs.push("title must be a string (max 500 chars)");
  }
  if (task.status !== undefined && !EVENT_TASK_STATUSES.includes(task.status)) {
    errs.push(`status must be one of [${EVENT_TASK_STATUSES.join(", ")}]`);
  }
  if (task.notes !== undefined) {
    if (typeof task.notes !== "string") errs.push("notes must be a string");
    else if (task.notes.length > 4000)
      errs.push("notes too long (max 4000 chars)");
  }
  if (task.assigned_to !== undefined && task.assigned_to !== null) {
    if (typeof task.assigned_to !== "string" || task.assigned_to.length > 200) {
      errs.push("assigned_to must be a short string");
    }
  }
  if (task.due_date !== undefined && task.due_date !== null) {
    if (typeof task.due_date !== "string" || task.due_date.length > 64) {
      errs.push("due_date must be an ISO date string");
    }
  }
  return errs;
}

const TASK_PATCH_FIELDS = Object.freeze([
  "title",
  "status",
  "notes",
  "assigned_to",
  "due_date",
  "order",
]);

/**
 * Normalize a task patch — drop unknown keys, stamp updated_at, derive
 * completed_at when status flips to "done". Used by PATCH endpoints.
 */
export function normalizeTaskPatch(input) {
  const out = {};
  const src = input && typeof input === "object" ? input : {};
  for (const key of TASK_PATCH_FIELDS) {
    if (key in src) out[key] = src[key];
  }
  if (out.status === "done") {
    out.completed_at = new Date().toISOString();
  } else if (out.status && out.status !== "done") {
    out.completed_at = null;
  }
  out.updated_at = new Date().toISOString();
  return out;
}

/**
 * Render an event card to the natural-language text Pinecone embeds.
 * Pulls every distinctive field so retrieval by meaning works whether
 * the user searches by name, dates, location, or attendees. Mirrors
 * contacts-index.js#textForContact.
 */
export function textForEvent(event) {
  if (!event || typeof event !== "object") return "";
  const parts = [];
  if (event.title) parts.push(`Event: ${event.title}.`);
  if (event.status) parts.push(`Status: ${event.status}.`);
  if (event.start_date || event.end_date) {
    const dates = [event.start_date, event.end_date]
      .filter(Boolean)
      .join(" to ");
    if (dates) parts.push(`Dates: ${dates}.`);
  }
  if (event.location) parts.push(`Location: ${event.location}.`);
  if (event.description) parts.push(`Description: ${event.description}.`);
  if (Array.isArray(event.attendees) && event.attendees.length) {
    const names = event.attendees
      .map((a) => a?.name || a?.contact_id || null)
      .filter(Boolean)
      .slice(0, 20)
      .join(", ");
    if (names) parts.push(`Attendees: ${names}.`);
  }
  if (typeof event.task_count === "number") {
    parts.push(`Tasks: ${event.task_count}.`);
  }
  return parts.filter(Boolean).join(" ");
}

/**
 * Render a task row to the natural-language text Pinecone embeds. The
 * parent event's title is included so a query like "what do I still need
 * to do for the Rytual retreat?" can semantically match the task vector
 * even without filtering by event_id.
 */
export function textForTask(task, event) {
  if (!task || typeof task !== "object") return "";
  const parts = [];
  if (task.title) parts.push(`Task: ${task.title}.`);
  if (event?.title) parts.push(`For event: ${event.title}.`);
  if (task.status) parts.push(`Status: ${task.status}.`);
  if (task.assigned_to) parts.push(`Assigned to: ${task.assigned_to}.`);
  if (task.due_date) parts.push(`Due: ${task.due_date}.`);
  if (task.notes) parts.push(`Notes: ${task.notes}.`);
  return parts.filter(Boolean).join(" ");
}
