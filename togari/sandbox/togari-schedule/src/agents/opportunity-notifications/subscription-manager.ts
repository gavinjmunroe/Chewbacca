/**
 * Subscription Manager — BigQuery CRUD for opportunity_subscriptions table.
 */

import { BigQuery } from '@google-cloud/bigquery';
import { randomUUID } from 'crypto';
import type {
  Subscription, PricingPlan, SeniorityLevel, EmploymentType, CompanySize, MonitorFrequency,
} from './types';
import { PRICING_PLANS } from './types';

// ─── BigQuery Helpers ──────────────────────────────────────────────────────

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

function fqt(table: string): string {
  const project = process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3';
  const dataset = process.env.BIGQUERY_DATASET ?? 'togari_data_lake';
  return `\`${project}.${dataset}.${table}\``;
}

// ─── CRUD Operations ──────────────────────────────────────────────────────

export interface CreateSubscriptionInput {
  subscriber_email: string;
  subscriber_name?: string;
  // V2: Signal query + frequency
  signal_query?: string;
  monitor_frequency?: MonitorFrequency;
  companies_limit?: number;
  // Pricing
  plan: PricingPlan;
  stripe_price_id?: string;
  // Step 1: Find Companies
  target_industries: string[];
  target_company_sizes: CompanySize[];
  target_location?: string;
  // Step 2: Job Posting signal
  target_job_titles: string[];
  target_seniority?: SeniorityLevel | null;
  target_employment_type?: EmploymentType | null;
  posting_limit_per_company?: number;
  target_keywords?: string[];
  target_companies?: string[];
  // Notification
  notification_channels: ('email' | 'slack')[];
  slack_channel_id?: string;
  notification_email?: string;
}

export async function createSubscription(
  input: CreateSubscriptionInput,
): Promise<Subscription> {
  const bq = getBqClient();
  const now = new Date().toISOString();
  const planConfig = PRICING_PLANS[input.plan];

  const subscription: Subscription = {
    subscription_id: randomUUID(),
    subscriber_email: input.subscriber_email,
    subscriber_name: input.subscriber_name ?? null,
    plan: input.plan,
    max_companies: planConfig.max_companies,
    // V2 fields
    signal_query: input.signal_query ?? null,
    monitor_frequency: input.monitor_frequency ?? 'daily',
    companies_limit: input.companies_limit ?? planConfig.max_companies,
    // Step 1: Find Companies
    target_industries: input.target_industries,
    target_company_sizes: input.target_company_sizes,
    target_location: input.target_location ?? 'United States',
    target_job_titles: input.target_job_titles,
    target_seniority: input.target_seniority ?? null,
    target_employment_type: input.target_employment_type ?? null,
    posting_limit_per_company: Math.min(input.posting_limit_per_company ?? 10, 100),
    target_keywords: input.target_keywords ?? [],
    target_companies: input.target_companies ?? [],
    notification_channels: input.notification_channels,
    notification_email: input.notification_email ?? null,
    slack_channel_id: input.slack_channel_id ?? null,
    clay_table_webhook_url: null,
    clay_results_table_id: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_price_id: input.stripe_price_id ?? null,
    payment_status: 'pending',
    status: 'active',
    last_enrichment_at: null,
    last_notification_at: null,
    last_run_at: null,
    total_matches_found: 0,
    created_at: now,
    updated_at: now,
  };

  // DML INSERT instead of streaming insert so the row is immediately in standard storage
  // and can be updated by the Stripe webhook (streaming buffer rows cannot be UPDATEd)
  try {
    await bq.query({
      query: `
        INSERT INTO ${fqt('opportunity_subscriptions')} (
          subscription_id, subscriber_email, subscriber_name, plan, max_companies,
          signal_query, monitor_frequency, companies_limit,
          target_industries, target_company_sizes, target_location,
          target_job_titles, target_seniority, target_employment_type,
          posting_limit_per_company, target_keywords, target_companies,
          notification_channels, slack_channel_id, notification_email,
          clay_table_webhook_url, clay_results_table_id,
          stripe_customer_id, stripe_subscription_id, stripe_price_id,
          payment_status, status, total_matches_found,
          last_enrichment_at, last_notification_at, last_run_at,
          created_at, updated_at
        ) VALUES (
          @subscription_id, @subscriber_email, @subscriber_name, @plan, @max_companies,
          @signal_query, @monitor_frequency, @companies_limit,
          @target_industries, @target_company_sizes, @target_location,
          @target_job_titles, @target_seniority, @target_employment_type,
          @posting_limit_per_company, @target_keywords, @target_companies,
          @notification_channels, @slack_channel_id, @notification_email,
          NULL, NULL,
          NULL, NULL, @stripe_price_id,
          @payment_status, @status, @total_matches_found,
          NULL, NULL, NULL,
          @created_at, @updated_at
        )
      `,
      params: {
        subscription_id: subscription.subscription_id,
        subscriber_email: subscription.subscriber_email,
        subscriber_name: subscription.subscriber_name,
        plan: subscription.plan,
        max_companies: subscription.max_companies,
        signal_query: subscription.signal_query,
        monitor_frequency: subscription.monitor_frequency,
        companies_limit: subscription.companies_limit,
        target_industries: subscription.target_industries,
        target_company_sizes: subscription.target_company_sizes,
        target_location: subscription.target_location,
        target_job_titles: subscription.target_job_titles,
        target_seniority: subscription.target_seniority,
        target_employment_type: subscription.target_employment_type,
        posting_limit_per_company: subscription.posting_limit_per_company,
        target_keywords: subscription.target_keywords,
        target_companies: subscription.target_companies,
        notification_channels: subscription.notification_channels,
        slack_channel_id: subscription.slack_channel_id,
        notification_email: subscription.notification_email,
        stripe_price_id: subscription.stripe_price_id,
        payment_status: subscription.payment_status,
        status: subscription.status,
        total_matches_found: subscription.total_matches_found,
        created_at: new Date(subscription.created_at),
        updated_at: new Date(subscription.updated_at),
      },
      types: {
        subscriber_name: 'STRING',
        signal_query: 'STRING',
        target_seniority: 'STRING',
        target_employment_type: 'STRING',
        slack_channel_id: 'STRING',
        notification_email: 'STRING',
        stripe_price_id: 'STRING',
        target_industries: ['STRING'],
        target_company_sizes: ['STRING'],
        target_job_titles: ['STRING'],
        target_keywords: ['STRING'],
        target_companies: ['STRING'],
        notification_channels: ['STRING'],
        created_at: 'TIMESTAMP',
        updated_at: 'TIMESTAMP',
      },
      useLegacySql: false,
    });
  } catch (err: unknown) {
    const bqErr = err as { message?: string };
    throw new Error(bqErr?.message ?? JSON.stringify(err));
  }
  return subscription;
}

export async function getSubscription(subscriptionId: string): Promise<Subscription | null> {
  const bq = getBqClient();
  const [rows] = await bq.query({
    query: `SELECT * FROM ${fqt('opportunity_subscriptions')} WHERE subscription_id = @id AND DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR) LIMIT 1`,
    params: { id: subscriptionId },
    useLegacySql: false,
  });
  if (!rows || rows.length === 0) return null;
  return rowToSubscription(rows[0]);
}

export async function listActiveSubscriptions(): Promise<Subscription[]> {
  const bq = getBqClient();
  const [rows] = await bq.query({
    query: `
      SELECT * FROM ${fqt('opportunity_subscriptions')}
      WHERE status = 'active'
        AND (payment_status = 'active' OR payment_status = 'pending')
      ORDER BY created_at DESC
    `,
    useLegacySql: false,
  });
  return (rows as Record<string, unknown>[]).map(rowToSubscription);
}

export async function listSubscriptions(
  filters?: { status?: string; email?: string },
): Promise<Subscription[]> {
  const bq = getBqClient();
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.status) {
    conditions.push('status = @status');
    params.status = filters.status;
  }
  if (filters?.email) {
    conditions.push('subscriber_email = @email');
    params.email = filters.email;
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const [rows] = await bq.query({
    query: `SELECT * FROM ${fqt('opportunity_subscriptions')} ${whereClause} ORDER BY created_at DESC LIMIT 100`,
    params,
    useLegacySql: false,
  });
  return (rows as Record<string, unknown>[]).map(rowToSubscription);
}

export interface UpdateSubscriptionInput {
  // V2 fields
  signal_query?: string;
  monitor_frequency?: MonitorFrequency;
  companies_limit?: number;
  last_run_at?: string;
  total_matches_found?: number;
  // Legacy fields
  target_industries?: string[];
  target_company_sizes?: CompanySize[];
  target_location?: string;
  target_job_titles?: string[];
  target_seniority?: SeniorityLevel | null;
  target_employment_type?: EmploymentType | null;
  posting_limit_per_company?: number;
  target_keywords?: string[];
  notification_channels?: ('email' | 'slack')[];
  notification_email?: string;
  slack_channel_id?: string;
  clay_table_webhook_url?: string;
  clay_results_table_id?: string;
  status?: 'active' | 'paused' | 'canceled';
  payment_status?: 'pending' | 'active' | 'past_due' | 'canceled';
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  last_enrichment_at?: string;
  last_notification_at?: string;
}

export async function updateSubscription(
  subscriptionId: string,
  updates: UpdateSubscriptionInput,
): Promise<void> {
  const bq = getBqClient();
  const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP()'];
  const params: Record<string, unknown> = { id: subscriptionId };

  const stringFields = [
    'signal_query', 'monitor_frequency',
    'target_location', 'notification_email', 'slack_channel_id',
    'clay_table_webhook_url', 'clay_results_table_id',
    'status', 'payment_status', 'stripe_customer_id', 'stripe_subscription_id',
    'last_enrichment_at', 'last_notification_at', 'last_run_at',
    'target_seniority', 'target_employment_type',
  ] as const;

  for (const field of stringFields) {
    if (updates[field] !== undefined) {
      setClauses.push(`${field} = @${field}`);
      params[field] = updates[field];
    }
  }

  const intFields = [
    'posting_limit_per_company', 'companies_limit', 'total_matches_found',
  ] as const;

  for (const field of intFields) {
    if (updates[field] !== undefined) {
      setClauses.push(`${field} = @${field}`);
      params[field] = field === 'posting_limit_per_company'
        ? Math.min(updates[field]!, 100)
        : updates[field];
    }
  }

  const arrayFields = [
    'target_industries', 'target_company_sizes', 'target_job_titles',
    'target_keywords', 'notification_channels',
  ] as const;
  for (const field of arrayFields) {
    if (updates[field] !== undefined) {
      setClauses.push(`${field} = @${field}`);
      params[field] = updates[field];
    }
  }

  // DATE(created_at) filter satisfies BigQuery's require_partition_filter on this partitioned table
  await bq.query({
    query: `UPDATE ${fqt('opportunity_subscriptions')} SET ${setClauses.join(', ')} WHERE subscription_id = @id AND DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)`,
    params,
    useLegacySql: false,
  });
}

export async function deactivateSubscription(subscriptionId: string): Promise<void> {
  await updateSubscription(subscriptionId, { status: 'canceled' });
}

// ─── Row Mapping ──────────────────────────────────────────────────────────

function rowToSubscription(row: Record<string, unknown>): Subscription {
  return {
    subscription_id: String(row.subscription_id),
    subscriber_email: String(row.subscriber_email),
    subscriber_name: row.subscriber_name ? String(row.subscriber_name) : null,
    plan: (['starter', 'standard', 'professional', 'enterprise'].includes(String(row.plan || ''))
      ? String(row.plan) : (String(row.plan) === 'growth' ? 'professional' : 'starter')) as PricingPlan,
    max_companies: row.max_companies ? Number(row.max_companies) : 50,
    // V2 fields
    signal_query: row.signal_query ? String(row.signal_query) : null,
    monitor_frequency: (String(row.monitor_frequency || 'daily')) as MonitorFrequency,
    companies_limit: row.companies_limit ? Number(row.companies_limit) : (row.max_companies ? Number(row.max_companies) : 50),
    // Legacy structured filters
    target_industries: Array.isArray(row.target_industries) ? row.target_industries.map(String) : [],
    target_company_sizes: Array.isArray(row.target_company_sizes) ? row.target_company_sizes.map(String) as CompanySize[] : [],
    target_location: row.target_location ? String(row.target_location) : 'United States',
    target_job_titles: Array.isArray(row.target_job_titles) ? row.target_job_titles.map(String) : [],
    target_seniority: row.target_seniority ? String(row.target_seniority) as SeniorityLevel : null,
    target_employment_type: row.target_employment_type ? String(row.target_employment_type) as EmploymentType : null,
    posting_limit_per_company: row.posting_limit_per_company ? Number(row.posting_limit_per_company) : 10,
    target_keywords: Array.isArray(row.target_keywords) ? row.target_keywords.map(String) : [],
    target_companies: Array.isArray(row.target_companies) ? row.target_companies.map(String) : [],
    notification_channels: Array.isArray(row.notification_channels)
      ? row.notification_channels.map(String) as ('email' | 'slack' | 'both')[]
      : ['email'],
    notification_email: row.notification_email ? String(row.notification_email) : null,
    slack_channel_id: row.slack_channel_id ? String(row.slack_channel_id) : null,
    clay_table_webhook_url: row.clay_table_webhook_url ? String(row.clay_table_webhook_url) : null,
    clay_results_table_id: row.clay_results_table_id ? String(row.clay_results_table_id) : null,
    stripe_customer_id: row.stripe_customer_id ? String(row.stripe_customer_id) : null,
    stripe_subscription_id: row.stripe_subscription_id ? String(row.stripe_subscription_id) : null,
    stripe_price_id: row.stripe_price_id ? String(row.stripe_price_id) : null,
    payment_status: String(row.payment_status || 'pending') as Subscription['payment_status'],
    status: String(row.status || 'active') as Subscription['status'],
    last_enrichment_at: row.last_enrichment_at ? String(row.last_enrichment_at) : null,
    last_notification_at: row.last_notification_at ? String(row.last_notification_at) : null,
    last_run_at: row.last_run_at ? String(row.last_run_at) : null,
    total_matches_found: row.total_matches_found ? Number(row.total_matches_found) : 0,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}
