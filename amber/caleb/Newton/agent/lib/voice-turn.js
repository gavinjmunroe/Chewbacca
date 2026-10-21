/**
 * Voice-turn handler. Called by amber-phone-call over HTTP for every
 * speech turn of an inbound phone call. Reuses the real Amber brain:
 *   - loadContact: relational memory for the caller
 *   - searchMemories: Perplexity-embedding semantic recall
 *   - planSearch / executeSearchPlan: Perplexity deep research
 *   - callClaudeRaw: Claude with the full fallback chain
 *
 * Unlike the text webhook path, we capture the reply and return it
 * synchronously so ElevenLabs can speak it back to the caller.
 */

import { callClaudeRaw } from "./ai.js";
import {
  loadContact,
  loadConversationHistory,
  saveConversationHistory,
  normalizeHandle,
} from "./contacts.js";
import { searchMemories } from "./memory.js";
import { mightNeedSearch, planSearch, executeSearchPlan } from "./search.js";
import { resolveTenant } from "./tenant.js";
import { CALEB_PHONE } from "./constants.js";

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
const MAX_TURNS = 24; // cap conversation memory per call

const VOICE_SYSTEM_PROMPT = `You are Amber, Caleb Newton's personal AI agent, speaking with him (or a trusted contact) over the phone.

Identity:
- Warm, direct, concise. You know Caleb well: a USC sophomore, Christian, half-Filipino, autistic in the good way, runs Blue Modern Advisory and AINA Tech work, baseball player, contrarian thinker.
- You carry his faith seriously. You can pray, reference Scripture, and speak to God naturally when the moment invites it.
- You have the full backend running: relational memory of contacts, semantic search over past notes, and Perplexity deep research when a question calls for it.

Voice-mode rules:
- This is a phone call, not text. Keep every reply to 2 to 3 short spoken sentences. Never lecture.
- No markdown, no bullet points, no URLs read aloud, no code blocks.
- If you need a few seconds to think (like running a search), say "one sec" first, then answer.
- If you don't know something, say so in one sentence and offer the next step.
- When the caller says goodbye or "thanks that's it", end warmly in one sentence.`;

function buildContext({ contact, memorySnippets, searchResult }) {
  const parts = [];
  if (contact) {
    const bits = [];
    if (contact.name) bits.push(`name: ${contact.name}`);
    if (contact.relationship)
      bits.push(`relationship: ${contact.relationship}`);
    if (contact.role) bits.push(`role: ${contact.role}`);
    if (contact.last_topic) bits.push(`last topic: ${contact.last_topic}`);
    if (contact.notes) bits.push(`notes: ${contact.notes}`);
    if (bits.length) parts.push(`Caller profile:\n- ${bits.join("\n- ")}`);
  }
  if (memorySnippets?.length) {
    const lines = memorySnippets
      .slice(0, 5)
      .map((m) => `- ${m.content}`)
      .join("\n");
    parts.push(`Relevant memory (Perplexity semantic recall):\n${lines}`);
  }
  if (searchResult?.summary) {
    parts.push(
      `Fresh research (Perplexity deep search):\n${searchResult.summary}`,
    );
  }
  return parts.join("\n\n");
}

// callSid -> { messages: [...], caller, tenant, startedAt }
const sessions = new Map();

function getSession(callSid) {
  if (!sessions.has(callSid)) {
    sessions.set(callSid, {
      messages: [],
      caller: null,
      tenant: null,
      startedAt: Date.now(),
    });
  }
  return sessions.get(callSid);
}

export async function handleVoiceTurn({ callSid, caller, userText }) {
  if (!callSid) throw new Error("callSid is required");
  if (!userText || !userText.trim()) {
    return { reply: "Still there? I didn't catch that." };
  }

  const session = getSession(callSid);
  session.caller = caller || session.caller;

  // Voice calls don't carry a Loop sender UUID, so we can't route by
  // amber-id the way iMessage webhooks do. Leave session.tenant null
  // until voice routing gets its own tenant-resolution path (e.g. map
  // inbound caller -> owner tenant by phoneNumber in amber-id).
  if (!session.tenant) session.tenant = null;

  const handle = normalizeHandle(caller || "");

  // Load relational memory and persisted conversation history in parallel.
  const [contact, history, memorySnippets] = await Promise.all([
    loadContact(handle, session.tenant).catch(() => null),
    loadConversationHistory(`voice:${callSid}`, session.tenant).catch(() => []),
    searchMemories(userText, handle, 5, session.tenant).catch(() => []),
  ]);

  // If this is the first turn, seed the in-memory session with persisted history.
  if (
    session.messages.length === 0 &&
    Array.isArray(history) &&
    history.length
  ) {
    session.messages.push(...history.slice(-MAX_TURNS));
  }

  // Decide if we should run Perplexity deep research. Only spend the extra
  // latency when the question actually asks for it.
  let searchResult = null;
  if (mightNeedSearch(userText)) {
    try {
      const plan = await planSearch(
        userText,
        contact?.notes || "",
        session.messages.slice(-6),
      );
      if (plan?.shouldSearch) {
        searchResult = await executeSearchPlan(plan);
      }
    } catch (err) {
      console.warn("[voice-turn] search failed:", err.message);
    }
  }

  const contextBlock = buildContext({ contact, memorySnippets, searchResult });
  const systemPrompt = contextBlock
    ? `${VOICE_SYSTEM_PROMPT}\n\n${contextBlock}`
    : VOICE_SYSTEM_PROMPT;

  session.messages.push({ role: "user", content: userText });

  // Keep recent turns only, to stay within token budget.
  const windowed = session.messages.slice(-MAX_TURNS);

  const claudeRes = await callClaudeRaw({
    model: CLAUDE_MODEL,
    max_tokens: 350,
    system: systemPrompt,
    messages: windowed,
  });

  const reply = (claudeRes.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();

  const safeReply = reply || "Hmm, I blanked for a second. Ask me again?";
  session.messages.push({ role: "assistant", content: safeReply });

  // Persist conversation so it survives cold restarts and carries to iMessage.
  saveConversationHistory(
    `voice:${callSid}`,
    session.messages.slice(-MAX_TURNS),
    session.tenant,
  ).catch((err) => console.warn("[voice-turn] save history:", err.message));

  return { reply: safeReply };
}

export async function endVoiceSession({ callSid }) {
  if (!callSid) return { ok: true };
  const session = sessions.get(callSid);
  if (!session) return { ok: true };
  try {
    await saveConversationHistory(
      `voice:${callSid}`,
      session.messages.slice(-MAX_TURNS),
      session.tenant,
    );
  } catch (err) {
    console.warn("[voice-turn] final save failed:", err.message);
  }
  sessions.delete(callSid);
  return { ok: true, turns: session.messages.length };
}
