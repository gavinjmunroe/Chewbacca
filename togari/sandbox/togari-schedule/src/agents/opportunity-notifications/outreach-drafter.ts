/**
 * Outreach Drafter — Generates recruiter outreach messages for job posting matches.
 *
 * Uses Anthropic Claude to draft personalized outreach messages.
 * Respects guardrails from src/config/guardrails.ts (no fear-based copy, no exploitation).
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  JobPostingMatch,
  RecruiterContact,
  OutreachDraft,
} from './types';

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

export async function draftOutreachMessage(
  posting: JobPostingMatch,
  recruiter: RecruiterContact | null,
  subscriber: { name: string | null; email: string },
): Promise<OutreachDraft> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return buildFallbackDraft(posting, recruiter, subscriber);
  }

  try {
    const client = getAnthropicClient();
    const prompt = buildOutreachPrompt(posting, recruiter, subscriber);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    return parseOutreachResponse(text, posting, recruiter, subscriber);
  } catch (err) {
    process.stderr.write(`Outreach draft error: ${err instanceof Error ? err.message : err}\n`);
    return buildFallbackDraft(posting, recruiter, subscriber);
  }
}

function buildOutreachPrompt(
  posting: JobPostingMatch,
  recruiter: RecruiterContact | null,
  subscriber: { name: string | null },
): string {
  const recruiterSection = recruiter
    ? `Recruiter: ${recruiter.name || 'Hiring Manager'}${recruiter.title ? `, ${recruiter.title}` : ''} at ${recruiter.company}`
    : `Contact: Hiring Manager at ${posting.company}`;

  return `Write a brief, professional outreach message for a job opportunity.

Context:
- Job posting: "${posting.title}" at ${posting.company}
- Job URL: ${posting.url}
- ${recruiterSection}
- Sender: ${subscriber.name || 'a professional'}

Requirements:
- Write a subject line (under 60 chars) and body (under 100 words)
- Be warm, direct, and professional
- Reference the specific job posting
- Express genuine interest, not desperation
- DO NOT use fear-based language, urgency tactics, or manipulative framing
- DO NOT make claims about the sender's qualifications (you don't know them)
- Keep the tone conversational and human

Format your response as:
SUBJECT: [subject line]
BODY: [message body]`;
}

function parseOutreachResponse(
  text: string,
  posting: JobPostingMatch,
  recruiter: RecruiterContact | null,
  subscriber: { name: string | null; email: string },
): OutreachDraft {
  const subjectMatch = text.match(/SUBJECT:\s*(.+?)(?:\n|$)/i);
  const bodyMatch = text.match(/BODY:\s*([\s\S]+)/i);

  if (subjectMatch && bodyMatch) {
    return {
      subject: subjectMatch[1].trim(),
      body: bodyMatch[1].trim(),
    };
  }

  return buildFallbackDraft(posting, recruiter, subscriber);
}

function buildFallbackDraft(
  posting: JobPostingMatch,
  recruiter: RecruiterContact | null,
  subscriber: { name: string | null; email: string },
): OutreachDraft {
  const recipientName = recruiter?.name || 'Hiring Manager';
  const senderName = subscriber.name || 'there';

  return {
    subject: `Re: ${posting.title} at ${posting.company}`,
    body: `Hi ${recipientName},\n\nI came across the ${posting.title} role at ${posting.company} and wanted to reach out. I'd love to learn more about this opportunity and discuss how my background might be a fit.\n\nWould you be open to a brief conversation?\n\nBest,\n${senderName}`,
  };
}

/**
 * Batch draft outreach messages for multiple postings.
 * Uses fallback templates when Anthropic API is unavailable to avoid blocking notifications.
 */
export async function batchDraftOutreach(
  postings: JobPostingMatch[],
  recruiters: Map<string, RecruiterContact>,
  subscriber: { name: string | null; email: string },
): Promise<Map<string, OutreachDraft>> {
  const drafts = new Map<string, OutreachDraft>();

  for (const posting of postings) {
    const recruiter = recruiters.get(posting.company) ?? null;
    const draft = await draftOutreachMessage(posting, recruiter, subscriber);
    drafts.set(posting.url, draft);
  }

  return drafts;
}
