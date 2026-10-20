/**
 * @togari/admin — Email classifier
 *
 * Uses Claude API (raw fetch) to classify emails as TRASH, EASY, or COMPLEX
 * and draft replies for EASY emails.
 */

import { createLogger } from '../observability/logger';
import { SONNET } from '../config/models';
import type { ParsedEmail } from './gmail-client';

const logger = createLogger('EmailClassifier');

export interface ClassificationResult {
  classification: 'TRASH' | 'EASY' | 'COMPLEX';
  confidence: number;
  reason: string;
  draft: string | null;
  summary: string | null;
}

const SYSTEM_PROMPT = `You are an email triage assistant for Blue Modern Advisory (BMA), a GTM and AI consulting agency. Your job is to classify incoming emails and draft replies when appropriate.

BMA offers go-to-market strategy, lead generation, CRM architecture, outbound sales automation, and AI consulting services.

## Classification Rules

Classify every email into exactly ONE of these categories:

### TRASH — Ignore completely, no action needed
- Calendar notifications (meeting scheduled, meeting updated, etc.)
- Do-not-reply automated emails
- Promotional emails and newsletters
- Spam
- Automated system notifications
- Marketing emails from vendors trying to sell to BMA
- Subscription confirmations
- Social media notifications

### EASY — Auto-draft a reply
- Someone requesting basic information about BMA's services
- Someone requesting links, decks, or materials
- Simple follow-ups and check-ins where a brief professional reply works
- Thank you emails that warrant a short acknowledgment
- Simple introductions where the person wants to connect

### COMPLEX — Escalate to Slack, no draft
- Meeting/scheduling requests (someone wants to set up time)
- Partnership proposals or inquiries
- Pricing discussions or custom scope questions
- Negotiation or contract discussions
- Complaints or issues
- Anything requiring strategic thinking or decision-making
- Referral introductions that need a personalized follow-up
- Emails from existing clients about their active engagement
- Anything you're not confident about — when in doubt, classify as COMPLEX

## Response Format

Respond ONLY with valid JSON, no markdown backticks, no preamble:

{
  "classification": "TRASH" | "EASY" | "COMPLEX",
  "confidence": 0.0 to 1.0,
  "reason": "Brief explanation",
  "draft": "Full draft reply text (only if EASY, otherwise null)",
  "summary": "One-line summary for Slack (only for EASY and COMPLEX)"
}

## Draft Reply Guidelines (EASY only)

- Professional but warm tone
- 2-4 sentences max
- Always sign off emails as:\n  Best,\n  Kevin Cong\n  Co-founder\n  Blue Modern Advisory
- Do not make promises or commitments
- Do not share pricing
- For service inquiries, express interest and suggest connecting
- For follow-ups, acknowledge and keep conversation moving
- If they ask for materials, say you'll get those over shortly`;

export async function classifyEmail(
  email: ParsedEmail,
  teamMemberName: string,
): Promise<ClassificationResult> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const userPrompt = `Classify this email and respond with JSON only.

Team member inbox: ${teamMemberName}

From: ${email.fromName} <${email.from}>
To: ${email.to}
Subject: ${email.subject}
Date: ${email.date}

Body:
${email.body}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: SONNET,
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API ${response.status}: ${errorBody}`);
    }

    const data = await response.json() as any;
    const text = data.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('');

    // Strip any accidental markdown fencing
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const result: ClassificationResult = JSON.parse(cleaned);

    // Auto-escalate low-confidence EASY to COMPLEX
    if (result.classification === 'EASY' && result.confidence < 0.7) {
      logger.info('Low confidence EASY, escalating to COMPLEX', {
        subject: email.subject,
        confidence: result.confidence,
      });
      result.classification = 'COMPLEX';
      result.draft = null;
      result.reason = `Auto-escalated: ${result.reason} (confidence ${result.confidence})`;
    }

    logger.info('Classified email', {
      subject: email.subject,
      classification: result.classification,
      confidence: result.confidence,
    });

    return result;
  } catch (err) {
    // On any error, default to COMPLEX so nothing is missed
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`Classification failed, defaulting to COMPLEX: ${errMsg}`, err, {
      subject: email.subject,
      from: email.from,
    });
    console.error('Full classification error:', JSON.stringify(err, null, 2));
    return {
      classification: 'COMPLEX',
      confidence: 0,
      reason: `Classification error: ${err instanceof Error ? err.message : 'unknown'}`,
      draft: null,
      summary: `[Error classifying] ${email.subject}`,
    };
  }
}
