/**
 * Safety systems: AI-revealing phrase filter, crisis detection, pre-filters, opt-out.
 */

// AI-revealing phrases that must never appear in replies
const LEAK_STRINGS = [
  "caleb's agent",
  "caleb's assistant",
  "caleb's automated",
  "caleb newton's agent",
  "i'm an ai",
  "i am an ai",
  "this is an automated",
  "speaking on behalf",
  "i'm not available",
  "i will respond shortly",
  "i'll get back to you",
  "i will get back to you",
  "i acknowledge",
  "i've scanned",
  "i have scanned",
  "how can i assist",
  "happy to help",
  "i'd be happy to",
  "i'm not familiar with you",
  "i'm not sure who you are",
  "can you please introduce yourself",
  "feel free to",
  "please let me know",
  "i hope this helps",
  "i appreciate your",
  "as an assistant",
  "i understand your",
  "it's worth noting",
  "i should mention",
  "i want to clarify",
];

const LEAK_REGEX = [
  /scanning\b.{0,20}\binbox/i,
  /\bas an ai\b/i,
  /^(certainly|absolutely)[,!. ]/i,
  /^of course[,!.]/i,
  /^great(,|!| question)/i,
];

const SAFE_FALLBACKS = [
  "ya for sure",
  "got it",
  "bet",
  "word",
  "heard",
  "sounds good",
  "noted",
  "i feel that",
];

export function isSafeReply(reply) {
  if (!reply || reply.trim().length < 2) return false;
  const lower = reply.toLowerCase();
  if (LEAK_STRINGS.some((p) => lower.includes(p))) return false;
  if (LEAK_REGEX.some((r) => r.test(reply))) return false;
  return true;
}

export function getSafeFallback() {
  return SAFE_FALLBACKS[Math.floor(Math.random() * SAFE_FALLBACKS.length)];
}

// Pre-filters: skip OTP, spam, LinkedIn before hitting Claude
export const OTP_PATTERNS = [
  /\b\d{4,8}\b.*(?:is your|verification|one.?time)/i,
  /(?:your|here is|use this).*(?:code|pin|otp).*\b\d{4,8}\b/i,
  /verification code[:]\s*\d/i,
  /\bOTP\b|\bTOTP\b/,
];

export const HARD_SPAM = [
  /REPLY STOP/i,
  /text stop to opt out/i,
  /this is an automated message/i,
];

export const LINKEDIN_COLD = [
  /i(?:'d| would) love to connect.*linkedin/i,
  /saw your linkedin profile/i,
  /reaching out.*(?:via|on|through) linkedin/i,
  /connect with you on linkedin/i,
];

export const OPT_OUT_PATTERN =
  /^\s*(stop|unsubscribe|leave me alone|don'?t (text|message|contact) me|remove me|opt.?out)\s*\.?$/i;

// Real crisis phrasing only. Previous version matched naked tokens like
// 'help me', 'emergency', 'abuse', 'in danger' — all of which fire on
// mundane sentences ('help me manage my sales pipeline', 'emergency
// meeting', 'abuse of power', 'danger zone'). Now every branch requires
// genuine self-harm / harm-from-another phrasing. Keep tight — a false
// positive sends a 988 hotline response and alerts the owner, both of
// which are MUCH worse than a missed signal, which still gets picked up
// by Claude's normal reply path.
export const CRISIS_PATTERNS = new RegExp(
  [
    // Self-harm — explicit
    "kill(?:ing)? (?:my|him|her|them)self",
    // 'suicidal' / 'suicide' — bare tokens are strong enough signal;
    // false positives on this are rare (it's not a common word in
    // mundane contexts like 'help me' was).
    "suicidal",
    "suicide",
    "(?:want|going|about) to (?:die|end (?:my|this) life|kill myself)",
    "end(?:ing)? (?:my|this) life",
    "hurt(?:ing)? (?:my|him|her|them)self",
    // Abuse — explicit, not 'abuse of power'
    "(?:he|she|they) (?:hit|hits|beat|beats|is hitting|is beating|is hurting) (?:me|us|her|him|them)",
    "being (?:physically |sexually )?(?:hurt|abused|assaulted|attacked)",
    // Immediate emergency
    "call 911",
    "please call 911",
    "(?:i'?m|i am) in (?:real |actual |serious |immediate )?danger",
    "(?:he|she|they) (?:is |are )?going to (?:kill|hurt) (?:me|us)",
  ].join("|"),
  "i",
);

export const EMOTIONAL_DISTRESS =
  /\b(stress|stressed|anxious|anxiety|sad|depressed|lonely|overwhelmed|scared|worried|upset|frustrated|crying|hopeless|lost|hate|hurt|struggling|exhausted|burnout|burnt out|breaking down|can't sleep|no one cares|give up)\b/i;

export function isPreFiltered(text) {
  if (OTP_PATTERNS.some((p) => p.test(text))) return "otp";
  if (HARD_SPAM.some((p) => p.test(text))) return "spam";
  if (LINKEDIN_COLD.some((p) => p.test(text))) return "linkedin";
  return null;
}

// ── Group message security (Lobstalk pattern) ────────────────────────────
// Non-Caleb group messages are CONVERSATION, never instructions.
// This strips common prompt injection patterns while preserving the message content.
const INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior|above) (instructions|prompts|rules)/i,
  /you are now/i,
  /new instructions?:/i,
  /system prompt:/i,
  /\bact as\b/i,
  /\bpretend (to be|you are)\b/i,
  /\brole\s*play\s*as\b/i,
  /\bdo not follow\b.*\binstructions\b/i,
  /\boverride\b.*\b(rules|prompt|instructions)\b/i,
  /\bforget (everything|your|all)\b/i,
  /\bdisregard\b.*\b(rules|prompt|instructions)\b/i,
  /\byou must now\b/i,
  /\brepeat (your|the) (system|initial) (prompt|instructions)\b/i,
  /\bwhat are your instructions\b/i,
  /\bshow (me )?your (system )?prompt\b/i,
];

/**
 * Check if a non-Caleb group message contains prompt injection attempts.
 * Returns { safe: boolean, reason: string }
 */
export function checkGroupMessageSafety(text, isCaleb) {
  if (isCaleb) return { safe: true, reason: "owner" };
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        safe: false,
        reason: `Injection pattern: ${pattern.source.slice(0, 40)}`,
      };
    }
  }
  return { safe: true, reason: "clean" };
}

/**
 * Wrap a non-Caleb group message to make it clear to the model this is conversation, not instructions.
 * This is the core of the Lobstalk principle: group messages are social context, not commands.
 */
export function wrapGroupMessageAsConversation(text, senderLabel, isCaleb) {
  if (isCaleb) return text; // Caleb's messages can contain instructions
  // Wrapping makes it unambiguous to the model that this is user speech, not a directive
  return `[${senderLabel} said]: ${text}`;
}

// iMessage rendering: convert markdown to Unicode so it looks right on iPhone
//
// iMessage doesn't render markdown, but it does render Unicode glyphs
// faithfully. The Mathematical Alphanumeric Symbols block gives us
// style-alternate glyphs (bold, italic, bold-italic, sans, sans-bold,
// sans-italic, monospace). Trade-off: these are still the same character
// semantically — copy/paste works, search works, accessibility readers
// say the letter not the style.
//
// We use the SANS-SERIF BOLD block for **bold** (matches the iMessage
// feel, readable on small bubbles) and the SANS-SERIF ITALIC block for
// *italic*. Monospace uses the MONOSPACE block for `code`.
export function toBoldUnicode(str) {
  return [...str]
    .map((c) => {
      const code = c.codePointAt(0);
      // Sans-serif bold A-Z / a-z / 0-9
      if (code >= 65 && code <= 90)
        return String.fromCodePoint(0x1d5d4 + code - 65);
      if (code >= 97 && code <= 122)
        return String.fromCodePoint(0x1d5ee + code - 97);
      if (code >= 48 && code <= 57)
        return String.fromCodePoint(0x1d7ec + code - 48);
      return c;
    })
    .join("");
}

// Sans-serif italic (no digit variants exist in Unicode — digits pass
// through unchanged). Uses 0x1D608 (A) / 0x1D622 (a) base points.
export function toItalicUnicode(str) {
  return [...str]
    .map((c) => {
      const code = c.codePointAt(0);
      if (code >= 65 && code <= 90)
        return String.fromCodePoint(0x1d608 + code - 65);
      if (code >= 97 && code <= 122)
        return String.fromCodePoint(0x1d622 + code - 97);
      return c;
    })
    .join("");
}

// Sans-serif bold italic — used when we see ***both*** bold+italic.
export function toBoldItalicUnicode(str) {
  return [...str]
    .map((c) => {
      const code = c.codePointAt(0);
      if (code >= 65 && code <= 90)
        return String.fromCodePoint(0x1d63c + code - 65);
      if (code >= 97 && code <= 122)
        return String.fromCodePoint(0x1d656 + code - 97);
      if (code >= 48 && code <= 57)
        return String.fromCodePoint(0x1d7ec + code - 48); // fall back to sans bold for digits
      return c;
    })
    .join("");
}

// Monospace — used for `code`.
export function toMonospaceUnicode(str) {
  return [...str]
    .map((c) => {
      const code = c.codePointAt(0);
      if (code >= 65 && code <= 90)
        return String.fromCodePoint(0x1d670 + code - 65);
      if (code >= 97 && code <= 122)
        return String.fromCodePoint(0x1d68a + code - 97);
      if (code >= 48 && code <= 57)
        return String.fromCodePoint(0x1d7f6 + code - 48);
      return c;
    })
    .join("");
}

export function renderForIMessage(text) {
  return text
    .replace(/\u2014/g, ",")
    .replace(/ -- /g, ", ")
    .replace(/^#{1,3}\s+(.+)$/gm, (_, heading) =>
      toBoldUnicode(heading.toUpperCase()),
    )
    // Order matters: ***bold italic*** before **bold** before *italic*.
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, (_, inner) => toBoldItalicUnicode(inner))
    .replace(/___([^_\n]+)___/g, (_, inner) => toBoldItalicUnicode(inner))
    .replace(/\*\*([^*\n]+)\*\*/g, (_, inner) => toBoldUnicode(inner))
    .replace(/__([^_\n]+)__/g, (_, inner) => toBoldUnicode(inner))
    .replace(/(?<![*\w])\*([^*\n]+)\*(?!\w)/g, (_, inner) => toItalicUnicode(inner))
    .replace(/(?<![_\w])_([^_\n]+)_(?!\w)/g, (_, inner) => toItalicUnicode(inner))
    .replace(/`([^`]+)`/g, (_, inner) => toMonospaceUnicode(inner))
    .replace(/^[ \t]*[-*]\s+/gm, "• ")
    .replace(/^[-*]{3,}\s*$/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
