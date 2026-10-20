/**
 * The intro ask a Good path produces: a short note to the customer contact
 * (the champion) asking for the introduction.
 *
 * Drafted by Claude from the path's facts only, then cleaned deterministically
 * — the same belt and braces as reply drafts: the prompt forbids links, em
 * dashes and sign-offs, and the code removes any that slip through anyway.
 * Nothing here sends anything. The draft lands in Slack for a person to edit
 * and copy.
 */

import { SONNET } from "../config/models";
import { stripEmDashes } from "../agents/smartlead-responder/reply-text";
import type { ConnectionPath } from "./paths";

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

const SYSTEM_PROMPT = `You write a short note from someone at a company to one of that company's customers, asking for a warm introduction. A person will read and edit it before sending.

Rules:
- Address the customer by first name: start "Hi <first name>,".
- 50 to 80 words. One short paragraph, two at most.
- Ask, never assert. You may say where someone worked and when, because that is public. Never say or imply that two people know each other, worked together, or have any relationship.
- Use only the facts given. No product claims, no numbers, nothing about rates or what the target pays.
- Make it easy to say no.
- No subject line, no sign-off, no signature, no links, no em dashes or en dashes.
- Never use: "I hope this finds you well", "reach out", "reaching out", "circle back", "touch base", "leverage", "synergy", "quick question", "just wanted to".

Return only the note.`;

/** What the note is for, in the words the prompt and the Slack reply both use. */
export function draftPurpose(p: ConnectionPath): string {
  return p.bridge_relation === "self"
    ? `intro to ${p.buyer_name} at ${p.target_account}`
    : `intro to ${p.bridge_name}, then ${p.buyer_name} at ${p.target_account}`;
}

export function draftUserPrompt(p: ConnectionPath, clientName: string): string {
  const when =
    p.start_year && p.end_year ? ` (${p.start_year} to ${p.end_year})` : p.end_year ? ` (until ${p.end_year})` : "";
  const champion = `${p.champion_name}${p.champion_title ? `, ${p.champion_title}` : ""}${
    p.champion_company ? ` at ${p.champion_company}` : ""
  }`;
  const buyer = `${p.buyer_name}${p.buyer_title ? `, ${p.buyer_title}` : ""}`;
  const ask =
    p.bridge_relation === "self"
      ? `Ask ${firstName(p.champion_name)} whether they would introduce us to ${buyer} at ${p.target_account}, or point us to whoever they would go to there. Mention that they were at ${p.target_account}${when}${p.former_title ? ` as ${p.former_title}` : ""}.`
      : `Ask ${firstName(p.champion_name)} whether they would connect us with their colleague ${p.bridge_name}${p.bridge_title ? ` (${p.bridge_title})` : ""}, who was at ${p.target_account}${when}${p.former_title ? ` as ${p.former_title}` : ""}. Say we hope to reach ${buyer} there, and that ${firstName(p.bridge_name)} may know whether that is the right person.`;
  return [
    `We are ${clientName}. We would like an introduction to ${buyer} at ${p.target_account}.`,
    `Write to: ${champion}. They are our customer.`,
    ask,
  ].join("\n");
}

/** Remove what the prompt forbids but a model may still write. */
export function cleanDraft(text: string): string {
  const lines = stripEmDashes(text)
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/^["']|["']$/g, "")
    .trim()
    .split("\n");
  // A trailing sign-off ("Best," / "Thanks!" / a lone name line after one).
  while (lines.length > 1) {
    const last = lines[lines.length - 1].trim();
    if (last === "" || /^(best|thanks|thank you|cheers|regards|warmly|all the best)[,.!]?$/i.test(last)) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Draft the ask. Throws if Claude cannot be reached or returns nothing. */
export async function draftIntroAsk(p: ConnectionPath, clientName: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: SONNET,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: draftUserPrompt(p, clientName) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as any;
  const text = (data.content ?? [])
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("");
  const draft = cleanDraft(text);
  if (!draft) throw new Error("Claude returned an empty draft");
  return draft;
}
