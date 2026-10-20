/**
 * @togari/admin — Email processing orchestrator
 *
 * Coordinates the full email triage flow:
 * fetch → classify → deal lookup → draft/notify
 */

import { createLogger } from '../observability/logger';
import { getRecentEmails, createDraftReply, type ParsedEmail } from './gmail-client';
import { classifyEmail } from './classifier';
import { notifyDraftReady, notifyManualResponse, notifySummary, type ProcessingStats } from './slack-client';
import { lookupDealOwner, lookupDealOwnerByName } from './deal-lookup';

const logger = createLogger('EmailProcessor');

export interface TeamMember {
  name: string;
  email: string;
  slackId: string;
}

const TEAM: TeamMember[] = [
  { name: 'Karthik Dev', email: 'karthik@bluemodernadvisory.com', slackId: 'U08L8PFMWBE' },
  { name: 'Kevin Cong', email: 'kevin@bluemodernadvisory.com', slackId: 'U088N3LT0SU' },
  { name: 'Sagar Tiwari', email: 'sagar@bluemodernadvisory.com', slackId: 'U087Z8LPMMY' },
];

const OWNER_SLACK_MAP: Record<string, string | null> = {
  'karthik dev': 'U08L8PFMWBE',
  'karthik': 'U08L8PFMWBE',
  'kevin cong': 'U088N3LT0SU',
  'kevin': 'U088N3LT0SU',
  'sagar tiwari': 'U087Z8LPMMY',
  'sagar': 'U087Z8LPMMY',
  'maggie chen': null,
  'maggie': null,
};

function resolveSlackId(ownerName: string): string | null {
  const normalized = ownerName.toLowerCase().trim();
  if (normalized in OWNER_SLACK_MAP) {
    return OWNER_SLACK_MAP[normalized];
  }
  // Try first name match
  const firstName = normalized.split(' ')[0];
  if (firstName in OWNER_SLACK_MAP) {
    return OWNER_SLACK_MAP[firstName];
  }
  return null;
}

const DELAY_MS = 1000;
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processEmailForMember(
  email: ParsedEmail,
  member: TeamMember,
  slackChannel: string,
): Promise<'trash' | 'easy' | 'complex' | 'error'> {
  try {
    // Classify
    const result = await classifyEmail(email, member.name);

    if (result.classification === 'TRASH') {
      logger.debug('Trashed email', { subject: email.subject, from: email.from });
      return 'trash';
    }

    // Determine who to notify — deal owner or inbox owner
    let targetSlackId = member.slackId;
    const deal = await lookupDealOwner(email.from);
    const dealInfo = deal ?? await lookupDealOwnerByName(email.fromName);

    if (dealInfo?.owner) {
      const ownerSlack = resolveSlackId(dealInfo.owner);
      if (ownerSlack) {
        logger.info('Routing to deal owner', {
          dealOwner: dealInfo.owner,
          dealName: dealInfo.dealName,
          sender: email.from,
        });
        targetSlackId = ownerSlack;
      }
    }

    if (result.classification === 'EASY' && result.draft) {
      // Create draft reply in Gmail
      await createDraftReply(
        member.email,
        email.threadId,
        email.from,
        email.subject,
        result.draft,
      );

      // Notify on Slack
      await notifyDraftReady(
        slackChannel,
        targetSlackId,
        email,
        result.draft,
        result.summary ?? result.reason,
      );

      return 'easy';
    }

    // COMPLEX
    await notifyManualResponse(
      slackChannel,
      targetSlackId,
      email,
      result.summary ?? result.reason,
    );

    return 'complex';
  } catch (err) {
    logger.error('Failed to process email', err, {
      subject: email.subject,
      from: email.from,
      inbox: member.email,
    });
    return 'error';
  }
}

export async function processInboxes(
  team: TeamMember[],
  slackChannel: string,
  hoursBack: number,
  lastCheckTimes: Map<string, Date>,
): Promise<ProcessingStats> {
  const stats: ProcessingStats = {
    totalEmails: 0,
    trash: 0,
    easy: 0,
    complex: 0,
    errors: 0,
    inboxes: [],
  };

  for (const member of team) {
    logger.info(`Processing inbox: ${member.email}`);
    stats.inboxes.push(member.name);

    try {
      const emails = await getRecentEmails(member.email, hoursBack);
      stats.totalEmails += emails.length;

      for (const email of emails) {
        const outcome = await processEmailForMember(email, member, slackChannel);
        switch (outcome) {
          case 'trash':
            stats.trash++;
            break;
          case 'easy':
            stats.easy++;
            break;
          case 'complex':
            stats.complex++;
            break;
          case 'error':
            stats.errors++;
            break;
        }

        // Rate limit delay between emails
        await delay(DELAY_MS);
      }

      lastCheckTimes.set(member.email, new Date());
    } catch (err) {
      logger.error(`Failed to process inbox: ${member.email}`, err);
      stats.errors++;
    }
  }

  // Post summary if we processed anything
  if (stats.totalEmails > 0) {
    await notifySummary(slackChannel, stats);
  }

  logger.info('Processing complete', { stats });
  return stats;
}

export function getTeam(): TeamMember[] {
  return TEAM;
}

export function getDefaultSlackChannel(): string {
  return 'C0AQG18C529';
}
