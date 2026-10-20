/**
 * BOF Pilot Tracker
 * Manages pilot/trial tracking for enterprise sales deals.
 *
 * Three sub-commands: create, update, query.
 * Storage: BigQuery table 'togari.pilots'.
 * Health score formula: (milestones_completed / total) * 0.6 + (days_remaining / total_days) * 0.4
 * If score < 50, auto-sets status to 'at_risk'.
 *
 * Follows prompt-delegation model: returns structured data, not prose.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { BigQuery } from '@google-cloud/bigquery';
import { randomUUID } from 'crypto';

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const milestoneSchema = z.object({
  name: z.string().describe('Milestone name'),
  target_date: z.string().describe('Target date (YYYY-MM-DD)'),
  status: z.enum(['pending', 'in_progress', 'completed', 'missed']).describe('Milestone status'),
});

export type Milestone = z.infer<typeof milestoneSchema>;

const pilotStatusSchema = z.enum(['active', 'completed', 'at_risk']);

export type PilotStatus = z.infer<typeof pilotStatusSchema>;

// ─── Input Schemas ──────────────────────────────────────────────────────────

export const pilotCreateInputSchema = z.object({
  command: z.literal('create').describe('Sub-command: create a new pilot'),
  deal_id: z.string().describe('UUID of the deal in togari.deals'),
  client_id: z.string().describe('Client/company identifier'),
  pilot_start: z.string().describe('Pilot start date (YYYY-MM-DD)'),
  pilot_end: z.string().describe('Pilot end date (YYYY-MM-DD)'),
  success_criteria: z.array(z.string()).describe('List of success criteria for the pilot'),
  milestones: z.array(milestoneSchema).describe('Array of milestones with name, target_date, status'),
});

export const pilotUpdateInputSchema = z.object({
  command: z.literal('update').describe('Sub-command: update an existing pilot'),
  pilot_id: z.string().describe('UUID of the pilot to update'),
  client_id: z.string().describe('Client/company identifier'),
  pilot_end: z.string().optional().describe('Updated pilot end date (YYYY-MM-DD)'),
  success_criteria: z.array(z.string()).optional().describe('Updated success criteria'),
  milestones: z.array(milestoneSchema).optional().describe('Updated milestones array'),
  status: pilotStatusSchema.optional().describe('Override pilot status'),
});

export const pilotQueryInputSchema = z.object({
  command: z.literal('query').describe('Sub-command: query pilots'),
  client_id: z.string().describe('Client/company identifier'),
  status: pilotStatusSchema.optional().describe('Filter by pilot status'),
  deal_id: z.string().optional().describe('Filter by deal_id'),
});

export const pilotInputSchema = z.discriminatedUnion('command', [
  pilotCreateInputSchema,
  pilotUpdateInputSchema,
  pilotQueryInputSchema,
]);

export type PilotInput = z.infer<typeof pilotInputSchema>;

// ─── Output Schemas ─────────────────────────────────────────────────────────

const pilotRecordSchema = z.object({
  pilot_id: z.string(),
  deal_id: z.string(),
  client_id: z.string(),
  pilot_start: z.string(),
  pilot_end: z.string(),
  success_criteria: z.array(z.string()),
  milestones: z.array(milestoneSchema),
  status: pilotStatusSchema,
  health_score: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const pilotCreateOutputSchema = z.object({
  action: z.literal('pilot_created'),
  pilot: pilotRecordSchema,
});

export const pilotUpdateOutputSchema = z.object({
  action: z.literal('pilot_updated'),
  pilot: pilotRecordSchema,
  fields_updated: z.array(z.string()),
});

export const pilotQueryOutputSchema = z.object({
  action: z.literal('pilot_query'),
  total_matches: z.number(),
  pilots: z.array(pilotRecordSchema),
});

// ─── Types ──────────────────────────────────────────────────────────────────

interface PilotRow {
  pilot_id: string;
  deal_id: string;
  client_id: string;
  pilot_start: string;
  pilot_end: string;
  success_criteria: string[];
  milestones: string; // JSON string from BigQuery
  status: string;
  health_score: number;
  created_at: string;
  updated_at: string;
}

// ─── BigQuery Helpers ───────────────────────────────────────────────────────

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

// ─── Health Score ───────────────────────────────────────────────────────────

function computeHealthScore(
  milestones: Milestone[],
  pilotStart: string,
  pilotEnd: string,
): number {
  // Milestone completion component (60% weight)
  const total = milestones.length;
  const completed = milestones.filter((m) => m.status === 'completed').length;
  const milestoneScore = total > 0 ? (completed / total) : 0;

  // Time remaining component (40% weight)
  const now = new Date();
  const start = new Date(pilotStart);
  const end = new Date(pilotEnd);
  const totalDays = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const daysRemaining = Math.max(0, (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const timeScore = daysRemaining / totalDays;

  const score = milestoneScore * 0.6 + timeScore * 0.4;
  return Math.round(score * 100);
}

// ─── Parsers ────────────────────────────────────────────────────────────────

function parsePilotRow(row: PilotRow): z.infer<typeof pilotRecordSchema> {
  const milestones: Milestone[] = typeof row.milestones === 'string'
    ? JSON.parse(row.milestones)
    : row.milestones;

  return {
    pilot_id: row.pilot_id,
    deal_id: row.deal_id,
    client_id: row.client_id,
    pilot_start: row.pilot_start,
    pilot_end: row.pilot_end,
    success_criteria: row.success_criteria ?? [],
    milestones,
    status: row.status as PilotStatus,
    health_score: row.health_score,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── Sub-command: CREATE ────────────────────────────────────────────────────

async function handleCreate(
  bq: BigQuery,
  params: z.infer<typeof pilotCreateInputSchema>,
): Promise<object> {
  const pilotId = randomUUID();
  const now = new Date().toISOString();

  const healthScore = computeHealthScore(params.milestones, params.pilot_start, params.pilot_end);
  const status: PilotStatus = healthScore < 50 ? 'at_risk' : 'active';

  await bq.query({
    query: `
      INSERT INTO \`togari.pilots\` (
        pilot_id, deal_id, client_id, pilot_start, pilot_end,
        success_criteria, milestones, status, health_score,
        created_at, updated_at
      ) VALUES (
        @pilot_id, @deal_id, @client_id, DATE(@pilot_start), DATE(@pilot_end),
        @success_criteria, @milestones, @status, @health_score,
        @created_at, @updated_at
      )
    `,
    params: {
      pilot_id: pilotId,
      deal_id: params.deal_id,
      client_id: params.client_id,
      pilot_start: params.pilot_start,
      pilot_end: params.pilot_end,
      success_criteria: params.success_criteria,
      milestones: JSON.stringify(params.milestones),
      status,
      health_score: healthScore,
      created_at: now,
      updated_at: now,
    },
    types: {
      pilot_id: 'STRING',
      deal_id: 'STRING',
      client_id: 'STRING',
      pilot_start: 'STRING',
      pilot_end: 'STRING',
      success_criteria: ['STRING'],
      milestones: 'STRING',
      status: 'STRING',
      health_score: 'FLOAT64',
      created_at: 'STRING',
      updated_at: 'STRING',
    },
    useLegacySql: false,
  });

  return {
    action: 'pilot_created',
    pilot: {
      pilot_id: pilotId,
      deal_id: params.deal_id,
      client_id: params.client_id,
      pilot_start: params.pilot_start,
      pilot_end: params.pilot_end,
      success_criteria: params.success_criteria,
      milestones: params.milestones,
      status,
      health_score: healthScore,
      created_at: now,
      updated_at: now,
    },
  };
}

// ─── Sub-command: UPDATE ────────────────────────────────────────────────────

async function handleUpdate(
  bq: BigQuery,
  params: z.infer<typeof pilotUpdateInputSchema>,
): Promise<object> {
  // Fetch existing pilot
  const [existingRows] = await bq.query({
    query: `
      SELECT pilot_id, deal_id, client_id,
        CAST(pilot_start AS STRING) AS pilot_start,
        CAST(pilot_end AS STRING) AS pilot_end,
        success_criteria,
        TO_JSON_STRING(milestones) AS milestones,
        status, health_score,
        CAST(created_at AS STRING) AS created_at,
        CAST(updated_at AS STRING) AS updated_at
      FROM \`togari.pilots\`
      WHERE pilot_id = @pilot_id AND client_id = @client_id
      LIMIT 1
    `,
    params: { pilot_id: params.pilot_id, client_id: params.client_id },
    useLegacySql: false,
  });

  const existing = (existingRows as PilotRow[])[0];
  if (!existing) {
    throw new Error(
      `Pilot not found: ${params.pilot_id} for client ${params.client_id}. Use command: "query" to locate the correct pilot.`,
    );
  }

  const now = new Date().toISOString();
  const setClauses: string[] = ['updated_at = @updated_at'];
  const queryParams: Record<string, unknown> = {
    pilot_id: params.pilot_id,
    client_id: params.client_id,
    updated_at: now,
  };
  const fieldsUpdated: string[] = [];

  // Resolve effective values for health score recalculation
  const effectiveEnd = params.pilot_end ?? existing.pilot_end;
  const effectiveMilestones: Milestone[] = params.milestones
    ?? (typeof existing.milestones === 'string' ? JSON.parse(existing.milestones) : existing.milestones);

  if (params.pilot_end !== undefined) {
    setClauses.push('pilot_end = DATE(@pilot_end)');
    queryParams['pilot_end'] = params.pilot_end;
    fieldsUpdated.push('pilot_end');
  }

  if (params.success_criteria !== undefined) {
    setClauses.push('success_criteria = @success_criteria');
    queryParams['success_criteria'] = params.success_criteria;
    fieldsUpdated.push('success_criteria');
  }

  if (params.milestones !== undefined) {
    setClauses.push('milestones = @milestones');
    queryParams['milestones'] = JSON.stringify(params.milestones);
    fieldsUpdated.push('milestones');
  }

  // Recompute health score
  const healthScore = computeHealthScore(effectiveMilestones, existing.pilot_start, effectiveEnd);
  setClauses.push('health_score = @health_score');
  queryParams['health_score'] = healthScore;
  fieldsUpdated.push('health_score');

  // Determine status: explicit override takes precedence, otherwise auto-set at_risk
  let effectiveStatus: PilotStatus;
  if (params.status !== undefined) {
    effectiveStatus = params.status;
  } else if (healthScore < 50) {
    effectiveStatus = 'at_risk';
  } else {
    effectiveStatus = existing.status as PilotStatus;
  }
  setClauses.push('status = @status');
  queryParams['status'] = effectiveStatus;
  fieldsUpdated.push('status');

  await bq.query({
    query: `
      UPDATE \`togari.pilots\`
      SET ${setClauses.join(', ')}
      WHERE pilot_id = @pilot_id AND client_id = @client_id
    `,
    params: queryParams,
    useLegacySql: false,
  });

  const existingMilestones: Milestone[] = typeof existing.milestones === 'string'
    ? JSON.parse(existing.milestones)
    : existing.milestones;

  return {
    action: 'pilot_updated',
    pilot: {
      pilot_id: params.pilot_id,
      deal_id: existing.deal_id,
      client_id: params.client_id,
      pilot_start: existing.pilot_start,
      pilot_end: effectiveEnd,
      success_criteria: params.success_criteria ?? existing.success_criteria,
      milestones: params.milestones ?? existingMilestones,
      status: effectiveStatus,
      health_score: healthScore,
      created_at: existing.created_at,
      updated_at: now,
    },
    fields_updated: fieldsUpdated,
  };
}

// ─── Sub-command: QUERY ─────────────────────────────────────────────────────

async function handleQuery(
  bq: BigQuery,
  params: z.infer<typeof pilotQueryInputSchema>,
): Promise<object> {
  const whereClauses: string[] = ['client_id = @client_id'];
  const queryParams: Record<string, unknown> = { client_id: params.client_id };

  if (params.status !== undefined) {
    whereClauses.push('status = @status');
    queryParams['status'] = params.status;
  }

  if (params.deal_id !== undefined) {
    whereClauses.push('deal_id = @deal_id');
    queryParams['deal_id'] = params.deal_id;
  }

  const [rows] = await bq.query({
    query: `
      SELECT pilot_id, deal_id, client_id,
        CAST(pilot_start AS STRING) AS pilot_start,
        CAST(pilot_end AS STRING) AS pilot_end,
        success_criteria,
        TO_JSON_STRING(milestones) AS milestones,
        status, health_score,
        CAST(created_at AS STRING) AS created_at,
        CAST(updated_at AS STRING) AS updated_at
      FROM \`togari.pilots\`
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY updated_at DESC
      LIMIT 20
    `,
    params: queryParams,
    useLegacySql: false,
  });

  const pilots = (rows as PilotRow[]).map((row) => {
    const parsed = parsePilotRow(row);
    // Recompute health score live for accurate real-time data
    const liveScore = computeHealthScore(parsed.milestones, parsed.pilot_start, parsed.pilot_end);
    return { ...parsed, health_score: liveScore };
  });

  return {
    action: 'pilot_query',
    total_matches: pilots.length,
    pilots,
  };
}

// ─── Tool Registration ──────────────────────────────────────────────────────

export function registerPilotTrackerTools(server: McpServer): void {
  server.tool(
    'bof_track_pilot',
    'Manage pilot/trial tracking for enterprise deals. Sub-commands: "create" (new pilot with milestones and success criteria), "update" (partial update with auto health-score recalculation), "query" (list pilots by client, status, or deal). Health score auto-computed; pilots below 50 are flagged at_risk.',
    {
      command: z.enum(['create', 'update', 'query']).describe('Sub-command to execute'),
      deal_id: z.string().optional().describe('UUID of the deal (required for create, optional filter for query)'),
      client_id: z.string().describe('Client/company identifier'),
      pilot_id: z.string().optional().describe('UUID of the pilot (required for update)'),
      pilot_start: z.string().optional().describe('Pilot start date YYYY-MM-DD (required for create)'),
      pilot_end: z.string().optional().describe('Pilot end date YYYY-MM-DD (required for create, optional for update)'),
      success_criteria: z.array(z.string()).optional().describe('List of success criteria'),
      milestones: z.array(
        z.object({
          name: z.string().describe('Milestone name'),
          target_date: z.string().describe('Target date YYYY-MM-DD'),
          status: z.enum(['pending', 'in_progress', 'completed', 'missed']).describe('Status'),
        }),
      ).optional().describe('Array of milestones'),
      status: z.enum(['active', 'completed', 'at_risk']).optional().describe('Pilot status (filter for query, override for update)'),
    },
    async (params) => {
      try {
        const bq = getBqClient();
        let result: object;

        switch (params.command) {
          case 'create': {
            if (!params.deal_id) {
              throw new Error('deal_id is required for create command');
            }
            if (!params.pilot_start) {
              throw new Error('pilot_start is required for create command');
            }
            if (!params.pilot_end) {
              throw new Error('pilot_end is required for create command');
            }
            if (!params.success_criteria || params.success_criteria.length === 0) {
              throw new Error('success_criteria is required for create command');
            }
            if (!params.milestones || params.milestones.length === 0) {
              throw new Error('milestones is required for create command');
            }
            result = await handleCreate(bq, {
              command: 'create',
              deal_id: params.deal_id,
              client_id: params.client_id,
              pilot_start: params.pilot_start,
              pilot_end: params.pilot_end,
              success_criteria: params.success_criteria,
              milestones: params.milestones,
            });
            break;
          }

          case 'update': {
            if (!params.pilot_id) {
              throw new Error('pilot_id is required for update command');
            }
            result = await handleUpdate(bq, {
              command: 'update',
              pilot_id: params.pilot_id,
              client_id: params.client_id,
              pilot_end: params.pilot_end,
              success_criteria: params.success_criteria,
              milestones: params.milestones,
              status: params.status,
            });
            break;
          }

          case 'query': {
            result = await handleQuery(bq, {
              command: 'query',
              client_id: params.client_id,
              status: params.status,
              deal_id: params.deal_id,
            });
            break;
          }

          default:
            throw new Error(`Unknown command: ${params.command}. Valid commands: create, update, query.`);
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'pilot_tracker_failed',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );
}
