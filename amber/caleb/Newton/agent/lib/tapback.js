/**
 * iMessage tapback utilities.
 *
 * Three responsibilities:
 *   1. Detect a deterministic tapback-shortcut intent in Caleb's incoming
 *      text ("Heart this message", "React with ? to this", etc.) so we can
 *      fire the reaction without going through the AI. Models don't reliably
 *      emit the [react:TYPE] token for terse reaction commands.
 *   2. Parse one-or-many [react:TYPE] / [react:TYPE:messageId] tokens from
 *      the start of Amber's reply, so she can react to multiple messages in
 *      a single turn (e.g. "like these 3 messages").
 *   3. Build a "recent message IDs" block for the system prompt so Amber
 *      knows which ID corresponds to which past message — without this she
 *      can only react to the most recent incoming message.
 *
 * Valid reactions per Loop Message: love, like, dislike, laugh, emphasize,
 * question. Prefixing a reaction with `-` removes it; that form is available
 * via the explicit [react:-TYPE] syntax but not via the shortcut.
 */

export const VALID_REACTIONS = new Set([
  "love",
  "like",
  "dislike",
  "laugh",
  "emphasize",
  "question",
]);

// Alias map: catches common LLM paraphrases so [react:thumbsup] etc. still
// fire instead of being emitted as literal text. Keys are lowercased; values
// must be in VALID_REACTIONS.
export const REACTION_ALIASES = {
  thumbsup: "like",
  "thumbs-up": "like",
  thumb_up: "like",
  thumbup: "like",
  heart: "love",
  hearted: "love",
  loved: "love",
  liked: "like",
  thumbsdown: "dislike",
  "thumbs-down": "dislike",
  thumbdown: "dislike",
  disliked: "dislike",
  haha: "laugh",
  lol: "laugh",
  laughed: "laugh",
  laughing: "laugh",
  funny: "laugh",
  exclaim: "emphasize",
  exclamation: "emphasize",
  emphasized: "emphasize",
  wow: "emphasize",
  bang: "emphasize",
  huh: "question",
  questioned: "question",
  confused: "question",
};

/**
 * Normalize a reaction string (possibly with leading "-") to its canonical
 * Loop Message value. Returns null if unknown.
 */
export function normalizeReaction(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase();
  const negated = s.startsWith("-");
  const base = negated ? s.slice(1) : s;
  const canonical = VALID_REACTIONS.has(base)
    ? base
    : REACTION_ALIASES[base] || null;
  if (!canonical) return null;
  return negated ? "-" + canonical : canonical;
}

const REACTION_PATTERNS = [
  ["love", /\b(love[ds]?|hearts?|hearted|heart\s*it)\b/],
  ["like", /\b(like[ds]?|thumbs?\s?up)\b|👍/],
  ["dislike", /\b(dislike[ds]?|thumbs?\s?down)\b|👎/],
  ["laugh", /\b(laugh(?:ed|s|ing)?|haha+|lol|funny|hilarious)\b/],
  [
    "emphasize",
    /\b(emphasi[sz]e[ds]?|exclaim(?:ed)?|exclamation(?:\s+(?:mark|point))?|bang|!!)\b|!!+/,
  ],
  // Note: bare "?" is NOT matched here — any innocent question ("what's your
  // name?") would otherwise trigger a tapback instead of a real reply. The
  // user must say "question mark", "confused", "huh", or use the explicit
  // [react:question] token.
  ["question", /\b(question(?:\s+mark)?|confused|huh)\b/],
];

const TAPBACK_VERB = /\b(tapback|tapbacks|react(?:ion|ions|s|ed|ing)?)\b/;
const MESSAGE_REF =
  /\b(this|that|it|the\s+(?:last|previous|above|first|second|third))\b(?:\s*(?:message|msg|text|one))?|\bthe\s+msg\b/;
const MULTI_SIGNAL =
  /\band\b|\balso\b|\bboth\b|\bthese\b|\bthose\b|\beach\b|\ball\s+(?:the\s+)?(?:last|previous|messages)\b|\bplus\b|&|\+|\b\d+\s+(?:messages|msgs)\b|\bmessages\b|\bmsgs\b/i;

/**
 * Check the incoming text for a SINGLE-message reaction command that we can
 * fire deterministically without asking the AI. Returns the reaction name
 * (e.g. "love") or null.
 *
 * Returns null if:
 *   - Text is empty, too long, or doesn't reference a message
 *   - Text names multiple messages (e.g. "like these two messages") — those
 *     need the AI path because they require picking specific message IDs
 *   - No reaction keyword is present (e.g. "tapback with an emoji")
 */
export function detectTapbackShortcut(text) {
  if (typeof text !== "string") return null;
  const lower = text.trim().toLowerCase();
  if (lower.length === 0 || lower.length > 160) return null;

  const hasTapbackVerb = TAPBACK_VERB.test(lower);
  const hasMessageRef = MESSAGE_REF.test(lower);
  const wordCount = lower.split(/\s+/).length;
  const isVeryTerse = wordCount <= 4;

  // Require at least a message reference OR an explicit tapback verb. The
  // previous "isVeryTerse" escape hatch fired on any short message, so
  // "yo samber" and "wtf dude" got misclassified as reaction commands
  // and never reached the AI. Being short is not enough signal.
  if (!hasTapbackVerb && !hasMessageRef) return null;
  if (MULTI_SIGNAL.test(lower)) return null;

  for (const [reaction, pattern] of REACTION_PATTERNS) {
    if (pattern.test(lower)) return reaction;
  }
  return null;
}

/**
 * Parse one-or-many reaction tokens at the start of a reply. Stops at the
 * first non-reaction text. Supports both `[react:TYPE]` (targets the
 * triggering incoming message) and `[react:TYPE:messageId]` (targets a
 * specific past message, by ID from the recent-message block in the prompt).
 *
 * Returns { cleaned, reactions }:
 *   cleaned   — reply with all leading reaction tokens stripped
 *   reactions — [{ reaction, targetId | null }, ...] in order
 */
export function parseReactionTokens(reply) {
  const out = { cleaned: reply, reactions: [] };
  if (typeof reply !== "string" || reply.length === 0) return out;
  // TYPE in group 1 (e.g. 'love', '-like', 'thumbsup'); optional targetId in
  // group 2. `msg:` prefix on the target ID is accepted and stripped — Claude
  // sometimes copies it from the RECENT MESSAGE IDS block where each line is
  // rendered as `[msg:<id>] ...`.
  const TOKEN = /^\[react:(-?[\w-]+)(?::(?:msg:)?([A-Za-z0-9_-]+))?\]\s*/i;

  let rest = reply;
  while (true) {
    const m = rest.match(TOKEN);
    if (!m) break;
    const normalized = normalizeReaction(m[1]);
    if (!normalized) {
      // Unknown reaction name (including LLM paraphrases not in the alias
      // map). Strip the token from the reply so it doesn't show up as
      // literal text like "[react:sparkles] nice" — but don't fire a
      // reaction for it. This is safer than leaving the broken token in
      // the outgoing message.
      console.warn(`[tapback] stripped unknown reaction token: ${m[0].trim()}`);
      rest = rest.slice(m[0].length);
      continue;
    }
    out.reactions.push({
      reaction: normalized,
      targetId: m[2] || null,
    });
    rest = rest.slice(m[0].length);
  }
  out.cleaned = rest.trimStart();
  return out;
}

/**
 * Render a prompt block listing the last N messages with their IDs so
 * Amber can target a specific one with [react:TYPE:messageId]. Only
 * emits entries that have a messageId — older entries pre-dating the
 * tracking change, or outbound messages where Loop didn't return an ID,
 * are omitted (they can't be targeted anyway).
 */
export function buildRecentMessageIdsBlock(history, limit = 10) {
  if (!Array.isArray(history) || history.length === 0) return "";
  const slice = history.slice(-limit).filter((m) => m && m.messageId);
  if (slice.length === 0) return "";
  const lines = slice.map((m) => {
    // Prefer the explicit senderLabel persisted on the history entry (works
    // in group chats where multiple people speak). Fall back to role-based
    // labels for older entries or DM turns without senderLabel.
    const who =
      m.senderLabel || (m.role === "user" ? "Caleb" : "You");
    const snippet = (m.content || "").replace(/\s+/g, " ").trim().slice(0, 100);
    // Display the raw ID (no [msg:] wrapper) so Claude copies the ID cleanly
    // into [reply:<id>] or [react:TYPE:<id>] without picking up extra
    // syntax. Previous 'msg:' prefix caused the LLM to emit invalid tokens
    // like `[reply:msg:abc-123]`.
    return `  id=${m.messageId}  ${who}: "${snippet}"`;
  });
  return (
    "\n\nRECENT MESSAGE IDS (for tapback reactions AND inline-reply threading — oldest first, newest last):\n" +
    lines.join("\n") +
    "\n\nThese IDs power TWO different iMessage affordances:\n" +
    "  • [react:TYPE:messageId]  → fires a tapback reaction on that specific bubble. Stack multiple tokens to react to several messages in one turn (e.g. `[react:love:abc-123][react:emphasize:def-456] done`). If you omit the messageId, the reaction lands on Caleb's most recent message.\n" +
    "  • [reply:messageId]       → threads your reply as an inline reply attached to that specific bubble. MUST be the very first token in your output. Use this whenever Caleb asks you to \"reply in a thread\", \"thread this\", \"inline reply\", or any paraphrase meaning \"use the iMessage reply feature\". Exactly one [reply:...] per message. When he says \"this\" or \"this message\" without specifying, it means HIS most recent message — the LAST Caleb entry in the list above.\n" +
    "Copy the ID verbatim. Never invent an ID. If the ID isn't in the list, don't thread."
  );
}
