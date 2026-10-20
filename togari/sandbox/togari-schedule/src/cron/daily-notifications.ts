/**
 * Daily Notification Cron — Standalone entry point for scheduled execution.
 *
 * V2: Processes signal subscriptions based on monitor_frequency + last_run_at.
 * V1 (legacy): Processes subscriptions without signal_query via the old enrichment pipeline.
 *
 * For each due subscription:
 *   - V2 (has signal_query): runSignalQuery() → send notification with matched contacts
 *   - V1 (no signal_query): runEnrichmentForSubscriber() → draft outreach → send notification
 *
 * Rate limits: max 50 Exa calls per cron run, Clay 10/min.
 *
 * Run via Railway cron: node dist/cron/daily-notifications.cjs
 * Or manually: POST /api/cron/daily-notifications (with CRON_SECRET bearer token)
 */

import {
  listActiveSubscriptions,
  updateSubscription,
} from '../agents/opportunity-notifications/subscription-manager';
import {
  runEnrichmentForSubscriber,
  runSignalQuery,
  clearExaCache,
  resetRunExaCounter,
} from '../agents/opportunity-notifications/enrichment-pipeline';
import { batchDraftOutreach } from '../agents/opportunity-notifications/outreach-drafter';
import { sendNotification } from '../agents/opportunity-notifications/notification-sender';
import type {
  Subscription,
  NotificationPayload,
  NotificationMatch,
  MonitorFrequency,
} from '../agents/opportunity-notifications/types';

// ─── Frequency Helpers ───────────────────────────────────────────────────

/** Returns true if this subscription is due for a run based on frequency + last_run_at */
function isDueForRun(sub: Subscription): boolean {
  const lastRun = sub.last_run_at || sub.last_enrichment_at;
  if (!lastRun) return true; // Never run before

  const lastRunDate = new Date(lastRun);
  const now = new Date();
  const msSinceLastRun = now.getTime() - lastRunDate.getTime();
  const hoursSinceLastRun = msSinceLastRun / (1000 * 60 * 60);

  const freq: MonitorFrequency = sub.monitor_frequency || 'daily';
  switch (freq) {
    case 'daily':
      return hoursSinceLastRun >= 22; // ~daily with some buffer
    case 'weekly':
      return hoursSinceLastRun >= 166; // ~7 days with buffer
    case 'biweekly':
      return hoursSinceLastRun >= 332; // ~14 days with buffer
    default:
      return hoursSinceLastRun >= 22;
  }
}

/** Calculate next notification date based on frequency */
function getNextNotificationDate(freq: MonitorFrequency): string {
  const next = new Date();
  switch (freq) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      break;
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'biweekly':
      next.setDate(next.getDate() + 14);
      break;
  }
  return next.toISOString().split('T')[0];
}

// ─── V2: Signal Subscription Processing ──────────────────────────────────

async function processSignalSubscription(sub: Subscription): Promise<{
  status: 'sent' | 'failed' | 'skipped';
  matchCount: number;
  error?: string;
}> {
  const result = await runSignalQuery(sub);

  if (result.matched_contacts.length === 0) {
    process.stderr.write(`  No signal matches — skipping notification\n`);
    await updateSubscription(sub.subscription_id, {
      last_enrichment_at: new Date().toISOString(),
      last_run_at: new Date().toISOString(),
    });
    return { status: 'skipped', matchCount: 0 };
  }

  // Build notification payload from signal results
  const freq: MonitorFrequency = sub.monitor_frequency || 'daily';
  const matches: NotificationMatch[] = result.matched_contacts.map(contact => ({
    job_posting: {
      title: contact.title || 'Contact Match',
      company: contact.company,
      company_domain: contact.company_domain,
      url: contact.linkedin_url || '',
      posted_date: null,
      seniority: null,
      employment_type: null,
      location: null,
      source: contact.source === 'clay' ? 'clay' as const : 'exa' as const,
    },
    recruiter: contact.email ? {
      name: contact.name,
      title: contact.title,
      email: contact.email,
      linkedin_url: contact.linkedin_url,
      company: contact.company,
    } : null,
    outreach_draft: {
      subject: `Reaching out — ${contact.company}`,
      body: contact.name
        ? `Hi ${contact.name},\n\nI found your profile while researching ${contact.company}. I'd love to connect and discuss potential synergies.\n\nBest regards`
        : `Hello,\n\nI came across ${contact.company} and would love to connect to discuss potential collaboration.\n\nBest regards`,
    },
  }));

  const payload: NotificationPayload = {
    subscriber: {
      name: sub.subscriber_name,
      email: sub.subscriber_email,
    },
    date: new Date().toISOString().split('T')[0],
    matches,
    total_matches: matches.length,
    companies_discovered: new Set(result.matched_contacts.map(c => c.company)).size,
    next_notification_date: getNextNotificationDate(freq),
  };

  const stats = {
    exa_calls: result.exa_results.length,
    clay_calls: result.matched_contacts.filter(c => c.source === 'clay').length,
    cost_usd: 0,
    companies_found: new Set(result.matched_contacts.map(c => c.company)).size,
    postings_found: result.matched_contacts.length,
  };

  const sendResult = await sendNotification(sub, payload, stats);

  const now = new Date().toISOString();
  const newTotal = (sub.total_matches_found || 0) + result.new_since_last_run;
  await updateSubscription(sub.subscription_id, {
    last_enrichment_at: now,
    last_run_at: now,
    total_matches_found: newTotal,
    ...(sendResult.status === 'sent' ? { last_notification_at: now } : {}),
  });

  return {
    status: sendResult.status,
    matchCount: matches.length,
    error: sendResult.error,
  };
}

// ─── V1: Legacy Subscription Processing ──────────────────────────────────

async function processLegacySubscription(sub: Subscription): Promise<{
  status: 'sent' | 'failed' | 'skipped';
  matchCount: number;
  error?: string;
}> {
  const { companies, postings, recruiters, stats } = await runEnrichmentForSubscriber(sub);

  if (postings.length === 0) {
    process.stderr.write(`  No new matches — skipping notification\n`);
    await updateSubscription(sub.subscription_id, {
      last_enrichment_at: new Date().toISOString(),
    });
    return { status: 'skipped', matchCount: 0 };
  }

  // Draft outreach messages
  const drafts = await batchDraftOutreach(
    postings,
    recruiters,
    { name: sub.subscriber_name, email: sub.subscriber_email },
  );

  // Assemble notification
  const freq: MonitorFrequency = sub.monitor_frequency || 'daily';
  const matches: NotificationMatch[] = postings.map(posting => ({
    job_posting: posting,
    recruiter: recruiters.get(posting.company) ?? null,
    outreach_draft: drafts.get(posting.url) ?? {
      subject: `Re: ${posting.title}`,
      body: `Interested in the ${posting.title} role at ${posting.company}.`,
    },
  }));

  const payload: NotificationPayload = {
    subscriber: {
      name: sub.subscriber_name,
      email: sub.subscriber_email,
    },
    date: new Date().toISOString().split('T')[0],
    matches,
    total_matches: matches.length,
    companies_discovered: companies.length,
    next_notification_date: getNextNotificationDate(freq),
  };

  const sendResult = await sendNotification(sub, payload, stats);

  const now = new Date().toISOString();
  await updateSubscription(sub.subscription_id, {
    last_enrichment_at: now,
    ...(sendResult.status === 'sent' ? { last_notification_at: now } : {}),
  });

  return {
    status: sendResult.status,
    matchCount: matches.length,
    error: sendResult.error,
  };
}

// ─── Main Pipeline ───────────────────────────────────────────────────────

async function runDailyNotifications(): Promise<void> {
  const startTime = Date.now();
  process.stderr.write(`[${new Date().toISOString()}] Signal notification pipeline starting...\n`);

  const subscriptions = await listActiveSubscriptions();
  process.stderr.write(`Found ${subscriptions.length} active subscriptions\n`);

  if (subscriptions.length === 0) {
    process.stderr.write('No active subscriptions — exiting\n');
    return;
  }

  clearExaCache();
  resetRunExaCounter();

  // Filter to subscriptions that are due for a run
  const dueSubscriptions = subscriptions.filter(isDueForRun);
  process.stderr.write(`${dueSubscriptions.length} subscriptions due for processing\n`);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const sub of dueSubscriptions) {
    try {
      process.stderr.write(`\nProcessing: ${sub.subscriber_email} (${sub.subscription_id})\n`);

      const isSignalV2 = !!sub.signal_query;
      const result = isSignalV2
        ? await processSignalSubscription(sub)
        : await processLegacySubscription(sub);

      if (result.status === 'sent') {
        sent++;
        process.stderr.write(`  Sent ${result.matchCount} matches via ${sub.notification_channels.join(', ')}\n`);
      } else if (result.status === 'failed') {
        failed++;
        process.stderr.write(`  Send failed: ${result.error}\n`);
      } else {
        skipped++;
      }
    } catch (err) {
      failed++;
      process.stderr.write(`  Error: ${err instanceof Error ? err.message : err}\n`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  process.stderr.write(
    `\n[${new Date().toISOString()}] Pipeline complete in ${elapsed}s — ` +
    `sent: ${sent}, skipped: ${skipped}, failed: ${failed}\n`
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────

runDailyNotifications()
  .then(() => process.exit(0))
  .catch(err => {
    process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  });
