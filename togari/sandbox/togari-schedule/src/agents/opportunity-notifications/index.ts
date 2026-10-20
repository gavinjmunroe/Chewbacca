/**
 * Opportunity Engine V2 — MCP Tool Registration
 *
 * 8 tools:
 *   Signal Subscriptions (continuous monitoring):
 *     signal_create_subscription  — create a new signal subscription
 *     signal_list_subscriptions   — list signal subscriptions
 *     signal_update_subscription  — update criteria, frequency, or status
 *     signal_trigger_scan         — manually trigger a signal scan (for testing)
 *     signal_get_results          — query signal result history
 *
 *   One-Time Data Pulls (ad hoc):
 *     create_data_pull            — request a one-time contact list export
 *     get_data_pull_status        — check status of a data pull
 *     list_data_pulls             — list data pulls for a client
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { BigQuery } from '@google-cloud/bigquery';
import {
  createSubscription,
  listSubscriptions,
  getSubscription,
  updateSubscription,
  listActiveSubscriptions,
} from './subscription-manager';
import {
  runSignalQuery,
  runEnrichmentForSubscriber,
  clearExaCache,
  resetRunExaCounter,
  clearClayThrottle,
} from './enrichment-pipeline';
import { batchDraftOutreach } from './outreach-drafter';
import { sendNotification } from './notification-sender';
import {
  createDataPullRecord,
  getDataPullRequest,
  listDataPullRequests,
  processDataPull,
  createDataPullCheckout,
  estimateDataPullCost,
} from './data-pull-pipeline';
import {
  SENIORITY_LEVELS, EMPLOYMENT_TYPES, COMPANY_SIZES, MONITOR_FREQUENCIES, PRICING_PLANS,
} from './types';
import type {
  NotificationPayload, NotificationMatch, PricingPlan, MonitorFrequency,
} from './types';

// ─── BigQuery Helpers ─────────────────────────────────────────────────────

function fqt(table: string): string {
  const project = process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3';
  const dataset = process.env.BIGQUERY_DATASET ?? 'togari_data_lake';
  return `\`${project}.${dataset}.${table}\``;
}

function getBqClient(): BigQuery {
  const projectId = process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3';
  const options: ConstructorParameters<typeof BigQuery>[0] = { projectId };
  const gcpCredentialsBase64 = process.env.GCP_CREDENTIALS_BASE64;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gcpCredentialsBase64) {
    const decoded = Buffer.from(gcpCredentialsBase64, 'base64').toString('utf-8');
    options.credentials = JSON.parse(decoded);
  } else if (credentialsPath) {
    options.keyFilename = credentialsPath;
  }
  return new BigQuery(options);
}

// ─── Enum Schemas ─────────────────────────────────────────────────────────

const seniorityEnum = z.enum(SENIORITY_LEVELS as unknown as [string, ...string[]]);
const employmentTypeEnum = z.enum(EMPLOYMENT_TYPES as unknown as [string, ...string[]]);
const companySizeEnum = z.enum(COMPANY_SIZES as unknown as [string, ...string[]]);
const planEnum = z.enum(['starter', 'standard', 'professional', 'enterprise'] as [string, ...string[]]);
const frequencyEnum = z.enum(MONITOR_FREQUENCIES as unknown as [string, ...string[]]);

// ─── Tool Registration ────────────────────────────────────────────────────

export function registerOpportunityNotificationAgents(server: McpServer): void {

  // ── signal_create_subscription ─────────────────────────────────────────

  server.tool(
    'signal_create_subscription',
    'Create a new signal subscription for continuous monitoring. ' +
    'Provide a natural language signal_query (e.g. "VP of Sales at Series B healthtech companies in NYC") ' +
    'OR traditional structured filters (industries, company sizes, job titles). ' +
    'Subscriptions run on a schedule (daily/weekly/biweekly) and send notifications via email/Slack.',
    {
      subscriber_email: z.string().email().describe('Subscriber email address'),
      subscriber_name: z.string().optional().describe('Subscriber full name'),
      // V2: Natural language signal query
      signal_query: z.string().optional().describe('Natural language description of who/what to monitor (e.g. "hiring VPs at medtech startups")'),
      // Frequency
      monitor_frequency: frequencyEnum.optional().default('daily').describe('How often to run: daily, weekly, or biweekly'),
      // Pricing
      plan: planEnum.describe('Pricing plan: starter ($40/mo, 50 co), standard ($60/mo, 100 co), professional ($80/mo, 200 co), enterprise ($150/mo, 500 co)'),
      companies_limit: z.number().optional().describe('Max companies to monitor per run (overrides plan default)'),
      stripe_price_id: z.string().optional().describe('Stripe Price ID for the selected plan'),
      // Legacy structured filters (still supported)
      target_industries: z.array(z.string()).optional().describe('Industries to search (e.g. ["digital health", "medtech"])'),
      target_company_sizes: z.array(companySizeEnum).optional().describe('Company size codes: A(self-employed) through I(10001+)'),
      target_location: z.string().optional().default('United States').describe('Location filter'),
      target_job_titles: z.array(z.string()).optional().describe('Job titles/roles to search'),
      target_seniority: seniorityEnum.nullable().optional().describe('Seniority level filter'),
      target_employment_type: employmentTypeEnum.nullable().optional().describe('Employment type filter'),
      posting_limit_per_company: z.number().optional().default(10).describe('Max postings per company (default 10, max 100)'),
      target_keywords: z.array(z.string()).optional().describe('Additional search keywords'),
      // Notification
      notification_channels: z.array(z.enum(['email', 'slack', 'both'])).min(1).describe('Notification channels'),
      slack_channel_id: z.string().optional().describe('Slack channel ID (required if slack selected)'),
      notification_email: z.string().email().optional().describe('Override email for notifications'),
      // Clay integration
      clay_table_webhook_url: z.string().url().optional().describe('Pre-configured Clay table webhook URL'),
    },
    async (params) => {
      try {
        // Require either signal_query or structured filters
        if (!params.signal_query && (!params.target_industries || params.target_industries.length === 0)) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Provide either signal_query or target_industries + target_job_titles' }) }],
            isError: true,
          };
        }

        const channels = params.notification_channels.map(c =>
          c === 'both' ? ['email', 'slack'] : [c]
        ).flat() as ('email' | 'slack')[];

        if (channels.includes('slack') && !params.slack_channel_id) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'slack_channel_id is required when slack is in notification_channels' }) }],
            isError: true,
          };
        }

        const subscription = await createSubscription({
          subscriber_email: params.subscriber_email,
          subscriber_name: params.subscriber_name,
          signal_query: params.signal_query,
          monitor_frequency: (params.monitor_frequency as MonitorFrequency) || 'daily',
          companies_limit: params.companies_limit,
          plan: params.plan as PricingPlan,
          stripe_price_id: params.stripe_price_id,
          target_industries: params.target_industries || [],
          target_company_sizes: params.target_company_sizes as any || [],
          target_location: params.target_location,
          target_job_titles: params.target_job_titles || [],
          target_seniority: params.target_seniority ?? null,
          target_employment_type: params.target_employment_type ?? null,
          posting_limit_per_company: params.posting_limit_per_company,
          target_keywords: params.target_keywords,
          notification_channels: channels,
          slack_channel_id: params.slack_channel_id,
          notification_email: params.notification_email,
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'signal_subscription_created',
              subscription_id: subscription.subscription_id,
              signal_query: subscription.signal_query,
              monitor_frequency: subscription.monitor_frequency,
              plan: subscription.plan,
              companies_limit: subscription.companies_limit,
              status: subscription.status,
              payment_status: subscription.payment_status,
              notification_channels: subscription.notification_channels,
              clay_sync: !!subscription.clay_table_webhook_url,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error creating subscription: ${err instanceof Error ? err.message : err}` }],
          isError: true,
        };
      }
    },
  );

  // ── signal_list_subscriptions ──────────────────────────────────────────

  server.tool(
    'signal_list_subscriptions',
    'List signal subscriptions. Optionally filter by status or email.',
    {
      status: z.enum(['active', 'paused', 'canceled']).optional().describe('Filter by subscription status'),
      email: z.string().optional().describe('Filter by subscriber email'),
    },
    async (params) => {
      try {
        const subs = await listSubscriptions({
          status: params.status,
          email: params.email,
        });

        const summary = subs.map(s => ({
          subscription_id: s.subscription_id,
          subscriber_email: s.subscriber_email,
          subscriber_name: s.subscriber_name,
          signal_query: s.signal_query,
          monitor_frequency: s.monitor_frequency,
          plan: s.plan,
          companies_limit: s.companies_limit,
          status: s.status,
          payment_status: s.payment_status,
          total_matches_found: s.total_matches_found,
          channels: s.notification_channels,
          clay_sync: !!s.clay_table_webhook_url,
          last_run_at: s.last_run_at,
          last_notification: s.last_notification_at,
        }));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'list_signal_subscriptions',
              total: summary.length,
              subscriptions: summary,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error listing subscriptions: ${err instanceof Error ? err.message : err}` }],
          isError: true,
        };
      }
    },
  );

  // ── signal_update_subscription ─────────────────────────────────────────

  server.tool(
    'signal_update_subscription',
    'Update a signal subscription — signal query, frequency, criteria, channels, or pause/resume/cancel.',
    {
      subscription_id: z.string().describe('Subscription ID to update'),
      signal_query: z.string().optional().describe('New natural language signal query'),
      monitor_frequency: frequencyEnum.optional().describe('New frequency: daily, weekly, or biweekly'),
      companies_limit: z.number().optional().describe('New companies limit per run'),
      target_industries: z.array(z.string()).optional().describe('New industries list'),
      target_company_sizes: z.array(companySizeEnum).optional().describe('New company sizes'),
      target_location: z.string().optional().describe('New location filter'),
      target_job_titles: z.array(z.string()).optional().describe('New job titles list'),
      target_seniority: seniorityEnum.nullable().optional().describe('New seniority level'),
      target_employment_type: employmentTypeEnum.nullable().optional().describe('New employment type'),
      posting_limit_per_company: z.number().optional().describe('New posting limit per company'),
      target_keywords: z.array(z.string()).optional().describe('New keywords list'),
      notification_channels: z.array(z.enum(['email', 'slack', 'both'])).optional().describe('Change notification channels'),
      slack_channel_id: z.string().optional().describe('New Slack channel ID'),
      notification_email: z.string().optional().describe('New notification email'),
      clay_table_webhook_url: z.string().optional().describe('New Clay table webhook URL'),
      status: z.enum(['active', 'paused', 'canceled']).optional().describe('Change subscription status'),
    },
    async (params) => {
      try {
        const existing = await getSubscription(params.subscription_id);
        if (!existing) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Subscription not found' }) }],
            isError: true,
          };
        }

        const { subscription_id, notification_channels, ...rest } = params;
        const updates: Record<string, unknown> = Object.fromEntries(
          Object.entries(rest).filter(([, v]) => v !== undefined)
        );

        // Expand 'both' in notification channels
        if (notification_channels) {
          updates.notification_channels = notification_channels.map(c =>
            c === 'both' ? ['email', 'slack'] : [c]
          ).flat();
        }

        await updateSubscription(subscription_id, updates);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'signal_subscription_updated',
              subscription_id,
              updated_fields: Object.keys(updates),
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error updating subscription: ${err instanceof Error ? err.message : err}` }],
          isError: true,
        };
      }
    },
  );

  // ── signal_trigger_scan ────────────────────────────────────────────────

  server.tool(
    'signal_trigger_scan',
    'Manually trigger a signal scan for testing. ' +
    'Runs the full pipeline: parse signal query → Exa search → dedup → Clay enrichment → notification. ' +
    'For legacy subscriptions (no signal_query), runs the V1 enrichment pipeline.',
    {
      subscription_id: z.string().optional().describe('Specific subscription to scan (omit for all active)'),
      dry_run: z.boolean().optional().default(false).describe('Preview results without sending notifications'),
    },
    async (params) => {
      try {
        const subscriptions = params.subscription_id
          ? [await getSubscription(params.subscription_id)].filter(Boolean) as Awaited<ReturnType<typeof getSubscription>>[]
          : await listActiveSubscriptions();

        if (subscriptions.length === 0) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ action: 'signal_trigger_scan', message: 'No active subscriptions found' }) }],
          };
        }

        clearExaCache();
        resetRunExaCounter();
        clearClayThrottle();

        const results: Array<{
          subscription_id: string;
          email: string;
          mode: 'signal_v2' | 'legacy_v1';
          matches_found: number;
          new_contacts: number;
          notification_status: string;
          error?: string;
        }> = [];

        for (const sub of subscriptions) {
          if (!sub) continue;

          const isSignalV2 = !!sub.signal_query;

          if (isSignalV2) {
            // V2: Signal Query Pipeline
            try {
              const signalResult = await runSignalQuery(sub);

              if (params.dry_run) {
                results.push({
                  subscription_id: sub.subscription_id,
                  email: sub.subscriber_email,
                  mode: 'signal_v2',
                  matches_found: signalResult.matched_contacts.length,
                  new_contacts: signalResult.new_since_last_run,
                  notification_status: 'dry_run',
                });
              } else {
                // Send notification
                const matches: NotificationMatch[] = signalResult.matched_contacts.map(contact => ({
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
                    body: `Hi${contact.name ? ` ${contact.name}` : ''},\n\nI found your profile while researching ${contact.company} and would love to connect.\n\nBest regards`,
                  },
                }));

                const freq: MonitorFrequency = sub.monitor_frequency || 'daily';
                const nextDate = new Date();
                switch (freq) {
                  case 'daily': nextDate.setDate(nextDate.getDate() + 1); break;
                  case 'weekly': nextDate.setDate(nextDate.getDate() + 7); break;
                  case 'biweekly': nextDate.setDate(nextDate.getDate() + 14); break;
                }

                const payload: NotificationPayload = {
                  subscriber: { name: sub.subscriber_name, email: sub.subscriber_email },
                  date: new Date().toISOString().split('T')[0],
                  matches,
                  total_matches: matches.length,
                  companies_discovered: new Set(signalResult.matched_contacts.map(c => c.company)).size,
                  next_notification_date: nextDate.toISOString().split('T')[0],
                };

                const stats = {
                  exa_calls: signalResult.exa_results.length,
                  clay_calls: signalResult.matched_contacts.filter(c => c.source === 'clay').length,
                  cost_usd: 0,
                  companies_found: new Set(signalResult.matched_contacts.map(c => c.company)).size,
                  postings_found: signalResult.matched_contacts.length,
                };

                const sendResult = await sendNotification(sub, payload, stats);

                const now = new Date().toISOString();
                const newTotal = (sub.total_matches_found || 0) + signalResult.new_since_last_run;
                await updateSubscription(sub.subscription_id, {
                  last_enrichment_at: now,
                  last_run_at: now,
                  total_matches_found: newTotal,
                  ...(sendResult.status === 'sent' ? { last_notification_at: now } : {}),
                });

                results.push({
                  subscription_id: sub.subscription_id,
                  email: sub.subscriber_email,
                  mode: 'signal_v2',
                  matches_found: signalResult.matched_contacts.length,
                  new_contacts: signalResult.new_since_last_run,
                  notification_status: sendResult.status,
                  error: sendResult.error,
                });
              }
            } catch (err) {
              results.push({
                subscription_id: sub.subscription_id,
                email: sub.subscriber_email,
                mode: 'signal_v2',
                matches_found: 0,
                new_contacts: 0,
                notification_status: 'failed',
                error: err instanceof Error ? err.message : String(err),
              });
            }
          } else {
            // V1: Legacy Enrichment Pipeline
            const { companies, postings, recruiters, stats, clay_synced } =
              await runEnrichmentForSubscriber(sub);

            const drafts = await batchDraftOutreach(
              postings,
              recruiters,
              { name: sub.subscriber_name, email: sub.subscriber_email },
            );

            const freq: MonitorFrequency = sub.monitor_frequency || 'daily';
            const nextDate = new Date();
            switch (freq) {
              case 'daily': nextDate.setDate(nextDate.getDate() + 1); break;
              case 'weekly': nextDate.setDate(nextDate.getDate() + 7); break;
              case 'biweekly': nextDate.setDate(nextDate.getDate() + 14); break;
            }

            const matches: NotificationMatch[] = postings.map(posting => ({
              job_posting: posting,
              recruiter: recruiters.get(posting.company) ?? null,
              outreach_draft: drafts.get(posting.url) ?? {
                subject: `Re: ${posting.title}`,
                body: `Interested in the ${posting.title} role at ${posting.company}.`,
              },
            }));

            const payload: NotificationPayload = {
              subscriber: { name: sub.subscriber_name, email: sub.subscriber_email },
              date: new Date().toISOString().split('T')[0],
              matches,
              total_matches: matches.length,
              companies_discovered: companies.length,
              next_notification_date: nextDate.toISOString().split('T')[0],
            };

            if (params.dry_run) {
              results.push({
                subscription_id: sub.subscription_id,
                email: sub.subscriber_email,
                mode: 'legacy_v1',
                matches_found: stats.postings_found,
                new_contacts: 0,
                notification_status: 'dry_run',
              });
            } else {
              const sendResult = await sendNotification(sub, payload, stats);
              const now = new Date().toISOString();
              await updateSubscription(sub.subscription_id, {
                last_enrichment_at: now,
                ...(sendResult.status === 'sent' ? { last_notification_at: now } : {}),
              });

              results.push({
                subscription_id: sub.subscription_id,
                email: sub.subscriber_email,
                mode: 'legacy_v1',
                matches_found: stats.postings_found,
                new_contacts: 0,
                notification_status: sendResult.status,
                error: sendResult.error,
              });
            }
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'signal_trigger_scan',
              subscriptions_processed: results.length,
              results,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error triggering scan: ${err instanceof Error ? err.message : err}` }],
          isError: true,
        };
      }
    },
  );

  // ── signal_get_results ─────────────────────────────────────────────────

  server.tool(
    'signal_get_results',
    'Query signal result history for a subscription. Shows past signal runs with match counts, contacts found, and Exa results.',
    {
      subscription_id: z.string().describe('Subscription ID to query results for'),
      limit: z.number().optional().default(10).describe('Max results to return (default 10)'),
      include_contacts: z.boolean().optional().default(false).describe('Include matched_contacts in response (can be large)'),
    },
    async (params) => {
      try {
        const bq = getBqClient();

        // Query signal_results table
        const [signalRows] = await bq.query({
          query: `
            SELECT
              result_id,
              subscription_id,
              new_since_last_run,
              created_at,
              ${params.include_contacts ? 'matched_contacts, exa_results,' : ''}
              JSON_LENGTH(matched_contacts) as total_contacts,
              JSON_LENGTH(exa_results) as total_exa_results
            FROM ${fqt('signal_results')}
            WHERE subscription_id = @sub_id
            ORDER BY created_at DESC
            LIMIT @lim
          `,
          params: { sub_id: params.subscription_id, lim: params.limit },
          useLegacySql: false,
        });

        // Also query legacy notification_history for backward compat
        const [legacyRows] = await bq.query({
          query: `
            SELECT
              notification_id,
              channel,
              status,
              error_message,
              matches_count,
              exa_calls_used,
              clay_calls_used,
              enrichment_cost_usd,
              sent_at
            FROM ${fqt('notification_history')}
            WHERE subscription_id = @sub_id
            ORDER BY sent_at DESC
            LIMIT @lim
          `,
          params: { sub_id: params.subscription_id, lim: params.limit },
          useLegacySql: false,
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'signal_get_results',
              subscription_id: params.subscription_id,
              signal_results: {
                total: (signalRows as unknown[]).length,
                results: signalRows,
              },
              notification_history: {
                total: (legacyRows as unknown[]).length,
                history: legacyRows,
              },
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error querying results: ${err instanceof Error ? err.message : err}` }],
          isError: true,
        };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ONE-TIME DATA PULLS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── create_data_pull ───────────────────────────────────────────────────

  server.tool(
    'create_data_pull',
    'Request a one-time contact list export. ' +
    'Provide a natural language query describing the contacts you need (e.g. "50 VP of Sales at Series B healthcare companies in NYC"). ' +
    'Creates a Stripe checkout session for payment, then processes the pull: ' +
    'searches the datalake, enriches shortfall via Exa + Clay, generates CSV, and emails the download link.',
    {
      query: z.string().min(1).describe('Natural language description of contacts needed'),
      count: z.number().int().positive().max(10000).describe('Number of contacts requested'),
      client_id: z.string().describe('Client ID or email for this request'),
      skip_payment: z.boolean().optional().default(false).describe('Skip Stripe checkout (for testing or pre-paid clients)'),
    },
    async (params) => {
      try {
        // Create the data pull record
        const request = await createDataPullRecord(
          params.client_id,
          params.query,
          params.count,
          null,
        );

        const estimatedCost = estimateDataPullCost(params.count);

        // Create Stripe checkout (one-time payment)
        let checkoutUrl: string | null = null;
        if (!params.skip_payment) {
          checkoutUrl = await createDataPullCheckout(
            request.pull_id,
            params.client_id.includes('@') ? params.client_id : `${params.client_id}@togari.com`,
            params.count,
          );
        }

        if (params.skip_payment || !checkoutUrl) {
          // Process immediately (pre-paid or no Stripe)
          const result = await processDataPull(request);

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                action: 'data_pull_created',
                pull_id: request.pull_id,
                status: 'ready',
                contacts_delivered: result.contacts.length,
                from_datalake: result.total_from_datalake,
                newly_enriched: result.total_enriched_new,
                csv_download_url: result.csv_download_url,
                cost_usd: request.cost_usd,
              }, null, 2),
            }],
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'data_pull_created',
              pull_id: request.pull_id,
              status: 'pending_payment',
              estimated_cost_usd: estimatedCost,
              stripe_checkout_url: checkoutUrl,
              message: 'Complete payment to start processing. The pull will be processed automatically after payment.',
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error creating data pull: ${err instanceof Error ? err.message : err}` }],
          isError: true,
        };
      }
    },
  );

  // ── get_data_pull_status ───────────────────────────────────────────────

  server.tool(
    'get_data_pull_status',
    'Check the status of a one-time data pull request. Returns current status, contact counts, and download URL when ready.',
    {
      pull_id: z.string().describe('Data pull request ID'),
    },
    async (params) => {
      try {
        const request = await getDataPullRequest(params.pull_id);

        if (!request) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Data pull not found' }) }],
            isError: true,
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'data_pull_status',
              pull_id: request.pull_id,
              client_id: request.client_id,
              query: request.natural_language_query,
              requested_count: request.requested_count,
              status: request.status,
              datalake_matches: request.datalake_matches,
              enrichment_needed: request.enrichment_needed,
              cost_usd: request.cost_usd,
              csv_url: request.csv_url,
              created_at: request.created_at,
              updated_at: request.updated_at,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error getting data pull status: ${err instanceof Error ? err.message : err}` }],
          isError: true,
        };
      }
    },
  );

  // ── list_data_pulls ────────────────────────────────────────────────────

  server.tool(
    'list_data_pulls',
    'List all data pull requests for a client. Shows status, contact counts, costs, and download URLs.',
    {
      client_id: z.string().describe('Client ID to list pulls for'),
    },
    async (params) => {
      try {
        const pulls = await listDataPullRequests(params.client_id);

        const summary = pulls.map(p => ({
          pull_id: p.pull_id,
          query: p.natural_language_query,
          requested: p.requested_count,
          status: p.status,
          datalake: p.datalake_matches,
          enriched: p.enrichment_needed,
          cost_usd: p.cost_usd,
          csv_url: p.csv_url,
          created_at: p.created_at,
        }));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'list_data_pulls',
              client_id: params.client_id,
              total: summary.length,
              pulls: summary,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error listing data pulls: ${err instanceof Error ? err.message : err}` }],
          isError: true,
        };
      }
    },
  );
}
