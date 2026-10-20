/**
 * Smartlead classifier smoke test.
 *
 * Required by Phase 1 scope answer #5: "Smoke tests must cover both
 * Smartlead and non-Smartlead paths so you catch regressions."
 *
 * The Smartlead classifier drafts in a per-client voice (BMA-Sagar by
 * default) that is DIFFERENT from the core/ conversation prompt. The
 * voice now lives in src/agents/replybot/client-config.ts — this test
 * is the regression guard for the default BMA voice and for per-client
 * voice selection.
 */

import { describe, it, expect } from 'vitest';
import { onFetch, getMockState, anthropicText } from './helpers';

import { classifyAndDraft } from '../../src/agents/smartlead-responder/classifier';
import { resolveReplybotClient } from '../../src/agents/replybot/client-config';
import type { SmartleadReply } from '../../src/agents/smartlead-responder/index';

function baseReply(overrides: Partial<SmartleadReply> = {}): SmartleadReply {
  return {
    leadId: 'lead_1',
    leadEmail: 'jane@example.com',
    leadName: 'Jane Doe',
    leadCompany: 'ExampleCo',
    leadTitle: 'VP of Eng',
    replyText: 'Thanks for reaching out — happy to chat next week. Tuesday works.',
    replySubject: 'Re: Intro',
    replyTimestamp: '2026-04-15T10:00:00Z',
    sendingEmail: 'kevin@bluemodernadvisory.com',
    campaignId: 'camp_1',
    campaignName: 'Outbound Q2',
    sequenceStep: 2,
    category: 'Interested',
    messageId: 'msg_abc',
    raw: {},
    ...overrides,
  };
}

describe('smartlead classifier', () => {
  it('calls Claude with the BMA-Sagar system prompt by default and parses the draft', async () => {
    onFetch('api.anthropic.com/v1/messages', () =>
      anthropicText(JSON.stringify({
        draftSubject: 'Re: Intro',
        draftBody: "Sounds good — Tuesday at 2pm ET works on my end. I'll send a calendar invite shortly.\n\nSagar",
        sentiment: 'interested',
        reasoning: 'Lead explicitly wants to talk Tuesday',
      })),
    );

    const result = await classifyAndDraft(baseReply());

    expect(result.action).toBe('auto_draft');
    expect(result.draftSubject).toBe('Re: Intro');
    expect(result.draftBody).toContain('Sagar');
    expect(result.sentiment).toBe('interested');

    const state = getMockState();
    const call = state.fetch.calls.find((c: any) => c.url.includes('api.anthropic.com'));
    expect(call).toBeDefined();
    const body = JSON.parse(call.init.body);
    // Regression guard: the Smartlead prompt is distinct from the core/
    // conversation prompt. These markers must be present or Smartlead tone
    // will change.
    expect(body.system).toContain('Sagar Tiwari');
    expect(body.system).toContain('Blue Modern Advisory');
    expect(body.system).toContain("Sign off as 'Sagar'");
    // Tone-banned phrases must stay listed
    expect(body.system).toContain('circle back');
    // The JSON output contract must always follow the voice prompt
    expect(body.system).toContain('Output strict JSON with these fields');
  });

  it('drafts in a per-client voice when a replybot client is passed', async () => {
    onFetch('api.anthropic.com/v1/messages', () =>
      anthropicText(JSON.stringify({
        draftSubject: 'Re: Intro',
        draftBody: 'Happy to walk you through it.\n\nThe Acme Team',
        sentiment: 'interested',
        reasoning: 'Lead wants details',
      })),
    );

    const client = {
      ...resolveReplybotClient(),
      clientId: 'acme',
      displayName: 'Acme',
      voice: {
        systemPrompt: 'You are drafting replies on behalf of the Acme team. Be concise.',
        signoffName: 'The Acme Team',
        timezone: 'America/New_York',
      },
    };

    const result = await classifyAndDraft(baseReply(), { client });
    expect(result.action).toBe('auto_draft');

    const state = getMockState();
    const call = state.fetch.calls.find((c: any) => c.url.includes('api.anthropic.com'));
    const body = JSON.parse(call.init.body);
    expect(body.system).toContain('on behalf of the Acme team');
    expect(body.system).not.toContain('Sagar Tiwari');
    // Output contract is appended regardless of client voice
    expect(body.system).toContain('Output strict JSON with these fields');
  });

  it('short-circuits to manual_review for "not interested" without calling Claude', async () => {
    const result = await classifyAndDraft(baseReply({ category: 'not interested' }));

    expect(result.action).toBe('manual_review');
    expect(result.sentiment).toBe('not_interested');
    expect(result.draftBody).toBe('');

    const state = getMockState();
    const anthropicCall = state.fetch.calls.find((c: any) => c.url.includes('api.anthropic.com'));
    expect(anthropicCall).toBeUndefined();
  });
});
