/**
 * @togari/admin — Smartlead reply classifier
 *
 * Uses Claude API (raw fetch) to classify Smartlead lead replies,
 * draft responses, and optionally classify job posting tracks (SWE/BizOps).
 *
 * The classifier now accepts:
 * - Full conversation history (original outbound + inbound reply)
 * - Campaign strategy (for track classification + LinkedIn profile attachments)
 * - Optional forced track (for ambiguity resolution after human input)
 *
 * Returns sentiment, optional track classification, draft body with
 * attachment links embedded when applicable.
 */

import { createLogger } from '../../observability/logger';
import { SONNET } from '../../config/models';
import { buildDateContext } from '../../core/identity/date-context';
import {
  resolveReplybotClient,
  type ReplybotClientConfig,
  type ReplybotVoice,
} from '../replybot/client-config';
import type { SmartleadReply } from './index';
import type { CampaignStrategy } from './campaign-strategies';
import { stripEmDashes } from './reply-text';

const logger = createLogger('SmartleadClassifier');

export interface ClassificationResult {
  action: 'auto_draft' | 'manual_review';
  draftSubject: string;
  draftBody: string;
  reason: string;
  urgency: 'high' | 'medium' | 'low';
  sentiment?: 'interested' | 'wants_more_info' | 'not_interested' | 'out_of_office' | 'other';
  track?: 'swe' | 'bizops' | 'ambiguous';
  attachmentLinks?: string[];
  /** The upstream model's own confidence in its verdict, 0 to 1, when it gave one. */
  confidence?: number;
}

export interface ClassifierOptions {
  originalOutbound?: string | null;
  strategy?: CampaignStrategy | null;
  forcedTrack?: 'swe' | 'bizops';
  /** Replybot client whose voice/sender the draft is written in. Defaults to BMA. */
  client?: ReplybotClientConfig;
}

// ── Category → tier mapping (kept for manual-review short-circuit) ──

interface CategoryConfig {
  action: 'auto_draft' | 'manual_review';
  urgency: 'high' | 'medium' | 'low';
  sentiment: ClassificationResult['sentiment'];
}

const CATEGORY_MAP: Record<string, CategoryConfig> = {
  'not interested':  { action: 'manual_review', urgency: 'low', sentiment: 'not_interested' },
  'wrong person':    { action: 'manual_review', urgency: 'low', sentiment: 'other' },
};

function getManualReviewConfig(category: string): CategoryConfig | null {
  const key = String(category || '').toLowerCase().trim();
  return CATEGORY_MAP[key] || null;
}

// ── Claude system prompt ─────────────────────────────────────────
// The persona + drafting rules live in the per-client voice config
// (src/agents/replybot/client-config.ts). Only the machine-readable
// output contract is fixed here, appended to every client's voice.

const OUTPUT_CONTRACT = `Output strict JSON with these fields: draftSubject, draftBody, sentiment, reasoning.

Sentiment values: 'interested' (positive, wants to engage), 'wants_more_info' (curious but non-committal), 'not_interested' (explicit no), 'out_of_office' (auto-reply), 'other' (unclear).

draftBody must be plain text with real line breaks. No markdown.`;

// First-touch outreach has no inbound reply, so no sentiment field.
const OUTREACH_CONTRACT = `Output strict JSON with these fields: draftSubject, draftBody, reasoning.

draftBody must be plain text with real line breaks. No markdown.`;

// ── Main classifier function ─────────────────────────────────────

export async function classifyAndDraft(
  reply: SmartleadReply,
  options?: ClassifierOptions,
): Promise<ClassificationResult> {
  const { originalOutbound, strategy, forcedTrack } = options || {};
  const client = options?.client ?? resolveReplybotClient();
  const voice = client.voice;

  // ── Manual-review categories → return immediately, no Claude call ──
  const manualConfig = getManualReviewConfig(reply.category || '');
  if (manualConfig && !forcedTrack) {
    logger.info('Manual-review category, skipping Claude call', {
      category: reply.category,
      leadEmail: reply.leadEmail,
    });
    return {
      action: 'manual_review',
      draftSubject: '',
      draftBody: '',
      reason: `Category "${reply.category}" requires manual review`,
      urgency: manualConfig.urgency,
      sentiment: manualConfig.sentiment,
    };
  }

  // ── Call Claude ──
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const systemPrompt = buildSystemPrompt(voice, strategy, forcedTrack);
    const userPrompt = buildUserPrompt(reply, originalOutbound, strategy, forcedTrack);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: SONNET,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as any;
    const rawText = data.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('');

    // Strip any accidental markdown fencing
    const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const sentiment = parseSentiment(parsed.sentiment);
    const track = parseTrack(parsed.track, forcedTrack);
    const reasoning = parsed.reasoning || '';

    // Post-process: deterministically inject LinkedIn profile URLs
    // Claude never includes URLs — we always append them here.
    let draftBody = parsed.draftBody || '';
    let attachmentLinks: string[] | undefined;

    if (strategy?.attachments?.type === 'linkedin_profiles') {
      const effectiveTrack = forcedTrack || track;
      if (
        effectiveTrack &&
        effectiveTrack !== 'ambiguous' &&
        (sentiment === 'interested' || sentiment === 'wants_more_info')
      ) {
        const urls = strategy.attachments.tracks[effectiveTrack];
        if (urls && urls.length > 0) {
          // Strip any URLs Claude may have hallucinated
          for (const u of urls) {
            draftBody = draftBody.replace(u, '').replace(/\n{3,}/g, '\n\n');
          }
          // Inject the sign-off split: find the client's sign-off and insert URLs before it.
          // Patch I — legacy drafts may still arrive with a 'Kevin' sign-off in
          // flight from the old prompt; accept both as a safety net so URL
          // injection doesn't fall through to the append branch.
          let signoffIdx = draftBody.lastIndexOf('\n' + voice.signoffName);
          if (signoffIdx === -1) signoffIdx = draftBody.lastIndexOf('\nKevin');
          if (signoffIdx !== -1) {
            const beforeSignoff = draftBody.slice(0, signoffIdx).trimEnd();
            const signoff = draftBody.slice(signoffIdx);
            draftBody = beforeSignoff + '\n\n' + urls.join('\n') + signoff;
          } else {
            // No sign-off found — append URLs then sign-off
            draftBody = draftBody.trimEnd() + '\n\n' + urls.join('\n') + '\n\n' + voice.signoffName;
          }
          attachmentLinks = [...urls];
        }
      }
    }

    // Map sentiment → action/urgency for routing
    const action = sentiment === 'not_interested' ? 'manual_review' as const : 'auto_draft' as const;
    const urgency = sentiment === 'interested' ? 'low' as const : sentiment === 'wants_more_info' ? 'low' as const : 'medium' as const;

    logger.info('Draft generated', {
      category: reply.category,
      leadEmail: reply.leadEmail,
      sentiment,
      track,
      hasStrategy: !!strategy,
      forcedTrack: forcedTrack || null,
    });

    // Em dashes read as AI-written, so clients whose voice bans them get a
    // deterministic pass on top of the prompt rule.
    if (voice.banEmDashes) draftBody = stripEmDashes(draftBody);

    return {
      action,
      draftSubject: voice.banEmDashes
        ? stripEmDashes(parsed.draftSubject || `Re: ${reply.replySubject || '(no subject)'}`)
        : parsed.draftSubject || `Re: ${reply.replySubject || '(no subject)'}`,
      draftBody,
      reason: reasoning,
      urgency,
      sentiment,
      track,
      attachmentLinks,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      'Classification failed, defaulting to manual_review',
      err instanceof Error ? err : new Error(errMsg),
      { leadEmail: reply.leadEmail, category: reply.category },
    );
    return {
      action: 'manual_review',
      draftSubject: '',
      draftBody: '',
      reason: `Classification error: ${errMsg}`,
      urgency: 'medium',
      sentiment: 'other',
    };
  }
}

// ── First-touch outreach drafters (form fills, LinkedIn posts) ───

export interface FormFillLead {
  email: string;
  name: string;
  companyName: string;
  companyDescription?: string;
  domain?: string;
  industry?: string;
  companySize?: string;
  title?: string;
  formName?: string;
}

/** Someone who commented on / reacted to / shared a LinkedIn post. */
export interface LinkedInInteractionLead {
  email: string;
  name: string;
  linkedinUrl?: string;
  /** 'comment' | 'reaction' | 'share' (free-form — whatever the source sends). */
  interactionType: string;
  /** e.g. 'like', 'love', 'celebrate' — only set for reactions. */
  reactionType?: string;
  /** Their comment text — only set for comments. */
  commentText?: string;
  postUrl?: string;
  /** What the post was about, when the source provides it. */
  postText?: string;
  companyName?: string;
  title?: string;
}

export interface OutreachResult {
  draftSubject: string;
  draftBody: string;
  reason: string;
}

/**
 * Draft a first-touch email for a website form fill. There is no inbound
 * reply to classify — the client's outreachSystemPrompt frames the task.
 * Throws if the client has no outreach voice configured or the API fails;
 * the caller decides how to surface that in Slack.
 */
export async function draftOutreach(
  lead: FormFillLead,
  client: ReplybotClientConfig,
): Promise<OutreachResult> {
  const lines = [
    `A new lead just filled out a form on our website. Draft the first outreach email to them.`,
    '',
    'What we know:',
    `- Name: ${lead.name || 'Unknown'}`,
    `- Email: ${lead.email}`,
    `- Company: ${lead.companyName || 'Unknown'}`,
  ];
  if (lead.companyDescription) lines.push(`- Company description: ${lead.companyDescription}`);
  if (lead.domain) lines.push(`- Domain: ${lead.domain}`);
  if (lead.industry) lines.push(`- Industry: ${lead.industry}`);
  if (lead.companySize) lines.push(`- Company size: ${lead.companySize}`);
  if (lead.title) lines.push(`- Title: ${lead.title}`);
  if (lead.formName) lines.push(`- Form they filled out: ${lead.formName}`);

  return runOutreachDraft(client, lines.join('\n'), `Welcome — ${client.displayName}`, {
    leadEmail: lead.email,
    companyName: lead.companyName,
  });
}

/**
 * Draft a first-touch email to someone who interacted with the client's
 * LinkedIn post. Same contract as draftOutreach — the client's
 * outreachSystemPrompt frames the task; throws if it's missing or the
 * API fails.
 */
export async function draftLinkedInOutreach(
  lead: LinkedInInteractionLead,
  client: ReplybotClientConfig,
): Promise<OutreachResult> {
  const interaction = (lead.interactionType || '').toLowerCase();
  const engaged =
    interaction === 'comment'
      ? `commented on the post${lead.commentText ? `. Their comment: "${lead.commentText}"` : ' (comment text not captured)'}`
      : interaction === 'share'
        ? 'shared the post with their network'
        : `reacted to the post${lead.reactionType ? ` with "${lead.reactionType}"` : ''}`;

  const lines = [
    `Someone just interacted with one of ${client.sender.name}'s LinkedIn posts. Draft the personal hello email to them.`,
    '',
    'Who they are:',
    `- Name: ${lead.name || 'Unknown'}`,
    `- Email: ${lead.email}`,
  ];
  if (lead.title) lines.push(`- Title: ${lead.title}`);
  if (lead.companyName) lines.push(`- Company: ${lead.companyName}`);
  if (lead.linkedinUrl) lines.push(`- LinkedIn: ${lead.linkedinUrl}`);
  lines.push('', `How they engaged: they ${engaged}`);
  if (lead.postText) lines.push('', `What the post was about:\n${lead.postText}`);

  return runOutreachDraft(client, lines.join('\n'), `Hello from ${client.sender.name}`, {
    leadEmail: lead.email,
    interactionType: lead.interactionType,
  });
}

/**
 * Shared outreach plumbing: system prompt assembly, Claude call, JSON
 * parse, and demo-calendar-link injection. Prompt building stays with
 * the per-shape drafters above.
 */
async function runOutreachDraft(
  client: ReplybotClientConfig,
  userPrompt: string,
  fallbackSubject: string,
  logContext: Record<string, unknown>,
): Promise<OutreachResult> {
  const outreachPrompt = client.voice.outreachSystemPrompt;
  if (!outreachPrompt) {
    throw new Error(`Client "${client.clientId}" has no outreach voice configured`);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const systemPrompt = `${buildDateContext(client.voice.timezone)}\n\n${outreachPrompt}\n\n${OUTREACH_CONTRACT}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: SONNET,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${errorBody}`);
  }

  const data = (await response.json()) as any;
  const rawText = data.content
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('');
  const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  // Tolerate a prose preamble around the JSON object — take the outermost {...}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(`Outreach draft response contained no JSON object: ${cleaned.slice(0, 120)}`);
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1));

  // Deterministically place the demo calendar link just before the sign-off.
  // The prompt has Claude write the lead-in sentence but never the URL, so we
  // strip any it slipped in and insert the real one — same discipline as the
  // LinkedIn-profile injection in classifyAndDraft, so the link can't be
  // mangled or hallucinated.
  let draftBody = parsed.draftBody || '';
  const demoUrl = client.voice.demoCalendarUrl;
  if (demoUrl && draftBody) {
    draftBody = draftBody.replace(demoUrl, '').replace(/\n{3,}/g, '\n\n');
    const signoffIdx = draftBody.lastIndexOf('\n' + client.voice.signoffName);
    if (signoffIdx !== -1) {
      const beforeSignoff = draftBody.slice(0, signoffIdx).trimEnd();
      const signoff = draftBody.slice(signoffIdx);
      draftBody = beforeSignoff + '\n\n' + demoUrl + signoff;
    } else {
      // No sign-off found — append the link at the end as a fallback.
      draftBody = draftBody.trimEnd() + '\n\n' + demoUrl;
    }
  }

  logger.info('Outreach draft generated', {
    clientId: client.clientId,
    ...logContext,
    demoLinkInjected: !!(demoUrl && draftBody),
  });

  if (client.voice.banEmDashes) draftBody = stripEmDashes(draftBody);

  return {
    draftSubject: client.voice.banEmDashes
      ? stripEmDashes(parsed.draftSubject || fallbackSubject)
      : parsed.draftSubject || fallbackSubject,
    draftBody,
    reason: parsed.reasoning || '',
  };
}

// ── Prompt builders ──────────────────────────────────────────────

function buildSystemPrompt(
  voice: ReplybotVoice,
  strategy?: CampaignStrategy | null,
  forcedTrack?: string,
): string {
  let prompt = `${buildDateContext(voice.timezone)}\n\n${voice.systemPrompt}\n\n${OUTPUT_CONTRACT}`;

  if (strategy?.classifierInstructions && !forcedTrack) {
    prompt += `\n\n${strategy.classifierInstructions}\n\nIn addition to the standard fields, also output "track" in your JSON response.`;
  }

  if (forcedTrack) {
    prompt += `\n\nThe role track has been pre-classified as "${forcedTrack}". Set "track" to "${forcedTrack}" in your JSON output. End draftBody with a natural lead-in sentence for past placement profiles before the ${voice.signoffName} sign-off.`;
  } else if (strategy?.attachments?.type === 'linkedin_profiles') {
    prompt += `\n\nWhen sentiment is interested or wants_more_info, end draftBody with a natural lead-in sentence for past placement profiles before the ${voice.signoffName} sign-off. Profile URLs will be appended automatically — do NOT include any URLs yourself.`;
  }

  return prompt;
}

function buildUserPrompt(
  reply: SmartleadReply,
  originalOutbound?: string | null,
  strategy?: CampaignStrategy | null,
  forcedTrack?: string,
): string {
  const today = new Date().toISOString().split('T')[0];

  let prompt = `Today is ${today}. WE cold-emailed this person as part of our outbound campaign. They wrote back. Below is their reply, and you are drafting OUR response to it.

Who they are (the person we cold-emailed):
- Name: ${reply.leadName || 'Unknown'}
- Company: ${reply.leadCompany || 'Unknown'}
- Title: ${reply.leadTitle || 'Unknown'}
- Email: ${reply.leadEmail}
- Our campaign: ${reply.campaignName || 'Unknown'}`;

  if (reply.category) {
    prompt += `\n- Reply category from the sending system: ${reply.category}`;
  }

  if (originalOutbound) {
    prompt += `\n\nThe cold email WE sent them:\n${originalOutbound}`;
  } else {
    prompt += `\n\nOur original cold email is not available to you. Do not guess what it said, do not reference it, and do not describe what we offer in specifics you were not given.`;
  }

  // The subject line belongs to OUR cold email; their reply just inherits
  // it with a "Re:". Labelling it "their subject" is what had the model
  // congratulating prospects on subject lines we wrote ourselves.
  prompt += `\n\nTheir reply (on our thread, subject "${reply.replySubject || '(no subject)'}", which is our own subject line and not theirs):\n${reply.replyText || '(empty)'}`;

  if (forcedTrack) {
    prompt += `\n\nThe track has already been classified as "${forcedTrack}". Use this classification.`;
  }

  return prompt;
}

// ── Response parsers ─────────────────────────────────────────────

function parseSentiment(raw: string | undefined): ClassificationResult['sentiment'] {
  const valid = ['interested', 'wants_more_info', 'not_interested', 'out_of_office', 'other'] as const;
  const val = (raw || '').toLowerCase().trim();
  return (valid as readonly string[]).includes(val)
    ? (val as ClassificationResult['sentiment'])
    : 'other';
}

function parseTrack(
  raw: string | undefined,
  forcedTrack?: string,
): ClassificationResult['track'] {
  if (forcedTrack === 'swe' || forcedTrack === 'bizops') return forcedTrack;
  const valid = ['swe', 'bizops', 'ambiguous'] as const;
  const val = (raw || '').toLowerCase().trim();
  return (valid as readonly string[]).includes(val)
    ? (val as ClassificationResult['track'])
    : undefined;
}
