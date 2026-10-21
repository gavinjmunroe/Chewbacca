/**
 * Amber Q&A Phase 2 — conversational replies + answer detection for question
 * threads. Uses the shared Anthropic client (lib/anthropic-chat.js) — the same
 * one /ask synthesis uses, so there is one place that knows how to talk to a
 * model on the non-chat surfaces. Everything here is fail-safe: any error/empty
 * → null/false so the caller can persist the user's message regardless of LLM
 * availability.
 *
 * This used to import callPerplexityChat from lib/ask.js, which meant the live
 * Amber Q&A feature was billing sonar-pro to write two-sentence replies.
 */

import { callChat } from "./anthropic-chat.js";
import { AMBER_IDENTITY } from "./amber-identity.js";

/**
 * Build the `messages` array for Amber's conversational reply: a
 * system persona/instructions message anchored to the question, followed by the
 * thread transcript mapped to chat roles ('amber' -> 'assistant', 'user' ->
 * 'user') in order.
 *
 * When the question carries `followups` and/or a `waterfall` hint, they are
 * folded into the system prompt as GENTLE, optional guidance (directions Amber
 * *may* explore when the moment fits) — never a script or interrogation.
 */
export function buildReplyMessages(question, messages) {
  let system =
    // Identity from lib/amber-identity.js, so the companion in a thread question
    // is the same Amber as everywhere else rather than "a warm, brief companion".
    `${AMBER_IDENTITY}\n\n` +
    `THIS TURN: you asked the user: "${question?.prompt ?? ""}". ` +
    `Have a natural back-and-forth. They may answer fully, partially, deflect, or talk about ` +
    `something else entirely — that is all fine, never pressure them and never repeat the question ` +
    `verbatim. Keep replies to 1–2 short sentences, plain text, no markdown, no web citations. ` +
    `You do NOT need to end every message with a question. Often just reflect warmly and let it ` +
    `land; ask a follow-up only when it genuinely moves the conversation forward. Vary this ` +
    `naturally so it never feels like an interview.`;

  const followups = Array.isArray(question?.followups)
    ? question.followups.filter((f) => typeof f === "string" && f.trim())
    : [];
  if (followups.length > 0) {
    system +=
      ` Natural directions you can explore if it fits, one at a time, only when the moment is right: ` +
      `${followups.join("; ")}.`;
  }

  if (question?.waterfall === "to_contacts") {
    system +=
      ` Once they've reflected, you may gently bring the conversation toward the specific people in ` +
      `their life this connects to — but never force it, and if no one comes to mind, let it go and ` +
      `stay with them.`;
  } else if (question?.waterfall === "to_personality") {
    system +=
      ` Once they've reflected, you may gently steer toward the trait or pattern in themselves this ` +
      `reveals — but never force it, and if nothing surfaces, let it go and stay with them.`;
  }

  const mapped = (Array.isArray(messages) ? messages : []).map((m) => ({
    role: m.role === "amber" ? "assistant" : "user",
    content: m.content,
  }));
  return [{ role: "system", content: system }, ...mapped];
}

/**
 * Generate Amber's next conversational reply for the thread. Returns the
 * trimmed string, or null on any error / empty response (fail-safe).
 */
export async function generateAmberReply({ question, messages }) {
  try {
    if (!question) return null;
    const text = await callChat({
      messages: buildReplyMessages(question, messages),
    });
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}

// Parse a JSON object out of a model response defensively: strip ``` fences and
// slice to the outer {...}. Returns the parsed object or null.
function parseJsonLoose(text) {
  if (typeof text !== "string") return null;
  let s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * A SEPARATE structured call: decide whether the user has answered the question
 * and, if so, suggest a concise answer (text) or an exact option (multiple
 * choice). Never commits anything. Returns
 *   { answered: boolean, suggestedAnswer: string|null, suggestedChoice: string|null }
 * Any error → { answered:false, suggestedAnswer:null, suggestedChoice:null }.
 */
export async function detectAnswer({ question, messages }) {
  const nullResult = { answered: false, suggestedAnswer: null, suggestedChoice: null };
  try {
    if (!question) return nullResult;
    const isMc = question.answerType === "multiple_choice";
    const options = Array.isArray(question.options) ? question.options : [];
    const prompt = question.prompt ?? "";

    const system = isMc
      ? `Decide if the user has answered the question "${prompt}". Return ONLY JSON. ` +
        `This is a multiple_choice question with options ${JSON.stringify(options)}: ` +
        `{"answered":bool,"choice":string|null} where choice is EXACTLY one of the options or null.`
      : `Decide if the user has answered the question "${prompt}". Return ONLY JSON. ` +
        `This is a text question: {"answered":bool,"answer":string|null} ` +
        `(answer = a concise SYNTHESIS of everything the user conveyed across the ENTIRE ` +
        `conversation in response to the question, in their own voice — NOT just their first ` +
        `sentence).`;

    const transcript = (Array.isArray(messages) ? messages : [])
      .map((m) => `${m.role === "amber" ? "Amber" : "User"}: ${m.content}`)
      .join("\n");

    const text = await callChat({
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Conversation:\n${transcript}` },
      ],
      // A strict-JSON verdict, not prose: a tight ceiling here is a real
      // safeguard, because a model that starts explaining itself produces
      // exactly the unparseable output parseJsonLoose has to throw away.
      maxTokens: 300,
    });

    const parsed = parseJsonLoose(text);
    if (!parsed || typeof parsed !== "object") return nullResult;

    const answered = parsed.answered === true;
    if (isMc) {
      const choice =
        typeof parsed.choice === "string" && options.includes(parsed.choice)
          ? parsed.choice
          : null;
      return { answered, suggestedAnswer: null, suggestedChoice: choice };
    }
    const answer =
      typeof parsed.answer === "string" && parsed.answer.trim()
        ? parsed.answer.trim()
        : null;
    return { answered, suggestedAnswer: answer, suggestedChoice: null };
  } catch {
    return nullResult;
  }
}
