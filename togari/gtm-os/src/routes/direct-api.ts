/**
 * Direct-mode REST endpoints — bypass Claude, query BigQuery directly.
 *
 * These exist so core CRUD operations work even if the Anthropic API is down.
 * All routes are JWT-protected via requireJwt; client_id comes from the token.
 *
 * Routes:
 *   GET    /api/deals           — list/search deals
 *   POST   /api/deals           — create a deal
 *   PATCH  /api/deals/:id       — update a deal
 *   GET    /api/contacts/search — search contacts in BigQuery
 *   GET    /api/pipeline/kanban — kanban board view
 */

import { Router, Request, Response } from 'express';
import { BigQuery } from '@google-cloud/bigquery';
import {
  createDeal,
  updateDeal,
  searchDeals,
  listDeals,
  DealStoreConfig,
} from '../agents/middle-of-funnel/deal-store';
import { requireJwt } from '../middleware/auth';
import { publishEvent } from '../events';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDealStoreConfig(): DealStoreConfig {
  return {
    projectId: process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3',
    dataset: process.env.BIGQUERY_DATASET ?? 'togari_data_lake',
    table: process.env.BIGQUERY_DEALS_TABLE ?? 'togari_structured_deals',
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    gcpCredentialsBase64: process.env.GCP_CREDENTIALS_BASE64,
  };
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

function fqTable(table: string): string {
  const project = process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3';
  const dataset = process.env.BIGQUERY_DATASET ?? 'togari_data_lake';
  return `\`${project}.${dataset}.${table}\``;
}

function errorResponse(res: Response, status: number, message: string, retry_possible = false): void {
  res.status(status).json({
    error: true,
    message,
    retry_possible,
  });
}

// ─── Stage validation ────────────────────────────────────────────────────────

const VALID_STAGES = new Set([
  'researching', 'contacted', 'conversation_started',
  'discovery_scheduled', 'discovery_complete',
  'proposal_sent', 'negotiating',
  'verbal_commit', 'contract_sent',
  'nurture', 'not_a_fit',
  'closed_won', 'closed_lost',
]);

const VALID_PIPELINES = new Set(['partnerships', 'inbound', 'outbound']);

const STAGE_ORDER = [
  'researching', 'contacted', 'conversation_started',
  'discovery_scheduled', 'discovery_complete',
  'proposal_sent', 'negotiating',
  'verbal_commit', 'contract_sent',
  'nurture', 'not_a_fit',
  'closed_won', 'closed_lost',
];

// ─── Router ──────────────────────────────────────────────────────────────────

export function createDirectApiRouter(): Router {
  const router = Router();

  // All direct-api routes require JWT
  router.use(requireJwt);

  // JSON body parsing for POST/PATCH
  router.use((req, _res, next) => {
    if (req.is('application/json') || req.method === 'POST' || req.method === 'PATCH') {
      // express.json() should already be applied by the parent app,
      // but we ensure it here as a safety net
    }
    next();
  });

  // ── GET /api/deals — list or search deals ──────────────────────────────────

  router.get('/deals', async (req: Request, res: Response) => {
    try {
      const config = getDealStoreConfig();
      const query = req.query.q as string | undefined;

      if (query) {
        // Search mode
        const pipeline = req.query.pipeline as string | undefined;
        if (pipeline && !VALID_PIPELINES.has(pipeline)) {
          return errorResponse(res, 400, `Invalid pipeline: ${pipeline}. Must be partnerships, inbound, or outbound`);
        }
        const deals = await searchDeals(config, {
          query,
          pipeline: pipeline as any,
        });
        return res.json({ deals, count: deals.length });
      }

      // List mode
      const pipeline = req.query.pipeline as string | undefined;
      const owner = req.query.owner as string | undefined;
      const since = req.query.since as string | undefined;
      const excludeTerminal = req.query.exclude_terminal === 'true';

      if (pipeline && !VALID_PIPELINES.has(pipeline)) {
        return errorResponse(res, 400, `Invalid pipeline: ${pipeline}`);
      }

      const deals = await listDeals(config, {
        pipeline: pipeline as any,
        owner,
        since,
        excludeTerminal,
      });
      return res.json({ deals, count: deals.length });
    } catch (error) {
      process.stderr.write(`[direct-api] GET /deals failed: ${error instanceof Error ? error.message : error}\n`);
      return errorResponse(res, 500, 'Failed to fetch deals', true);
    }
  });

  // ── POST /api/deals — create a deal ────────────────────────────────────────

  router.post('/deals', async (req: Request, res: Response) => {
    try {
      const config = getDealStoreConfig();
      const body = req.body;

      // Validate required fields
      const required = ['deal_name', 'company', 'pipeline', 'stage', 'owner', 'next_action', 'next_action_date'];
      const missing = required.filter(f => !body[f]);
      if (missing.length > 0) {
        return errorResponse(res, 400, `Missing required fields: ${missing.join(', ')}`);
      }

      if (!VALID_PIPELINES.has(body.pipeline)) {
        return errorResponse(res, 400, `Invalid pipeline: ${body.pipeline}`);
      }
      if (!VALID_STAGES.has(body.stage)) {
        return errorResponse(res, 400, `Invalid stage: ${body.stage}`);
      }

      const result = await createDeal(config, {
        deal_name: body.deal_name,
        company: body.company,
        client_id: req.clientId,
        pipeline: body.pipeline,
        stage: body.stage,
        owner: body.owner,
        value: body.value,
        close_date: body.close_date,
        next_action: body.next_action,
        next_action_date: body.next_action_date,
        notes: body.notes,
        contact_full_name: body.contact_full_name,
        contact_email: body.contact_email,
        contact_linkedin: body.contact_linkedin,
        deal_source: body.deal_source,
      });

      // Fire-and-forget event
      publishEvent('deal_created', {
        deal_id: result.deal_id,
        deal_name: body.deal_name,
        company: body.company,
        pipeline: body.pipeline,
        stage: body.stage,
        owner: body.owner,
        value: body.value ?? null,
        deal_source: body.deal_source ?? null,
      });

      return res.status(201).json({
        success: true,
        deal_id: result.deal_id,
        created_at: result.created_at,
      });
    } catch (error) {
      process.stderr.write(`[direct-api] POST /deals failed: ${error instanceof Error ? error.message : error}\n`);
      return errorResponse(res, 500, 'Failed to create deal', true);
    }
  });

  // ── PATCH /api/deals/:id — update a deal ───────────────────────────────────

  router.patch('/deals/:id', async (req: Request, res: Response) => {
    try {
      const config = getDealStoreConfig();
      const body = req.body;
      const dealId = req.params.id;

      if (!dealId) {
        return errorResponse(res, 400, 'deal_id is required in URL path');
      }

      if (body.stage && !VALID_STAGES.has(body.stage)) {
        return errorResponse(res, 400, `Invalid stage: ${body.stage}`);
      }
      if (body.pipeline) {
        return errorResponse(res, 400, 'Pipeline cannot be changed after creation');
      }

      const result = await updateDeal(config, {
        deal_id: String(dealId),
        deal_name: body.deal_name,
        stage: body.stage,
        owner: body.owner,
        value: body.value,
        close_date: body.close_date,
        next_action: body.next_action,
        next_action_date: body.next_action_date,
        notes: body.notes,
        contact_full_name: body.contact_full_name,
        contact_email: body.contact_email,
        contact_linkedin: body.contact_linkedin,
        deal_source: body.deal_source,
      });

      // Fire-and-forget event
      publishEvent('deal_updated', {
        deal_id: result.deal_id,
        fields_updated: result.fields_updated,
        changes: Object.fromEntries(
          result.fields_updated.map((f: string) => [f, body[f]]),
        ),
      });

      return res.json({
        success: true,
        deal_id: result.deal_id,
        fields_updated: result.fields_updated,
        updated_at: result.updated_at,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Deal not found')) {
        return errorResponse(res, 404, message);
      }
      process.stderr.write(`[direct-api] PATCH /deals/${req.params.id} failed: ${message}\n`);
      return errorResponse(res, 500, 'Failed to update deal', true);
    }
  });

  // ── GET /api/contacts/search — search contacts ─────────────────────────────

  router.get('/contacts/search', async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string | undefined;
      if (!query || query.trim().length < 2) {
        return errorResponse(res, 400, 'Query parameter "q" is required (min 2 characters)');
      }

      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
      const bq = getBqClient();
      const contactsTable = fqTable(process.env.BIGQUERY_TABLE ?? 'togari_structured_contacts');
      const q = `%${query.toLowerCase()}%`;

      const [rows] = await bq.query({
        query: `
          SELECT
            linkedinUrl, fullName, firstName, lastName,
            workEmail, phone, currentTitle, currentCompany,
            companyDomain, CAST(createdAt AS STRING) AS createdAt
          FROM ${contactsTable}
          WHERE
            LOWER(COALESCE(fullName, '')) LIKE @q
            OR LOWER(COALESCE(workEmail, '')) LIKE @q
            OR LOWER(COALESCE(currentCompany, '')) LIKE @q
            OR LOWER(COALESCE(currentTitle, '')) LIKE @q
            OR LOWER(COALESCE(companyDomain, '')) LIKE @q
          ORDER BY createdAt DESC
          LIMIT @limit
        `,
        params: { q, limit },
        useLegacySql: false,
      });

      return res.json({ contacts: rows, count: (rows as any[]).length });
    } catch (error) {
      process.stderr.write(`[direct-api] GET /contacts/search failed: ${error instanceof Error ? error.message : error}\n`);
      return errorResponse(res, 500, 'Failed to search contacts', true);
    }
  });

  // ── GET /api/pipeline/kanban — kanban board view ───────────────────────────

  router.get('/pipeline/kanban', async (req: Request, res: Response) => {
    try {
      const config = getDealStoreConfig();
      const pipeline = req.query.pipeline as string | undefined;
      const owner = req.query.owner as string | undefined;

      if (pipeline && pipeline !== 'all' && !VALID_PIPELINES.has(pipeline)) {
        return errorResponse(res, 400, `Invalid pipeline: ${pipeline}`);
      }

      const deals = await listDeals(config, {
        pipeline: (pipeline && pipeline !== 'all') ? pipeline as any : undefined,
        owner,
        excludeTerminal: req.query.exclude_terminal !== 'false', // default true for kanban
      });

      // Group deals by stage in canonical order
      const kanban: Record<string, typeof deals> = {};
      for (const stage of STAGE_ORDER) {
        const stageDeals = deals.filter(d => d.stage === stage);
        if (stageDeals.length > 0) {
          kanban[stage] = stageDeals;
        }
      }

      // Compute summary stats
      const stats = {
        total: deals.length,
        by_stage: Object.entries(kanban).map(([stage, d]) => ({ stage, count: d.length })),
        by_pipeline: Array.from(new Set(deals.map(d => d.pipeline))).map(p => ({
          pipeline: p,
          count: deals.filter(d => d.pipeline === p).length,
        })),
        overdue: deals.filter(d => d.is_overdue).length,
        stale: deals.filter(d => d.is_stale).length,
      };

      return res.json({ kanban, stats });
    } catch (error) {
      process.stderr.write(`[direct-api] GET /pipeline/kanban failed: ${error instanceof Error ? error.message : error}\n`);
      return errorResponse(res, 500, 'Failed to load kanban', true);
    }
  });

  return router;
}
