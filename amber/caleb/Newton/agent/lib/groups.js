/**
 * Group chat logic: topic-aware AI router, memory bridge, social governor.
 * Inspired by CyberGroupmate's "reading the room" engine.
 *
 * Two-layer decision:
 *   1) socialGovernor()  — deterministic, hard-coded social-cue rules.
 *      Runs first and can SHORT-CIRCUIT to silence (skip the LLM).
 *      Handles cases the LLM router has historically gotten wrong:
 *      - human asks both/all agents to be quiet ("shut up", "chill", etc.)
 *      - the *other* AI agent (Camber vs Samber) was named, not us
 *      - the other AI just answered adequately (don't echo / pile on)
 *      - newest message conflicts with stale topic — drop the old thread
 *   2) shouldAmberReplyInGroup() — LLM "reading the room" router.
 *      Only consulted when the governor returns NO_DECISION.
 *
 * The governor is intentionally *strict about silence* in group chats.
 * Group chats with two AI agents (Camber + Samber) are the failure mode:
 * both bots responding to every message and echoing each other turns the
 * thread into noise. Default to silence unless this specific agent has a
 * clear reason to speak.
 */

import { callPerplexityLight } from "./tiwari/context.js";
import { normalizeHandle } from "./permissions.js";
import { loadConversationHistory } from "./contacts.js";

// Phrases that signal "stop / be quiet / chill out" addressed at the bots.
// Match conservatively — these are high-cost false positives if we misfire,
// but they're MUCH higher cost if we miss them and keep yapping.
const SHUTDOWN_PATTERNS = [
  /\bshut\s*up\b/i,
  /\bbe\s+quiet\b/i,
  /\bstop\s+(?:talking|texting|replying|responding|messag\w+)\b/i,
  /\bquit\s+(?:talking|texting|replying|responding)\b/i,
  /\bchill(?:\s+(?:out|tf|the\s+f))?\b/i,
  /\b(?:both\s+of\s+you|y(?:ou)?'?all|u\s+both|you\s+both|both\s+u)\b.*\b(?:shut|quiet|stop|chill|enough)\b/i,
  /\benough\b.*\b(?:guys|bots|of\s+(?:this|that|you))\b/i,
  /\b(?:hold\s+on|hold\s+up|wait|one\s+sec|gimme\s+a\s+sec|stfu)\b/i,
  /\bstop\s+(?:it|that)\b/i,
  /\bquiet\s+down\b/i,
];

// Casual filler that almost never deserves an agent reply. We let an LLM
// handle ambiguous mid-cases; this list is just the obvious ones.
const PURE_FILLER = [
  /^(?:lol|lmao|haha+|hehe+|bet|word|fr+|facts|nice|cool|ok+|okay|kk|k|hm+|mm+|yeah|yep|yup|nah|sure|ig|ofc|tru|true)[!.\s]*$/i,
  /^[\p{Emoji}\s\p{P}]+$/u,
];

// Local "things we should not bring up unprompted" — venues, weather, web
// facts, recommendations. Phrased as topic words for cheap detection.
const RECOMMENDATION_LEAK_TOPICS = [
  "gaslamp",
  "bay cruise",
  "artisan market",
  "rooftop bar",
  "happy hour",
  "san diego",
  "weather",
  "recommend",
  "you could check out",
  "you should try",
];

// Words that imply this is an *action request* the addressed agent should
// fulfill, not a reflective comment we should pile onto.
const ACTION_REQUEST_PATTERNS = [
  /\b(make|create|generate|build|draft|send|write|design|spin\s+up|cook\s+up|whip\s+up|render|produce|shoot)\b/i,
  /\b(image|picture|pic|photo|meme|gif|video|sticker|emoji|wallpaper|poster|flyer|graphic|art|drawing)\b/i,
];

// Casual greetings / "what's good" / "wyd" / "how are you" filler. When this
// fires AND the message has no real ask, we hard-reset topic context and the
// reply must be a tiny greeting only — never a planning question, never a
// continuation of stale recommendations (Altitude, Gaslamp, weather, etc.).
const CASUAL_GREETING_PATTERNS = [
  /\b(?:yo|sup|hey+|hi+|hello+|heya|hola|howdy|aloha|ayo+|ay)\b/i,
  /\bwhat'?s\s*(?:good|up|poppin|crackin|happenin|going\s*on)\b/i,
  /\bhow'?s\s*(?:it\s*going|things|life|tricks|everything)\b/i,
  /\bhow\s*(?:are|r|u\s+doin|you\s+doin|ya\s+doin)\b/i,
  /\bwyd\b/i,
  /\bgood\s*(?:morning|afternoon|evening|night)\b/i,
  /\bwagwan\b/i,
];

// Substantive ask signals — if these appear we treat the message as a real
// request and do NOT trigger greeting-reset, even if a greeting word is
// present ("yo camber can you draft this email").
const SUBSTANTIVE_ASK_PATTERNS = [
  /\b(?:can|could|would|will|please|pls|plz)\s+(?:you|u|y'?all|yall)\b/i,
  /\?\s*$/, // ends with a question mark
  /\b(?:help|find|tell|show|give|make|create|generate|draft|send|write|search|look\s*up|book|schedule|plan|remind)\b/i,
  /\b(?:tonight|tomorrow|saturday|sunday|monday|tuesday|wednesday|thursday|friday|weekend|next\s+week|later)\b/i,
];

function isCasualGreeting(text) {
  const t = (text || "").trim();
  if (!t) return false;
  // Cap length — long messages with greeting words inside are not pure greetings.
  if (t.length > 80) return false;
  if (!CASUAL_GREETING_PATTERNS.some((re) => re.test(t))) return false;
  // If there's an actual ask packed in, it's not a pure greeting.
  if (SUBSTANTIVE_ASK_PATTERNS.some((re) => re.test(t))) return false;
  return true;
}

/**
 * Detect a multi-addressed / multi-intent message where each known agent has
 * its own clause + ask (e.g. "Camber what about cows? Samber what about pigs?"
 * or "camber draft the email and samber book the flight").
 *
 * Returns { isMulti, clauses } where `clauses` is a map persona→clause text
 * containing only the substring addressed to that persona. Falls back to
 * { isMulti: false, clauses: {} } when the structure doesn't fit.
 *
 * Detection rule: the message contains at least two distinct known persona
 * names AND each named persona is followed by enough non-trivial content
 * (>=4 chars before the next persona / end of message) to count as its own
 * ask. Pure shared greetings ("yo Camber and Samber what's good") fail this
 * check because the content after the persona run is one shared greeting,
 * not per-agent asks — those keep going through the existing greeting path.
 */
export function detectMultiAddressed(text) {
  const t = (text || "").trim();
  if (!t) return { isMulti: false, clauses: {} };

  // Find all persona occurrences with their byte offset.
  const occurrences = [];
  for (const persona of KNOWN_AGENT_PERSONAS) {
    const re = new RegExp(`\\b${persona}\\b`, "gi");
    let m;
    while ((m = re.exec(t)) !== null) {
      occurrences.push({ persona, index: m.index, length: m[0].length });
    }
  }
  if (occurrences.length < 2) return { isMulti: false, clauses: {} };

  // Distinct personas only (need at least two different agents named).
  const distinct = new Set(occurrences.map((o) => o.persona));
  if (distinct.size < 2) return { isMulti: false, clauses: {} };

  // Sort by index so we can slice clauses [persona_i .. persona_{i+1}).
  occurrences.sort((a, b) => a.index - b.index);

  const clauses = {};
  for (let i = 0; i < occurrences.length; i++) {
    const cur = occurrences[i];
    const nextIdx = occurrences[i + 1]?.index ?? t.length;
    // Slice from the persona word through the start of the next persona
    // mention (or end of text). This includes the persona name itself so
    // the prompt can show "Camber, what do you know about cows?" verbatim.
    const slice = t.slice(cur.index, nextIdx).trim();
    // Strip a trailing connector ("and"/"&"/",") that bridges to next persona.
    const cleaned = slice
      .replace(/\s*(?:[,;:]|\band\b|&)\s*$/i, "")
      .trim();
    // Per-clause content beyond just the name + filler must be substantive.
    const afterName = cleaned.slice(cur.length).trim();
    // Strip leading punctuation/connectors after the name.
    const askPart = afterName.replace(/^[\s,:;-]+(?:and\s+)?/i, "").trim();
    // Treat clauses with very short tails ("yo Camber and Samber what's up")
    // as shared greeting — single shared ask, not per-agent multi-intent.
    if (askPart.length < 4) {
      // Add an empty clause but mark non-multi at the end.
      clauses[cur.persona] = cleaned;
      continue;
    }
    // Prefer the longest clause we've seen for this persona (handles repeated
    // mentions like "samber, hey samber what about pigs"). Take the first one
    // that has substantive content.
    if (!clauses[cur.persona] || cleaned.length > clauses[cur.persona].length) {
      clauses[cur.persona] = cleaned;
    }
  }

  // For it to qualify as multi-addressed, at least two distinct personas must
  // have substantive clauses (>= 4 chars after their name). Otherwise it's a
  // shared greeting / co-mention and we keep the existing peer-suppression.
  const substantiveCount = Object.entries(clauses).filter(([persona, clause]) => {
    const tail = clause.slice(persona.length).replace(/^[\s,:;-]+/, "").trim();
    return tail.length >= 4;
  }).length;
  if (substantiveCount < 2) return { isMulti: false, clauses: {} };

  return { isMulti: true, clauses };
}

/**
 * Build the regex used to detect whether THIS agent is being addressed.
 * Always allow generic "amber" since that's the platform name. Also allow
 * the per-tenant agent name (Camber, Samber, …) when provided.
 */
function buildSelfNameRegex(agentName) {
  const names = ["amber"];
  if (agentName && typeof agentName === "string") {
    const trimmed = agentName.trim();
    if (trimmed && trimmed.toLowerCase() !== "amber") names.push(trimmed);
  }
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(?:${escaped.join("|")})\\b`, "i");
}

/**
 * Detect mentions of *another* AI agent (not this one). In our deployment
 * the two known personas are Camber (Caleb) and Samber (Sagar). If the
 * human names the OTHER agent and not us, we should stay silent.
 */
const KNOWN_AGENT_PERSONAS = ["camber", "samber"];
function mentionsOtherAgent(text, agentName) {
  const self = (agentName || "amber").toLowerCase();
  const others = KNOWN_AGENT_PERSONAS.filter((n) => n !== self);
  if (!others.length) return false;
  return others.some((n) => new RegExp(`\\b${n}\\b`, "i").test(text));
}

function mentionsSelf(text, agentName) {
  return buildSelfNameRegex(agentName).test(text || "");
}

function isShutdownCue(text) {
  return SHUTDOWN_PATTERNS.some((re) => re.test(text || ""));
}

function isPureFiller(text) {
  const t = (text || "").trim();
  if (!t) return true;
  return PURE_FILLER.some((re) => re.test(t));
}

function isActionRequest(text) {
  return ACTION_REQUEST_PATTERNS.some((re) => re.test(text || ""));
}

/**
 * Find the most recent assistant message in the local cache that came
 * from THIS agent (matched on senderLabel/agentName when available, else
 * fall back to the only assistant). Returns null if the most recent
 * assistant message was from a different agent.
 */
function findOurLastAssistantMsg(history, agentName) {
  const reversed = [...history].reverse();
  const lastAssistant = reversed.find((m) => m.role === "assistant");
  if (!lastAssistant) return null;
  const label = (lastAssistant.senderLabel || lastAssistant.agentName || "")
    .toString()
    .toLowerCase();
  if (!label) return lastAssistant; // no label info — assume ours
  if (label === (agentName || "amber").toLowerCase()) return lastAssistant;
  return null;
}

/**
 * Did *another* AI just answer the latest human message adequately?
 * Heuristic: the most recent message before the new human message is from
 * an assistant whose label is NOT this agent, and it was substantive
 * (>= 12 chars and not a one-word ack).
 */
function otherAgentJustAnswered(history, agentName) {
  const reversed = [...history].reverse();
  const lastAssistant = reversed.find((m) => m.role === "assistant");
  if (!lastAssistant) return false;
  const label = (lastAssistant.senderLabel || lastAssistant.agentName || "")
    .toString()
    .toLowerCase();
  if (!label) return false;
  if (label === (agentName || "amber").toLowerCase()) return false;
  const content = (lastAssistant.content || "").trim();
  return content.length >= 12;
}

/**
 * Deterministic social governor. Returns one of:
 *   { decision: "skip",  reason }      — definitely do not reply
 *   { decision: "reply", reason }      — definitely reply (short)
 *   { decision: "defer", reason }      — let the LLM router decide
 *
 * `agentName` is THIS agent's persona name (e.g. "Camber", "Samber").
 * `lastHumanText` defaults to the current text but can be overridden when
 * we want to evaluate the newest human message regardless of any later
 * assistant churn.
 */
export function socialGovernor({
  text,
  agentName,
  recentHistory = [],
  isCaleb = false,
}) {
  const t = (text || "").trim();
  if (!t) return { decision: "skip", reason: "empty message" };

  const namedSelf = mentionsSelf(t, agentName);
  const namedOther = mentionsOtherAgent(t, agentName);
  const greeting = isCasualGreeting(t);
  const multi = detectMultiAddressed(t);
  const selfPersona = (agentName || "").toLowerCase();

  // Rule 8: hard shutdown / social cue guard. Highest priority.
  // - "shut up", "be quiet", "chill", "wait", "hold on", "both shut up", …
  // If the cue is generic ("guys can u both shut up") nobody replies.
  // If THIS agent is named AND there is also an action request in the same
  // message ("camber shut up but make the image"), let the LLM decide so
  // we can fulfill the action with a one-line ack — but that's rare.
  if (isShutdownCue(t)) {
    if (namedSelf && !namedOther && isActionRequest(t)) {
      return {
        decision: "defer",
        reason: "shutdown+action directed at us; LLM picks short ack",
      };
    }
    return {
      decision: "skip",
      reason: "shutdown/social cue — both agents go silent",
    };
  }

  // Rule 1 (positive): directly named — reply. Even if the OTHER agent is
  // also named, if WE are named we should respond (and keep it short).
  // Rule 7 corollary: if ONLY the other agent is named (and not us), stay
  // silent. Don't talk to / about the other AI.
  if (namedOther && !namedSelf) {
    return {
      decision: "skip",
      reason: `addressed at other agent, not ${agentName || "us"}`,
    };
  }
  if (namedSelf) {
    // Multi-addressed / multi-intent: each named agent has its own ask
    // (e.g. "Camber what about cows? Samber what about pigs?"). Each agent
    // MUST reply to its own clause and must NOT answer the peer's clause.
    // This rule fires BEFORE the greeting-reset path so a co-mention with
    // two distinct asks is never treated as a shared filler.
    if (multi.isMulti && multi.clauses[selfPersona]) {
      return {
        decision: "reply",
        reason: "multi-addressed: own clause directed at this agent",
        responseStyle: "multi-addressed",
        focusClause: multi.clauses[selfPersona],
      };
    }
    // Greeting reset: if the human just said "yo Camber and Samber what's
    // good dawg" or similar, we must reply with a TINY greeting and drop
    // any stale topic context. When BOTH agents are named in a pure
    // greeting, only the primary (owner's) agent should speak — the peer
    // stays silent to avoid the dual-bot echo failure mode.
    if (greeting) {
      if (namedOther && !isCaleb) {
        return {
          decision: "skip",
          reason: "group greeting names both agents; peer suppresses",
        };
      }
      return {
        decision: "reply",
        reason: "directly addressed with casual greeting; reset topic",
        responseStyle: "greeting-reset",
      };
    }
    return { decision: "reply", reason: "directly addressed" };
  }

  // Greeting with no agent named: defer to LLM router but still flag the
  // greeting-reset style so if it chooses to reply it doesn't drag stale
  // topic context forward.
  if (greeting) {
    return {
      decision: "defer",
      reason: "casual greeting, no agent named",
      responseStyle: "greeting-reset",
    };
  }

  // Rule 6: explicit image / action request from the human — the addressed
  // (or default-primary) agent should reply. Owner messages always win
  // over peer-agent activity, so we check action-request BEFORE the
  // "other agent just answered" rule below.
  if (isActionRequest(t)) {
    if (isCaleb) {
      return {
        decision: "reply",
        reason: "action request from owner",
      };
    }
    return { decision: "defer", reason: "action request, defer to router" };
  }

  // Rule 3: newest message from the OWNER always beats peer-agent chatter.
  // Don't let "other agent just answered" silence us when our owner is the
  // one talking — they may be redirecting / moving on / testing us.
  if (isCaleb) {
    return { decision: "defer", reason: "owner message; defer to router" };
  }

  // Rule 2: another AI just answered adequately — don't pile on / echo.
  if (otherAgentJustAnswered(recentHistory, agentName)) {
    return {
      decision: "skip",
      reason: "other AI just answered; avoid echo",
    };
  }

  // Rule 2: pure filler ("lol", a single emoji, "bet") → skip.
  if (isPureFiller(t)) {
    return { decision: "skip", reason: "pure filler" };
  }

  // Otherwise, defer to the LLM router for nuanced cases.
  return { decision: "defer", reason: "no hard rule applied" };
}

// AI-powered group chat router with topic classification.
// Returns { shouldReply: boolean, responseStyle?: string }. The
// deterministic social governor runs first; the LLM is only consulted
// when the governor returns "defer". `responseStyle` is a hint for the
// downstream prompt builder (e.g. "greeting-reset" → produce a tiny
// greeting, drop stale topic context, no planning question).
export async function shouldAmberReplyInGroup(
  text,
  senderName,
  recentHistory,
  isCaleb,
  agentName = "Amber",
) {
  // Step 1 — deterministic governor.
  const gov = socialGovernor({
    text,
    agentName,
    recentHistory: recentHistory || [],
    isCaleb,
  });
  if (gov.decision === "skip") {
    console.log(
      `[group-router] GOVERNOR SKIP | reason="${gov.reason}" | agent=${agentName} | from=${senderName}`,
    );
    return { shouldReply: false };
  }
  if (gov.decision === "reply") {
    console.log(
      `[group-router] GOVERNOR REPLY | reason="${gov.reason}" | agent=${agentName} | from=${senderName}${gov.responseStyle ? ` | style=${gov.responseStyle}` : ""}${gov.focusClause ? ` | focus="${gov.focusClause.slice(0, 60)}"` : ""}`,
    );
    return {
      shouldReply: true,
      responseStyle: gov.responseStyle,
      focusClause: gov.focusClause,
    };
  }

  // Step 2 — LLM "reading the room" router for ambiguous cases.
  const historyLines = (recentHistory || [])
    .slice(-10)
    .map((m) => {
      const label = m.role === "assistant" ? "Amber" : m.senderLabel || m.from;
      return `${label}: ${m.content}`;
    })
    .join("\n");
  const amberInHistory = (recentHistory || []).some(
    (m) => m.role === "assistant",
  );
  const amberLastMsg = findOurLastAssistantMsg(
    recentHistory || [],
    agentName,
  );

  // Fast path: emotional distress always gets a reply (unless governor
  // already ruled, which it didn't if we got here).
  const EMOTIONAL_DISTRESS =
    /\b(stress|stressed|anxious|anxiety|sad|depressed|lonely|overwhelmed|scared|worried|upset|frustrated|crying|hopeless|lost|hate|hurt|struggling|exhausted|burnout|burnt out|breaking down|can't sleep|no one cares|give up)\b/i;
  if (EMOTIONAL_DISTRESS.test(text)) {
    console.log(`[group-router] Emotional signal from ${senderName}, replying`);
    return { shouldReply: true };
  }

  // Fast path: questions almost always deserve a reply.
  const isQuestion =
    /\?/.test(text) ||
    /^(what|who|where|when|why|how|do you|can you|is there|are you|did|does|have you|would you)\b/i.test(
      text,
    );

  // Fast path: if Amber just spoke and this message acknowledges her
  // (praise/thanks/reaction/follow-up reference), REPLY. Ghosting someone
  // who's engaging with Amber's last message reads cold — at minimum
  // Amber should acknowledge.
  if (amberLastMsg && text.length < 240) {
    const ACK_PRAISE =
      /\b(tuff|good stuff|good one|nice one|well said|helpful|thanks|thank you|appreciate|love that|love it|amazing|brilliant|great point|good point|exactly|that'?s right|makes sense|got it|nailed it|perfect|spot on|on point|great answer|solid|preach|facts|true that|respect|bro|💪|🔥|👏|👍|❤️|💯)\b/i;
    const REFERENCES_AMBER =
      /\b(your|you(?:'re|'ve| are| have)?|amber|camber|samber|that (?:was|is|'?s)|this)\b/i;
    if (ACK_PRAISE.test(text) && REFERENCES_AMBER.test(text)) {
      console.log(
        `[group-router] Ack/praise of Amber's last msg from ${senderName}, replying: "${text.slice(0, 60)}"`,
      );
      return { shouldReply: true };
    }
  }
  // Carry forward greeting-reset style if the governor flagged it.
  const carriedStyle = gov.responseStyle;

  const prompt = `You are the "reading the room" engine for ${agentName}, an AI agent in a group iMessage chat. Another AI agent (a peer "Amber" persona for a different owner) MAY also be in this chat. Your job is to decide whether ${agentName} specifically should reply.

CONVERSATION CONTEXT:
${historyLines || "(fresh conversation)"}
${amberInHistory ? `\n${agentName} is ACTIVE in this conversation. Last message: "${amberLastMsg?.content?.slice(0, 100) || "..."}"` : `\n${agentName} has NOT spoken in this conversation yet.`}

NEW MESSAGE from ${senderName}${isCaleb ? " (the owner)" : ""}:
"${text}"

DEFAULT: When unsure in a group chat with two AI agents, choose IGNORE. Two bots replying to every message is the failure mode. Only reply if there is a real, specific reason for ${agentName} to speak.

REPLY only if:
- Message names ${agentName} or addresses them
- Someone is reacting to / building on something ${agentName} just said
- A question ${agentName} can uniquely answer was asked AND no other AI has already answered it
- Caleb (the owner) gives ${agentName} a direct instruction
${isQuestion ? "- The new message contains a question with no recent answer" : ""}

IGNORE if:
- Another AI agent has already answered adequately (do NOT echo or extend)
- The message is casual banter, filler, or two humans chatting
- The message references an OLD topic that was already resolved (do NOT continue stale threads)
- The newest message asks the agents to stop / be quiet / chill / wait
- The newest human message conflicts with prior context — drop the old thread
- The reply would only repeat what the other agent said

Reply with EXACTLY this JSON format:
{"action": "reply" | "ignore", "reason": "<one short sentence>"}`;

  try {
    const raw = await callPerplexityLight(prompt, {
      maxTokens: 80,
      timeoutMs: 10_000,
    });
    if (!raw) return { shouldReply: false }; // fail CLOSED in groups w/ 2 agents

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const result = JSON.parse(jsonMatch[0]);
        const action = (result.action || "ignore").toLowerCase();
        const reason = result.reason || "";
        console.log(
          `[group-router] LLM ${action.toUpperCase()} | reason="${reason}" | agent=${agentName} | from=${senderName}`,
        );
        return action === "reply"
          ? { shouldReply: true, responseStyle: carriedStyle }
          : { shouldReply: false };
      } catch {
        // JSON parse failed, fall through
      }
    }

    const upper = raw.toUpperCase();
    if (upper.includes("IGNORE")) return { shouldReply: false };
    if (upper.includes("OBSERVE")) {
      console.log(
        `[group-router] OBSERVE | from=${senderName} | "${text.slice(0, 40)}"`,
      );
      return { shouldReply: false };
    }
    if (upper.includes("REPLY"))
      return { shouldReply: true, responseStyle: carriedStyle };
    return { shouldReply: false };
  } catch {
    return { shouldReply: false }; // fail CLOSED — silence is recoverable; over-replying isn't
  }
}

// Pull a contact's recent messages from group conversation threads
export async function loadGroupContextForContact(
  contactHandle,
  groupIds,
  tenant = null,
) {
  if (!groupIds?.length) return "";
  const normHandle = normalizeHandle(contactHandle);
  const snippets = [];

  const groupResults = await Promise.all(
    groupIds.slice(-3).map(async (groupId) => {
      try {
        const history = await loadConversationHistory(groupId, tenant);
        if (!history.length) return null;
        const theirMessages = history.filter(
          (m) =>
            m.role === "user" &&
            m.from &&
            normalizeHandle(m.from) === normHandle,
        );
        if (!theirMessages.length) return null;
        const recent = theirMessages.slice(-5);
        const lines = recent.map(
          (m) => `  [${m.senderLabel || m.from}]: ${m.content}`,
        );
        return `Group thread:\n${lines.join("\n")}`;
      } catch {
        return null;
      }
    }),
  );
  snippets.push(...groupResults.filter(Boolean));

  if (!snippets.length) return "";
  return `\n\nPRIOR GROUP CONTEXT (you've met this person before in a group chat):\n${snippets.join("\n\n")}`;
}
