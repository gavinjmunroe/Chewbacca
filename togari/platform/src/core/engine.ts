/**
 * @togari/core — Main orchestration engine
 *
 * Single entry point for all transports. Classifies intent(s),
 * routes to the appropriate handler(s), and returns a structured response.
 * Supports multi-action messages — processes all actions and returns
 * an aggregated response.
 *
 * Usage: import { processMessage } from './core/engine';
 */

import { createLogger } from '../observability/logger';
import { SONNET } from '../config/models';
import type { TogariRequest, TogariResponse, ParsedIntent, OnProgress } from './types';
import { classifyIntent } from './intent-router';
import { isToolLoopEnabled, runToolUseLoop } from './tool-use-runner';
import { searchDeal, createDeal, updateDeal, queryDeals, logActivity } from './tools/deal-ops';
import { findCompanyByName, upsertCompany } from './tools/company-ops';
import { searchCapturesByCompany, markCapturePromoted } from './tools/capture-ops';
import {
  scheduleEvent,
  findCalendarEvent,
  updateCalendarEvent,
  CalendarAuthMissingError,
} from './tools/calendar-ops';
import { findMeeting, analyzeMeeting } from './tools/meeting-intel';
import { generateProposal } from './tools/proposal-ops';
import { draftReply } from './tools/email-ops';
import { setReminder } from './tools/reminder-ops';
import { resolveReminderOwner, isOwnerRoutingEnabled, getUserTimezone, findUserBySlackId } from './identity';
import { isInactiveOperator } from './identity/mention-resolver';
import { isoLocalToUnix } from './identity/date-context';
import { buildConversationPrompt } from './prompts/system';
import { selectModel } from './models/router';

const logger = createLogger('core/engine');

// ── Deal context loader (lightweight, for proposal/analysis) ────

async function loadDealContextSummary(personName?: string, companyName?: string): Promise<string | null> {
  if (!personName && !companyName) return null;

  try {
    const deal = await searchDeal(companyName, personName);
    if (!deal) return null;

    const parts = [
      `Company: ${deal.company}`,
      `Contact: ${deal.contact_full_name}`,
      `Stage: ${deal.stage}`,
      deal.value ? `Value: $${deal.value.toLocaleString()}` : null,
      deal.pipeline ? `Pipeline: ${deal.pipeline}` : null,
      deal.next_action ? `Next action: ${deal.next_action}` : null,
      deal.contact_email ? `Email: ${deal.contact_email}` : null,
    ].filter(Boolean);

    return `CRM Context:\n${parts.join(' | ')}`;
  } catch {
    return null;
  }
}

// ── Conversation handler ─────────────────────────────────────────

async function handleConversation(text: string, request?: TogariRequest): Promise<string> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    // Look up the requester's timezone so buildConversationPrompt can
    // anchor "today" to the right zone. getUserTimezone falls back to
    // ET when the user isn't in togari.users — acceptable today.
    const timezone = request?.userId
      ? await getUserTimezone(request.userId)
      : 'America/Chicago';
    const systemPrompt = buildConversationPrompt({
      transport: request?.transport ?? request?.platform,
      conversationId: request?.conversationId,
      timezone,
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: selectModel('conversation', 'low'),
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: text }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API ${response.status}: ${errorBody}`);
    }

    const data = await response.json() as any;
    return data.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('')
      .trim();
  } catch (err) {
    logger.error('Conversation handler failed', err instanceof Error ? err : new Error(String(err)));
    return "I'm Togari, your sales ops assistant. I can help you manage deals, track pipeline, schedule meetings, analyze calls, generate proposals, and more. Try asking me about your deals or pipeline data!";
  }
}

// ── Single intent handler — returns one TogariResponse ───────────

/**
 * Public entry for running a pre-classified intent through the engine.
 * Transports that already have a `ParsedIntent` (e.g. Slack, which
 * classifies once and then loops over actions) use this instead of
 * `processMessage`. Long-running intents emit an intermediate
 * progress update via `onProgress` so transports can post "working on
 * it…" feedback before the final response.
 */
export async function executeIntent(
  intent: ParsedIntent,
  request: TogariRequest,
  onProgress?: OnProgress,
): Promise<TogariResponse> {
  if (onProgress && (intent.intent === 'generate_proposal' || intent.intent === 'analyze_meeting')) {
    const target = intent.targetPerson || intent.contactName || intent.company || 'meeting';
    const verb = intent.intent === 'generate_proposal' ? 'Generating proposal' : 'Analyzing meeting';
    await onProgress({
      stage: 'fetching_transcript',
      message: `:hourglass_flowing_sand: ${verb} for *${target}*… looking up meeting transcript and deal context (~15 seconds)`,
    });
  }
  return handleSingleIntent(intent, request);
}

async function handleSingleIntent(intent: ParsedIntent, request: TogariRequest): Promise<TogariResponse> {
  switch (intent.intent) {
    case 'conversation': {
      const reply = await handleConversation(request.text, request);
      return { type: 'text', text: reply };
    }

    case 'new_deal': {
      if (!intent.company) {
        return { type: 'error', text: 'I need a company name to create a deal. Could you include that?' };
      }
      const existing = await searchDeal(intent.company, intent.contactName);
      if (existing) {
        return {
          type: 'error',
          text: `A deal for *${intent.company}* already exists (${existing.deal_id}, stage: ${existing.stage}). Did you mean to update it instead?`,
          data: { existingDeal: existing },
        };
      }
      const { deal } = await createDeal({
        company: intent.company,
        contactName: intent.contactName,
        contactEmail: intent.contactEmail,
        value: intent.dealValue,
        stage: intent.stage,
        pipeline: intent.pipeline,
        clientBrand: intent.clientBrand,
        // Pass userId as the sender fallback only; createDeal resolves
        // free-text names through the mention-resolver and falls through
        // to this id only when no name was given.
        owner: request.userName,
        senderSlackUserId: request.userId,
        notes: intent.notes || request.text,
      });
      return {
        type: 'deal_created',
        text: `New deal created for *${deal.company}*${deal.contact_full_name ? ` (contact: ${deal.contact_full_name})` : ''} — Stage: ${deal.stage}, Value: $${deal.value.toLocaleString()}`,
        data: { deal },
      };
    }

    case 'update_deal': {
      const existing = await searchDeal(intent.company, intent.contactName);
      if (!existing) {
        if (intent.company) {
          const { deal } = await createDeal({
            company: intent.company,
            contactName: intent.contactName,
            contactEmail: intent.contactEmail,
            value: intent.dealValue,
            stage: intent.stage,
            pipeline: intent.pipeline,
            clientBrand: intent.clientBrand,
            owner: request.userName,
            senderSlackUserId: request.userId,
            notes: intent.notes || request.text,
          });
          return {
            type: 'deal_created',
            text: `No existing deal found to update — created new deal for *${deal.company}* instead. Stage: ${deal.stage}, Value: $${deal.value.toLocaleString()}`,
            data: { deal },
          };
        }
        return { type: 'error', text: "I couldn't find that deal to update. Could you provide the company name?" };
      }
      const updates: Record<string, any> = {};
      if (intent.stage) updates.stage = intent.stage;
      if (intent.pipeline) updates.pipeline = intent.pipeline;
      if (intent.clientBrand) updates.client_brand = intent.clientBrand;
      if (intent.dealValue !== undefined) updates.value = intent.dealValue;
      if (intent.contactName) updates.contact_full_name = intent.contactName;
      if (intent.contactEmail) updates.contact_email = intent.contactEmail;
      if (intent.notes) updates.notes = intent.notes;
      else updates.notes = request.text;
      const { deal } = await updateDeal(existing.deal_id, updates);
      return {
        type: 'deal_updated',
        text: `Updated *${deal.company}* — Stage: ${deal.stage}, Value: $${deal.value.toLocaleString()}`,
        data: { deal },
      };
    }

    case 'transfer_deal': {
      // Ownership change. Distinct from update_deal because the owner
      // column is special-cased: only Slack user IDs may be written.
      // We resolve the new owner via the same mention-resolver path
      // reminders use, so "Sagar" / "@sagar" / "<@U087Z8LPMMY>" all work.
      if (!intent.company) {
        return { type: 'error', text: 'I need a company name to transfer the deal. Could you include that?' };
      }
      const targetToken = intent.reminderTarget;
      if (!targetToken) {
        return { type: 'error', text: 'I need a new owner name (e.g. "transfer Acme to Sagar"). Who should own it now?' };
      }
      const rawText = (request.transportMetadata?.rawText as string | undefined) ?? request.text;
      const owner = await resolveReminderOwner({
        token: targetToken,
        senderSlackUserId: request.userId,
        rawText,
      });
      if (owner.status === 'ambiguous') {
        const names = (owner.ambiguousCandidates ?? []).map((c) => c.display).join(', ');
        return {
          type: 'error',
          text: `Found multiple people matching "${targetToken}" (${names}). Please rephrase with an @mention or a fuller name.`,
          data: { ambiguous: true, candidates: owner.ambiguousCandidates },
        };
      }
      // G.4 — refuse to silently transfer ownership to the sender when
      // the named target couldn't be resolved. Better to ask.
      if (owner.status === 'unresolved_name' || !owner.ownerSlackUserId) {
        return {
          type: 'error',
          text: `I couldn't find "${targetToken}" on the team. Try @-mentioning them or using their full name. (Active team: karthik, sagar, maggie, drew, shirley, caleb, tyler, reem, rania)`,
        };
      }
      // F.2 inactive-operator guardrail: refuse to silently transfer
      // ownership to someone who's no longer active. The user can still
      // resend explicitly or pick a different person. __overrideInactive
      // is set by the Slack transport's resume path after the user
      // confirms with "yes proceed" — skip the guardrail in that case.
      if (isInactiveOperator(owner.ownerSlackUserId) && !intent.__overrideInactive) {
        return {
          type: 'warning',
          text: `:information_source: <@${owner.ownerSlackUserId}> ("${targetToken}") is no longer an active operator. Transferring ownership to them means the deal won't have a working owner — want me to transfer to Karthik or Sagar instead, or proceed anyway?`,
          data: { reason: 'inactive_operator', inactiveSlackId: owner.ownerSlackUserId, pendingAction: intent },
        };
      }
      const existing = await searchDeal(intent.company, intent.contactName);
      if (!existing) {
        return {
          type: 'error',
          text: `I couldn't find a deal for *${intent.company}* to transfer. Try a different company name, or create the deal first.`,
        };
      }
      const updates: Record<string, any> = { owner: owner.ownerSlackUserId };
      // Always log the transfer reason in notes so the audit trail is grep-able.
      updates.notes = `Transferred ownership to <@${owner.ownerSlackUserId}> (${targetToken})${intent.notes ? ` — ${intent.notes}` : ''}`;
      const { deal } = await updateDeal(existing.deal_id, updates);
      return {
        type: 'deal_transferred',
        text: `Ownership of *${deal.company}* transferred to <@${owner.ownerSlackUserId}>.`,
        data: { deal, newOwnerSlackUserId: owner.ownerSlackUserId, targetToken },
      };
    }

    case 'log_activity': {
      await logActivity({
        company: intent.company,
        contactName: intent.contactName,
        type: 'log_activity',
        content: request.text,
      });
      return {
        type: 'activity_logged',
        text: `Activity logged${intent.company ? ` for *${intent.company}*` : ''}${intent.contactName ? ` (${intent.contactName})` : ''}.`,
      };
    }

    case 'schedule_meeting': {
      const preferredTimes = intent.rawFields?.calendar?.preferred_times || intent.rawFields?.preferred_times || [];
      const hasPreservedTime = Array.isArray(preferredTimes) && preferredTimes.length > 0 && !!preferredTimes[0];
      if (!intent.calendarTime && !hasPreservedTime) {
        const dateStr = intent.calendarDate && /^\d{4}-\d{2}-\d{2}$/.test(intent.calendarDate)
          ? new Date(`${intent.calendarDate}T12:00:00`).toLocaleString('en-US', { weekday: 'long' })
          : intent.calendarDate;
        const dayPhrase = dateStr ? ` on ${dateStr}` : '';
        return {
          type: 'error',
          text: `What time${dayPhrase}?`,
        };
      }
      let dateTime = '';
      if (intent.calendarDate && intent.calendarTime) {
        dateTime = `${intent.calendarDate} ${intent.calendarTime}`;
      } else if (intent.calendarTime) {
        dateTime = intent.calendarDate ? `${intent.calendarDate} ${intent.calendarTime}` : intent.calendarTime;
      } else {
        dateTime = preferredTimes[0];
      }
      const timezone = await getUserTimezone(request.userId);
      const result = await scheduleEvent({
        title: intent.meetingTitle || `Meeting${intent.contactName ? ` with ${intent.contactName}` : ''}`,
        dateTime,
        duration: intent.calendarDuration || 30,
        attendeeEmails: intent.calendarAttendees,
        timezone,
        senderSlackUserId: request.userId,
      });
      return {
        type: 'meeting_scheduled',
        text: `Meeting scheduled: ${result.summary}\n\nCalendar link: ${result.link}`,
        data: { eventId: result.eventId, link: result.link, summary: result.summary },
      };
    }

    case 'update_event': {
      // Look up an existing event in the sender's calendar within a
      // 14-day window, then PATCH it. Ambiguous matches are surfaced
      // so the user can clarify; a missing OAuth token surfaces the
      // friendly per-user message rather than a stack trace.
      const query = intent.targetPerson || intent.meetingTitle || intent.company || intent.contactName;
      if (!query) {
        return {
          type: 'error',
          text: 'I need a meeting title, person, or topic to find the event. Try "change the Sift discovery to 4pm".',
        };
      }
      const timezone = await getUserTimezone(request.userId);

      let matches: Awaited<ReturnType<typeof findCalendarEvent>>;
      try {
        matches = await findCalendarEvent({
          query,
          senderSlackUserId: request.userId,
        });
      } catch (err) {
        if (err instanceof CalendarAuthMissingError) {
          return { type: 'warning', text: `:warning: ${err.message}`, data: { reason: 'calendar_auth_missing' } };
        }
        throw err;
      }

      if (matches.length === 0) {
        return {
          type: 'error',
          text: `I couldn't find a calendar event matching "${query}" in the next 14 days.`,
        };
      }
      if (matches.length > 1) {
        const list = matches
          .slice(0, 5)
          .map((m, i) => `${i + 1}. ${m.summary} — ${m.start}`)
          .join('\n');
        return {
          type: 'error',
          text: `Found ${matches.length} events matching "${query}". Which one?\n${list}`,
          data: { ambiguous: true, matches },
        };
      }

      // Build the new dateTime hint from whichever of calendar_date /
      // calendar_time the user supplied. Skip if neither was set
      // (caller wants only an attendee/title change, not a reschedule).
      let dateTimeHint: string | undefined;
      if (intent.calendarDate && intent.calendarTime) {
        dateTimeHint = `${intent.calendarDate} ${intent.calendarTime}`;
      } else if (intent.calendarTime) {
        dateTimeHint = intent.calendarTime;
      } else if (intent.calendarDate) {
        dateTimeHint = intent.calendarDate;
      }

      try {
        const result = await updateCalendarEvent({
          eventId: matches[0].id,
          updates: {
            title: intent.meetingTitle,
            dateTime: dateTimeHint,
            duration: intent.calendarDuration,
            attendeeEmails: intent.calendarAttendees,
          },
          timezone,
          senderSlackUserId: request.userId,
        });
        return {
          type: 'event_updated',
          text: `Event updated: ${result.summary}${result.link ? `\n${result.link}` : ''}`,
          data: { eventId: result.eventId, link: result.link, summary: result.summary, matched: matches[0] },
        };
      } catch (err) {
        if (err instanceof CalendarAuthMissingError) {
          return { type: 'warning', text: `:warning: ${err.message}`, data: { reason: 'calendar_auth_missing' } };
        }
        throw err;
      }
    }

    case 'set_reminder': {
      const reminderText = intent.reminderText || request.text;
      const reminderTimeStrings = intent.reminderTimes || [];
      if (reminderTimeStrings.length === 0) {
        return {
          type: 'error',
          text: 'I understood you want a reminder, but couldn\'t determine the timing. Try something like "remind me to follow up with Acme next week".',
        };
      }

      // Convert ISO-local datetime strings → Unix epoch using the
      // requester's TZ. The LLM no longer computes timestamps; we do
      // the math in JS for correctness and to enable past-time filtering.
      const requesterTz = await getUserTimezone(request.userId);
      const reminderTimes: number[] = [];
      for (const iso of reminderTimeStrings) {
        try {
          reminderTimes.push(isoLocalToUnix(iso, requesterTz));
        } catch (err) {
          logger.warn('Skipping malformed reminder time', {
            iso,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (reminderTimes.length === 0) {
        return {
          type: 'error',
          text: 'I parsed the reminder timing but couldn\'t convert it to a real timestamp. Try a specific date and time like "Tuesday at 3pm".',
        };
      }

      // Past-time guard — symmetric with the Slack transport. LLMs sometimes
      // produce timestamps in the past when the user's phrase is ambiguous
      // ("this morning" said at 3pm). Drop anything <= now (30s grace), and
      // if nothing remains, ask the user to re-specify rather than silently
      // scheduling reminders for the past via setReminder.
      const nowEpoch = Math.floor(Date.now() / 1000);
      const validTimes: number[] = [];
      const pastTimes: number[] = [];
      for (const t of reminderTimes) {
        if (t > nowEpoch + 30) {
          validTimes.push(t);
        } else {
          pastTimes.push(t);
        }
      }
      if (validTimes.length === 0 && pastTimes.length > 0) {
        return {
          type: 'error',
          text: `I parsed "${reminderText}" as a time in the past. Can you give me a specific date and time? (e.g. "Tuesday at 3pm" or "tomorrow morning")`,
        };
      }
      if (pastTimes.length > 0) {
        logger.warn('Dropping past-dated reminder times', { count: pastTimes.length });
      }

      // Owner routing: resolve who actually owns this reminder. Falls
      // back to sender when the feature flag is disabled, when the
      // resolver errors (e.g. togari.users unreachable), or when the
      // token is empty / group-only / "me".
      let targetUserId = intent.reminderTarget || request.userId;
      if (isOwnerRoutingEnabled()) {
        try {
          const rawText = (request.transportMetadata?.rawText as string | undefined) ?? request.text;
          const owner = await resolveReminderOwner({
            token: intent.reminderTarget,
            senderSlackUserId: request.userId,
            rawText,
          });
          if (owner.status === 'ambiguous') {
            const names = (owner.ambiguousCandidates ?? []).map((c) => c.display).join(', ');
            return {
              type: 'error',
              text: `I found multiple people matching that name (${names}). Please rephrase with @mention or a more specific name so I can schedule the right reminder.`,
              data: { ambiguous: true, candidates: owner.ambiguousCandidates },
            };
          }
          // G.4 — unresolved third-party name. Refuse to fall back to the
          // sender (the old behaviour was the wrong-person-got-reminded
          // bug). Ask the user to clarify.
          if (owner.status === 'unresolved_name') {
            return {
              type: 'error',
              text: `I couldn't find "${owner.inputToken ?? intent.reminderTarget ?? 'that person'}" on the team. Did you mean someone specific? Try @-mentioning them or using their full name. (Active team: karthik, sagar, maggie, drew, shirley, caleb, tyler, reem, rania)`,
            };
          }
          if (owner.ownerSlackUserId) {
            targetUserId = owner.ownerSlackUserId;
          }
        } catch (err) {
          logger.warn('Owner resolver failed; falling back to sender', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // F.2 inactive-operator guardrail: don't silently schedule a
      // reminder for someone who's left the team. Soft warn and let the
      // user re-issue with a different target (or confirm to proceed).
      // __overrideInactive is set by the Slack transport's resume path
      // after the user explicitly types "yes proceed".
      if (isInactiveOperator(targetUserId) && !intent.__overrideInactive) {
        return {
          type: 'warning',
          text: `:information_source: <@${targetUserId}> is no longer an active operator and won't receive reminders reliably. Want me to assign to Karthik or Sagar instead, or rephrase with a different person?`,
          data: { reason: 'inactive_operator', inactiveSlackId: targetUserId, pendingAction: intent },
        };
      }

      const result = await setReminder({
        targetUserId,
        text: reminderText,
        times: validTimes,
        platform: request.platform,
      });
      return {
        type: 'reminder_set',
        text: result.details,
        data: { method: result.method, success: result.success },
      };
    }

    case 'generate_proposal': {
      // Fallback chain: targetPerson → entities from rawFields → original text
      const rawTarget = intent.targetPerson || intent.contactName || intent.company;
      const searchTerm = (rawTarget && rawTarget !== 'Unknown' && rawTarget.trim() !== '')
        ? rawTarget
        : intent.rawFields?.query?.entities_mentioned?.[0]
          || intent.rawFields?.query_text
          || request.text;
      const targetPerson = searchTerm;
      const targetCompany = intent.company || '';
      // Pass full user message for Claude-powered resolution
      const transcript = await findMeeting(request.text);
      if (!transcript) {
        return {
          type: 'error',
          text: `Couldn't find a Fireflies meeting matching "${targetPerson}". Try using the exact name or topic as it appears in the meeting title, or check that the meeting has been processed by Fireflies.`,
        };
      }
      const dealContext = await loadDealContextSummary(targetPerson, targetCompany);
      const transcriptText = transcript.fullText
        || transcript.sentences?.map((s) => `${s.speaker}: ${s.text}`).join('\n')
        || transcript.summary.overview;
      const result = await generateProposal({
        clientName: targetPerson,
        clientCompany: targetCompany || transcript.title,
        meetingTranscript: transcriptText,
        dealContext: dealContext || 'No existing CRM data found.',
        userInstructions: intent.pricingInstructions || request.text,
        pricing: intent.pricingInstructions,
      });
      return {
        type: 'proposal_generated',
        text: `Proposal generated for *${result.clientName}*${result.clientCompany ? ` at *${result.clientCompany}*` : ''}. ${result.summary}`,
        data: { markdown: result.markdown, clientName: result.clientName, clientCompany: result.clientCompany, meetingTitle: transcript.title },
        attachments: [{ type: 'markdown', filename: `proposal_${targetPerson.toLowerCase().replace(/\s+/g, '_')}.md`, content: result.markdown }],
        actions: [{ id: 'send_email', label: 'Email Proposal', style: 'primary', data: { clientName: result.clientName, clientCompany: result.clientCompany } }],
      };
    }

    case 'analyze_meeting': {
      // Build search query from best available source
      const rawTarget = intent.targetPerson || intent.contactName || intent.company;
      let searchTerm: string;
      let searchTermSource: string;

      if (rawTarget && rawTarget !== 'Unknown' && rawTarget.trim() !== '') {
        searchTerm = rawTarget;
        searchTermSource = 'target_person';
      } else if (intent.rawFields?.query?.entities_mentioned?.[0]) {
        searchTerm = intent.rawFields.query.entities_mentioned[0];
        searchTermSource = 'entities';
      } else if (intent.rawFields?.query_text) {
        searchTerm = intent.rawFields.query_text;
        searchTermSource = 'query_text';
      } else {
        // Use the full original message — Claude resolver will figure it out
        searchTerm = request.text;
        searchTermSource = 'full_message';
      }

      console.log(`[meeting-search] User asked: '${request.text}' | Search query passed to resolver: '${searchTerm}' (source: ${searchTermSource})`);

      const analysisType = intent.analysisType || 'general';

      // Claude-powered resolution — pass full user message for maximum context
      const resolverQuery = request.text;
      const transcript = await findMeeting(resolverQuery);
      if (!transcript) {
        return {
          type: 'error',
          text: `Couldn't find a Fireflies meeting matching "${searchTerm}". Try using the exact name or topic as it appears in the meeting title.`,
        };
      }
      const dealContext = await loadDealContextSummary(searchTerm, intent.company);
      const analysis = await analyzeMeeting(transcript, analysisType, dealContext || undefined);
      const header = `Meeting Analysis — ${transcript.title}\n${analysisType.replace(/_/g, ' ')} | ${transcript.date}\n\n`;
      return {
        type: 'meeting_analysis',
        text: header + analysis,
        data: { meetingTitle: transcript.title, meetingDate: transcript.date, analysisType, participants: transcript.participants },
      };
    }

    case 'query': {
      const question = intent.rawFields?.query_text || intent.rawFields?.query?.natural_language || request.text;

      // Resolve sender identity from Slack user_id → UserRow so the SQL
      // generator can interpret "my pipeline" / "deals I own" correctly.
      let sender: NonNullable<Parameters<typeof queryDeals>[1]>['sender'] | undefined;
      let senderTimezone: string | undefined;

      if (request.userId) {
        try {
          const userRow = await findUserBySlackId(request.userId);
          if (userRow) {
            sender = {
              slackId: request.userId,
              email: userRow.email,
              displayName: userRow.slack_display_name ?? undefined,
              firstName: userRow.first_name ?? undefined,
              lastName: userRow.last_name ?? undefined,
            };
            senderTimezone = userRow.timezone || undefined;
          }
        } catch (err) {
          console.warn('[engine] sender resolution failed:', err);
        }
      }

      if (!senderTimezone && request.userId) {
        try {
          senderTimezone = await getUserTimezone(request.userId);
        } catch {}
      }

      try {
        const result = await queryDeals(question, { timezone: senderTimezone, sender });
        return {
          type: 'query_result',
          text: result.summary,
          data: { sql: result.sql, rows: result.rows, totalRows: result.rows.length },
        };
      } catch (err: any) {
        const msg = err?.message || String(err);
        // Preserve the forbidden-SQL warning that previously lived in query-handler.ts
        if (/mutation|forbidden|read-only|SELECT only/i.test(msg)) {
          return {
            type: 'error',
            text: ':warning: I can only run read-only queries. The generated query contained mutation keywords and was rejected for safety.',
          };
        }
        throw err;
      }
    }

    case 'draft_email': {
      const leadEmail = intent.contactEmail || intent.rawFields?.draft_to || '';
      const leadName = intent.contactName || intent.targetPerson || intent.rawFields?.draft_to || 'Unknown';
      const result = await draftReply({
        leadEmail,
        leadName,
        replyText: intent.rawFields?.draft_body_instructions || request.text,
        category: 'outreach',
      });
      return {
        type: 'email_drafted',
        text: `Email draft ready for *${leadName}*:\n\nSubject: ${result.subject}\n\n${result.body}`,
        data: { subject: result.subject, body: result.body, urgency: result.urgency, to: leadEmail, leadName },
        actions: [
          { id: 'send_email', label: 'Send Email', style: 'primary', data: { to: leadEmail, subject: result.subject, body: result.body } },
          { id: 'create_draft', label: 'Save as Draft', style: 'default', data: { to: leadEmail, subject: result.subject, body: result.body } },
        ],
      };
    }

    case 'promote_capture': {
      if (!intent.company) {
        return { type: 'error', text: 'I need a company name to promote a capture. Could you include that?' };
      }

      // Resolve company → company_id. Create the company row if it
      // doesn't exist; the capture lookup below will return [] in that
      // case, which we handle with a clear error.
      const company = await findCompanyByName(intent.company)
        ?? await upsertCompany({ name: intent.company });

      const captures = await searchCapturesByCompany(company.company_id, 5);
      if (captures.length === 0) {
        return {
          type: 'error',
          text: `No captures found for *${company.name}*. Use \`new deal ${company.name}\` to create one directly instead.`,
        };
      }

      // Use the most recent capture as the seed for the deal.
      const sourceCapture = captures[0];

      // Extract structured fields from the raw_blob via Claude. If the
      // call fails we fall through with just the user-provided fields —
      // the deal still gets created, just with less context.
      const extracted = await extractDealFieldsFromCapture(sourceCapture);

      // Merge: user-provided fields override LLM extraction.
      const merged = {
        company: company.name,
        companyId: company.company_id,
        contactName: intent.contactName ?? extracted.contactName,
        contactEmail: intent.contactEmail ?? extracted.contactEmail,
        value: intent.dealValue ?? extracted.value,
        stage: intent.stage ?? extracted.stage,
        pipeline: intent.pipeline ?? extracted.pipeline,
        clientBrand: intent.clientBrand,
        notes: intent.notes ?? extracted.notes ?? `Promoted from capture ${sourceCapture.capture_id}`,
        promotedFromCaptureId: sourceCapture.capture_id,
      };

      const { deal } = await createDeal({
        ...merged,
        owner: request.userName,
        senderSlackUserId: request.userId,
      });

      // Mark the capture as promoted (sets promoted_to_deal_id + deal_id).
      try {
        await markCapturePromoted(sourceCapture.capture_id, deal.deal_id);
      } catch (err) {
        logger.warn('promote_capture: markCapturePromoted failed', {
          captureId: sourceCapture.capture_id,
          dealId: deal.deal_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const valueStr = deal.value ? `$${deal.value.toLocaleString()}` : '—';
      return {
        type: 'deal_created',
        text: `:rocket: *Promoted to Deal:* ${deal.contact_full_name || '(no contact)'} at *${deal.company}* — ${deal.pipeline} (${deal.client_brand ?? 'bma'}) — ${valueStr}`,
        data: { deal, sourceCapture },
      };
    }

    default: {
      const reply = await handleConversation(request.text, request);
      return { type: 'text', text: reply };
    }
  }
}

// ── Capture → deal field extraction (Patch L) ────────────────────

interface ExtractedDealFields {
  contactName?: string;
  contactEmail?: string;
  value?: number;
  stage?: string;
  pipeline?: string;
  notes?: string;
}

async function extractDealFieldsFromCapture(capture: {
  capture_id: string;
  raw_blob?: string;
  title?: string;
  attendees?: string[];
}): Promise<ExtractedDealFields> {
  if (!capture.raw_blob || capture.raw_blob.length < 50) {
    return {};
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return {};

  const systemPrompt = `You are a CRM analyst. Given a meeting transcript, extract structured deal fields. Return JSON with keys: contactName (the primary external contact), contactEmail (if mentioned), value (numeric, monthly rate if discussed), stage (one of: researching, contacted, conversation_started, discovery_scheduled, discovery_complete, proposal_sent, negotiating, verbal_commit, contract_sent), pipeline (one of: inbound, outbound, partnership, fundraising), notes (a 1-2 sentence summary of what was discussed). Use null for any field you can't extract. Respond ONLY with JSON, no preamble.`;
  const userPrompt = `Meeting title: ${capture.title ?? '(no title)'}
Attendees: ${(capture.attendees ?? []).join(', ') || '(none)'}

Transcript (truncated):
${capture.raw_blob.slice(0, 4000)}`;

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
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!response.ok) return {};
    const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    const raw = (data.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('')
      .trim();
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      contactName: parsed.contactName ?? undefined,
      contactEmail: parsed.contactEmail ?? undefined,
      value: typeof parsed.value === 'number' ? parsed.value : undefined,
      stage: parsed.stage ?? undefined,
      pipeline: parsed.pipeline ?? undefined,
      notes: parsed.notes ?? undefined,
    };
  } catch (err) {
    logger.warn('extractDealFieldsFromCapture failed', {
      captureId: capture.capture_id,
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}

// ── Main entry point ─────────────────────────────────────────────

export async function processMessage(
  request: TogariRequest,
  onProgress?: OnProgress,
): Promise<TogariResponse> {
  console.log(`[core/engine] Processing: '${request.text.slice(0, 80)}' from ${request.platform}/${request.userId}`);

  // Progress callback is declared and forwarded-ready; Phase 1 engine
  // doesn't yet emit intermediate events because the existing handlers
  // are short. Long-running handlers (proposal, analyze_meeting) will
  // start calling onProgress when Step 3 / 4 migrations wire transports
  // through this engine. Declared no-op invocation so unused-var rules
  // stay happy without the param being lost.
  void onProgress;

  // TOGARI_TOOL_LOOP_ENABLED — route through the new tool-use runner.
  // The runner replaces classifyIntent + handleSingleIntent end-to-end
  // for transports that haven't taken over invocation themselves (i.e.
  // MCP `ask_togari` and any future API caller). The Slack transport
  // calls runToolUseLoop directly when the flag is on so it can pass
  // channel/thread context for resume + side-effect rendering.
  if (isToolLoopEnabled()) {
    const channelId = (request.transportMetadata?.channelId as string | undefined);
    const threadTs = (request.transportMetadata?.threadTs as string | undefined);
    const { response } = await runToolUseLoop(request, {
      channelId,
      threadTs,
      onProgress,
    });
    return response;
  }

  try {
    // Step 1: Classify intent(s) — now returns an array. Pass the
    // requester's TZ so the parser computes reminder_times relative to
    // the user, not the server.
    const timezone = await getUserTimezone(request.userId);
    const intents = await classifyIntent(request, { timezone });
    console.log(`[core/engine] ${intents.length} intent(s): ${intents.map(i => `${i.intent}(${i.confidence}%)`).join(', ')}`);
    logger.info('Processing message', {
      text: request.text.slice(0, 100),
      platform: request.platform,
      userId: request.userId,
      intentCount: intents.length,
      intents: intents.map(i => i.intent),
    });

    // Step 2: Filter by confidence — 40 threshold for non-conversation, no gate for conversation
    const executable: ParsedIntent[] = [];
    const skipped: ParsedIntent[] = [];

    for (const intent of intents) {
      if (intent.intent === 'conversation') {
        executable.push(intent);
      } else if (intent.confidence >= 40) {
        executable.push(intent);
      } else {
        skipped.push(intent);
      }
    }

    // If ALL below threshold, ask for clarification
    if (executable.length === 0) {
      const maxConf = Math.max(...intents.map(i => i.confidence));
      return {
        type: 'text',
        text: `I wasn't confident enough to process that (max confidence: ${maxConf}%). Could you rephrase with more details?\n\nFor example:\n- "New deal with Acme Corp, contact John Smith, 5k monthly"\n- "Show me all deals in discovery stage"\n- "Schedule a call with Sarah at 3pm Wednesday"`,
      };
    }

    // Step 3: Single action — handle directly
    if (executable.length === 1) {
      return await handleSingleIntent(executable[0], request);
    }

    // Step 4: Multi-action — process all and aggregate
    const results: Array<{ intent: ParsedIntent; response: TogariResponse }> = [];

    for (const intent of executable) {
      try {
        const response = await handleSingleIntent(intent, request);
        results.push({ intent, response });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.push({
          intent,
          response: { type: 'error', text: `${intent.intent} failed: ${errMsg}` },
        });
      }
    }

    // Build aggregated response
    const successResults = results.filter(r => r.response.type !== 'error');
    const failResults = results.filter(r => r.response.type === 'error');

    const summaryLines: string[] = [];

    // Header
    if (failResults.length === 0) {
      summaryLines.push(`Processed ${successResults.length} action${successResults.length > 1 ? 's' : ''}:`);
    } else if (successResults.length === 0) {
      summaryLines.push(`All ${failResults.length} action${failResults.length > 1 ? 's' : ''} failed:`);
    } else {
      summaryLines.push(`${successResults.length} succeeded, ${failResults.length} failed:`);
    }
    summaryLines.push('');

    for (const r of successResults) {
      summaryLines.push(`- ${r.response.text}`);
    }
    for (const r of failResults) {
      summaryLines.push(`- [Error] ${r.response.text}`);
    }

    if (skipped.length > 0) {
      summaryLines.push('');
      summaryLines.push(`${skipped.length} action${skipped.length > 1 ? 's were' : ' was'} unclear — could you rephrase?`);
    }

    // Collect all attachments and actions from individual responses
    const allAttachments = results.flatMap(r => r.response.attachments || []);
    const allActions = results.flatMap(r => r.response.actions || []);
    const allData = results.reduce((acc, r) => {
      if (r.response.data) {
        acc[r.intent.intent] = acc[r.intent.intent] || [];
        (acc[r.intent.intent] as any[]).push(r.response.data);
      }
      return acc;
    }, {} as Record<string, any>);

    return {
      type: successResults.length > 0 ? successResults[0].response.type : 'error',
      text: summaryLines.join('\n'),
      data: { actionResults: allData, totalActions: results.length, successCount: successResults.length, failCount: failResults.length },
      attachments: allAttachments.length > 0 ? allAttachments : undefined,
      actions: allActions.length > 0 ? allActions : undefined,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[core/engine] Error:', errMsg);
    logger.error('Engine processing failed', err instanceof Error ? err : new Error(errMsg), {
      text: request.text.slice(0, 100),
      platform: request.platform,
    });

    return {
      type: 'error',
      text: `Something went wrong: ${errMsg}. Please try again or rephrase your request.`,
    };
  }
}
