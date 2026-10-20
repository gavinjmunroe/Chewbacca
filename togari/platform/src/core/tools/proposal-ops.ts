/**
 * @togari/core — Transport-agnostic proposal generation
 *
 * Generates professional contract proposals using Claude.
 * Extracted from slack-sync/proposal-generator.ts.
 */

import { createLogger } from '../../observability/logger';
import { SONNET } from '../../config/models';
import { buildDateContext } from '../identity/date-context';
import type { ProposalRequest, ProposalResult } from '../types';

const logger = createLogger('core/proposal-ops');

const PROPOSAL_SYSTEM_PROMPT = `You are a proposal generator for Blue Modern Advisory (BMA), a GTM and data advisory firm. Generate a professional contract proposal based on the meeting transcript, deal context, and any specific instructions provided.

The proposal structure (generate ALL sections):

1. CONTRACT HEADER
- Title: 'Contract Agreement - Retainer'
- Contractor: Blue Modern Advisory (or 'Rytual LLC' if the user doesn't specify)
- Client: [client company name]
- Effective date: leave as [EFFECTIVE DATE] for manual fill

2. SERVICES OVERVIEW
- Project title based on what was discussed
- Brief project overview paragraph

3. SCOPE OF WORK
- Break into numbered sections based on what was discussed in the meeting
- Each section has a title and bullet points of specific deliverables
- Common sections: Data Optimization, Lead Generation, Outbound Campaign Management, Provider/Partner Outreach, Analytics & Reporting
- ONLY include sections relevant to what was discussed — don't pad with generic services

4. PRICING
- Use the deal value from context if available
- If the user specified pricing in their message, use that (it overrides everything)
- Format as: engagement type (POC/retainer/project), duration, fee amount
- Include payment terms: due first of month, 1.5% late penalty, USD, digital invoice

5. TIMELINE
- Break the engagement into phases with approximate durations
- Based on what was discussed

6. TERMS (use this exact legal boilerplate):
- Term: indefinite unless terminated with 10 business days written notice
- Termination: pro-rata fees for completed work, non-refundable
- Contractor is independent contractor, not employee
- Mutual indemnification
- SOC 2-level confidentiality standards
- Neither party discloses agreement terms without written consent
- IP: each party retains their own, jointly created IP discussed separately
- Limitation of liability: capped at 12 months fees
- Governing law: State of New York, County of New York

Return the proposal as clean markdown with proper headers, bullet points, and sections. Do NOT include signature lines or dates — those get added manually.`;

export async function generateProposal(
  request: ProposalRequest,
  // TODO: thread the requester's timezone through from the caller; defaults to Chicago today.
  timezone: string = 'America/Chicago',
): Promise<ProposalResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  console.log(`[core/proposal-ops] Generating proposal for ${request.clientName} at ${request.clientCompany}`);

  // Truncate transcript to first ~3000 words to fit context
  const transcript = request.meetingTranscript || '';
  const transcriptWords = transcript.split(/\s+/);
  const truncatedTranscript = transcriptWords.length > 3000
    ? transcriptWords.slice(0, 3000).join(' ') + '\n\n[... transcript truncated ...]'
    : transcript;

  const userPrompt = [
    `User instructions: ${request.userInstructions || 'Generate a standard proposal based on the meeting.'}`,
    request.pricing ? `Pricing instructions: ${request.pricing}` : '',
    `Client: ${request.clientName} at ${request.clientCompany}`,
    `Deal context: ${request.dealContext || 'No existing CRM data found.'}`,
    transcript ? `Meeting transcript summary: ${transcript.slice(0, 500)}` : '',
    truncatedTranscript ? `Full transcript:\n${truncatedTranscript}` : '',
  ].filter(Boolean).join('\n\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: SONNET,
        max_tokens: 4096,
        system: `${buildDateContext(timezone)}\n\n${PROPOSAL_SYSTEM_PROMPT}`,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API ${response.status}: ${errorBody}`);
    }

    const data = await response.json() as any;
    const markdown = data.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('')
      .trim();

    // Extract a brief summary (first 2 sentences or 200 chars)
    const firstParagraph = markdown.split('\n\n').find((p: string) => p.length > 20 && !p.startsWith('#')) || '';
    const summary = firstParagraph.slice(0, 200) + (firstParagraph.length > 200 ? '...' : '');

    console.log(`[core/proposal-ops] Generated: ${markdown.length} chars`);
    logger.info('Proposal generated', { clientName: request.clientName, clientCompany: request.clientCompany, length: markdown.length });

    return {
      markdown,
      summary,
      clientName: request.clientName,
      clientCompany: request.clientCompany,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[core/proposal-ops] Generation failed:', errMsg);
    logger.error('Proposal generation failed', err instanceof Error ? err : new Error(errMsg), {
      clientName: request.clientName,
      clientCompany: request.clientCompany,
    });
    throw err;
  }
}
