/**
 * Opportunity Engine V2 — Shared Types
 *
 * Two products:
 *   1. Signal Subscriptions (continuous monitoring)
 *      - Natural language signal queries run on a schedule
 *      - Metered Stripe billing per notification batch
 *   2. One-Time Data Pulls (ad hoc)
 *      - Client requests a contact list via natural language query
 *      - Single Stripe checkout, CSV delivery
 *
 * Legacy Architecture (Clay-first, still supported):
 *   1. Form submission creates subscription in BigQuery
 *   2. Operator sets up Clay "Find Companies" table per client
 *   3. Clay "Job Posting" enrichment runs on discovered companies
 *   4. Clay sends results back via HTTP API action → POST /webhooks/clay-results
 *   5. Backend processes results, enriches recruiter contacts, drafts outreach, sends notification
 *
 * Exa is used as a fallback/supplement for recruiter discovery when Clay doesn't surface contacts.
 */

import { z } from 'zod';

// ─── Pricing Plans ────────────────────────────────────────────────────────

export const PRICING_PLANS = {
  starter: { max_companies: 50, stripe_product_prefix: 'Signal Monitor 50' },
  standard: { max_companies: 100, stripe_product_prefix: 'Signal Monitor 100' },
  professional: { max_companies: 200, stripe_product_prefix: 'Signal Monitor 200' },
  enterprise: { max_companies: 500, stripe_product_prefix: 'Signal Monitor 500' },
} as const;

export const FREQUENCY_PRICING: Record<string, Record<string, number>> = {
  daily: { standard: 14900, professional: 19900, enterprise: 34900 },
  weekly: { starter: 5000, standard: 6000, professional: 10000, enterprise: 15000 },
};

export function getPriceMonthly(plan: PricingPlan, frequency: MonitorFrequency): number {
  return FREQUENCY_PRICING[frequency]?.[plan] ?? FREQUENCY_PRICING.weekly[plan];
}

export function getStripeProductName(plan: PricingPlan, frequency: MonitorFrequency): string {
  return `${PRICING_PLANS[plan].stripe_product_prefix} ${frequency}`;
}

// ─── Data Pull Pricing (tiered per-contact) ────────────────────────────

export const DATA_PULL_PRICING = {
  /** First 250 contacts */
  tier1: { max: 250, price_per_contact: 0.50 },
  /** 251–1000 contacts */
  tier2: { max: 1000, price_per_contact: 0.30 },
  /** 1001+ contacts */
  tier3: { max: Infinity, price_per_contact: 0.20 },
} as const;

/** Calculate tiered data pull cost */
export function calculateDataPullCost(count: number): number {
  let remaining = count;
  let cost = 0;
  const { tier1, tier2, tier3 } = DATA_PULL_PRICING;

  // Tier 1: first 250 at $0.50
  const t1 = Math.min(remaining, tier1.max);
  cost += t1 * tier1.price_per_contact;
  remaining -= t1;

  // Tier 2: 251-1000 at $0.30
  if (remaining > 0) {
    const t2 = Math.min(remaining, tier2.max - tier1.max);
    cost += t2 * tier2.price_per_contact;
    remaining -= t2;
  }

  // Tier 3: 1001+ at $0.20
  if (remaining > 0) {
    cost += remaining * tier3.price_per_contact;
  }

  return Math.round(cost * 100) / 100;
}

export type PricingPlan = keyof typeof PRICING_PLANS;

// ─── Seniority Levels (matches Clay's seniority filter) ──────────────────

export const SENIORITY_LEVELS = [
  'internship',
  'entry_level',
  'associate',
  'mid_senior',
  'director',
  'executive',
] as const;

export type SeniorityLevel = typeof SENIORITY_LEVELS[number];

// ─── Employment Types (matches Clay job posting filter) ───────────────────

export const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'temporary',
  'internship',
  'volunteer',
] as const;

export type EmploymentType = typeof EMPLOYMENT_TYPES[number];

// ─── Company Size (matches Clay/LinkedIn employee count brackets) ─────────

export const COMPANY_SIZES = [
  'A',  // Self-employed
  'B',  // 1-10
  'C',  // 11-50
  'D',  // 51-200
  'E',  // 201-500
  'F',  // 501-1,000
  'G',  // 1,001-5,000
  'H',  // 5,001-10,000
  'I',  // 10,001+
] as const;

export type CompanySize = typeof COMPANY_SIZES[number];

export const COMPANY_SIZE_LABELS: Record<CompanySize, string> = {
  A: 'Self-employed',
  B: '1-10 employees',
  C: '11-50 employees',
  D: '51-200 employees',
  E: '201-500 employees',
  F: '501-1,000 employees',
  G: '1,001-5,000 employees',
  H: '5,001-10,000 employees',
  I: '10,001+ employees',
};

// ─── Monitor Frequency (Signal Subscriptions) ────────────────────────────

export const MONITOR_FREQUENCIES = ['daily', 'weekly'] as const;

export type MonitorFrequency = typeof MONITOR_FREQUENCIES[number];

// ─── Data Pull Status ────────────────────────────────────────────────────

export const DATA_PULL_STATUSES = ['pending', 'processing', 'ready', 'delivered'] as const;

export type DataPullStatus = typeof DATA_PULL_STATUSES[number];

// ─── Contact Source ──────────────────────────────────────────────────────

export const CONTACT_SOURCES = ['clay', 'exa', 'datalake'] as const;

export type ContactSource = typeof CONTACT_SOURCES[number];

// ─── Subscription (Signal Subscriptions — continuous monitoring) ─────────
//
// Backward-compatible: all new fields are optional or have defaults.
// Existing rows from the legacy Opportunity Notification Engine work as-is.

export interface Subscription {
  subscription_id: string;
  subscriber_email: string;
  subscriber_name: string | null;

  // Pricing plan
  plan: PricingPlan;
  max_companies: number;

  // Signal query (V2) — natural language description of what to monitor
  signal_query: string | null;

  // Monitor frequency (V2) — how often to run the signal; legacy defaults to 'daily'
  monitor_frequency: MonitorFrequency;

  // Companies limit (V2) — max companies per run; falls back to max_companies if unset
  companies_limit: number;

  // Step 1: Find Companies (Clay "Find Companies" table)
  target_industries: string[];          // Clay/LinkedIn industry taxonomy
  target_company_sizes: CompanySize[];  // LinkedIn employee count brackets
  target_location: string;              // default: "United States"

  // Step 2: Job Posting signal (Clay "Job Posting" enrichment)
  target_job_titles: string[];          // comma-separated roles from form
  target_seniority: SeniorityLevel | null;
  target_employment_type: EmploymentType | null;
  posting_limit_per_company: number;    // max 100, default 10
  target_keywords: string[];
  target_companies: string[];

  // Notification preferences — 'both' is shorthand for email + slack
  notification_channels: ('email' | 'slack' | 'both')[];
  notification_email: string | null;
  slack_channel_id: string | null;

  // Clay integration
  clay_table_webhook_url: string | null;       // webhook URL to push data INTO Clay table
  clay_results_table_id: string | null;        // identifier for the Clay table (for operator reference)

  // Billing (Stripe) — V2 uses metered billing (usage_record per notification batch)
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  payment_status: 'pending' | 'active' | 'past_due' | 'canceled';

  // State
  status: 'active' | 'paused' | 'canceled';
  last_enrichment_at: string | null;
  last_notification_at: string | null;
  last_run_at: string | null;              // V2: timestamp of last signal run
  total_matches_found: number;             // V2: running counter across all runs
  created_at: string;
  updated_at: string;
}

// ─── Contact Match (enriched contact from signal run) ────────────────────

export interface ContactMatch {
  contact_id: string;
  name: string | null;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
  company: string;
  company_domain: string | null;
  source: ContactSource;
  confidence_score: number | null;  // 0-1
}

// ─── Exa Search Result (promoted from enrichment-pipeline internal type) ─

export interface ExaResult {
  title: string;
  url: string;
  published_date: string | null;
  text: string | null;
  author: string | null;
  highlight: string | null;
  score: number | null;
}

// ─── Signal Result (output of a single signal subscription run) ──────────

export interface SignalResult {
  result_id: string;
  subscription_id: string;
  matched_contacts: ContactMatch[];
  exa_results: ExaResult[];
  new_since_last_run: number;
  created_at: string;
}

// ─── Structured Contact (deliverable row in a data pull CSV) ─────────────

export interface StructuredContact {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  company: string;
  company_domain: string | null;
  industry: string | null;
  company_size: CompanySize | null;
  location: string | null;
  source: ContactSource;
  enriched_at: string;
}

// ─── Data Pull Request (One-Time Data Pulls — ad hoc) ───────────────────

export interface DataPullRequest {
  pull_id: string;
  client_id: string;
  natural_language_query: string;
  requested_count: number;
  datalake_matches: number;
  enrichment_needed: number;
  status: DataPullStatus;
  csv_url: string | null;
  cost_usd: number;
  stripe_checkout_id: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Data Pull Result (response payload for completed data pull) ─────────

export interface DataPullResult {
  contacts: StructuredContact[];
  total_from_datalake: number;
  total_enriched_new: number;
  csv_download_url: string;
}

// ─── Zod Schemas ─────────────────────────────────────────────────────────

export const monitorFrequencySchema = z.enum(
  MONITOR_FREQUENCIES as unknown as [string, ...string[]]
).describe('How often the signal subscription runs');

export const dataPullStatusSchema = z.enum(
  DATA_PULL_STATUSES as unknown as [string, ...string[]]
).describe('Current status of a data pull request');

export const contactSourceSchema = z.enum(
  CONTACT_SOURCES as unknown as [string, ...string[]]
).describe('Source system that provided the contact');

export const contactMatchSchema = z.object({
  contact_id: z.string().describe('Unique identifier for this contact match'),
  name: z.string().nullable().describe('Full name'),
  title: z.string().nullable().describe('Job title'),
  email: z.string().nullable().describe('Email address'),
  linkedin_url: z.string().nullable().describe('LinkedIn profile URL'),
  company: z.string().describe('Company name'),
  company_domain: z.string().nullable().describe('Company website domain'),
  source: contactSourceSchema,
  confidence_score: z.number().min(0).max(1).nullable().describe('Match confidence 0-1'),
}).describe('Enriched contact matched by a signal run');

export const exaResultSchema = z.object({
  title: z.string().describe('Result title'),
  url: z.string().describe('Result URL'),
  published_date: z.string().nullable().describe('Publication date'),
  text: z.string().nullable().describe('Extracted text snippet'),
  author: z.string().nullable().describe('Author name'),
  highlight: z.string().nullable().describe('Highlighted matching text'),
  score: z.number().nullable().describe('Relevance score'),
}).describe('Raw Exa web search result');

export const signalResultSchema = z.object({
  result_id: z.string().describe('Unique identifier for this signal run result'),
  subscription_id: z.string().describe('Parent signal subscription ID'),
  matched_contacts: z.array(contactMatchSchema).describe('Contacts matched in this run'),
  exa_results: z.array(exaResultSchema).describe('Raw Exa results from this run'),
  new_since_last_run: z.number().describe('Count of new matches since previous run'),
  created_at: z.string().describe('ISO timestamp of this run'),
}).describe('Output of a single signal subscription run');

export const structuredContactSchema = z.object({
  name: z.string().describe('Full name'),
  title: z.string().nullable().describe('Job title'),
  email: z.string().nullable().describe('Email address'),
  phone: z.string().nullable().describe('Phone number'),
  linkedin_url: z.string().nullable().describe('LinkedIn profile URL'),
  company: z.string().describe('Company name'),
  company_domain: z.string().nullable().describe('Company website domain'),
  industry: z.string().nullable().describe('Industry classification'),
  company_size: z.enum(COMPANY_SIZES as unknown as [string, ...string[]]).nullable().describe('Company size bracket'),
  location: z.string().nullable().describe('Contact location'),
  source: contactSourceSchema,
  enriched_at: z.string().describe('ISO timestamp of enrichment'),
}).describe('Deliverable contact row for CSV export');

export const dataPullRequestSchema = z.object({
  pull_id: z.string().describe('Unique identifier for this data pull'),
  client_id: z.string().describe('Client who requested the pull'),
  natural_language_query: z.string().describe('What the client is looking for'),
  requested_count: z.number().int().positive().describe('Number of contacts requested'),
  datalake_matches: z.number().int().describe('Contacts found in existing datalake'),
  enrichment_needed: z.number().int().describe('Contacts that need fresh enrichment'),
  status: dataPullStatusSchema,
  csv_url: z.string().nullable().describe('Download URL when ready'),
  cost_usd: z.number().describe('Total cost of this pull in USD'),
  stripe_checkout_id: z.string().nullable().describe('Stripe Checkout Session ID'),
  created_at: z.string().describe('ISO timestamp of request creation'),
  updated_at: z.string().describe('ISO timestamp of last update'),
}).describe('One-time data pull request');

export const dataPullResultSchema = z.object({
  contacts: z.array(structuredContactSchema).describe('Delivered contacts'),
  total_from_datalake: z.number().int().describe('Count sourced from existing datalake'),
  total_enriched_new: z.number().int().describe('Count of newly enriched contacts'),
  csv_download_url: z.string().describe('URL to download the CSV'),
}).describe('Result payload for a completed data pull');

// ─── Company Discovery Result ─────────────────────────────────────────────

export interface DiscoveredCompany {
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  headcount: number | null;
  description: string | null;
  source: 'clay' | 'exa';
}

// ─── Job Posting Match ────────────────────────────────────────────────────

export interface JobPostingMatch {
  title: string;
  company: string;
  company_domain: string | null;
  url: string;
  posted_date: string | null;
  seniority: SeniorityLevel | null;
  employment_type: EmploymentType | null;
  location: string | null;
  source: 'clay' | 'exa';
}

// ─── Recruiter Contact ────────────────────────────────────────────────────

export interface RecruiterContact {
  name: string | null;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
  company: string;
}

// ─── Outreach Draft ───────────────────────────────────────────────────────

export interface OutreachDraft {
  subject: string;
  body: string;
}

// ─── Notification Types ───────────────────────────────────────────────────

export interface NotificationMatch {
  job_posting: JobPostingMatch;
  recruiter: RecruiterContact | null;
  outreach_draft: OutreachDraft;
}

export interface NotificationPayload {
  subscriber: {
    name: string | null;
    email: string;
  };
  date: string;
  matches: NotificationMatch[];
  total_matches: number;
  companies_discovered: number;
  next_notification_date: string;
}

export interface NotificationHistoryRow {
  notification_id: string;
  subscription_id: string;
  channel: 'email' | 'slack';
  status: 'sent' | 'failed' | 'skipped';
  error_message: string | null;
  matches_count: number;
  matches_json: string;
  exa_calls_used: number;
  clay_calls_used: number;
  enrichment_cost_usd: number;
  sent_at: string;
  created_at: string;
}

export interface EnrichmentRunStats {
  exa_calls: number;
  clay_calls: number;
  cost_usd: number;
  companies_found: number;
  postings_found: number;
}
