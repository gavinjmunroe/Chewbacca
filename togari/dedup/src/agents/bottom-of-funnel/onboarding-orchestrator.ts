/**
 * BOF Onboarding Orchestrator
 * Generates structured onboarding plans when a deal is marked closed_won.
 *
 * Queries deal details and activity history from BigQuery, then produces
 * an 8-task onboarding checklist with computed due dates relative to close_date.
 *
 * Follows prompt-delegation model: returns structured data, not prose.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { BigQuery } from '@google-cloud/bigquery';

// ─── Zod Schemas ────────────────────────────────────────────────────────────

export const onboardingInputSchema = z.object({
  deal_id: z.string().describe('UUID of the deal in togari.deals'),
  client_id: z.string().describe('Client/company identifier'),
});

export type OnboardingInput = z.infer<typeof onboardingInputSchema>;

const onboardingTaskSchema = z.object({
  task_name: z.string().describe('Name of the onboarding task'),
  description: z.string().describe('What this task involves'),
  owner: z.string().describe('Who is responsible (role or team)'),
  due_date: z.string().describe('Computed due date (YYYY-MM-DD)'),
  dependencies: z.array(z.string()).describe('Task names this depends on'),
  status: z.literal('pending').describe('Initial status is always pending'),
});

export type OnboardingTask = z.infer<typeof onboardingTaskSchema>;

const calendarHoldSchema = z.object({
  title: z.string().describe('Calendar event title'),
  date: z.string().describe('Suggested date (YYYY-MM-DD)'),
  duration_minutes: z.number().describe('Meeting duration in minutes'),
  attendees: z.array(z.string()).describe('Roles or people to invite'),
});

const dealSummarySchema = z.object({
  deal_id: z.string(),
  deal_name: z.string(),
  company: z.string(),
  value: z.number().nullable(),
  stage: z.string(),
  close_date: z.string().nullable(),
  owner: z.string(),
  contact_ids: z.array(z.string()),
  notes: z.string().nullable(),
});

export const onboardingOutputSchema = z.object({
  onboarding_plan: z.object({
    deal_summary: dealSummarySchema,
    tasks: z.array(onboardingTaskSchema),
    timeline_weeks: z.number().describe('Total onboarding timeline in weeks'),
    suggested_calendar_holds: z.array(calendarHoldSchema),
  }),
});

export type OnboardingOutput = z.infer<typeof onboardingOutputSchema>;

// ─── Types ──────────────────────────────────────────────────────────────────

interface DealRow {
  deal_name: string;
  company: string;
  value: number | null;
  stage: string;
  close_date: string | null;
  owner: string;
  contact_ids: string[];
  notes: string | null;
}

interface ActivityRow {
  activity_type: string;
  summary: string;
  created_at: string;
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

async function queryDealDetails(bq: BigQuery, dealId: string): Promise<DealRow | null> {
  const [rows] = await bq.query({
    query: `
      SELECT deal_name, company, value, stage,
        CAST(close_date AS STRING) AS close_date,
        owner, contact_ids, notes
      FROM \`togari.deals\`
      WHERE deal_id = @deal_id
      LIMIT 1
    `,
    params: { deal_id: dealId },
    useLegacySql: false,
  });
  return (rows as DealRow[])[0] ?? null;
}

async function queryActivities(bq: BigQuery, dealId: string): Promise<ActivityRow[]> {
  const [rows] = await bq.query({
    query: `
      SELECT activity_type, summary, CAST(created_at AS STRING) AS created_at
      FROM \`togari.activities\`
      WHERE deal_id = @deal_id
      ORDER BY created_at DESC
      LIMIT 20
    `,
    params: { deal_id: dealId },
    useLegacySql: false,
  });
  return rows as ActivityRow[];
}

// ─── Date Helpers ───────────────────────────────────────────────────────────

function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

// ─── Onboarding Task Definitions ────────────────────────────────────────────

interface TaskTemplate {
  task_name: string;
  description: string;
  owner: string;
  offset_business_days: number;
  dependencies: string[];
}

const ONBOARDING_TASKS: TaskTemplate[] = [
  {
    task_name: 'Kickoff Call',
    description: 'Introduce the client to the onboarding team, review goals, confirm success criteria from the pilot/proposal phase, and align on the onboarding timeline.',
    owner: 'Account Manager',
    offset_business_days: 2,
    dependencies: [],
  },
  {
    task_name: 'Data Access Setup',
    description: 'Provision client access to the platform, set up SSO/auth, create workspace, and configure API keys and integrations.',
    owner: 'Solutions Engineer',
    offset_business_days: 4,
    dependencies: ['Kickoff Call'],
  },
  {
    task_name: 'Initial Data Import',
    description: 'Import client CRM data, contact lists, and historical campaign data. Validate data quality and resolve mapping issues.',
    owner: 'Solutions Engineer',
    offset_business_days: 7,
    dependencies: ['Data Access Setup'],
  },
  {
    task_name: 'Tool Configuration',
    description: 'Configure outreach sequences, email templates, persona settings, and campaign parameters based on discovery notes and client preferences.',
    owner: 'Solutions Engineer',
    offset_business_days: 9,
    dependencies: ['Initial Data Import'],
  },
  {
    task_name: 'Team Training',
    description: 'Conduct training session for the client team covering platform workflows, dashboard navigation, campaign management, and reporting.',
    owner: 'Customer Success',
    offset_business_days: 12,
    dependencies: ['Tool Configuration'],
  },
  {
    task_name: 'First Campaign Launch',
    description: 'Launch the first live outreach campaign. Monitor initial sends, deliverability, and early engagement metrics.',
    owner: 'Customer Success',
    offset_business_days: 14,
    dependencies: ['Team Training'],
  },
  {
    task_name: 'Week 2 Check-in',
    description: 'Review early campaign performance, address any issues, adjust targeting or messaging, and confirm the client team is self-sufficient.',
    owner: 'Account Manager',
    offset_business_days: 19,
    dependencies: ['First Campaign Launch'],
  },
  {
    task_name: 'Month 1 Review',
    description: 'Comprehensive review of onboarding outcomes, campaign metrics, ROI projections, and transition plan to ongoing customer success management.',
    owner: 'Account Manager',
    offset_business_days: 23,
    dependencies: ['Week 2 Check-in'],
  },
];

// ─── Calendar Holds ─────────────────────────────────────────────────────────

function buildCalendarHolds(baseDate: Date): z.infer<typeof calendarHoldSchema>[] {
  return [
    {
      title: 'Onboarding Kickoff Call',
      date: formatDate(addBusinessDays(baseDate, 2)),
      duration_minutes: 60,
      attendees: ['Account Manager', 'Solutions Engineer', 'Client Stakeholders'],
    },
    {
      title: 'Team Training Session',
      date: formatDate(addBusinessDays(baseDate, 12)),
      duration_minutes: 90,
      attendees: ['Customer Success', 'Solutions Engineer', 'Client Team'],
    },
    {
      title: 'First Campaign Launch Review',
      date: formatDate(addBusinessDays(baseDate, 14)),
      duration_minutes: 30,
      attendees: ['Customer Success', 'Client Campaign Owner'],
    },
    {
      title: 'Week 2 Check-in',
      date: formatDate(addBusinessDays(baseDate, 19)),
      duration_minutes: 45,
      attendees: ['Account Manager', 'Customer Success', 'Client Stakeholders'],
    },
    {
      title: 'Month 1 Review',
      date: formatDate(addBusinessDays(baseDate, 23)),
      duration_minutes: 60,
      attendees: ['Account Manager', 'Customer Success', 'Client Executive Sponsor'],
    },
  ];
}

// ─── Tool Registration ──────────────────────────────────────────────────────

export function registerOnboardingOrchestratorTools(server: McpServer): void {
  server.tool(
    'bof_orchestrate_onboarding',
    'Generate a structured onboarding plan when a deal is closed_won. Queries deal details and activity history from BigQuery, produces an 8-task checklist with computed due dates, and suggests calendar holds for key meetings.',
    {
      deal_id: z.string().describe('UUID of the deal in togari.deals'),
      client_id: z.string().describe('Client/company identifier'),
    },
    async (params) => {
      try {
        const bq = getBqClient();

        // Query deal details and activities in parallel
        const [deal, activities] = await Promise.all([
          queryDealDetails(bq, params.deal_id),
          queryActivities(bq, params.deal_id),
        ]);

        if (!deal) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: 'deal_not_found',
                message: `No deal found with deal_id: ${params.deal_id}. Run mof_deal_search to locate the correct deal.`,
              }),
            }],
          };
        }

        // Use close_date as the onboarding anchor; fall back to today
        const baseDate = deal.close_date ? new Date(deal.close_date) : new Date();

        // Build the 8 onboarding tasks with computed due dates
        const tasks: OnboardingTask[] = ONBOARDING_TASKS.map((t) => ({
          task_name: t.task_name,
          description: t.description,
          owner: t.owner,
          due_date: formatDate(addBusinessDays(baseDate, t.offset_business_days)),
          dependencies: t.dependencies,
          status: 'pending' as const,
        }));

        // Build suggested calendar holds
        const calendarHolds = buildCalendarHolds(baseDate);

        // Compute timeline in weeks (from first task to last)
        const timelineWeeks = Math.ceil(
          ONBOARDING_TASKS[ONBOARDING_TASKS.length - 1].offset_business_days / 5,
        );

        // Build activity context for downstream prompt delegation
        const activityContext = activities.map((a) => ({
          type: a.activity_type,
          summary: a.summary,
          date: a.created_at,
        }));

        const dealSummary = {
          deal_id: params.deal_id,
          deal_name: deal.deal_name,
          company: deal.company,
          value: deal.value,
          stage: deal.stage,
          close_date: deal.close_date,
          owner: deal.owner,
          contact_ids: deal.contact_ids,
          notes: deal.notes,
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'bof_orchestrate_onboarding',
              onboarding_plan: {
                deal_summary: dealSummary,
                tasks,
                timeline_weeks: timelineWeeks,
                suggested_calendar_holds: calendarHolds,
              },
              activity_context: activityContext,
              instructions: 'Use the onboarding plan as-is. Personalize task descriptions using the deal notes and activity context if additional detail is needed. Do not generate prose — return the structured plan.',
            }, null, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'onboarding_orchestration_failed',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );
}
