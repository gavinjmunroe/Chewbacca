/**
 * Slack pipeline smoke tests.
 *
 * These tests capture the CURRENT behavior of the Slack bot's core
 * operations: parser → deal sync → calendar sync → query handler.
 * After Phase 1 Step 3, the Slack transport consumes `core/` via
 * `core/engine.executeIntent` and thin wrappers in
 * `src/transports/slack/*.ts`. Fixtures use the flat `ParsedIntent`
 * shape produced by the core intent classifier.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { queueBqRows, onFetch, onAnthropic, getMockState, anthropicText } from './helpers';

import { parseSlackMessage } from '../../src/transports/slack/parser';
import { syncDeal } from '../../src/transports/slack/deal-sync';
import { syncCalendar } from '../../src/transports/slack/calendar-sync';
import { handleQuery } from '../../src/transports/slack/query-handler';
import {
  processSingleAction,
  processSlackMessage,
  _resetPendingClarifications,
  _getPendingClarifications,
} from '../../src/transports/slack/index';
import { executeIntent } from '../../src/core/engine';
import type { ParsedIntent, TogariRequest } from '../../src/core/types';

// ── Helpers to build ParsedIntent fixtures ───────────────────────

function baseParsed(overrides: Partial<ParsedIntent> & Record<string, any> = {}): ParsedIntent {
  return {
    intent: 'new_deal',
    confidence: 90,
    targetPerson: undefined,
    company: undefined,
    contactName: undefined,
    contactEmail: undefined,
    dealValue: undefined,
    stage: undefined,
    pipeline: undefined,
    notes: undefined,
    analysisType: undefined,
    pricingInstructions: undefined,
    meetingTitle: undefined,
    reminderText: undefined,
    reminderTarget: undefined,
    reminderTimes: [],
    calendarDate: undefined,
    calendarTime: undefined,
    calendarDuration: undefined,
    calendarAttendees: [],
    rawFields: {},
    ...overrides,
  };
}

// ================================================================
// Parser
// ================================================================

describe('slack parser', () => {
  it('returns a structured ParsedIntent from a new-deal phrase', async () => {
    onAnthropic(JSON.stringify({
      actions: [{
        intent: 'new_deal',
        confidence: 90,
        company: 'Acme',
        contact_name: 'Sarah',
        deal_value: 5000,
        pipeline: 'outbound',
        stage: 'researching',
      }],
    }));

    const results = await parseSlackMessage('Sarah from Acme wants to work with us on lead gen, 5k a month');

    expect(results).toHaveLength(1);
    expect(results[0].intent).toBe('new_deal');
    expect(results[0].company).toBe('Acme');
    expect(results[0].contactName).toBe('Sarah');
    expect(results[0].dealValue).toBe(5000);
  });

  it('falls back to conversation intent on unparseable Claude response', async () => {
    onAnthropic('this is not valid json at all');

    const results = await parseSlackMessage('hello');

    expect(results).toHaveLength(1);
    expect(results[0].intent).toBe('conversation');
    expect(results[0].confidence).toBe(60);
  });

  it('sends the Slack parser system prompt and claude-sonnet-4 model', async () => {
    onAnthropic(JSON.stringify({ intent: 'conversation', confidence: 90 }));

    await parseSlackMessage('hi');

    const state = getMockState();
    const anthropicCall = state.fetch.calls.find((c: any) => c.url.includes('api.anthropic.com'));
    expect(anthropicCall).toBeDefined();
    const body = JSON.parse(anthropicCall.init.body);
    expect(body.model).toBe('claude-sonnet-4-20250514');
    // Slack-specific prompt markers — must NOT regress during core extraction
    expect(body.system).toContain('Blue Modern Advisory');
    expect(body.system).toContain('NEVER return confidence 0');
  });
});

// ================================================================
// Deal sync
// ================================================================

describe('slack deal sync', () => {
  it('inserts a new deal when intent=new_deal and no match exists', async () => {
    // findExistingDeal → company SELECT → returns no rows
    queueBqRows([]);

    const parsed = baseParsed({
      intent: 'new_deal',
      company: 'Acme',
      contactName: 'Sarah Smith',
      dealValue: 5000,
      stage: 'researching',
      pipeline: 'outbound',
    });

    const result = await syncDeal(parsed, 'U123', 'C123', 'Sarah from Acme 5k');

    expect(result.operation).toBe('inserted');
    expect(result.company).toBe('Acme');
    expect(result.deal_id).toMatch(/^bma_deal_acme_\d{8}$/);

    const state = getMockState();
    // Expect 2 writes: INSERT deal, INSERT activity
    expect(state.bq.writes).toHaveLength(2);
    expect(state.bq.writes[0].sql).toMatch(/^INSERT INTO.*togari_structured_deals/s);
    expect(state.bq.writes[0].params.company).toBe('Acme');
    expect(state.bq.writes[0].params.value).toBe(5000);
    expect(state.bq.writes[0].params.stage).toBe('researching');
    expect(state.bq.writes[0].params.contact_first_name).toBe('Sarah');
    expect(state.bq.writes[0].params.contact_last_name).toBe('Smith');
    expect(state.bq.writes[1].sql).toMatch(/^INSERT INTO.*activities/s);
  });

  it('updates an existing deal when intent=update_deal and match is found', async () => {
    const existingRow = {
      deal_id: 'bma_deal_acme_01012026',
      client_id: 'acme_01012026',
      company: 'Acme',
      stage: 'researching',
      pipeline: 'outbound',
      value: 5000,
      notes: '',
    };
    // searchDeal consumes the first queued result; updateDeal's internal
    // SELECT * consumes the second.
    queueBqRows([existingRow]);
    queueBqRows([existingRow]);

    const parsed = baseParsed({
      intent: 'update_deal',
      company: 'Acme',
      dealValue: 7000,
    });

    const result = await syncDeal(parsed, 'U123', 'C123', 'Acme is paying 7k not 5k');

    expect(result.operation).toBe('updated');
    expect(result.deal_id).toBe('bma_deal_acme_01012026');

    const state = getMockState();
    // Expect 2 writes: UPDATE deal, INSERT activity
    expect(state.bq.writes).toHaveLength(2);
    expect(state.bq.writes[0].sql).toMatch(/^UPDATE/);
    expect(state.bq.writes[0].sql).toContain('togari_structured_deals');
    expect(state.bq.writes[0].params.value).toBe(7000);
    expect(state.bq.writes[1].sql).toMatch(/^INSERT INTO.*activities/s);
  });

  it('logs activity only when intent=log_activity (no deal INSERT/UPDATE)', async () => {
    const parsed = baseParsed({
      intent: 'log_activity',
      company: 'Acme',
    });

    const result = await syncDeal(parsed, 'U123', 'C123', 'had a great call with Acme');

    expect(result.operation).toBe('activity_only');

    const state = getMockState();
    expect(state.bq.writes).toHaveLength(1);
    expect(state.bq.writes[0].sql).toMatch(/^INSERT INTO.*activities/s);
    expect(state.bq.writes[0].params.type).toBe('log_activity');
    expect(state.bq.writes[0].params.content).toBe('had a great call with Acme');
  });

  it('returns conflict (no mutation) when intent=new_deal but deal already exists', async () => {
    queueBqRows([{
      deal_id: 'bma_deal_acme_01012026',
      client_id: 'acme_01012026',
      company: 'Acme',
      stage: 'conversation_started',
      owner: 'U555',
      value: 5000,
    }]);

    const parsed = baseParsed({
      intent: 'new_deal',
      company: 'Acme',
      dealValue: 8000,
    });

    const result = await syncDeal(parsed, 'U123', 'C123', 'add Acme as a new deal');

    expect(result.operation).toBe('conflict');
    expect(result.conflict_deal?.owner).toBe('U555');

    const state = getMockState();
    // Conflict path: still logs activity, never UPDATEs or INSERTs the deal
    expect(state.bq.writes.every((w: any) => /INSERT INTO.*activities/s.test(w.sql))).toBe(true);
  });
});

// ================================================================
// Calendar sync
// ================================================================

describe('slack calendar sync', () => {
  it('creates a calendar event and always includes Kevin as attendee', async () => {
    onFetch('oauth2.googleapis.com/token', { access_token: 'fake-access-token', expires_in: 3599 });
    onFetch('googleapis.com/calendar/v3/calendars/primary/events', {
      id: 'evt_123',
      htmlLink: 'https://calendar.google.com/evt_123',
      summary: 'Kevin & John',
      start: { dateTime: '2026-04-22T15:00:00' },
      end: { dateTime: '2026-04-22T15:30:00' },
    });

    const parsed = baseParsed({
      intent: 'schedule_meeting',
      meetingTitle: 'Kevin & John',
      calendarAttendees: ['john@example.com'],
      calendarDuration: 30,
      rawFields: { calendar: { preferred_times: ['2026-04-22T15:00:00'] } },
    });

    const events = await syncCalendar(parsed);

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('evt_123');

    const state = getMockState();
    const calCall = state.fetch.calls.find((c: any) => c.url.includes('/calendar/v3/calendars/primary/events'));
    expect(calCall).toBeDefined();
    const body = JSON.parse(calCall.init.body);
    expect(body.summary).toBe('Kevin & John');
    const attendeeEmails = (body.attendees as any[]).map(a => a.email);
    expect(attendeeEmails).toContain('kevin@bluemodernadvisory.com');
    expect(attendeeEmails).toContain('john@example.com');
  });
});

// ================================================================
// Query handler
// ================================================================

describe('slack query handler', () => {
  it('generates SQL via Claude, runs SELECT, formats results via Claude', async () => {
    // Two sequential Anthropic calls: SQL gen, then formatting
    let callCount = 0;
    onFetch('api.anthropic.com/v1/messages', () => {
      callCount++;
      if (callCount === 1) {
        return anthropicText('SELECT COUNT(*) AS total FROM `midyear-glazing-485303-u3.togari_data_lake.togari_structured_deals`');
      }
      return anthropicText('You have 42 active deals.');
    });

    // BigQuery SELECT returns one row
    queueBqRows([{ total: 42 }]);

    const parsed = baseParsed({
      intent: 'query',
      rawFields: { query_text: 'How many deals do we have?' },
    });

    const formatted = await handleQuery(parsed);

    expect(formatted).toBe('You have 42 active deals.');

    const state = getMockState();
    expect(state.bq.queries).toHaveLength(1);
    expect(state.bq.queries[0].sql).toMatch(/^SELECT/);
    expect(callCount).toBe(2);
  });

  it('rejects generated SQL that contains dangerous DML keywords', async () => {
    onAnthropic('DELETE FROM `midyear-glazing-485303-u3.togari_data_lake.togari_structured_deals`');

    const parsed = baseParsed({
      intent: 'query',
      rawFields: { query_text: 'delete everything' },
    });

    const result = await handleQuery(parsed);

    expect(result).toContain(':warning:');
    expect(result.toLowerCase()).toContain('read-only');

    const state = getMockState();
    // Must not have executed the dangerous SQL
    expect(state.bq.queries).toHaveLength(0);
    expect(state.bq.writes).toHaveLength(0);
  });
});

// ================================================================
// Phase 1 Step 1b — Regression guards for Step 2/3 refactor
// ================================================================

// ── TEST 20: Progress callback preserved (scope #6) ──────────────
//
// Proposal generation is the canonical long-running flow that emits
// a mid-flow progress message BEFORE the final response. Post Step 3
// the progress message is emitted by `core/engine.executeIntent` via
// the `onProgress` callback that the Slack transport supplies — the
// callback routes to `postTextReply` (WebClient → state.slack.postedMessages).
// The final proposal post goes through raw fetch to slack.com in
// `proposal-output.ts`. If onProgress is dropped, postedMessages will
// be empty and this test fails.

describe('slack progress messages', () => {
  it('emits an intermediate progress message BEFORE the final proposal post', async () => {
    // ── Fireflies: metadata list + per-id detail ──
    const transcriptMeta = {
      id: 'ff_meet_1',
      title: 'John Doe Discovery',
      date: '2026-04-10',
      participants: ['john@example.com', 'kevin@bluemodernadvisory.com'],
      summary: { overview: 'Discussed pricing', action_items: '', keywords: [] },
    };
    const transcriptDetail = {
      ...transcriptMeta,
      duration: 30,
      sentences: [
        { speaker_name: 'Kevin', text: 'Thanks for joining today.' },
        { speaker_name: 'John', text: 'Happy to be here.' },
      ],
      summary: { overview: 'Discussed pricing', action_items: '', shorthand_bullet: '', keywords: [] },
    };
    onFetch('api.fireflies.ai/graphql', (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.query.includes('transcripts(')) {
        return { data: { transcripts: [transcriptMeta] } };
      }
      return { data: { transcript: transcriptDetail } };
    });

    // ── BigQuery: deal-context SELECTs (deals table + activities table) ──
    queueBqRows([]); // deals
    queueBqRows([]); // activities

    // ── Anthropic: up to 2 calls (transcript resolver, proposal generator) ──
    // Both return simple deterministic text; resolver expects a bare ID.
    let anthropicCallCount = 0;
    onFetch('api.anthropic.com/v1/messages', () => {
      anthropicCallCount++;
      if (anthropicCallCount === 1) {
        // resolveTranscript → returns matching transcript id
        return anthropicText('ff_meet_1');
      }
      // generateProposal → returns proposal markdown
      return anthropicText('# Proposal for John\n\nPricing: $7k/mo\n');
    });

    // ── Slack direct-fetch endpoints used by postProposalToSlack ──
    onFetch('slack.com/api/chat.postMessage', { ok: true, ts: '123.456' });
    onFetch('slack.com/api/files.uploadV2', { ok: true, file: { id: 'F1' } });

    const parsed = baseParsed({
      intent: 'generate_proposal',
      targetPerson: 'John Doe',
      pricingInstructions: '7k/mo',
    });

    const result = await processSingleAction(
      parsed,
      'U123',
      'C123',
      '1700000000.000001',
      'generate a proposal for John Doe at 7k monthly',
      'generate a proposal for John Doe at 7k monthly',
    );

    expect(result.success).toBe(true);

    const state = getMockState();

    // The progress message went through WebClient.chat.postMessage (mocked
    // onProgress → postTextReply), so it lands in state.slack.postedMessages.
    const progressMessages = state.slack.postedMessages.filter((m: any) =>
      typeof m.text === 'string' &&
      (m.text.includes(':hourglass_flowing_sand:') || /generat/i.test(m.text)),
    );
    expect(progressMessages.length).toBeGreaterThanOrEqual(1);

    // The final proposal post went via raw fetch to slack.com (not WebClient).
    const finalProposalCalls = state.fetch.calls.filter((c: any) =>
      c.url.includes('slack.com/api/chat.postMessage'),
    );
    expect(finalProposalCalls.length).toBeGreaterThanOrEqual(1);

    // Ordering: progress (WebClient path) must be registered before the
    // final proposal post (fetch path). If onProgress is dropped in Step 3,
    // postedMessages will be empty and the first-index access below fails.
    expect(state.slack.postedMessages[0].text).toMatch(/:hourglass_flowing_sand:|Generating/i);
  });
});

// ── TEST 21: Slack-specific enrichment in deal notes (scope #7) ──
//
// The only Slack-specific enrichment that reaches BigQuery today is
// `rawText` (the full original Slack message text, including `<@U...>`
// mentions) being written to `notes` with a `[YYYY-MM-DD]` date prefix
// by `core/tools/deal-ops.createDeal`.
//
// This test pins that enrichment. If the transport-specific raw Slack
// text (or future permalink) is dropped from the BQ write payload,
// this test fails. Rename/extend the assertion when permalink
// enrichment is actually added.

describe('slack permalink / raw text in deal notes', () => {
  it('embeds the raw Slack message text in the BQ INSERT notes field', async () => {
    queueBqRows([]); // no existing deal

    const rawSlackText = '<@UBOT123> new deal with Acme, Sarah Smith, 5k monthly';
    const parsed = baseParsed({
      intent: 'new_deal',
      company: 'Acme',
      contactName: 'Sarah Smith',
      dealValue: 5000,
      stage: 'researching',
      pipeline: 'outbound',
    });

    await syncDeal(parsed, 'U123', 'C999CHANNEL', rawSlackText);

    const state = getMockState();
    const insert = state.bq.writes.find((w: any) => /^INSERT INTO.*togari_structured_deals/s.test(w.sql));
    expect(insert).toBeDefined();

    // Today's enrichment: date-prefixed raw Slack text (including the <@U...> mention)
    // ends up in the notes column.
    expect(typeof insert.params.notes).toBe('string');
    expect(insert.params.notes).toContain(rawSlackText);
    expect(insert.params.notes).toMatch(/^\[\d{4}-\d{2}-\d{2}\] /);
    // The <@U...> mention is the Slack-transport-specific marker that proves
    // raw transport payload survived into the BQ write.
    expect(insert.params.notes).toContain('<@UBOT123>');
  });
});

// ── TEST 22: Slack transportMetadata survives the request shape (scope #8) ──
//
// Post Phase 1 Step 3: `ParsedSlackMessage` has been collapsed into
// `ParsedIntent` + `transportMetadata`. Slack-specific identifiers
// (userId, channelId, threadTs, rawText) live on
// `TogariRequest.transportMetadata`. Deal ops still receive the rawText
// explicitly so it lands in the BQ `notes` column; the `userId`
// parameter is stamped as the deal `owner`.

describe('slack transportMetadata fields preserved', () => {
  it('threads user_id, channel_id, and thread_ts through the parser+sync pipeline into downstream ops', async () => {
    // Parser returns a new_deal action (flat ParsedIntent shape)
    onAnthropic(JSON.stringify({
      actions: [{
        intent: 'new_deal',
        confidence: 90,
        company: 'ExampleCo',
        contact_name: 'Jane',
        deal_value: 8000,
        pipeline: 'outbound',
        stage: 'researching',
      }],
    }));

    const actions = await parseSlackMessage('Jane at ExampleCo, 8k monthly');
    expect(actions).toHaveLength(1);
    const parsed = actions[0];
    expect(parsed.company).toBe('ExampleCo');
    expect(parsed.contactName).toBe('Jane');
    expect(parsed.dealValue).toBe(8000);

    // Known transport-metadata triplet
    const USER_ID = 'U1_TRANSPORT_TEST';
    const CHANNEL_ID = 'C1_TRANSPORT_TEST';
    const THREAD_TS = '1700000000.111111';
    const RAW_TEXT = `<@UBOT> Jane at ExampleCo, 8k monthly (thread ${THREAD_TS})`;

    // No existing deal
    queueBqRows([]);

    // Run the sync. channel_id and thread_ts are accepted as params today;
    // the processSingleAction entry point wraps these into TogariRequest.transportMetadata
    // for the core engine, while syncDeal continues to receive them directly so the
    // rawText lands in BQ `notes` and slackUser lands in BQ `owner`.
    const result = await syncDeal(parsed, USER_ID, CHANNEL_ID, RAW_TEXT);
    expect(result.operation).toBe('inserted');

    const state = getMockState();
    const insert = state.bq.writes.find((w: any) => /^INSERT INTO.*togari_structured_deals/s.test(w.sql));
    expect(insert).toBeDefined();

    // user_id → owner column (survives into BQ today)
    expect(insert.params.owner).toBe(USER_ID);
    // raw_text (which encodes thread context) → notes column
    expect(insert.params.notes).toContain(RAW_TEXT);
    expect(insert.params.notes).toContain(THREAD_TS);

    // channel_id does NOT currently reach BQ — it's consumed only by the
    // responder/calendar/reminder post-back paths. If Step 2 begins persisting
    // channel_id (e.g. as source_channel), extend this assertion rather than
    // deleting it.
  });
});

// ================================================================
// Phase 1.5a — Reminder owner routing + fuzzy name resolution
// ================================================================
//
// These tests exercise the new mention-resolver (src/core/identity/
// mention-resolver.ts) through the Slack transport's reminder path
// (`processSingleAction` → `handleSlackReminder`).
//
// Shared fixtures:
//
//   - `BMA_USERS` is the 7-person directory in shape matching the
//     tenant-scoped SELECT in user-directory.ts. We queue it as the BQ
//     response whenever a test exercises owner routing.
//   - `onSlackSchedule` registers a fetch handler for Slack's
//     chat.scheduleMessage that captures the outbound channel so
//     assertions can verify *who* received the DM.

interface FakeUserRow {
  user_id: string;
  tenant_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  slack_user_id: string | null;
  slack_display_name: string | null;
  preferred_transport: string | null;
  timezone: string | null;
}

const BMA_USERS: FakeUserRow[] = [
  { user_id: 'usr_kevin_cong', tenant_id: 'bma', email: 'kevin@bluemodernadvisory.com',
    first_name: 'Kevin', last_name: 'Cong', slack_user_id: 'U088N3LT0SU',
    slack_display_name: 'Kevin', preferred_transport: 'slack', timezone: 'America/New_York' },
  { user_id: 'usr_karthik_devarakonda', tenant_id: 'bma', email: 'karthik@bluemodernadvisory.com',
    first_name: 'Karthik', last_name: 'Devarakonda', slack_user_id: 'U08L8PFMWBE',
    slack_display_name: 'Karthik', preferred_transport: 'slack', timezone: 'America/New_York' },
  { user_id: 'usr_sagar_dahiya', tenant_id: 'bma', email: 'sagar@bluemodernadvisory.com',
    first_name: 'Sagar', last_name: 'Dahiya', slack_user_id: 'U087Z8LPMMY',
    slack_display_name: 'Sagar', preferred_transport: 'slack', timezone: 'America/New_York' },
  { user_id: 'usr_mike_placeholder', tenant_id: 'bma', email: 'mike@bluemodernadvisory.com',
    first_name: 'Mike', last_name: null, slack_user_id: null, slack_display_name: null,
    preferred_transport: 'slack', timezone: 'America/New_York' },
  { user_id: 'usr_maggie_placeholder', tenant_id: 'bma', email: 'maggie@bluemodernadvisory.com',
    first_name: 'Maggie', last_name: null, slack_user_id: null, slack_display_name: null,
    preferred_transport: 'slack', timezone: 'America/New_York' },
  { user_id: 'usr_gwen_placeholder', tenant_id: 'bma', email: 'gwen@bluemodernadvisory.com',
    first_name: 'Gwen', last_name: null, slack_user_id: null, slack_display_name: null,
    preferred_transport: 'slack', timezone: 'America/New_York' },
  { user_id: 'usr_caleb_placeholder', tenant_id: 'bma', email: 'caleb@bluemodernadvisory.com',
    first_name: 'Caleb', last_name: null, slack_user_id: null, slack_display_name: null,
    preferred_transport: 'slack', timezone: 'America/New_York' },
];

function queueUsers(users: FakeUserRow[] = BMA_USERS): void {
  queueBqRows(users);
}

function onSlackSchedule(): void {
  onFetch('slack.com/api/chat.scheduleMessage', (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    return {
      ok: true,
      scheduled_message_id: `sm_${body.channel}_${body.post_at}`,
      channel: body.channel,
      post_at: body.post_at,
    };
  });
}

function futureUnix(): number {
  return Math.floor(Date.now() / 1000) + 3600;
}

function getScheduleCalls(): Array<{ channel: string; post_at: number; text: string }> {
  const state = getMockState();
  return state.fetch.calls
    .filter((c: any) => c.url.includes('slack.com/api/chat.scheduleMessage'))
    .map((c: any) => JSON.parse(c.init.body));
}

describe('phase 1.5a — reminder owner routing', () => {
  // ── TEST 23 — Slack mention inside reminder clause routes to owner ──
  it('TEST 23: "remind @kevin" (Slack <@U...> mention) fires at Kevin, not sender', async () => {
    delete process.env.FEATURE_REMINDER_OWNER_ROUTING;
    queueUsers();
    onSlackSchedule();

    const parsed = baseParsed({
      intent: 'set_reminder',
      reminderText: 'touch base with Ramie',
      reminderTarget: '<@U088N3LT0SU>',
      reminderTimes: [futureUnix()],
    });

    const result = await processSingleAction(
      parsed,
      'USENDER999',
      'C123',
      '1700000000.000001',
      '<@UBOT> remind <@U088N3LT0SU> to touch base with Ramie tomorrow',
      'remind <@U088N3LT0SU> to touch base with Ramie tomorrow',
    );

    expect(result.success).toBe(true);
    const calls = getScheduleCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].channel).toBe('U088N3LT0SU');
    expect(calls[0].channel).not.toBe('USENDER999');
  });

  // ── TEST 24 — "remind me" falls back to sender ─────────────────
  it('TEST 24: "remind me" targets the sender', async () => {
    delete process.env.FEATURE_REMINDER_OWNER_ROUTING;
    queueUsers();
    onSlackSchedule();

    const parsed = baseParsed({
      intent: 'set_reminder',
      reminderText: 'call Acme',
      reminderTarget: 'me',
      reminderTimes: [futureUnix()],
    });

    const result = await processSingleAction(
      parsed,
      'USENDER_A',
      'C123',
      '1700000000.000002',
      '<@UBOT> remind me to call Acme',
      'remind me to call Acme',
    );

    expect(result.success).toBe(true);
    const calls = getScheduleCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].channel).toBe('USENDER_A');
  });

  // ── TEST 25 — Plain-text name fuzzy-resolves via togari.users ──
  it('TEST 25: "remind Kevin" (plain text) resolves via togari.users to Kevin\'s slack_user_id', async () => {
    delete process.env.FEATURE_REMINDER_OWNER_ROUTING;
    queueUsers();
    onSlackSchedule();

    const parsed = baseParsed({
      intent: 'set_reminder',
      reminderText: 'follow up with Torben',
      reminderTarget: 'Kevin',
      reminderTimes: [futureUnix()],
    });

    const result = await processSingleAction(
      parsed,
      'USENDER_B',
      'C123',
      '1700000000.000003',
      '<@UBOT> remind Kevin to follow up with Torben next week',
      'remind Kevin to follow up with Torben next week',
    );

    expect(result.success).toBe(true);
    const calls = getScheduleCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].channel).toBe('U088N3LT0SU');
  });

  // ── TEST 26 — @kevin and @sagar → 2 reminders, 2 owners ────────
  it('TEST 26: "remind @kevin and @sagar" creates 2 reminders targeting each owner', async () => {
    delete process.env.FEATURE_REMINDER_OWNER_ROUTING;
    // Two resolver calls → two user-directory SELECTs, so queue twice.
    queueUsers();
    queueUsers();
    onSlackSchedule();

    const RAW = '<@UBOT> remind <@U088N3LT0SU> to ping James and <@U087Z8LPMMY> to draft the SOW';
    const CLEAN = 'remind <@U088N3LT0SU> to ping James and <@U087Z8LPMMY> to draft the SOW';
    const fireAt = futureUnix();

    const kevinAction = baseParsed({
      intent: 'set_reminder',
      reminderText: 'ping James',
      reminderTarget: '<@U088N3LT0SU>',
      reminderTimes: [fireAt],
    });
    const sagarAction = baseParsed({
      intent: 'set_reminder',
      reminderText: 'draft the SOW',
      reminderTarget: '<@U087Z8LPMMY>',
      reminderTimes: [fireAt],
    });

    const r1 = await processSingleAction(kevinAction, 'USENDER_C', 'C123', '1700000000.000004', RAW, CLEAN);
    const r2 = await processSingleAction(sagarAction, 'USENDER_C', 'C123', '1700000000.000004', RAW, CLEAN);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    const calls = getScheduleCalls();
    expect(calls).toHaveLength(2);
    const channels = calls.map((c) => c.channel).sort();
    expect(channels).toEqual(['U087Z8LPMMY', 'U088N3LT0SU']);
  });

  // ── TEST 27 — Ambiguous fuzzy match → clarification, no schedule ──
  it('TEST 27: two users named Kevin → clarification intent, no chat.scheduleMessage call', async () => {
    delete process.env.FEATURE_REMINDER_OWNER_ROUTING;
    // Directory with TWO Kevins — ambiguous plain-text resolution.
    queueUsers([
      ...BMA_USERS,
      { user_id: 'usr_kevin_delacruz', tenant_id: 'bma', email: 'kevin.d@bluemodernadvisory.com',
        first_name: 'Kevin', last_name: 'Delacruz', slack_user_id: 'UKEVIND1',
        slack_display_name: 'KevinD', preferred_transport: 'slack', timezone: 'America/New_York' },
    ]);
    onSlackSchedule();

    const parsed = baseParsed({
      intent: 'set_reminder',
      reminderText: 'send the proposal',
      reminderTarget: 'Kevin',
      reminderTimes: [futureUnix()],
    });

    const result = await processSingleAction(
      parsed,
      'USENDER_D',
      'C123',
      '1700000000.000005',
      '<@UBOT> remind Kevin to send the proposal',
      'remind Kevin to send the proposal',
    );

    expect(result.success).toBe(false);
    expect(result.emoji).toBe(':raised_hand:');
    expect(result.summary.toLowerCase()).toContain('who did you mean');
    // No reminder scheduled.
    expect(getScheduleCalls()).toHaveLength(0);
  });

  // ── TEST 28 — Multi-action message: reminder still routes to Kevin ──
  it('TEST 28: multi-action message with embedded "remind @kevin" routes that reminder to Kevin', async () => {
    delete process.env.FEATURE_REMINDER_OWNER_ROUTING;
    // Only the reminder action fires resolver → one queue
    queueUsers();
    onSlackSchedule();
    // The new_deal action lookup: no existing deal
    queueBqRows([]);

    const RAW = '<@UBOT> partnership: kyle @ exa, remind <@U088N3LT0SU> to text kyle by monday, log that we chatted today';
    const CLEAN = 'partnership: kyle @ exa, remind <@U088N3LT0SU> to text kyle by monday, log that we chatted today';

    const reminderAction = baseParsed({
      intent: 'set_reminder',
      reminderText: 'text Kyle by Monday',
      reminderTarget: '<@U088N3LT0SU>',
      reminderTimes: [futureUnix()],
    });

    const result = await processSingleAction(
      reminderAction, 'USENDER_E', 'C123', '1700000000.000006', RAW, CLEAN,
    );

    expect(result.success).toBe(true);
    const calls = getScheduleCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].channel).toBe('U088N3LT0SU');
  });

  // ── TEST 29 — Feature flag off → legacy sender-as-owner behaviour ──
  it('TEST 29: FEATURE_REMINDER_OWNER_ROUTING=false → @kevin mention falls back to sender', async () => {
    process.env.FEATURE_REMINDER_OWNER_ROUTING = 'false';
    // Resolver must NOT be called; no users queue needed.
    onSlackSchedule();

    const parsed = baseParsed({
      intent: 'set_reminder',
      reminderText: 'do the thing',
      reminderTarget: '<@U088N3LT0SU>',
      reminderTimes: [futureUnix()],
    });

    const result = await processSingleAction(
      parsed,
      'USENDER_F',
      'C123',
      '1700000000.000007',
      '<@UBOT> remind <@U088N3LT0SU> to do the thing',
      'remind <@U088N3LT0SU> to do the thing',
    );

    expect(result.success).toBe(true);
    const calls = getScheduleCalls();
    expect(calls).toHaveLength(1);
    // Legacy behaviour: reminderTarget string goes straight to Slack; here
    // that is the raw `<@U088N3LT0SU>` string. The key property is that
    // the NEW resolver did NOT run (no BQ users SELECT happened).
    expect(calls[0].channel).toBe('<@U088N3LT0SU>');
    const state = getMockState();
    const userLookupCalls = state.bq.queries.filter((q: any) => /togari_data_lake\.users/.test(q.sql));
    expect(userLookupCalls).toHaveLength(0);

    delete process.env.FEATURE_REMINDER_OWNER_ROUTING;
  });

  // ── TEST 30 — Adversarial: sender is Kevin, says "remind me" ───
  it('TEST 30: sender is "Kevin" and says "remind me" → owner is sender, NOT the other Kevin in the table', async () => {
    delete process.env.FEATURE_REMINDER_OWNER_ROUTING;
    queueUsers([
      ...BMA_USERS,
      { user_id: 'usr_other_kevin', tenant_id: 'bma', email: 'kevin.other@example.com',
        first_name: 'Kevin', last_name: 'Other', slack_user_id: 'UOTHERKEV',
        slack_display_name: 'Kevin Other', preferred_transport: 'slack', timezone: 'America/New_York' },
    ]);
    onSlackSchedule();

    const SENDER_SLACK_ID = 'U088N3LT0SU'; // this sender IS Kevin Cong
    const parsed = baseParsed({
      intent: 'set_reminder',
      reminderText: 'call Sarah',
      reminderTarget: 'me',
      reminderTimes: [futureUnix()],
    });

    const result = await processSingleAction(
      parsed,
      SENDER_SLACK_ID,
      'C123',
      '1700000000.000008',
      '<@UBOT> remind me to call Sarah',
      'remind me to call Sarah',
    );

    expect(result.success).toBe(true);
    const calls = getScheduleCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].channel).toBe(SENDER_SLACK_ID);
    expect(calls[0].channel).not.toBe('UOTHERKEV');
  });

  // ── TEST 31 — Adversarial: "remind @everyone" / "remind the team" ──
  it('TEST 31: group words ("everyone", "the team") → owner = sender, no fan-out, no error', async () => {
    delete process.env.FEATURE_REMINDER_OWNER_ROUTING;
    queueUsers();
    queueUsers();
    onSlackSchedule();

    const everyoneAction = baseParsed({
      intent: 'set_reminder',
      reminderText: 'standup at 10',
      reminderTarget: 'everyone',
      reminderTimes: [futureUnix()],
    });
    const teamAction = baseParsed({
      intent: 'set_reminder',
      reminderText: 'submit expenses',
      reminderTarget: 'team',
      reminderTimes: [futureUnix()],
    });

    const r1 = await processSingleAction(
      everyoneAction, 'USENDER_G', 'C123', '1700000000.000009',
      '<@UBOT> remind everyone about standup at 10',
      'remind everyone about standup at 10',
    );
    const r2 = await processSingleAction(
      teamAction, 'USENDER_G', 'C123', '1700000000.000010',
      '<@UBOT> remind the team to submit expenses',
      'remind the team to submit expenses',
    );

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    const calls = getScheduleCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0].channel).toBe('USENDER_G');
    expect(calls[1].channel).toBe('USENDER_G');
  });

  // ── TEST 32 — Adversarial: literal U… in plain text must NOT bind ──
  it('TEST 32: typed literal "U088N3LT0SU" (no <@>) does NOT bind to Kevin', async () => {
    delete process.env.FEATURE_REMINDER_OWNER_ROUTING;
    queueUsers();
    onSlackSchedule();

    // LLM produced reminderTarget = the typed token, but the rawText does
    // NOT contain the <@U...> form — only the bare user ID. Per brief:
    // only Slack-resolved <@U...> tokens are valid mentions.
    const parsed = baseParsed({
      intent: 'set_reminder',
      reminderText: 'do something',
      reminderTarget: 'U088N3LT0SU',
      reminderTimes: [futureUnix()],
    });

    const result = await processSingleAction(
      parsed,
      'USENDER_H',
      'C123',
      '1700000000.000011',
      '<@UBOT> remind U088N3LT0SU to do something',    // literal — no <@>
      'remind U088N3LT0SU to do something',
    );

    expect(result.success).toBe(true);
    const calls = getScheduleCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].channel).toBe('USENDER_H');
    expect(calls[0].channel).not.toBe('U088N3LT0SU');
  });

  // ── TEST 33 — Adversarial: Unicode lookalikes ──────────────────
  it('TEST 33: Unicode lookalike names do NOT auto-match Kevin — clarification only', async () => {
    delete process.env.FEATURE_REMINDER_OWNER_ROUTING;
    queueUsers();
    queueUsers();
    onSlackSchedule();

    // "Kevın" — Turkish dotless lowercase i, codepoint U+0131
    const parsed1 = baseParsed({
      intent: 'set_reminder',
      reminderText: 'ping Carlo',
      reminderTarget: 'Kevın',
      reminderTimes: [futureUnix()],
    });
    const r1 = await processSingleAction(
      parsed1, 'USENDER_I', 'C123', '1700000000.000012',
      '<@UBOT> remind Kevın to ping Carlo',
      'remind Kevın to ping Carlo',
    );
    expect(r1.success).toBe(false);
    expect(r1.emoji).toBe(':raised_hand:');

    // "Кevin" — Cyrillic capital Ke, codepoint U+041A
    const parsed2 = baseParsed({
      intent: 'set_reminder',
      reminderText: 'update the deck',
      reminderTarget: 'Кevin',
      reminderTimes: [futureUnix()],
    });
    const r2 = await processSingleAction(
      parsed2, 'USENDER_I', 'C123', '1700000000.000013',
      '<@UBOT> remind Кevin to update the deck',
      'remind Кevin to update the deck',
    );
    expect(r2.success).toBe(false);
    expect(r2.emoji).toBe(':raised_hand:');

    // No reminder was scheduled for either.
    expect(getScheduleCalls()).toHaveLength(0);
  });

  // ── TEST 34 — Adversarial: SQL injection attempt ───────────────
  it('TEST 34: SQL injection attempt in fuzzy input is parameterized, zero matches, falls back to sender', async () => {
    delete process.env.FEATURE_REMINDER_OWNER_ROUTING;
    queueUsers();
    onSlackSchedule();

    const INJECTION = "'; DROP TABLE users; --";
    const parsed = baseParsed({
      intent: 'set_reminder',
      reminderText: 'do nothing bad',
      reminderTarget: INJECTION,
      reminderTimes: [futureUnix()],
    });

    const result = await processSingleAction(
      parsed,
      'USENDER_J',
      'C123',
      '1700000000.000014',
      `<@UBOT> remind ${INJECTION} to do nothing bad`,
      `remind ${INJECTION} to do nothing bad`,
    );

    expect(result.success).toBe(true);
    // No match found → fell back to sender. Reminder fires at the sender,
    // not at any user, and the injection string was parameterized —
    // visible in the mocked BQ query shape.
    const calls = getScheduleCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].channel).toBe('USENDER_J');

    const state = getMockState();
    const userLookup = state.bq.queries.find((q: any) => /togari_data_lake\.users/.test(q.sql));
    expect(userLookup).toBeDefined();
    // The SELECT itself contains no interpolated SQL — only a @tenantId
    // placeholder. The dangerous string never touches the SQL text.
    expect(userLookup.sql).not.toContain('DROP TABLE');
    expect(userLookup.sql).toContain('@tenantId');
    // And the parameter was passed as a bound value (tenantId is 'bma',
    // not the injection — the injection is matched in-memory, not via SQL).
    expect(userLookup.params.tenantId).toBe('bma');
  });
});

// ================================================================
// Intent classification edge cases (Commit A — silent hallucination
// fix + reminder-vs-meeting linguistic rules)
// ================================================================
//
// Tests 1-4 verify the parser's rawToParsedIntent mapping faithfully
// preserves the intent and key fields from a Claude response that
// follows the new linguistic rules (set_reminder vs schedule_meeting,
// null calendar_time, empty reminder_times). They simulate Claude's
// output rather than the rules themselves — but if the mapping
// regresses (e.g. null calendar_time silently coerced into a default),
// these tests will fail.
//
// Test 5 directly exercises the engine's new field-presence gate:
// schedule_meeting with no calendarTime AND no preferred_times must
// short-circuit with an error asking the user for the time, instead
// of falling back to "tomorrow at 10am" or invoking the calendar API.

describe('intent classification edge cases', () => {
  // 1. "tell Kevin at 3pm Tuesday to text John" → set_reminder
  it('parses "tell Kevin at 3pm Tuesday to text John" as set_reminder', async () => {
    // 3pm Tuesday — exact value doesn't matter, just must be non-empty
    const fireAt = Math.floor(Date.now() / 1000) + 3600;
    onAnthropic(JSON.stringify({
      actions: [{
        intent: 'set_reminder',
        confidence: 90,
        reminder_text: 'text John',
        reminder_target: 'Kevin',
        reminder_times: [fireAt],
      }],
    }));

    const results = await parseSlackMessage('tell Kevin at 3pm Tuesday to text John');

    expect(results).toHaveLength(1);
    expect(results[0].intent).toBe('set_reminder');
    expect(results[0].reminderTarget).toBe('Kevin');
    expect(results[0].reminderTimes).toEqual([fireAt]);
  });

  // 2. "Kevin and I are getting together at 2pm Thursday" → schedule_meeting
  it('parses "Kevin and I are getting together at 2pm Thursday" as schedule_meeting', async () => {
    onAnthropic(JSON.stringify({
      actions: [{
        intent: 'schedule_meeting',
        confidence: 90,
        calendar_date: 'Thursday',
        calendar_time: '2pm',
        calendar_attendees: ['Kevin'],
      }],
    }));

    const results = await parseSlackMessage('Kevin and I are getting together at 2pm Thursday');

    expect(results).toHaveLength(1);
    expect(results[0].intent).toBe('schedule_meeting');
    expect(results[0].calendarAttendees).toEqual(['Kevin']);
  });

  // 3. "schedule Kevin call Tuesday" → schedule_meeting with no time fabricated
  it('parses "schedule Kevin call Tuesday" with calendarTime undefined (no fabrication)', async () => {
    onAnthropic(JSON.stringify({
      actions: [{
        intent: 'schedule_meeting',
        confidence: 85,
        meeting_title: 'Kevin call',
        calendar_date: 'Tuesday',
        calendar_time: null,
        calendar_attendees: ['Kevin'],
      }],
    }));

    const results = await parseSlackMessage('schedule Kevin call Tuesday');

    expect(results).toHaveLength(1);
    expect(results[0].intent).toBe('schedule_meeting');
    expect(results[0].calendarTime).toBeUndefined();
    expect(results[0].calendarDate).toBe('Tuesday');
  });

  // 4. "remind Kevin to text John" (no timing) → set_reminder, empty times
  it('parses "remind Kevin to text John" with reminder_times=[] (no fabrication)', async () => {
    onAnthropic(JSON.stringify({
      actions: [{
        intent: 'set_reminder',
        confidence: 85,
        reminder_text: 'text John',
        reminder_target: 'Kevin',
        reminder_times: [],
      }],
    }));

    const results = await parseSlackMessage('remind Kevin to text John');

    expect(results).toHaveLength(1);
    expect(results[0].intent).toBe('set_reminder');
    expect(results[0].reminderTimes.length).toBe(0);
  });

  // 6. Parser must extract reminder_target = "Kevin" from "tell Kevin
  //    at 9:05pm today to text John". Bug A2 — parser was dropping the
  //    target token, causing the reminder to fire to the sender.
  it('extracts reminder_target from "tell Kevin at 9:05pm today to text John"', async () => {
    const fireAt = Math.floor(Date.now() / 1000) + 3600;
    onAnthropic(JSON.stringify({
      actions: [{
        intent: 'set_reminder',
        confidence: 92,
        reminder_text: 'Text John',
        reminder_target: 'Kevin',
        reminder_times: [fireAt],
      }],
    }));

    const results = await parseSlackMessage('tell Kevin at 9:05pm today to text John');

    expect(results).toHaveLength(1);
    expect(results[0].intent).toBe('set_reminder');
    expect(results[0].reminderTarget).toBe('Kevin');
    expect(results[0].reminderText).toBe('Text John');
  });

  // 7. Day-of-week math anchored to user's TZ. With server-local UTC at
  //    Saturday 02:00 (i.e. Friday 21:00 ET) and the user typing
  //    "Tuesday at 3pm", the resolved Tuesday must be the *following*
  //    Tuesday from the user's POV, not next-week-shifted by the
  //    server-side day boundary.
  it('engine: schedule_meeting Tuesday resolves to user-TZ Tuesday, not server-UTC Tuesday', async () => {
    // Mock getUserTimezone → ET via Slack users.info handler
    onFetch('slack.com/api/users.info', () => ({
      ok: true,
      user: { id: 'UKARTHIK', tz: 'America/New_York' },
    }));

    // OAuth token refresh
    onFetch('oauth2.googleapis.com/token', { access_token: 'fake' });
    // Calendar event creation — capture the body so we can assert the
    // resolved date is a Tuesday in ET.
    onFetch('googleapis.com/calendar/v3/calendars/primary/events', () => ({
      id: 'evt_1',
      htmlLink: 'https://calendar.google.com/event?eid=evt_1',
    }));

    const parsed = baseParsed({
      intent: 'schedule_meeting',
      meetingTitle: 'Kevin call',
      calendarDate: 'Tuesday',
      calendarTime: '3pm',
      calendarAttendees: [],
    });

    const request: TogariRequest = {
      text: 'schedule Kevin call Tuesday at 3pm',
      userId: 'UKARTHIK',
      platform: 'slack',
      transport: 'slack',
    };

    const response = await executeIntent(parsed, request);

    expect(response.type).toBe('meeting_scheduled');

    // Assert the Calendar API was called with start dateTime + ET tz
    const state = getMockState();
    const calCall = state.fetch.calls.find((c: any) =>
      c.url.includes('/calendar/v3/calendars/'),
    );
    expect(calCall).toBeDefined();
    const body = JSON.parse(calCall.init.body);
    expect(body.start.timeZone).toBe('America/New_York');
    expect(body.end.timeZone).toBe('America/New_York');
    // Day-of-week of resolved start, computed in ET, must be Tuesday (2).
    const startDow = new Date(body.start.dateTime).toLocaleString('en-US', {
      weekday: 'short',
    });
    expect(startDow).toBe('Tue');
  });

  // 8. getUserTimezone: returns the tz string from Slack users.info,
  //    falls back to ET on missing/error responses.
  it('getUserTimezone returns Pacific when Slack profile reports it', async () => {
    const { getUserTimezone, _clearTimezoneCache } = await import('../../src/core/identity/slack-profile');
    _clearTimezoneCache();

    onFetch('slack.com/api/users.info', () => ({
      ok: true,
      user: { id: 'UCALEB', tz: 'America/Los_Angeles' },
    }));

    const tz = await getUserTimezone('UCALEB');
    expect(tz).toBe('America/Los_Angeles');
  });

  it('getUserTimezone falls back to ET when Slack returns no tz', async () => {
    const { getUserTimezone, _clearTimezoneCache } = await import('../../src/core/identity/slack-profile');
    _clearTimezoneCache();

    onFetch('slack.com/api/users.info', () => ({
      ok: false,
      error: 'user_not_found',
    }));

    const tz = await getUserTimezone('UNOPE');
    expect(tz).toBe('America/New_York');
  });

  // 9. Slack transport: schedule_meeting with no time must short-circuit
  //    BEFORE syncDeal/syncCalendar. Even though the parser can emit an
  //    ISO date (e.g. "2026-05-13" for "next Tuesday"), no calendar
  //    event must be created and no BigQuery write must occur. The
  //    response must be a natural question, not internal jargon.
  it('processSingleAction: schedule_meeting with calendarDate but no calendarTime asks naturally and creates nothing', async () => {
    onFetch('slack.com/api/users.info', () => ({
      ok: true,
      user: { id: 'UKARTHIK', tz: 'America/New_York' },
    }));

    const parsed = baseParsed({
      intent: 'schedule_meeting',
      meetingTitle: 'Meeting with Kevin',
      calendarDate: '2026-05-12', // ISO date for "next Tuesday"
      calendarTime: undefined,
      calendarAttendees: [],
      rawFields: { calendar: {} },
    });

    const result = await processSingleAction(
      parsed,
      'UKARTHIK',
      'C123',
      '1700000000.000001',
      '<@TOGARI> schedule a meeting with Kevin next Tuesday',
      'schedule a meeting with Kevin next Tuesday',
      'America/New_York',
    );

    expect(result.success).toBe(false);
    // Natural question — no ISO date, no "I need a time for the meeting" jargon
    expect(result.summary.toLowerCase()).toContain('what time');
    expect(result.summary).not.toContain('2026-05-12');
    // Echo the weekday, not the ISO string
    expect(result.summary).toContain('Tuesday');

    const state = getMockState();
    // No calendar API call
    const calCalls = state.fetch.calls.filter((c: any) => c.url.includes('/calendar/v3/calendars/'));
    expect(calCalls).toHaveLength(0);
    // No BQ writes (deal creation / activity log)
    expect(state.bq.writes).toHaveLength(0);
  });

  // 5. Engine: schedule_meeting with no time → type:'error' asking for time
  it('engine: schedule_meeting without calendarTime or preferred_times returns error asking for time', async () => {
    const parsed = baseParsed({
      intent: 'schedule_meeting',
      meetingTitle: 'Kevin call',
      calendarDate: 'Tuesday',
      // calendarTime intentionally undefined; rawFields has no preferred_times
      rawFields: {},
    });

    const request: TogariRequest = {
      text: 'schedule Kevin call Tuesday',
      userId: 'U123',
      platform: 'slack',
      transport: 'slack',
    };

    const response = await executeIntent(parsed, request);

    expect(response.type).toBe('error');
    expect(response.text.toLowerCase()).toContain('what time');
    // No calendar API call should have been made.
    const state = getMockState();
    const calCalls = state.fetch.calls.filter((c: any) =>
      c.url.includes('/calendar/v3/calendars/'),
    );
    expect(calCalls).toHaveLength(0);
  });
});

// ================================================================
// Clarification flow — in-memory pending state for missing fields
// ================================================================

describe('slack clarification flow — schedule_meeting time follow-up', () => {
  beforeEach(() => {
    _resetPendingClarifications();
  });

  // 1. Two-step happy path: bot asks for time, user replies with bare
  //    time in the same thread, calendar event is created from the
  //    merged intent without re-parsing the original phrase.
  it('two-step: time-gate stashes pending, follow-up "3pm" merges and schedules', async () => {
    onFetch('slack.com/api/users.info', () => ({
      ok: true,
      user: { id: 'UKARTHIK', tz: 'America/New_York' },
    }));

    // ── Step A: original mention has a date but no time ──
    // Duration is set so this test focuses purely on the time gate.
    // The duration-gate has its own dedicated tests below.
    const partial = baseParsed({
      intent: 'schedule_meeting',
      meetingTitle: 'Meeting with Kevin',
      contactName: 'Kevin',
      calendarDate: '2026-05-12',
      calendarTime: undefined,
      calendarDuration: 30,
      rawFields: { calendar: { duration_minutes: 30 } },
    });

    const stepA = await processSingleAction(
      partial,
      'UKARTHIK',
      'C123',
      'T_THREAD_A',
      '<@TOGARI> schedule a meeting with Kevin next Tuesday',
      'schedule a meeting with Kevin next Tuesday',
      'America/New_York',
    );

    expect(stepA.success).toBe(false);
    expect(stepA.isClarification).toBe(true);
    expect(stepA.summary.toLowerCase()).toContain('what time');

    const pendingMap = _getPendingClarifications();
    expect(pendingMap.has('T_THREAD_A')).toBe(true);
    expect(pendingMap.get('T_THREAD_A')!.awaitingField).toBe('calendar_time');

    // ── Step B: follow-up reply is just "3pm" — parser must be
    //   skipped, calendar event must be created from merged intent ──
    onFetch('oauth2.googleapis.com/token', { access_token: 'fake-access-token', expires_in: 3599 });
    onFetch('googleapis.com/calendar/v3/calendars/primary/events', {
      id: 'evt_resumed',
      htmlLink: 'https://calendar.google.com/evt_resumed',
      summary: 'Meeting with Kevin',
      start: { dateTime: '2026-05-12T15:00:00' },
      end: { dateTime: '2026-05-12T15:30:00' },
    });

    await processSlackMessage(
      '3pm',
      'UKARTHIK',
      'C123',
      'T_THREAD_A',
      '<@TOGARI> 3pm',
    );

    // Pending entry consumed
    expect(_getPendingClarifications().has('T_THREAD_A')).toBe(false);

    const state = getMockState();

    // Parser was bypassed — no Anthropic call on the resume
    const anthropicCalls = state.fetch.calls.filter((c: any) =>
      c.url.includes('api.anthropic.com'),
    );
    expect(anthropicCalls).toHaveLength(0);

    // Calendar event was created with the merged time
    const calCall = state.fetch.calls.find((c: any) =>
      c.url.includes('/calendar/v3/calendars/primary/events'),
    );
    expect(calCall).toBeDefined();
    const body = JSON.parse(calCall!.init.body);
    // Title carried over from the stashed intent
    expect(body.summary).toBe('Meeting with Kevin');
    // Start time uses the user-supplied 15:00 (3pm) on the stored date
    expect(body.start.dateTime).toBe('2026-05-12T15:00:00');
  });

  // 2. Stale clarification (>15 min): the entry must be dropped on
  //    access, the parser must run normally, and no resume must
  //    happen — the user has clearly moved on.
  it('stale (>15 min): entry is deleted on next mention and parser runs normally', async () => {
    onFetch('slack.com/api/users.info', () => ({
      ok: true,
      user: { id: 'UKARTHIK', tz: 'America/New_York' },
    }));

    // Manually plant a stale pending entry — 16 minutes old
    const stalePartial = baseParsed({
      intent: 'schedule_meeting',
      meetingTitle: 'Stale meeting',
      calendarDate: '2026-05-12',
      rawFields: { calendar: {} },
    });
    _getPendingClarifications().set('T_THREAD_STALE', {
      intent: stalePartial,
      slackUser: 'UKARTHIK',
      channel: 'C123',
      threadTs: 'T_THREAD_STALE',
      awaitingField: 'calendar_time',
      createdAt: Date.now() - 16 * 60 * 1000,
    });

    // Parser will be invoked — return a low-confidence conversation
    // intent so processSlackMessage takes the clarification-message
    // branch and doesn't try to do real work.
    onAnthropic(JSON.stringify({
      actions: [{ intent: 'conversation', confidence: 30 }],
    }));

    await processSlackMessage(
      '3pm',
      'UKARTHIK',
      'C123',
      'T_THREAD_STALE',
      '<@TOGARI> 3pm',
    );

    // Stale entry was deleted
    expect(_getPendingClarifications().has('T_THREAD_STALE')).toBe(false);

    // Parser DID run (anthropic was called) — we did not silently resume
    const state = getMockState();
    const anthropicCalls = state.fetch.calls.filter((c: any) =>
      c.url.includes('api.anthropic.com'),
    );
    expect(anthropicCalls.length).toBeGreaterThanOrEqual(1);

    // No calendar event was created from the stale intent
    const calCalls = state.fetch.calls.filter((c: any) =>
      c.url.includes('/calendar/v3/calendars/'),
    );
    expect(calCalls).toHaveLength(0);
  });

  // 3. Different thread: a pending clarification on thread A must
  //    NOT be consumed by a time message arriving on thread B. The
  //    threads are independent conversations.
  it('different thread: time message on thread B leaves thread A pending intact', async () => {
    onFetch('slack.com/api/users.info', () => ({
      ok: true,
      user: { id: 'UKARTHIK', tz: 'America/New_York' },
    }));

    // Plant a fresh pending on thread A
    const partialA = baseParsed({
      intent: 'schedule_meeting',
      meetingTitle: 'Thread A meeting',
      calendarDate: '2026-05-12',
      rawFields: { calendar: {} },
    });
    _getPendingClarifications().set('T_THREAD_A', {
      intent: partialA,
      slackUser: 'UKARTHIK',
      channel: 'C123',
      threadTs: 'T_THREAD_A',
      awaitingField: 'calendar_time',
      createdAt: Date.now(),
    });

    // Anthropic returns a benign conversation result for thread B
    onAnthropic(JSON.stringify({
      actions: [{ intent: 'conversation', confidence: 30 }],
    }));

    await processSlackMessage(
      '3pm',
      'UKARTHIK',
      'C123',
      'T_THREAD_B', // <-- different thread
      '<@TOGARI> 3pm',
    );

    // Thread A's pending entry is still there — untouched
    expect(_getPendingClarifications().has('T_THREAD_A')).toBe(true);
    // Thread B never had a pending entry
    expect(_getPendingClarifications().has('T_THREAD_B')).toBe(false);

    // Parser ran for thread B
    const state = getMockState();
    const anthropicCalls = state.fetch.calls.filter((c: any) =>
      c.url.includes('api.anthropic.com'),
    );
    expect(anthropicCalls.length).toBeGreaterThanOrEqual(1);

    // No calendar event was created — neither thread A's pending nor
    // thread B's bare "3pm" message produces a meeting on its own
    const calCalls = state.fetch.calls.filter((c: any) =>
      c.url.includes('/calendar/v3/calendars/'),
    );
    expect(calCalls).toHaveLength(0);
  });

  // 4. Wrong-type reply during a calendar_time clarification re-prompts
  //    instead of falling through to the LLM parser. Strict dispatch on
  //    awaitingField — a reply with no time marker keeps the pending
  //    intact and asks "What time?" again. The old fall-through
  //    behavior silently re-classified replies as new intents and
  //    dropped the stored calendarDate.
  it('wrong-type reply during calendar_time clarification: re-prompts and preserves pending', async () => {
    onFetch('slack.com/api/users.info', () => ({
      ok: true,
      user: { id: 'UKARTHIK', tz: 'America/New_York' },
    }));

    const partial = baseParsed({
      intent: 'schedule_meeting',
      meetingTitle: 'Old pending',
      calendarDate: '2026-05-12',
      rawFields: { calendar: {} },
    });
    _getPendingClarifications().set('T_THREAD_PIVOT', {
      intent: partial,
      slackUser: 'UKARTHIK',
      channel: 'C123',
      threadTs: 'T_THREAD_PIVOT',
      awaitingField: 'calendar_time',
      createdAt: Date.now(),
    });

    await processSlackMessage(
      'log activity for Acme — talked to legal',
      'UKARTHIK',
      'C123',
      'T_THREAD_PIVOT',
      '<@TOGARI> log activity for Acme — talked to legal',
    );

    // Pending entry preserved — strict dispatch means we re-prompt.
    expect(_getPendingClarifications().has('T_THREAD_PIVOT')).toBe(true);

    // Parser was NOT called — we don't fall through to the LLM.
    const state = getMockState();
    const anthropicCalls = state.fetch.calls.filter((c: any) =>
      c.url.includes('api.anthropic.com'),
    );
    expect(anthropicCalls).toHaveLength(0);

    // No calendar event was created.
    const calCalls = state.fetch.calls.filter((c: any) =>
      c.url.includes('/calendar/v3/calendars/'),
    );
    expect(calCalls).toHaveLength(0);
  });
});

// ================================================================
// Duration clarification flow — implied defaults, prompt+resume,
// multi-step chaining, and deterministic phrase parsing.
// ================================================================

import {
  resolveDurationPhrase,
  resolveImpliedDuration,
} from '../../src/core/identity/date-resolver';

describe('slack clarification flow — schedule_meeting duration follow-up', () => {
  beforeEach(() => {
    _resetPendingClarifications();
  });

  // 1. No duration mentioned, no implied keyword → asks for duration
  //    and stashes the partial intent. No calendar event yet.
  it('time present, no duration, no keyword: returns duration prompt and stores pending', async () => {
    const partial = baseParsed({
      intent: 'schedule_meeting',
      meetingTitle: 'Meeting with Kevin',
      contactName: 'Kevin',
      calendarDate: '2026-05-12',
      calendarTime: '15:00',
      rawFields: { calendar: { preferred_times: ['15:00'] } },
    });

    const result = await processSingleAction(
      partial,
      'UKARTHIK',
      'C123',
      'T_THREAD_DUR_A',
      '<@TOGARI> schedule a meeting with Kevin Tuesday at 3pm',
      'schedule a meeting with Kevin Tuesday at 3pm',
      'America/New_York',
    );

    expect(result.success).toBe(false);
    expect(result.isClarification).toBe(true);
    expect(result.summary).toBe('How long should the meeting be?');

    const pending = _getPendingClarifications().get('T_THREAD_DUR_A');
    expect(pending).toBeDefined();
    expect(pending!.awaitingField).toBe('calendar_duration');

    // No calendar API call was made
    const state = getMockState();
    const calCalls = state.fetch.calls.filter((c: any) =>
      c.url.includes('/calendar/v3/calendars/'),
    );
    expect(calCalls).toHaveLength(0);
  });

  // 2. After duration prompt, user replies "30 min" → meeting created
  //    with duration=30, parser is bypassed.
  it('duration follow-up "30 min" merges and schedules', async () => {
    onFetch('slack.com/api/users.info', () => ({
      ok: true,
      user: { id: 'UKARTHIK', tz: 'America/New_York' },
    }));

    // Plant a fresh pending duration clarification — time already known.
    const partial = baseParsed({
      intent: 'schedule_meeting',
      meetingTitle: 'Meeting with Kevin',
      contactName: 'Kevin',
      calendarDate: '2026-05-12',
      calendarTime: '15:00',
      rawFields: { calendar: { preferred_times: ['15:00'] } },
    });
    _getPendingClarifications().set('T_THREAD_DUR_B', {
      intent: partial,
      slackUser: 'UKARTHIK',
      channel: 'C123',
      threadTs: 'T_THREAD_DUR_B',
      awaitingField: 'calendar_duration',
      originalText: 'schedule a meeting with Kevin Tuesday at 3pm',
      createdAt: Date.now(),
    });

    onFetch('oauth2.googleapis.com/token', { access_token: 'fake', expires_in: 3599 });
    onFetch('googleapis.com/calendar/v3/calendars/primary/events', {
      id: 'evt_dur',
      htmlLink: 'https://calendar.google.com/evt_dur',
      summary: 'Meeting with Kevin',
      start: { dateTime: '2026-05-12T15:00:00' },
      end: { dateTime: '2026-05-12T15:30:00' },
    });

    await processSlackMessage(
      '30 min',
      'UKARTHIK',
      'C123',
      'T_THREAD_DUR_B',
      '<@TOGARI> 30 min',
    );

    // Pending consumed
    expect(_getPendingClarifications().has('T_THREAD_DUR_B')).toBe(false);

    const state = getMockState();
    // Parser was bypassed — no Anthropic call on duration resume
    const anthropicCalls = state.fetch.calls.filter((c: any) =>
      c.url.includes('api.anthropic.com'),
    );
    expect(anthropicCalls).toHaveLength(0);

    // Calendar event created with duration = 30
    const calCall = state.fetch.calls.find((c: any) =>
      c.url.includes('/calendar/v3/calendars/primary/events'),
    );
    expect(calCall).toBeDefined();
    const body = JSON.parse(calCall!.init.body);
    expect(body.summary).toBe('Meeting with Kevin');
    expect(body.start.dateTime).toBe('2026-05-12T15:00:00');
    expect(body.end.dateTime).toBe('2026-05-12T15:30:00');
  });

  // 3. "quick call" implies 15-minute default → no prompt, meeting created.
  it('"quick call" implies 15min default — no clarification, meeting created', async () => {
    onFetch('oauth2.googleapis.com/token', { access_token: 'fake', expires_in: 3599 });
    onFetch('googleapis.com/calendar/v3/calendars/primary/events', {
      id: 'evt_quick',
      htmlLink: 'https://calendar.google.com/evt_quick',
      summary: 'Meeting with Kevin',
      start: { dateTime: '2026-05-12T15:00:00' },
      end: { dateTime: '2026-05-12T15:15:00' },
    });

    const partial = baseParsed({
      intent: 'schedule_meeting',
      meetingTitle: 'Meeting with Kevin',
      contactName: 'Kevin',
      calendarDate: '2026-05-12',
      calendarTime: '15:00',
      rawFields: { calendar: { preferred_times: ['15:00'] } },
    });

    const result = await processSingleAction(
      partial,
      'UKARTHIK',
      'C123',
      'T_THREAD_QUICK',
      '<@TOGARI> schedule quick call with Kevin Tuesday at 3pm',
      'schedule quick call with Kevin Tuesday at 3pm',
      'America/New_York',
    );

    // No clarification — implied default applied silently
    expect(result.isClarification).not.toBe(true);
    expect(_getPendingClarifications().has('T_THREAD_QUICK')).toBe(false);

    // Calendar event was created with duration = 15
    const state = getMockState();
    const calCall = state.fetch.calls.find((c: any) =>
      c.url.includes('/calendar/v3/calendars/primary/events'),
    );
    expect(calCall).toBeDefined();
    const body = JSON.parse(calCall!.init.body);
    // 15:00 → 15:15 = 15 minutes
    expect(body.start.dateTime).toBe('2026-05-12T15:00:00');
    expect(body.end.dateTime).toBe('2026-05-12T15:15:00');
  });

  // 4. "1:1" implies 30-minute default → no prompt, meeting created.
  it('"1:1" implies 30min default — no clarification', async () => {
    onFetch('oauth2.googleapis.com/token', { access_token: 'fake', expires_in: 3599 });
    onFetch('googleapis.com/calendar/v3/calendars/primary/events', {
      id: 'evt_1on1',
      htmlLink: 'https://calendar.google.com/evt_1on1',
      summary: '1:1 with Kevin',
      start: { dateTime: '2026-05-12T15:00:00' },
      end: { dateTime: '2026-05-12T15:30:00' },
    });

    const partial = baseParsed({
      intent: 'schedule_meeting',
      meetingTitle: '1:1 with Kevin',
      contactName: 'Kevin',
      calendarDate: '2026-05-12',
      calendarTime: '15:00',
      rawFields: { calendar: { preferred_times: ['15:00'] } },
    });

    const result = await processSingleAction(
      partial,
      'UKARTHIK',
      'C123',
      'T_THREAD_1ON1',
      '<@TOGARI> schedule 1:1 with Kevin Tuesday at 3pm',
      'schedule 1:1 with Kevin Tuesday at 3pm',
      'America/New_York',
    );

    expect(result.isClarification).not.toBe(true);
    expect(_getPendingClarifications().has('T_THREAD_1ON1')).toBe(false);

    const state = getMockState();
    const calCall = state.fetch.calls.find((c: any) =>
      c.url.includes('/calendar/v3/calendars/primary/events'),
    );
    expect(calCall).toBeDefined();
    const body = JSON.parse(calCall!.init.body);
    // 15:00 → 15:30 = 30 minutes
    expect(body.start.dateTime).toBe('2026-05-12T15:00:00');
    expect(body.end.dateTime).toBe('2026-05-12T15:30:00');
  });

  // 5. Two-step chain: time-gate → time reply → duration-gate →
  //    duration reply → meeting created.
  it('two-step chain: time then duration both prompt-and-resume', async () => {
    onFetch('slack.com/api/users.info', () => ({
      ok: true,
      user: { id: 'UKARTHIK', tz: 'America/New_York' },
    }));

    // ── Step A: original mention has date but no time (and no
    //   duration). Time-gate fires first. Duration is intentionally
    //   undefined; the original message has no implied keyword either.
    const partial = baseParsed({
      intent: 'schedule_meeting',
      meetingTitle: 'Meeting with Kevin',
      contactName: 'Kevin',
      calendarDate: '2026-05-12',
      calendarTime: undefined,
      calendarDuration: undefined,
      rawFields: { calendar: {} },
    });

    const stepA = await processSingleAction(
      partial,
      'UKARTHIK',
      'C123',
      'T_THREAD_CHAIN',
      '<@TOGARI> schedule a meeting with Kevin next Tuesday',
      'schedule a meeting with Kevin next Tuesday',
      'America/New_York',
    );

    expect(stepA.success).toBe(false);
    expect(stepA.isClarification).toBe(true);
    expect(stepA.summary.toLowerCase()).toContain('what time');
    expect(_getPendingClarifications().get('T_THREAD_CHAIN')!.awaitingField).toBe('calendar_time');

    // ── Step B: user replies "10am" — time-gate clears, duration-gate
    //   fires (no duration, no implied keyword in original phrase) ──
    await processSlackMessage(
      '10am',
      'UKARTHIK',
      'C123',
      'T_THREAD_CHAIN',
      '<@TOGARI> 10am',
    );

    // Pending should now be awaiting calendar_duration
    const afterB = _getPendingClarifications().get('T_THREAD_CHAIN');
    expect(afterB).toBeDefined();
    expect(afterB!.awaitingField).toBe('calendar_duration');

    // No calendar event yet
    let state = getMockState();
    let calCalls = state.fetch.calls.filter((c: any) =>
      c.url.includes('/calendar/v3/calendars/primary/events'),
    );
    expect(calCalls).toHaveLength(0);

    // ── Step C: user replies "30 minutes" — duration resolves,
    //   meeting is created with all three fields ──
    onFetch('oauth2.googleapis.com/token', { access_token: 'fake', expires_in: 3599 });
    onFetch('googleapis.com/calendar/v3/calendars/primary/events', {
      id: 'evt_chain',
      htmlLink: 'https://calendar.google.com/evt_chain',
      summary: 'Meeting with Kevin',
      start: { dateTime: '2026-05-12T10:00:00' },
      end: { dateTime: '2026-05-12T10:30:00' },
    });

    await processSlackMessage(
      '30 minutes',
      'UKARTHIK',
      'C123',
      'T_THREAD_CHAIN',
      '<@TOGARI> 30 minutes',
    );

    // Pending fully consumed
    expect(_getPendingClarifications().has('T_THREAD_CHAIN')).toBe(false);

    state = getMockState();
    // Parser was never called for the resume steps
    const anthropicCalls = state.fetch.calls.filter((c: any) =>
      c.url.includes('api.anthropic.com'),
    );
    expect(anthropicCalls).toHaveLength(0);

    // Calendar event created with merged date+time+duration
    const calCall = state.fetch.calls.find((c: any) =>
      c.url.includes('/calendar/v3/calendars/primary/events'),
    );
    expect(calCall).toBeDefined();
    const body = JSON.parse(calCall!.init.body);
    expect(body.summary).toBe('Meeting with Kevin');
    expect(body.start.dateTime).toBe('2026-05-12T10:00:00');
    expect(body.end.dateTime).toBe('2026-05-12T10:30:00');
  });
});

describe('resolveDurationPhrase — deterministic duration parsing', () => {
  it.each([
    ['30 min', 30],
    ['30 minutes', 30],
    ['30m', 30],
    ['thirty min', 30],
    ['an hour', 60],
    ['1 hour', 60],
    ['1hr', 60],
    ['60 min', 60],
    ['60 minutes', 60],
    ['half hour', 30],
    ['half an hour', 30],
    ['1.5 hours', 90],
    ['ninety minutes', 90],
    ['1h 30m', 90],
    ['2 hours', 120],
    ['45', 45],
    ['45 min', 45],
  ])('parses "%s" → %i minutes', (input, expected) => {
    expect(resolveDurationPhrase(input)).toBe(expected);
  });

  it('returns null for unrelated text', () => {
    expect(resolveDurationPhrase('hello there')).toBe(null);
    expect(resolveDurationPhrase('')).toBe(null);
  });
});

describe('resolveImpliedDuration — implied-default keywords', () => {
  it.each([
    ['schedule quick call with Kevin', 15],
    ['quick chat tomorrow', 15],
    ['quick sync', 15],
    ['schedule 1:1 with Kevin', 30],
    ['intro call with Acme', 30],
    ['intro tomorrow', 30],
    ['coffee with Sara', 30],
    ['one on one', 30],
    ['discovery call', 60],
    ['demo for Acme', 60],
    ['deep dive on pricing', 60],
    ['kickoff with the team', 60],
    ['quarterly review', 60],
  ])('"%s" → %i minutes', (input, expected) => {
    expect(resolveImpliedDuration(input)).toBe(expected);
  });

  it('returns null when no keyword present', () => {
    expect(resolveImpliedDuration('schedule a meeting with Kevin')).toBe(null);
  });
});

// ================================================================
// Bug-fix regressions: strict awaitingField dispatch, implied-
// duration fallback on resume, honest schedule_meeting confirmation.
// ================================================================

describe('schedule_meeting clarification bug fixes', () => {
  beforeEach(() => {
    _resetPendingClarifications();
  });

  // BUG 1 + BUG 2 (combined): full chain ending in "quick meeting"
  // duration reply. The duration reply has no minute marker, but
  // contains the word "quick", which resolveImpliedDuration maps
  // to 15 minutes. The original calendarDate must survive both
  // resume hops without re-parsing the message via the LLM.
  it('chain: time reply then "quick meeting" reply resolves to 15min, calendarDate preserved', async () => {
    onFetch('slack.com/api/users.info', () => ({
      ok: true,
      user: { id: 'UKARTHIK', tz: 'America/New_York' },
    }));

    // ── Step A: original mention has only a date ──
    const partial = baseParsed({
      intent: 'schedule_meeting',
      meetingTitle: 'Meeting with Kevin',
      contactName: 'Kevin',
      calendarDate: '2026-05-12',
      calendarTime: undefined,
      calendarDuration: undefined,
      rawFields: { calendar: {} },
    });

    const stepA = await processSingleAction(
      partial,
      'UKARTHIK',
      'C123',
      'T_THREAD_BUG',
      '<@TOGARI> schedule a meeting with Kevin next Tuesday',
      'schedule a meeting with Kevin next Tuesday',
      'America/New_York',
    );

    expect(stepA.isClarification).toBe(true);
    expect(stepA.summary.toLowerCase()).toContain('what time');
    expect(_getPendingClarifications().get('T_THREAD_BUG')!.awaitingField).toBe('calendar_time');

    // ── Step B: user replies "2pm" ──
    await processSlackMessage(
      '2pm',
      'UKARTHIK',
      'C123',
      'T_THREAD_BUG',
      '<@TOGARI> 2pm',
    );

    // Now awaiting calendar_duration; calendarDate + calendarTime preserved.
    const afterB = _getPendingClarifications().get('T_THREAD_BUG');
    expect(afterB).toBeDefined();
    expect(afterB!.awaitingField).toBe('calendar_duration');
    expect(afterB!.intent.calendarDate).toBe('2026-05-12');
    expect(afterB!.intent.calendarTime).toBe('14:00');

    // ── Step C: user replies "quick meeting" — no minute marker, but
    //   resolveImpliedDuration("quick") → 15. Calendar event must
    //   be created with the original date, the supplied time, and
    //   duration=15 ──
    onFetch('oauth2.googleapis.com/token', { access_token: 'fake', expires_in: 3599 });
    onFetch('googleapis.com/calendar/v3/calendars/primary/events', {
      id: 'evt_bug',
      htmlLink: 'https://calendar.google.com/evt_bug',
      summary: 'Meeting with Kevin',
      start: { dateTime: '2026-05-12T14:00:00' },
      end: { dateTime: '2026-05-12T14:15:00' },
    });

    await processSlackMessage(
      'quick meeting',
      'UKARTHIK',
      'C123',
      'T_THREAD_BUG',
      '<@TOGARI> quick meeting',
    );

    // Pending fully consumed
    expect(_getPendingClarifications().has('T_THREAD_BUG')).toBe(false);

    const state = getMockState();
    // No LLM call across either resume hop
    const anthropicCalls = state.fetch.calls.filter((c: any) =>
      c.url.includes('api.anthropic.com'),
    );
    expect(anthropicCalls).toHaveLength(0);

    // Calendar event was created with the merged fields
    const calCall = state.fetch.calls.find((c: any) =>
      c.url.includes('/calendar/v3/calendars/primary/events'),
    );
    expect(calCall).toBeDefined();
    const body = JSON.parse(calCall!.init.body);
    expect(body.summary).toBe('Meeting with Kevin');
    expect(body.start.dateTime).toBe('2026-05-12T14:00:00');
    expect(body.end.dateTime).toBe('2026-05-12T14:15:00');
  });

  // BUG 3a: when calendar sync throws, the response must be a
  // truthful failure — not "Meeting Scheduled" with an empty link.
  it('calendar sync failure surfaces as success:false with the underlying error', async () => {
    // No oauth2.googleapis.com handler registered — the unmocked URL
    // returns status 500, which makes getAccessToken throw, which
    // makes scheduleEvent throw, which makes syncCalendar throw.

    const parsed = baseParsed({
      intent: 'schedule_meeting',
      meetingTitle: 'Meeting with Kevin',
      contactName: 'Kevin',
      calendarDate: '2026-05-12',
      calendarTime: '14:00',
      calendarDuration: 30,
      calendarAttendees: [],
      rawFields: { calendar: { preferred_times: ['14:00'], duration_minutes: 30 } },
    });

    const result = await processSingleAction(
      parsed,
      'UKARTHIK',
      'C123',
      'T_THREAD_FAIL',
      '<@TOGARI> schedule a meeting with Kevin Tuesday at 2pm',
      'schedule a meeting with Kevin Tuesday at 2pm',
      'America/New_York',
    );

    expect(result.success).toBe(false);
    expect(result.summary).not.toContain('Meeting Scheduled');
    expect(result.summary.toLowerCase()).toContain("couldn't");
    expect(result.emoji).toBe(':warning:');
  });

  // BUG 3b: success summary includes title, weekday, 12-hour time,
  // duration, attendees, and the htmlLink as a Slack-formatted link.
  it('schedule_meeting success summary includes title, day, 12-hour time, duration, attendees, link', async () => {
    onFetch('oauth2.googleapis.com/token', { access_token: 'fake', expires_in: 3599 });
    onFetch('googleapis.com/calendar/v3/calendars/primary/events', {
      id: 'evt_summary',
      htmlLink: 'https://calendar.google.com/calendar/r/eventedit/evt_summary',
      summary: 'Meeting with Kevin',
      start: { dateTime: '2026-05-12T14:00:00' },
      end: { dateTime: '2026-05-12T14:30:00' },
    });

    const parsed = baseParsed({
      intent: 'schedule_meeting',
      meetingTitle: 'Meeting with Kevin',
      contactName: 'Kevin',
      calendarDate: '2026-05-12',
      calendarTime: '14:00',
      calendarDuration: 30,
      calendarAttendees: ['kevin@bluemodernadvisory.com'],
      rawFields: { calendar: { preferred_times: ['14:00'], duration_minutes: 30 } },
    });

    const result = await processSingleAction(
      parsed,
      'UKARTHIK',
      'C123',
      'T_THREAD_OK',
      '<@TOGARI> schedule a meeting with Kevin Tuesday at 2pm for 30 min',
      'schedule a meeting with Kevin Tuesday at 2pm for 30 min',
      'America/New_York',
    );

    expect(result.success).toBe(true);
    expect(result.emoji).toBe(':calendar:');
    // Title
    expect(result.summary).toContain('Meeting with Kevin');
    // Weekday
    expect(result.summary).toContain('Tuesday');
    // 12-hour time
    expect(result.summary).toContain('2:00 PM');
    // Duration
    expect(result.summary).toContain('30 min');
    // Attendee
    expect(result.summary).toContain('kevin@bluemodernadvisory.com');
    // Slack-formatted calendar link
    expect(result.summary).toContain(
      '<https://calendar.google.com/calendar/r/eventedit/evt_summary|Open in Google Calendar>',
    );
  });

  // BUG 1 (duration arm): wrong-type reply during a calendar_duration
  // clarification re-prompts and preserves the pending entry. A time
  // reply ("5pm") given when we asked for a duration must NOT advance
  // the state or fall through to the LLM parser.
  it('wrong-type reply during calendar_duration clarification: re-prompts and preserves pending', async () => {
    onFetch('slack.com/api/users.info', () => ({
      ok: true,
      user: { id: 'UKARTHIK', tz: 'America/New_York' },
    }));

    const partial = baseParsed({
      intent: 'schedule_meeting',
      meetingTitle: 'Meeting with Kevin',
      contactName: 'Kevin',
      calendarDate: '2026-05-12',
      calendarTime: '14:00',
      calendarDuration: undefined,
      rawFields: { calendar: { preferred_times: ['14:00'] } },
    });
    _getPendingClarifications().set('T_THREAD_DUR_REPROMPT', {
      intent: partial,
      slackUser: 'UKARTHIK',
      channel: 'C123',
      threadTs: 'T_THREAD_DUR_REPROMPT',
      awaitingField: 'calendar_duration',
      originalText: 'schedule a meeting with Kevin Tuesday at 2pm',
      createdAt: Date.now(),
    });

    await processSlackMessage(
      '5pm',
      'UKARTHIK',
      'C123',
      'T_THREAD_DUR_REPROMPT',
      '<@TOGARI> 5pm',
    );

    // Pending preserved, no advance, no LLM call
    const after = _getPendingClarifications().get('T_THREAD_DUR_REPROMPT');
    expect(after).toBeDefined();
    expect(after!.awaitingField).toBe('calendar_duration');
    expect(after!.intent.calendarTime).toBe('14:00');
    expect(after!.intent.calendarDate).toBe('2026-05-12');

    const state = getMockState();
    const anthropicCalls = state.fetch.calls.filter((c: any) =>
      c.url.includes('api.anthropic.com'),
    );
    expect(anthropicCalls).toHaveLength(0);

    // No calendar event was created
    const calCalls = state.fetch.calls.filter((c: any) =>
      c.url.includes('/calendar/v3/calendars/'),
    );
    expect(calCalls).toHaveLength(0);

    // The bot posted the duration prompt back into the thread
    const allText = JSON.stringify(state.slack.postedMessages).toLowerCase();
    expect(allText).toContain('how long should the meeting be');
  });
});

