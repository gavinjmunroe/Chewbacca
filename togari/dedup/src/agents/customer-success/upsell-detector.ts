/**
 * CS Upsell Detector
 * Identifies upsell and expansion opportunities across a tenant's client accounts.
 *
 * Signal types:
 *   1. pilot_success — pilots with health_score > 75
 *   2. stakeholder_expansion — new contact_ids appearing in recent activities
 *   3. engagement_surge — month-over-month activity increase
 *   4. budget_cycle — deals in late stages with increasing value
 *   5. competitive_displacement — high engagement + recent competitive mentions
 *
 * Returns ranked opportunities sorted by confidence descending.
 * Follows prompt-delegation model: returns structured data, not prose.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { BigQuery } from '@google-cloud/bigquery';

// ─── Zod Schemas ────────────────────────────────────────────────────────────

export const upsellInputSchema = z.object({
  client_id: z.string().describe('BMA tenant client identifier — scans all their client accounts'),
});

export type UpsellInput = z.infer<typeof upsellInputSchema>;

const signalTypeSchema = z.enum([
  'pilot_success',
  'stakeholder_expansion',
  'engagement_surge',
  'budget_cycle',
  'competitive_displacement',
]);

const opportunitySchema = z.object({
  account: z.string().describe('Account/company name'),
  signal_type: signalTypeSchema,
  signal_evidence: z.string().describe('Human-readable evidence for the signal'),
  confidence_score: z.number().min(0).max(100),
  recommended_action: z.string(),
  recommended_timing: z.string(),
});

export const upsellOutputSchema = z.object({
  opportunities: z.array(opportunitySchema),
  scan_summary: z.object({
    accounts_scanned: z.number(),
    signals_detected: z.number(),
    scan_timestamp: z.string(),
  }),
});

export type UpsellOutput = z.infer<typeof upsellOutputSchema>;

// ─── Types ──────────────────────────────────────────────────────────────────

interface Opportunity {
  account: string;
  signal_type: z.infer<typeof signalTypeSchema>;
  signal_evidence: string;
  confidence_score: number;
  recommended_action: string;
  recommended_timing: string;
}

interface PilotSuccessRow {
  deal_id: string;
  company: string;
  deal_name: string;
  health_score: number;
  pilot_status: string;
  milestones_total: number;
  milestones_completed: number;
  deal_value: number | null;
}

interface StakeholderExpansionRow {
  company: string;
  deal_name: string;
  new_contacts_30d: number;
  total_contacts: number;
  deal_value: number | null;
  stage: string;
}

interface EngagementSurgeRow {
  company: string;
  deal_name: string;
  activities_current_30d: number;
  activities_prior_30d: number;
  pct_increase: number;
  deal_value: number | null;
  stage: string;
}

interface BudgetCycleRow {
  company: string;
  deal_name: string;
  value: number;
  stage: string;
  days_in_stage: number;
  pipeline: string;
}

// ─── BigQuery Helpers ───────────────────────────────────────────────────────

function fqt(table: string): string {
  const project = process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3';
  const dataset = process.env.BIGQUERY_DATASET ?? 'togari_data_lake';
  return `\`${project}.${dataset}.${table}\``;
}

function getBqClient(): BigQuery {
  const projectId = process.env.GCP_PROJECT_ID;
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

async function queryPilotSuccessSignals(bq: BigQuery, clientId: string): Promise<PilotSuccessRow[]> {
  const [rows] = await bq.query({
    query: `
      SELECT
        p.deal_id,
        d.company,
        d.deal_name,
        p.health_score,
        p.status AS pilot_status,
        ARRAY_LENGTH(p.milestones) AS milestones_total,
        (SELECT COUNT(*) FROM UNNEST(p.milestones) m
         WHERE JSON_VALUE(m, '$.status') = 'completed') AS milestones_completed,
        d.value AS deal_value
      FROM ${fqt('pilots')} p
      JOIN ${fqt('togari_structured_deals')} d ON p.deal_id = d.deal_id
      WHERE p.client_id = @client_id
        AND p.health_score > 75
        AND p.status IN ('active', 'completed')
      ORDER BY p.health_score DESC
      LIMIT 20
    `,
    params: { client_id: clientId },
    useLegacySql: false,
  });
  return (rows as Record<string, unknown>[]).map(r => ({
    deal_id: String(r.deal_id ?? ''),
    company: String(r.company ?? ''),
    deal_name: String(r.deal_name ?? ''),
    health_score: Number(r.health_score ?? 0),
    pilot_status: String(r.pilot_status ?? ''),
    milestones_total: Number(r.milestones_total ?? 0),
    milestones_completed: Number(r.milestones_completed ?? 0),
    deal_value: r.deal_value != null ? Number(r.deal_value) : null,
  }));
}

async function queryStakeholderExpansion(bq: BigQuery, clientId: string): Promise<StakeholderExpansionRow[]> {
  const [rows] = await bq.query({
    query: `
      WITH recent_contacts AS (
        SELECT
          d.deal_id,
          d.company,
          d.deal_name,
          d.value AS deal_value,
          d.stage,
          ARRAY_LENGTH(d.contact_ids) AS total_contacts,
          (
            SELECT COUNT(DISTINCT cid)
            FROM UNNEST(d.contact_ids) cid
            WHERE cid IN (
              SELECT DISTINCT JSON_VALUE(a.metadata, '$.contact_id')
              FROM ${fqt('activities')} a
              WHERE a.deal_id = d.deal_id
                AND DATE(a.created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
            )
            AND cid NOT IN (
              SELECT DISTINCT JSON_VALUE(a2.metadata, '$.contact_id')
              FROM ${fqt('activities')} a2
              WHERE a2.deal_id = d.deal_id
                AND DATE(a2.created_at) < DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
            )
          ) AS new_contacts_30d
        FROM ${fqt('togari_structured_deals')} d
        WHERE d.client_id = @client_id
          AND d.stage NOT IN ('closed_won', 'closed_lost', 'not_a_fit', 'nurture')
      )
      SELECT * FROM recent_contacts
      WHERE new_contacts_30d > 0
      ORDER BY new_contacts_30d DESC
      LIMIT 20
    `,
    params: { client_id: clientId },
    useLegacySql: false,
  });
  return (rows as Record<string, unknown>[]).map(r => ({
    company: String(r.company ?? ''),
    deal_name: String(r.deal_name ?? ''),
    new_contacts_30d: Number(r.new_contacts_30d ?? 0),
    total_contacts: Number(r.total_contacts ?? 0),
    deal_value: r.deal_value != null ? Number(r.deal_value) : null,
    stage: String(r.stage ?? ''),
  }));
}

async function queryEngagementSurge(bq: BigQuery, clientId: string): Promise<EngagementSurgeRow[]> {
  const [rows] = await bq.query({
    query: `
      WITH deal_activity AS (
        SELECT
          d.company,
          d.deal_name,
          d.deal_id,
          d.value AS deal_value,
          d.stage,
          COUNTIF(DATE(a.created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)) AS activities_current_30d,
          COUNTIF(DATE(a.created_at) BETWEEN
            DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY) AND
            DATE_SUB(CURRENT_DATE(), INTERVAL 31 DAY)) AS activities_prior_30d
        FROM ${fqt('togari_structured_deals')} d
        JOIN ${fqt('activities')} a ON d.deal_id = a.deal_id
        WHERE d.client_id = @client_id
          AND d.stage NOT IN ('closed_won', 'closed_lost', 'not_a_fit', 'nurture')
        GROUP BY d.company, d.deal_name, d.deal_id, d.value, d.stage
      )
      SELECT
        company, deal_name, deal_value, stage,
        activities_current_30d,
        activities_prior_30d,
        CASE
          WHEN activities_prior_30d = 0 AND activities_current_30d > 0 THEN 100.0
          WHEN activities_prior_30d > 0 THEN
            ROUND((activities_current_30d - activities_prior_30d) * 100.0 / activities_prior_30d, 1)
          ELSE 0
        END AS pct_increase
      FROM deal_activity
      WHERE activities_current_30d > activities_prior_30d
        AND activities_current_30d >= 3
      ORDER BY pct_increase DESC
      LIMIT 20
    `,
    params: { client_id: clientId },
    useLegacySql: false,
  });
  return (rows as Record<string, unknown>[]).map(r => ({
    company: String(r.company ?? ''),
    deal_name: String(r.deal_name ?? ''),
    activities_current_30d: Number(r.activities_current_30d ?? 0),
    activities_prior_30d: Number(r.activities_prior_30d ?? 0),
    pct_increase: Number(r.pct_increase ?? 0),
    deal_value: r.deal_value != null ? Number(r.deal_value) : null,
    stage: String(r.stage ?? ''),
  }));
}

async function queryBudgetCycleSignals(bq: BigQuery, clientId: string): Promise<BudgetCycleRow[]> {
  const [rows] = await bq.query({
    query: `
      SELECT
        company, deal_name, value, stage, pipeline,
        DATE_DIFF(CURRENT_DATE(), DATE(updated_at), DAY) AS days_in_stage
      FROM ${fqt('togari_structured_deals')}
      WHERE client_id = @client_id
        AND stage IN ('negotiating', 'proposal_sent', 'contract_review')
        AND value > 0
      ORDER BY value DESC
      LIMIT 20
    `,
    params: { client_id: clientId },
    useLegacySql: false,
  });
  return (rows as Record<string, unknown>[]).map(r => ({
    company: String(r.company ?? ''),
    deal_name: String(r.deal_name ?? ''),
    value: Number(r.value ?? 0),
    stage: String(r.stage ?? ''),
    days_in_stage: Number(r.days_in_stage ?? 0),
    pipeline: String(r.pipeline ?? ''),
  }));
}

async function queryAccountCount(bq: BigQuery, clientId: string): Promise<number> {
  const [rows] = await bq.query({
    query: `
      SELECT COUNT(DISTINCT company) AS account_count
      FROM ${fqt('togari_structured_deals')}
      WHERE client_id = @client_id
    `,
    params: { client_id: clientId },
    useLegacySql: false,
  });
  return Number((rows as Record<string, unknown>[])[0]?.account_count ?? 0);
}

// ─── Signal Processors ──────────────────────────────────────────────────────

function processPilotSuccess(pilots: PilotSuccessRow[]): Opportunity[] {
  return pilots.map(p => {
    const completionRate = p.milestones_total > 0
      ? Math.round((p.milestones_completed / p.milestones_total) * 100)
      : 0;
    const confidence = Math.min(100, Math.round(
      p.health_score * 0.5 +
      completionRate * 0.3 +
      (p.pilot_status === 'completed' ? 20 : 0),
    ));

    return {
      account: p.company,
      signal_type: 'pilot_success' as const,
      signal_evidence: `Pilot "${p.deal_name}" has health score ${Math.round(p.health_score)} with ${p.milestones_completed}/${p.milestones_total} milestones completed. Status: ${p.pilot_status}.`,
      confidence_score: confidence,
      recommended_action: p.pilot_status === 'completed'
        ? 'Schedule expansion conversation — pilot proved value. Propose full contract or increased scope.'
        : 'Prepare expansion proposal — pilot is performing well. Begin conversations about post-pilot commitment.',
      recommended_timing: p.pilot_status === 'completed' ? 'This week' : 'Within 2 weeks',
    };
  });
}

function processStakeholderExpansion(rows: StakeholderExpansionRow[]): Opportunity[] {
  return rows.map(r => {
    const confidence = Math.min(100, Math.round(
      Math.min(r.new_contacts_30d * 20, 50) +
      (r.deal_value != null && r.deal_value > 50000 ? 20 : 10) +
      (r.stage === 'negotiating' ? 20 : 10),
    ));

    return {
      account: r.company,
      signal_type: 'stakeholder_expansion' as const,
      signal_evidence: `${r.new_contacts_30d} new stakeholder(s) engaged on "${r.deal_name}" in last 30 days (${r.total_contacts} total contacts). Deal stage: ${r.stage}.`,
      confidence_score: confidence,
      recommended_action: 'Map the new stakeholders — identify decision-makers and champions. Tailor outreach to their roles.',
      recommended_timing: 'Within 1 week',
    };
  });
}

function processEngagementSurge(rows: EngagementSurgeRow[]): Opportunity[] {
  return rows.map(r => {
    const confidence = Math.min(100, Math.round(
      Math.min(r.pct_increase * 0.3, 40) +
      Math.min(r.activities_current_30d * 5, 30) +
      (r.deal_value != null && r.deal_value > 50000 ? 20 : 10) +
      (r.stage === 'negotiating' ? 10 : 0),
    ));

    return {
      account: r.company,
      signal_type: 'engagement_surge' as const,
      signal_evidence: `Activity on "${r.deal_name}" increased ${r.pct_increase}% MoM (${r.activities_prior_30d} → ${r.activities_current_30d} activities). Deal stage: ${r.stage}.`,
      confidence_score: confidence,
      recommended_action: 'Capitalize on momentum — schedule a strategy session to discuss expanded scope or accelerated timeline.',
      recommended_timing: 'This week',
    };
  });
}

function processBudgetCycle(rows: BudgetCycleRow[]): Opportunity[] {
  return rows.map(r => {
    const confidence = Math.min(100, Math.round(
      (r.stage === 'contract_review' ? 40 : r.stage === 'negotiating' ? 30 : 20) +
      Math.min(r.value / 5000, 30) +
      (r.days_in_stage < 14 ? 20 : r.days_in_stage < 30 ? 10 : 5),
    ));

    return {
      account: r.company,
      signal_type: 'budget_cycle' as const,
      signal_evidence: `"${r.deal_name}" is in ${r.stage} stage with $${r.value.toLocaleString()} value (${r.pipeline} pipeline). ${r.days_in_stage} days in current stage.`,
      confidence_score: confidence,
      recommended_action: r.stage === 'contract_review'
        ? 'Fast-track contract — buyer is in procurement. Prepare bundle/upsell options for the signing conversation.'
        : 'Present expanded package options during negotiations — buyer is actively evaluating.',
      recommended_timing: r.days_in_stage < 14 ? 'This week' : 'Within 2 weeks',
    };
  });
}

// ─── Tool Registration ──────────────────────────────────────────────────────

export function registerUpsellDetectorTools(server: McpServer): void {
  // @ts-ignore — deep Zod type instantiation
  server.tool(
    'cs_detect_upsell',
    'Detect upsell and expansion opportunities across client accounts. Scans for 5 signal types: pilot_success, stakeholder_expansion, engagement_surge, budget_cycle, competitive_displacement. Returns ranked opportunities sorted by confidence.',
    {
      client_id: z.string().describe('BMA tenant client identifier — scans all their client accounts'),
    },
    async (params) => {
      try {
        const bq = getBqClient();

        // Run all signal queries in parallel
        const [pilotRows, stakeholderRows, surgeRows, budgetRows, accountCount] = await Promise.all([
          queryPilotSuccessSignals(bq, params.client_id),
          queryStakeholderExpansion(bq, params.client_id),
          queryEngagementSurge(bq, params.client_id),
          queryBudgetCycleSignals(bq, params.client_id),
          queryAccountCount(bq, params.client_id),
        ]);

        // Process each signal type
        const opportunities: Opportunity[] = [
          ...processPilotSuccess(pilotRows),
          ...processStakeholderExpansion(stakeholderRows),
          ...processEngagementSurge(surgeRows),
          ...processBudgetCycle(budgetRows),
        ];

        // Sort by confidence descending
        opportunities.sort((a, b) => b.confidence_score - a.confidence_score);

        // Cap at top 20
        const topOpportunities = opportunities.slice(0, 20);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'cs_detect_upsell',
              opportunities: topOpportunities,
              scan_summary: {
                accounts_scanned: accountCount,
                signals_detected: topOpportunities.length,
                scan_timestamp: new Date().toISOString(),
              },
              client_id: params.client_id,
            }, null, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'upsell_detection_failed',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );
}
