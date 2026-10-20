/**
 * MCP transport smoke tests.
 *
 * Calls handleToolCall directly (same entry point the MCP SDK invokes
 * for each tool). Verifies that each tool produces the expected
 * BigQuery writes, external HTTP calls, and user-facing text blocks.
 *
 * These tests cover the tool surface that Claude.ai uses today and
 * will be rerun after the core/ refactor to ensure MCP behavior is
 * preserved.
 */

import { describe, it, expect } from 'vitest';
import { queueBqRows, onFetch, onAnthropic, getMockState, anthropicText } from './helpers';

import { handleToolCall } from '../../src/transports/mcp/handlers';

describe('mcp handleToolCall', () => {
  it('create_deal writes an INSERT to togari_structured_deals', async () => {
    // No existing deal found via searchDeal (deal-ops uses direct SELECT)
    queueBqRows([]);

    const result = await handleToolCall('create_deal', {
      company: 'Initech',
      contact_name: 'Bill Lumbergh',
      contact_email: 'bill@initech.com',
      value: 12000,
      stage: 'discovery_scheduled',
      pipeline: 'inbound',
      owner: 'kevin',
      notes: 'Demo scheduled for next week',
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('Deal created successfully');
    expect(text).toContain('Initech');
    expect(text).toContain('Bill Lumbergh');
    expect(text).toContain('discovery_scheduled');

    const state = getMockState();
    const insertWrite = state.bq.writes.find((w: any) => /INSERT INTO.*togari_structured_deals/s.test(w.sql));
    expect(insertWrite).toBeDefined();
    expect(insertWrite.params.company).toBe('Initech');
    expect(insertWrite.params.value).toBe(12000);
    expect(insertWrite.params.stage).toBe('discovery_scheduled');
    expect(insertWrite.params.pipeline).toBe('inbound');
  });

  it('update_deal errors cleanly when no matching deal exists', async () => {
    queueBqRows([]);

    const result = await handleToolCall('update_deal', {
      company: 'NonexistentCo',
      updates: { stage: 'negotiating' },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No deal found');
  });

  it('get_deal_context returns CRM context for an existing deal', async () => {
    queueBqRows([{
      deal_id: 'bma_deal_acme_01012026',
      company: 'Acme',
      contact_full_name: 'Sarah Smith',
      contact_email: 'sarah@acme.com',
      stage: 'proposal_sent',
      pipeline: 'outbound',
      value: 15000,
      owner: 'kevin',
      next_action: 'Follow up Friday',
      notes: 'Great discovery call',
    }]);

    const result = await handleToolCall('get_deal_context', { company_name: 'Acme' });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('CRM Context');
    expect(text).toContain('Acme');
    expect(text).toContain('Sarah Smith');
    expect(text).toContain('proposal_sent');
    expect(text).toContain('$15,000');
  });

  it('log_activity inserts a row into the activities table', async () => {
    const result = await handleToolCall('log_activity', {
      company: 'Acme',
      contact_name: 'Sarah',
      activity_type: 'call',
      content: 'Spoke for 20 min about pricing',
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Activity logged');

    const state = getMockState();
    const activityWrite = state.bq.writes.find((w: any) => /INSERT INTO.*activities/s.test(w.sql));
    expect(activityWrite).toBeDefined();
    expect(activityWrite.params.type).toBe('call');
    expect(activityWrite.params.content).toBe('Spoke for 20 min about pricing');
  });

  it('search_meetings queries Fireflies and lists matching meetings', async () => {
    const transcript = {
      id: 'ff_1',
      title: 'Acme Discovery Call',
      date: '2026-04-01',
      duration: 30,
      participants: ['sarah@acme.com', 'kevin@bluemodernadvisory.com'],
      summary: { overview: 'Discussed pricing and scope.', keywords: [], action_items: '', shorthand_bullet: '' },
    };

    // Fireflies answers both the metadata list and the per-id detail query.
    onFetch('api.fireflies.ai/graphql', (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.query.includes('transcripts(')) {
        return { data: { transcripts: [transcript] } };
      }
      return { data: { transcript } };
    });

    // Claude resolver picks the matching transcript id from the list.
    onAnthropic('ff_1');

    const result = await handleToolCall('search_meetings', { query: 'Acme', limit: 5 });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('Acme Discovery Call');
    expect(text).toContain('2026-04-01');
  });

  it('ask_togari routes a greeting to the core conversation handler', async () => {
    // The processMessage path makes two sequential Anthropic calls:
    //   1. intent classifier (returns conversation)
    //   2. handleConversation (returns the chatty reply)
    // Dispatch based on system-prompt content.
    onFetch('api.anthropic.com/v1/messages', (_url, init) => {
      const body = JSON.parse(init.body);
      const sys = body.system || '';
      if (sys.includes('CRM assistant') || sys.includes('Parse')) {
        return anthropicText(JSON.stringify({
          actions: [{ intent: 'conversation', confidence: 95, deal: {} }],
        }));
      }
      return anthropicText('Hi! I can help you manage deals, track pipeline, and more.');
    });

    const result = await handleToolCall('ask_togari', { message: 'hello' });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Hi!');
  });

  it('returns an error for unknown tool names', async () => {
    const result = await handleToolCall('no_such_tool', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });
});
