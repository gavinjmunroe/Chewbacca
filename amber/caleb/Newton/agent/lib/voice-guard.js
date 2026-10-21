/**
 * voice-guard.js — small, deterministic copy guard for outbound iMessage.
 *
 * Camber and Samber share the same engine (lib/prompts.js voice doctrine)
 * but a lot of outbound text doesn't pass through the LLM at all:
 *   - lib/festival.js (SAFE keyword, substance redirect, first-contact)
 *   - lib/calendar/runtime.js (read replies + confirm prompts)
 *   - lib/checkins.js (scheduled morning / evening / spiritual prompts)
 *   - lib/proactive-runner.js (cool-down fallbacks, outreach previews)
 *
 * Those paths bypass the prompt, so the anti-bot doctrine in
 * AMBER_VOICE_DOCTRINE_TEMPLATE has no effect on them. This module is the
 * narrow adapter that brings them in line: it strips the small set of
 * phrases that consistently make Amber feel robotic, normalizes em-dashes
 * (per house style in lib/prompts.js), and collapses trailing exclamation
 * spam.
 *
 * It is intentionally a small post-processor, not a rewrite engine — we
 * don't want it to change the meaning of a deterministic reply. If a
 * substring isn't on the kill list it survives untouched.
 */

// Botty phrases we never want to ship to a user. Each rule is a regex +
// what to replace it with. Order matters: more specific rules run first.
const SCRUB_RULES = [
  // "As an AI, ..." / "I'm just an AI" disclaimers — kill them entirely.
  // Strip leading commas/spaces left over so we don't end up with " , ".
  { pattern: /\s*\bas an ai[, ]+/gi, replacement: "" },
  {
    pattern: /\s*\bi(?:'m| am) (?:just |only )?an ai[, .]*/gi,
    replacement: "",
  },
  {
    pattern:
      /\s*\bi'?m (?:just |only )?a (?:bot|chatbot|language model)[, .]*/gi,
    replacement: "",
  },

  // "Let me know if you need anything (else)" / "Is there anything else"
  // service-desk closers. The voice doctrine explicitly forbids them.
  {
    pattern:
      /\s*let me know if (?:you need anything|there'?s anything|i can help)[^.!?\n]*[.!?]*/gi,
    replacement: "",
  },
  { pattern: /\s*is there anything else[^.!?\n]*[.!?]*/gi, replacement: "" },
  { pattern: /\s*happy to help[^.!?\n]*[.!?]*/gi, replacement: "" },
  { pattern: /\s*hope (?:this|that) helps[^.!?\n]*[.!?]*/gi, replacement: "" },

  // "I apologize for..." / "Sorry for the inconvenience" — apology spam.
  {
    pattern: /\s*i apologi[sz]e for (?:any|the)[^.!?\n]*[.!?]*/gi,
    replacement: "",
  },
  {
    pattern: /\s*sorry for the inconvenience[^.!?\n]*[.!?]*/gi,
    replacement: "",
  },

  // "Feel free to ..." opener — service-desk filler.
  { pattern: /\bfeel free to /gi, replacement: "" },
];

// Per the prompt doctrine, never ship em-dashes. Convert to a comma + space.
// Covers both the em-dash (U+2014) and the en-dash (U+2013) when used as a
// sentence separator, which the model occasionally substitutes.
const EM_DASH = /\s*[—–]\s*/g;

// Trailing exclamation spam: "!!!" or "!!" becomes a single period.
const EXCLAIM_SPAM = /([!?])\1{1,}/g;

// Emoji / pictograph ranges. Deliberately scoped to the standard emoji blocks
// so it never touches the Mathematical Alphanumeric glyphs (U+1D400–U+1D7FF)
// that safety.js renderForIMessage emits for *bold* / _italic_, nor ordinary
// punctuation, currency, or accented Latin text. Includes the variation
// selector and zero-width joiner so composed sequences (👩‍💻, 👍🏽) are removed
// whole rather than leaving orphaned modifiers behind.
const EMOJI_RE =
  /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu;

/**
 * Remove emoji and pictographs from a string. Per house style (and Caleb's
 * standing rule) Amber never ships emoji. Leaves all normal text, punctuation,
 * and the unicode formatting glyphs renderForIMessage produces untouched.
 *
 * Collapses any double space left where an inline emoji used to sit so we don't
 * ship "hey  there" after stripping "hey 👋 there".
 */
export function stripEmoji(text) {
  if (typeof text !== "string" || !text) return text;
  return text.replace(EMOJI_RE, "").replace(/[ \t]{2,}/g, " ");
}

// Final whitespace cleanup. Collapse 3+ blank lines, trim, drop dangling
// punctuation left behind by the scrub.
function tidy(text) {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[\s.!?,;:]+/, "")
    .replace(/[ \t]+([.!?,;:])/g, "$1")
    .trim();
}

/**
 * Run the deterministic copy guard on a string. Returns the cleaned text.
 *
 * Safe to call on already-clean strings — it is a pure post-processor.
 * Returns the input unchanged when given non-strings so callers can wrap
 * without null-guarding.
 */
export function humanize(text) {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  for (const { pattern, replacement } of SCRUB_RULES) {
    out = out.replace(pattern, replacement);
  }
  out = out.replace(EM_DASH, ", ");
  out = out.replace(EXCLAIM_SPAM, "$1");
  return tidy(out);
}

/**
 * The single outbound persona guard. Layers emoji removal on top of humanize
 * so every send through transport.sendMessage ships in-voice copy: no botty
 * filler, no em dashes, no emoji. Idempotent and safe on already-clean
 * strings, so paths that already call humanize (checkins, festival,
 * proactive-runner) are not harmed by also passing through here.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {boolean} [opts.allowEmoji]  Escape hatch for the rare case where the
 *        user explicitly asked Amber to echo an emoji. Off by default.
 * @returns {string}
 */
// Strip internal model scaffolding that must never reach a user: <thinking>
// blocks (Medha leaked a raw one to Sagar 2026-05-22), <scratchpad>, and any
// stray open/close tags left behind. Complete blocks are removed wholesale so
// the real answer after </thinking> survives.
function stripInternalScaffolding(text) {
  if (typeof text !== "string" || !text) return text;
  let out = text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<scratchpad>[\s\S]*?<\/scratchpad>/gi, "");
  // Defensive: drop any surviving bare tags (orphaned open/close from a
  // truncated stream) without nuking the surrounding answer text.
  out = out.replace(/<\/?(?:thinking|scratchpad)>/gi, "");
  return out;
}

export function guardOutbound(text, opts = {}) {
  if (typeof text !== "string" || !text) return text;
  // Strip internal scaffolding first so a leaked <thinking> block never
  // survives downstream cleanup.
  let out = stripInternalScaffolding(text);
  // Strip emoji next so humanize's tidy pass cleans up any spacing artifact
  // an inline emoji left behind (e.g. a space stranded before a comma). Running
  // them in this order is what makes guardOutbound idempotent.
  out = opts.allowEmoji ? out : stripEmoji(out);
  out = humanize(out);
  return typeof out === "string" ? out.trim() : out;
}

/**
 * Scan a string for forbidden botty phrases. Returns an array of
 * matched-phrase strings (empty when clean). Used by tests and by
 * `assertHumanReply` to fail loud in development.
 */
export function findBottyPhrases(text) {
  if (typeof text !== "string" || !text) return [];
  const hits = [];
  for (const { pattern } of SCRUB_RULES) {
    const re = new RegExp(pattern.source, pattern.flags);
    const m = text.match(re);
    if (m) hits.push(...m.map((s) => s.trim()).filter(Boolean));
  }
  // Use fresh, non-global regexes for detection so module-level /g state
  // (lastIndex) can never make a later scan skip the start of a string.
  if (/[—–]/.test(text)) hits.push("em-dash");
  if (new RegExp(EMOJI_RE.source, "u").test(text)) hits.push("emoji");
  return hits;
}

/**
 * Throw in development when a deterministic reply contains botty phrasing.
 * No-op when AMBER_STRICT_VOICE is not set, so production never crashes on
 * a copy regression — it just gets scrubbed by `humanize`.
 */
export function assertHumanReply(text, label = "reply") {
  if (process.env.AMBER_STRICT_VOICE !== "1") return;
  const hits = findBottyPhrases(text);
  if (hits.length) {
    throw new Error(
      `[voice-guard] ${label} contains botty phrasing: ${hits.join(" | ")}`,
    );
  }
}
