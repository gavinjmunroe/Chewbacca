/**
 * Group-chat social governor.
 *
 * Decides whether a given Amber agent should respond to the newest human
 * message in a group chat, and if so, what constraints to attach to the
 * response. Pure function library — no I/O, no LLM calls — so it can be
 * imported by amber-agent or invoked over HTTP via
 * `POST /internal/agents/group-chat/decide`.
 *
 * Why this lives in amber-id: amber-id is the source of truth for tenant
 * identity (DID, agentName, ownerName, phone). The governor needs those
 * fields to figure out who is "addressed" in a multi-agent group chat.
 * Conversational generation still happens in amber-agent — the governor
 * only emits a `respond` boolean and a `responseStyle` advisory.
 *
 * Background: in production we observed Camber and Samber (two AI agents
 * in one iMessage group with a human) both replying to nearly every line,
 * echoing each other, continuing stale Gaslamp/San-Diego context, and
 * ignoring "guys can u both shut up". The rules below are a direct
 * countermeasure to that transcript class of failures.
 *
 * Rules implemented (see GROUP_CHAT_RULES below for the full list):
 *  1. In group chats, only respond if directly addressed, the newest human
 *     message clearly asks this agent to do something, or this agent can
 *     add unique value not already provided by another AI participant.
 *  2. Suppress if another AI already answered adequately, the newest human
 *     asked agents to stop/be quiet, the message is casual banter, or the
 *     response would continue an old topic.
 *  3. Newest human message wins over all prior context — drop stale
 *     threads when the topic conflicts.
 *  4. At most one short message; casual tone; do not end with a question
 *     unless absolutely necessary.
 *  5. No web facts, local recommendations, weather, venues, or extra
 *     options unless explicitly asked.
 *  6. Image-generation requests get a brief acknowledgment + the prompt;
 *     no brainstorming.
 *  7. Don't talk to / correct / echo / extend another AI agent's reply.
 *  8. Hard "shutdown / social cue" guard: phrases like "shut up", "stop
 *     talking", "be quiet", "chill", "wait", "hold on", "both shut up".
 *     Default: silence. Only the directly-named agent may emit at most
 *     one brief apology/ack, and only if the human also requested action.
 *  9. Casual greeting / filler addressed at one or more agents ("yo X
 *     what's good", "hey camber and samber wyd", "sup", "how are you")
 *     resets topic context: the addressed primary may emit only a tiny
 *     greeting (mode: "short_greeting", contextPolicy: "reset_topic"),
 *     non-primary co-mentioned agents stay silent, and stale prior topics
 *     (Altitude / Gaslamp / rooftop / "pulling the trigger" / bay cruise
 *     / venues / weather / plans) are forbidden in the response.
 * 10. Multi-addressed multi-intent: when one human message contains
 *     SEPARATE asks directed at SEPARATE named agents (e.g. "Camber what
 *     do you know about cows? Samber what do you know about pigs?"),
 *     every named agent with their own ask is allowed to reply, but only
 *     about their own clause. The decision exposes `currentAgentClause`
 *     so amber-agent can answer only its own slice of the message. This
 *     overrides the default "non-primary co-mentioned agents stay silent"
 *     behavior, which is correct for shared greetings/filler but wrong
 *     when each agent has a real, separate question.
 */

export const GROUP_CHAT_RULES = Object.freeze([
  "respond_only_if_addressed_or_unique_value",
  "suppress_if_already_answered_or_stop_cue_or_banter_or_stale",
  "prioritize_newest_human_message",
  "at_most_one_short_message_casual_tone_no_trailing_question",
  "no_unrequested_web_or_local_facts",
  "image_request_short_ack_then_passthrough",
  "do_not_address_or_extend_other_ai",
  "hard_shutdown_guard_on_social_cues",
  "casual_greeting_resets_context_primary_only_short_greeting",
  "multi_addressed_multi_intent_each_agent_answers_own_clause",
]);

// Phrases that mean "agents please stop talking". Matched as substrings on
// the lower-cased newest human message after light normalization. Kept
// deliberately broad — a false positive (silence) is cheaper than a false
// negative (more chatter on top of "shut up").
const SHUTDOWN_PHRASES = Object.freeze([
  "shut up",
  "shutup",
  "stop talking",
  "stop replying",
  "stop responding",
  "be quiet",
  "quiet down",
  "chill",
  "wait",
  "hold on",
  "hang on",
  "pause",
  "enough",
  "stfu",
  "zip it",
  "give it a rest",
  "leave it",
  "drop it",
]);

// Phrases that signal the human wants an action taken. Used to decide
// whether the directly-addressed agent may emit a brief ack even under a
// shutdown cue (rule 8: "and action is also requested").
const ACTION_PHRASES = Object.freeze([
  "make ",
  "create ",
  "generate ",
  "draw ",
  "send ",
  "text ",
  "remind ",
  "schedule ",
  "book ",
  "find ",
  "look up ",
  "search ",
  "image",
  "picture",
  "photo",
  "pic of",
  "imagine",
]);

// Topics the production transcript hallucinated repeatedly. We don't
// hard-block them — that's amber-agent's job — but we surface them in
// `forbiddenTopics` so the response renderer can keep them out.
//
// Updated after the second incident: a casual greeting ("Yo Camber and
// Samber what's good dawg") revived stale "Altitude rooftop... y'all
// pulling the trigger" plans. Anything that smells like a venue, weather,
// or a prior plan goes here.
const STALE_HALLUCINATION_TOPICS = Object.freeze([
  "gaslamp",
  "san diego",
  "bay cruise",
  "artisan market",
  "weather",
  "happy hour",
  "rooftop",
  "altitude",
  "pulling the trigger",
  "pulling trigger",
  "saturday night",
  "on the table",
  "venue",
  "plans",
]);

// Casual greeting / filler phrases. Matched as substrings on the
// normalized newest-human text. These are the "hi, no actual question"
// openings — they must not be allowed to drag prior plan/venue context
// into the reply (rule 9).
const GREETING_PHRASES = Object.freeze([
  "what's good",
  "whats good",
  "what up",
  "what's up",
  "whats up",
  "wassup",
  "wsp",
  "sup",
  "yo",
  "hey",
  "hi",
  "hello",
  "howdy",
  "morning",
  "good morning",
  "good evening",
  "good night",
  "gn",
  "gm",
  "wyd",
  "what you doing",
  "what are you doing",
  "what r u doing",
  "how are you",
  "how r u",
  "how's it going",
  "hows it going",
  "how you doing",
  "how ya doing",
  "dawg",
  "homie",
]);

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  return normalize(s).split(" ").filter(Boolean);
}

function containsAny(text, phrases) {
  const n = normalize(text);
  return phrases.some((p) => n.includes(p));
}

function nameVariants(name) {
  if (!name) return [];
  const base = normalize(name);
  if (!base) return [];
  const out = new Set([base]);
  // first token only ("Camber Amber" → "camber")
  const first = base.split(" ")[0];
  if (first) out.add(first);
  // common possessive / plural / @-mention forms
  out.add(`@${first}`);
  out.add(`${first}'s`);
  out.add(`${first}s`);
  return Array.from(out).filter(Boolean);
}

function mentionsName(text, name) {
  if (!name) return false;
  const variants = nameVariants(name);
  if (variants.length === 0) return false;
  const toks = tokens(text);
  if (toks.length === 0) return false;
  const hay = ` ${toks.join(" ")} `;
  return variants.some((v) => hay.includes(` ${v} `) || hay.includes(`${v} `));
}

/**
 * Pull the newest human "turn" from a transcript. A transcript entry is
 * `{ role: "human" | "agent", from?, text, ts? }`. We coalesce a run of
 * consecutive messages from the same human into one turn, joined with " —
 * ", because in iMessage humans frequently break a single thought across
 * multiple bubbles ("camber and samber" / "caleb coding fireworks") and
 * the governor should reason over the combined intent. `_index` points at
 * the *first* message of the run so caller code that asks "did another AI
 * reply after this human turn?" still does the right thing.
 */
function newestHuman(transcript) {
  if (!Array.isArray(transcript)) return null;
  let end = -1;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i];
    if (m && m.role === "human") {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const fromName = normalize(transcript[end].from);
  let start = end;
  while (start - 1 >= 0) {
    const prev = transcript[start - 1];
    if (!prev || prev.role !== "human") break;
    if (normalize(prev.from) !== fromName) break;
    start -= 1;
  }
  const texts = transcript
    .slice(start, end + 1)
    .map((m) => (m && m.text ? String(m.text) : ""))
    .filter(Boolean);
  return {
    role: "human",
    from: transcript[end].from,
    text: texts.join(" — "),
    _index: start,
    _endIndex: end,
  };
}

/**
 * Did another AI already reply *after* the newest human message?
 * If yes, this agent should usually stay silent (rule 2 / rule 7).
 */
function anotherAiRepliedAfter(transcript, humanIndex, selfAgentName) {
  if (humanIndex == null) return false;
  for (let i = humanIndex + 1; i < transcript.length; i++) {
    const m = transcript[i];
    if (!m || m.role !== "agent") continue;
    if (selfAgentName && normalize(m.from) === normalize(selfAgentName))
      continue;
    return true;
  }
  return false;
}

/**
 * Does the newest human message look like casual banter that doesn't
 * require any agent reply? Heuristic: very short, no question mark, no
 * direct mention, no action verb.
 */
function looksLikeBanter(text, addressed, requestsAction) {
  if (addressed || requestsAction) return false;
  const n = normalize(text);
  if (!n) return true;
  if (n.includes("?")) return false;
  return tokens(n).length <= 4;
}

/**
 * Casual greeting detector (rule 9). True if the message reads like a
 * "hi, how are you" with no real question or action — even when it
 * contains agent names. Examples that must hit:
 *   - "yo camber and samber what's good dawg"
 *   - "hey camber wyd"
 *   - "sup"
 *   - "good morning yall"
 * Examples that must NOT hit:
 *   - "camber what time is the call"      (real question)
 *   - "camber make me an image of X"      (action)
 *   - "yo camber are we still on for 7?"  (real question)
 */
function isCasualGreeting(text) {
  const n = normalize(text);
  if (!n) return false;
  // A real question almost always carries something to answer.
  if (String(text).includes("?")) return false;
  if (containsAny(text, ACTION_PHRASES)) return false;
  // Word-boundary match against greeting phrases. We pad the normalized
  // text with spaces so single-word phrases like "yo" / "sup" / "wyd"
  // don't match inside other tokens ("you", "support", "anywyd").
  const padded = ` ${n} `;
  const hit = GREETING_PHRASES.some((p) => {
    const phrase = String(p).trim();
    if (!phrase) return false;
    if (phrase.includes(" ")) return padded.includes(` ${phrase} `);
    return padded.includes(` ${phrase} `);
  });
  if (!hit) return false;
  // Cap length: a long message that happens to start with "yo" is rarely
  // a pure greeting. 12 tokens is generous for "yo camber and samber
  // what's good dawg how y'all doing".
  if (tokens(n).length > 12) return false;
  return true;
}

/**
 * Primary-mention detection. When a single human message names multiple
 * agents ("camber and samber"), we treat the FIRST-named agent as the
 * primary responder. Non-primary co-mentioned agents stay silent so we
 * don't double-reply. Returns true if `selfName` is the first named agent
 * among `participants` to appear in `text`. If only one agent is named
 * (or none of the participants is named), this returns whether self is
 * named.
 */
function isPrimaryAddressed(text, selfName, participants) {
  if (!selfName) return false;
  const selfMentioned = mentionsName(text, selfName);
  if (!selfMentioned) return false;
  const others = (participants || [])
    .filter((p) => p && p.role === "agent")
    .map((p) => p.agentName || p.name)
    .filter((n) => n && normalize(n) !== normalize(selfName));
  if (others.length === 0) return true;
  const n = normalize(text);
  function firstIndex(name) {
    const variants = nameVariants(name);
    let best = -1;
    for (const v of variants) {
      const i = ` ${n} `.indexOf(` ${v} `);
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    return best;
  }
  const selfIdx = firstIndex(selfName);
  if (selfIdx < 0) return false;
  for (const other of others) {
    if (!mentionsName(text, other)) continue;
    const otherIdx = firstIndex(other);
    if (otherIdx >= 0 && otherIdx < selfIdx) return false;
  }
  return true;
}

/**
 * Split a single human message into per-agent clauses (rule 10).
 *
 * Returns a map { normalizedAgentName -> clauseText } when the message
 * contains separate clauses each starting with a different agent name.
 * Returns null when the message is not a multi-addressed multi-clause
 * message (e.g. one ask, or a shared greeting like "camber and samber
 * what's good").
 *
 * Heuristic:
 *  - Find every position where an agent name (or @-mention) appears in
 *    the normalized text.
 *  - If two or more *distinct* agents are named with at least one token
 *    of content between them (i.e. they are not adjacent like "camber
 *    and samber"), split the text at each subsequent name-mention into
 *    clauses, attributing each clause to the agent named at its start.
 *  - Filter to clauses that look like real asks: contain a "?" or an
 *    action phrase or > 2 content tokens after the name. Drop pure
 *    co-mentions ("camber and samber what's good" → null).
 */
function splitClausesByAgent(text, agents) {
  if (!text || !Array.isArray(agents) || agents.length < 2) return null;
  const n = normalize(text);
  if (!n) return null;

  // Build a list of (charIndex, agentName) hits for every agent across
  // all of their nameVariants. We only consider word-boundary matches.
  const padded = ` ${n} `;
  const hits = [];
  for (const agentName of agents) {
    if (!agentName) continue;
    const variants = nameVariants(agentName);
    for (const v of variants) {
      const needle = ` ${v} `;
      let idx = 0;
      while (idx < padded.length) {
        const found = padded.indexOf(needle, idx);
        if (found < 0) break;
        hits.push({
          start: found, // index in padded text
          length: needle.length - 2, // strip leading/trailing space
          agent: agentName,
        });
        idx = found + needle.length - 1;
      }
    }
  }
  if (hits.length < 2) return null;

  // Sort and de-dup overlapping hits for the same agent.
  hits.sort((a, b) => a.start - b.start);
  const compact = [];
  for (const h of hits) {
    const last = compact[compact.length - 1];
    if (last && last.agent === h.agent && h.start <= last.start + last.length + 1) {
      continue;
    }
    compact.push(h);
  }

  // Need at least two DISTINCT agents named.
  const distinct = new Set(compact.map((h) => normalize(h.agent)));
  if (distinct.size < 2) return null;

  // Adjacent same-clause check: if two consecutive hits are separated by
  // only "and" / "&" / "," / whitespace, they are not separate clauses
  // (it's a co-mention like "camber and samber what's good").
  function joinerOnly(slice) {
    const t = slice.replace(/\s+/g, " ").trim();
    return t === "" || t === "and" || t === "&" || t === "," || t === ", and" || t === "and ," || t === "n";
  }

  // Build segments by walking compact hits in order. Each segment runs
  // from one hit to the next hit (or end of string).
  const segments = [];
  for (let i = 0; i < compact.length; i++) {
    const h = compact[i];
    const segStart = h.start + 1; // skip the leading space we padded
    const segEnd =
      i + 1 < compact.length ? compact[i + 1].start + 1 : padded.length - 1;
    const between =
      i + 1 < compact.length
        ? padded.slice(h.start + h.length + 1, compact[i + 1].start + 1)
        : "";
    segments.push({
      agent: h.agent,
      text: padded.slice(segStart, segEnd).trim(),
      joinerToNext: between,
    });
  }

  // Merge adjacent same-agent segments and adjacent co-mention segments.
  const merged = [];
  for (let i = 0; i < segments.length; i++) {
    const cur = segments[i];
    const prev = merged[merged.length - 1];
    const sameAgent = prev && normalize(prev.agent) === normalize(cur.agent);
    const isCoMention =
      prev && joinerOnly(prev.joinerToNext) && !sameAgent;
    if (sameAgent) {
      prev.text = `${prev.text} ${cur.text}`.trim();
      prev.joinerToNext = cur.joinerToNext;
    } else if (isCoMention) {
      // "camber and samber X" — collapse into a multi-agent shared clause
      // marked with a synthetic key so it can be filtered out later.
      prev.agent = `${prev.agent}+${cur.agent}`;
      prev.text = `${prev.text} ${cur.text}`.trim();
      prev.joinerToNext = cur.joinerToNext;
      prev.shared = true;
    } else {
      merged.push({ ...cur });
    }
  }

  // A "real ask" clause: contains "?" OR an action phrase OR has more
  // than 2 content tokens beyond the agent's name(s) at the start.
  function looksLikeAsk(clauseText, agentName) {
    if (!clauseText) return false;
    if (clauseText.includes("?")) return true;
    if (containsAny(clauseText, ACTION_PHRASES)) return true;
    const stripped = clauseText
      .split(" ")
      .filter((tok) => {
        const t = tok.trim();
        if (!t) return false;
        const variants = new Set(
          (Array.isArray(agentName) ? agentName : [agentName])
            .flatMap((nm) => nameVariants(nm)),
        );
        if (variants.has(t)) return false;
        if (t === "and" || t === "&" || t === ",") return false;
        return true;
      });
    return stripped.length > 2;
  }

  // Keep only single-agent merged clauses with a real ask. Discard
  // shared "camber and samber X" segments — those go through the normal
  // greeting / addressed paths.
  const perAgent = {};
  let realAskCount = 0;
  for (const seg of merged) {
    if (seg.shared) continue;
    if (!looksLikeAsk(seg.text, seg.agent)) continue;
    const key = normalize(seg.agent);
    perAgent[key] = (perAgent[key] ? `${perAgent[key]} ` : "") + seg.text;
    realAskCount += 1;
  }
  if (realAskCount < 2) return null;
  if (Object.keys(perAgent).length < 2) return null;
  return perAgent;
}

/**
 * Image-generation intent detector (rule 6).
 */
function isImageRequest(text) {
  const n = normalize(text);
  return (
    /\b(image|picture|photo|pic|drawing|render|illustration|imagine|meme)\b/.test(
      n,
    ) &&
    /\b(make|create|generate|draw|send|custom|gen)\b/.test(n)
  );
}

/**
 * Did a recent human turn (within the last few messages, before the
 * current `humanTurn`) ask for an image? Used to recognize bubble-split
 * image prompts as continuations of the same intent.
 */
function recentHumanImageRequest(transcript, humanTurn) {
  if (!Array.isArray(transcript) || !humanTurn) return false;
  const cap = Math.max(0, humanTurn._index - 1);
  const window = transcript.slice(Math.max(0, cap - 5), cap + 1);
  return window.some(
    (m) => m && m.role === "human" && isImageRequest(m.text || ""),
  );
}

/**
 * Compute the participant counts. If there are >= 3 participants total,
 * or >= 2 humans, or >= 2 AI agents, it's a group chat for governance
 * purposes. (`participants` is optional; callers can pass it explicitly.)
 */
function isGroupChat(input) {
  if (typeof input.isGroupChat === "boolean") return input.isGroupChat;
  const participants = input.participants || [];
  const humans = participants.filter((p) => p.role === "human").length;
  const agents = participants.filter((p) => p.role === "agent").length;
  return participants.length >= 3 || humans >= 2 || agents >= 2;
}

/**
 * Decide whether `selfAgent` should respond, and if so under what
 * constraints. Pure function — no side effects.
 *
 * @param {object}   input
 * @param {object}   input.selfAgent                — { agentName, did, ownerName? }
 * @param {object[]} input.transcript               — chronological messages
 * @param {object[]} [input.participants]           — chat participants
 * @param {boolean}  [input.isGroupChat]            — override for the heuristic
 * @returns {{
 *   respond: boolean,
 *   reason: string,
 *   responseStyle: {
 *     maxSentences: number,
 *     casual: boolean,
 *     allowQuestion: boolean,
 *     allowWebFacts: boolean,
 *     allowLocalRecs: boolean,
 *     forbiddenTopics: string[],
 *     mode: "ack_only" | "image_passthrough" | "normal" | "silent",
 *   },
 *   debug: object,
 * }}
 */
export function decideGroupChatResponse(input) {
  const selfAgent = input?.selfAgent || {};
  const transcript = Array.isArray(input?.transcript) ? input.transcript : [];
  const selfName = selfAgent.agentName || selfAgent.name || null;

  // Rule 10: outside group chats, this governor stays out of the way and
  // emits a permissive default. amber-agent keeps its existing behavior.
  if (!isGroupChat(input)) {
    return {
      respond: true,
      reason: "not_group_chat",
      responseStyle: defaultStyle({ mode: "normal" }),
      debug: { rule: "rule_10_preserve_1to1_behavior" },
    };
  }

  const human = newestHuman(transcript);
  if (!human) {
    return {
      respond: false,
      reason: "no_human_message",
      responseStyle: defaultStyle({ mode: "silent" }),
      debug: {},
    };
  }

  const text = human.text || "";
  const addressed = mentionsName(text, selfName);
  const otherAgentMentioned = (input.participants || [])
    .filter((p) => p.role === "agent")
    .map((p) => p.agentName || p.name)
    .filter((n) => n && normalize(n) !== normalize(selfName))
    .some((n) => mentionsName(text, n));
  const stopCue = containsAny(text, SHUTDOWN_PHRASES);
  // Image-request detection looks at the current turn AND any recent
  // human turn in the transcript — humans split image prompts across
  // bubbles ("can u make custom image" → "caleb coding fireworks"), and
  // the bare prompt fragment alone won't match isImageRequest.
  const recentImageContext = recentHumanImageRequest(transcript, human);
  const imageReq = isImageRequest(text) || recentImageContext;
  const action = containsAny(text, ACTION_PHRASES) || imageReq;

  // Rule 8: hard shutdown / social-cue guard. Default → silent. The only
  // exception is when the human directly named THIS agent AND requested an
  // action; then a single ack is allowed. Even then, do NOT bring up
  // anything from prior context.
  if (stopCue) {
    if (addressed && action) {
      return {
        respond: true,
        reason: "shutdown_cue_but_addressed_and_action",
        responseStyle: defaultStyle({
          mode: imageReq ? "image_passthrough" : "ack_only",
          maxSentences: 1,
          allowQuestion: false,
        }),
        debug: { addressed, action, imageReq, stopCue: true },
      };
    }
    return {
      respond: false,
      reason: "shutdown_cue",
      responseStyle: defaultStyle({ mode: "silent" }),
      debug: { addressed, action, imageReq, stopCue: true },
    };
  }

  // Rule 10: multi-addressed multi-intent. If the newest human message
  // contains separate clauses each directed at a different agent (e.g.
  // "Camber what do you know about cows? Samber what do you know about
  // pigs?"), each named agent answers ONLY its own clause. This must
  // run before rule 7 (other_agent_addressed), because in this case
  // *both* agents are validly addressed — just on different topics.
  const allAgentNames = (input.participants || [])
    .filter((p) => p && p.role === "agent")
    .map((p) => p.agentName || p.name)
    .filter(Boolean);
  const perAgentClauses = splitClausesByAgent(text, allAgentNames);
  if (perAgentClauses) {
    const selfKey = normalize(selfName);
    const myClause = perAgentClauses[selfKey];
    if (myClause) {
      return {
        respond: true,
        reason: "multi_addressed_multi_intent",
        responseStyle: defaultStyle({
          mode: "normal",
          maxSentences: 2,
          allowQuestion: false,
          contextPolicy: "reset_topic",
          currentAgentClause: myClause,
        }),
        debug: {
          multiAddressed: true,
          clauses: perAgentClauses,
          selfClause: myClause,
        },
      };
    }
    // Self is not one of the multi-addressed agents — stay silent.
    return {
      respond: false,
      reason: "multi_addressed_other_agents",
      responseStyle: defaultStyle({ mode: "silent" }),
      debug: { multiAddressed: true, clauses: perAgentClauses },
    };
  }

  // Rule 7: if the newest human message addresses ANOTHER agent (and not
  // us), stay silent. Don't pile on, don't correct, don't extend.
  if (otherAgentMentioned && !addressed) {
    return {
      respond: false,
      reason: "other_agent_addressed",
      responseStyle: defaultStyle({ mode: "silent" }),
      debug: { otherAgentMentioned },
    };
  }

  // Rule 2 (partial): if another AI already replied after this human
  // message, the second-mover stays silent unless explicitly addressed.
  if (
    !addressed &&
    anotherAiRepliedAfter(transcript, human._index, selfName)
  ) {
    return {
      respond: false,
      reason: "another_ai_already_answered",
      responseStyle: defaultStyle({ mode: "silent" }),
      debug: {},
    };
  }

  // Rule 2 (partial): casual banter with no addressee and no action verb.
  if (looksLikeBanter(text, addressed, action)) {
    return {
      respond: false,
      reason: "casual_banter",
      responseStyle: defaultStyle({ mode: "silent" }),
      debug: {},
    };
  }

  // Rule 9: casual greeting / filler addressed at one or more agents.
  // Reset topic context. Only the primary (first-named) addressed agent
  // emits a tiny greeting; co-mentioned non-primary agents stay silent.
  // No prior-context revival, no questions, no venues, no weather.
  if (addressed && isCasualGreeting(text)) {
    const primary = isPrimaryAddressed(
      text,
      selfName,
      input.participants || [],
    );
    if (!primary) {
      return {
        respond: false,
        reason: "casual_greeting_non_primary",
        responseStyle: defaultStyle({
          mode: "silent",
          contextPolicy: "reset_topic",
        }),
        debug: { addressed, greeting: true, primary: false },
      };
    }
    return {
      respond: true,
      reason: "casual_greeting_primary",
      responseStyle: defaultStyle({
        mode: "short_greeting",
        contextPolicy: "reset_topic",
        maxSentences: 1,
        allowQuestion: false,
        allowWebFacts: false,
        allowLocalRecs: false,
      }),
      debug: { addressed, greeting: true, primary: true },
    };
  }

  // Rule 6: image-generation intent → short ack + passthrough.
  if (imageReq) {
    return {
      respond: true,
      reason: "image_request",
      responseStyle: defaultStyle({
        mode: "image_passthrough",
        maxSentences: 1,
        allowQuestion: false,
      }),
      debug: { imageReq: true, addressed },
    };
  }

  // Rule 1: respond if addressed OR if the newest human asks an explicit
  // action. Otherwise stay silent — "unique value" is hard to estimate
  // without an LLM round-trip and the failure mode we are fixing is
  // *over*-responding, so we err on the side of silence.
  if (addressed || action) {
    return {
      respond: true,
      reason: addressed ? "addressed" : "action_requested",
      responseStyle: defaultStyle({
        mode: "normal",
        maxSentences: 2,
        allowQuestion: false,
      }),
      debug: { addressed, action },
    };
  }

  return {
    respond: false,
    reason: "not_addressed_no_action",
    responseStyle: defaultStyle({ mode: "silent" }),
    debug: {},
  };
}

function defaultStyle(overrides = {}) {
  return {
    maxSentences: 1,
    casual: true,
    allowQuestion: false,
    allowWebFacts: false,
    allowLocalRecs: false,
    forbiddenTopics: [...STALE_HALLUCINATION_TOPICS],
    // contextPolicy tells amber-agent how aggressively to drop prior turns
    // before generating. "carry" keeps existing transcript context (the
    // historical default), "reset_topic" instructs the renderer to ignore
    // any prior topic threads and answer only the newest human message.
    // Greeting/shutdown paths set "reset_topic"; normal/image paths carry.
    contextPolicy: "carry",
    mode: "silent",
    // currentAgentClause is set by rule 10 (multi-addressed multi-intent)
    // to the slice of the human message directed at THIS agent. Default
    // null — most paths leave it absent and amber-agent answers the full
    // newest human message.
    currentAgentClause: null,
    ...overrides,
  };
}

// Exports kept narrow on purpose: only the decision function, the rule
// list, and the topic blocklist. Callers should not depend on internal
// helpers.
export const __testing = {
  normalize,
  mentionsName,
  isImageRequest,
  isCasualGreeting,
  isPrimaryAddressed,
  newestHuman,
  anotherAiRepliedAfter,
  looksLikeBanter,
  splitClausesByAgent,
  SHUTDOWN_PHRASES,
  ACTION_PHRASES,
  GREETING_PHRASES,
  STALE_HALLUCINATION_TOPICS,
};
