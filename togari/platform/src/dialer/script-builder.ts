/**
 * @togari/admin â Cold-call script builder.
 *
 * Generates a per-thesis, per-contact cold-call script the Retell agent
 * (or human caller) can run from. Tone is warm, brief, signal-anchored;
 * the opening names the firm and the why-now in roughly 8 seconds, and
 * the meeting offer asks for 15 minutes â not "a quick chat".
 *
 * Returns a typed shape so the dialer co-pilot can render each section
 * separately in the UI.
 */

import { createLogger } from "../observability/logger";
import { SONNET } from "../config/models";

const logger = createLogger("dialer/script-builder");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = SONNET;
const ANTHROPIC_VERSION = "2023-06-01";

export type CallType = "cold_intro" | "follow_up" | "discovery";

export interface ScriptBuilderInput {
  thesis: { name: string; description?: string };
  company: { name: string; description?: string };
  contact: { full_name: string; title: string };
  call_type: CallType;
  /**
   * Optional concrete signal to anchor the opening line. If provided, the
   * script will reference it explicitly ("we noticed you just opened a
   * Greensboro location"). Otherwise the opener leans on the thesis fit.
   */
  signal?: string;
}

export interface ColdCallObjectionHandler {
  objection: string;
  response: string;
}

export interface ColdCallScript {
  opening_line: string;
  qualifying_questions: string[];
  objection_handlers: ColdCallObjectionHandler[];
  meeting_offer: string;
  closing: string;
}

const SCRIPT_SYSTEM_PROMPT = `You write cold-call scripts for a private-equity sourcing firm. Voice rules, in priority order:

1. Warm and brief. Real-human cadence, contractions OK ("we're", "I'd").
2. Never aggressive, never salesy. No "synergy", "leverage", "circle back", "touch base", "I hope this finds you well".
3. The opening line is 8 seconds spoken (~25 words). It must (a) name the firm, (b) name the why-now anchored in a real signal, (c) earn the next 30 seconds. Never start with "How are you doing today".
4. Qualifying questions are open-ended and specific to PE sourcing context (revenue range, owner intent, recent transactions, current PE backing, growth signals). 3-5 questions.
5. Objection handlers are short and respectful. Acknowledge the objection, redirect to value, never argue. Cover at least: "not interested", "we already have a buyer", "send me an email", "where did you get my number". 4-6 handlers total.
6. The meeting offer asks for 15 minutes â be specific. Not "a quick chat".
7. The closing thanks the contact by first name and confirms the next step.

Output strict JSON in the exact shape the user requests. No code fences. No commentary. No prose outside the JSON.`;

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  return key;
}

function buildUserMessage(input: ScriptBuilderInput): string {
  const callTypeLine: Record<CallType, string> = {
    cold_intro: "First-touch cold call. Contact does not know us.",
    follow_up:
      "Follow-up call after prior outreach went unanswered. Reference the prior note briefly.",
    discovery:
      "Discovery call. Contact has agreed to a meeting; explore fit deeper.",
  };

  const signalLine = input.signal
    ? `Signal to anchor the opening line: "${input.signal}"`
    : "No specific signal provided â anchor the opening on thesis fit.";

  const firstName =
    input.contact.full_name.split(/\s+/)[0] || input.contact.full_name;

  return `INVESTMENT THESIS
Name: ${input.thesis.name}
${input.thesis.description ? `Description: ${input.thesis.description}\n` : ""}
COMPANY
${input.company.name}
${input.company.description ? `Description: ${input.company.description}\n` : ""}
CONTACT
${input.contact.full_name} â ${input.contact.title} (call them by first name "${firstName}")

CALL TYPE
${callTypeLine[input.call_type]}

${signalLine}

OUTPUT FORMAT â return ONLY this JSON shape:
{
  "opening_line": "<8-second opening that names firm + why-now>",
  "qualifying_questions": ["<question 1>", "<question 2>", "<question 3>"],
  "objection_handlers": [
    { "objection": "<verbatim objection>", "response": "<warm short redirect>" }
  ],
  "meeting_offer": "<offer 15 minutes, specific day/time framing>",
  "closing": "<thank by first name + confirm next step>"
}`;
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      `No JSON object in script-builder response: ${raw.slice(0, 200)}`,
    );
  }
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0,
  );
}

function asObjectionHandlers(v: unknown): ColdCallObjectionHandler[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const objection =
        typeof o.objection === "string" ? o.objection.trim() : "";
      const response = typeof o.response === "string" ? o.response.trim() : "";
      if (!objection || !response) return null;
      return { objection, response };
    })
    .filter((x): x is ColdCallObjectionHandler => x !== null);
}

export async function buildColdCallScript(
  input: ScriptBuilderInput,
): Promise<ColdCallScript> {
  const apiKey = getApiKey();
  const userMessage = buildUserMessage(input);

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system: SCRIPT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    logger.error(
      "Script builder Claude call failed",
      new Error(`status=${res.status}`),
      {
        status: res.status,
        body: errBody.slice(0, 500),
        company: input.company.name,
      },
    );
    throw new Error(`Anthropic script-builder ${res.status}: ${errBody}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const raw = (data.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text || "")
    .join("")
    .trim();

  const parsed = extractJsonObject(raw);
  const script: ColdCallScript = {
    opening_line:
      typeof parsed.opening_line === "string" ? parsed.opening_line.trim() : "",
    qualifying_questions: asStringArray(parsed.qualifying_questions),
    objection_handlers: asObjectionHandlers(parsed.objection_handlers),
    meeting_offer:
      typeof parsed.meeting_offer === "string"
        ? parsed.meeting_offer.trim()
        : "",
    closing: typeof parsed.closing === "string" ? parsed.closing.trim() : "",
  };

  if (
    !script.opening_line ||
    script.qualifying_questions.length === 0 ||
    !script.meeting_offer
  ) {
    throw new Error(
      `Script builder returned incomplete script: missing required sections. Raw: ${raw.slice(0, 300)}`,
    );
  }

  logger.info("Cold-call script built", {
    company: input.company.name,
    contact: input.contact.full_name,
    call_type: input.call_type,
    questions: script.qualifying_questions.length,
    objections: script.objection_handlers.length,
  });

  return script;
}
