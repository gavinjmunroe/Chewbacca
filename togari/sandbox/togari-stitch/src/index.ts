#!/usr/bin/env node

// Sentry must be imported before all other modules
import { Sentry } from './instrument';

/**
 * togari-healthcare — MCP Server for Amber Healthcare Platform
 *
 * Wraps the Togari core library (connectors, schemas, services) as MCP tools
 * for patient/contact management, data enrichment, file processing, and scoring.
 *
 * Transport modes:
 *   - stdio mode for Claude Desktop (default)
 *   - HTTP/SSE mode when PORT is set (Railway deployment)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp';
import express from 'express';
import { z } from 'zod';

// Tenant middleware
import {
  tenantStorage,
  getCurrentTenant,
  createAuthMiddleware,
  createStdioTenantContext,
  setStdioFallback,
} from './core/middleware/tenant';

// Core imports
import { AnthropicClient, CostTracker } from './core/connectors/anthropic';
import { CloudStorageClient } from './core/connectors/gcp';
import { StructifyClient } from './core/connectors/structify';
import { FirestoreClient } from './core/connectors/firestore';
import { ExaClient } from './core/connectors/exa';
import { ClayClient } from './core/connectors/clay';
import { connectorRegistry } from './core/connectors/registry';
import { ScoringService } from './core/services/scoring';
import { FileParser } from './core/services/file-parser/parser';
import { DataValidator } from './core/services/file-parser/validators';
import { ColumnMapper } from './core/services/file-parser/column-mapper';
import { Normalizer } from './core/services/normalizer/normalizer';
import { ModelSelector } from './core/services/normalizer/model-selector';
import { BatchNormalizer } from './core/services/normalizer/batch';
import { UploadPipeline, createUploadPipeline } from './core/services/file-parser/pipeline';
import { DataProcessor } from './core/services/pipeline/processor';
import { createLogger } from './core/utils/logger';
import { handleError } from './core/errors/handler';
import { getSecret, getOptionalSecret, staticConfig } from './core/config';
import { initRedis } from './core/services/rate-limiter';
import { withRateLimit } from './core/middleware/rate-limit-wrapper';
import { withAuditLog } from './core/middleware/audit-wrapper';
import {
  publishEntityEvent,
  publishScoringEvent,
  publishEnrichmentEvent,
} from './core/services/event-publisher';
import {
  leadFunnel,
  scoringDistribution,
  enrichmentCoverage,
  touchpointAnalysis,
  verticalBreakdown,
  scoringTrend,
} from './core/services/analytics';

const logger = createLogger('togari-healthcare');

// ---------------------------------------------------------------------------
// CAPABILITIES & DEGRADED MODE HELPERS
// ---------------------------------------------------------------------------

/**
 * Derive system capabilities from connector health.
 * Used by /api/status endpoint and tool meta envelopes.
 */
function getCapabilities(): Record<string, boolean> {
  const statuses = Object.fromEntries(
    connectorRegistry.getAllStatuses().map((s) => [s.name, s.healthy])
  );
  return {
    crud: statuses.firestore !== false,            // Firestore required for CRUD
    scoring: true,                                // Local computation, always available
    enrichment: (statuses.exa !== false) || (statuses.clay !== false),
    normalization: statuses.anthropic !== false,   // Claude required
    file_processing: true,                        // Parsing is local; normalization degrades gracefully
    analytics: true,                              // BigQuery — separate infra
  };
}

/**
 * Determine overall system status from capabilities.
 */
function getSystemStatus(): 'healthy' | 'degraded' | 'critical' {
  const caps = getCapabilities();
  if (!caps.crud) return 'critical';             // Firestore down = can't do core ops
  const allHealthy = Object.values(caps).every(Boolean);
  return allHealthy ? 'healthy' : 'degraded';
}

// ---------------------------------------------------------------------------
// Lazy-initialized singletons (created on first use, not at import time)
// Async because secrets are loaded from Secret Manager on first access.
// ---------------------------------------------------------------------------

let _anthropic: AnthropicClient | null = null;
let _costTracker: CostTracker | null = null;
let _cloudStorage: CloudStorageClient | null = null;
let _firestore: FirestoreClient | null = null;
let _structify: StructifyClient | null = null;  // kept for DataProcessor extraction features
let _exa: ExaClient | null = null;
let _clay: ClayClient | null = null;
let _scoring: ScoringService | null = null;
let _uploadPipeline: UploadPipeline | null = null;
let _dataProcessor: DataProcessor | null = null;

async function getAnthropic(): Promise<AnthropicClient> {
  if (!_anthropic) {
    const key = await getSecret('anthropic-api-key');
    _anthropic = new AnthropicClient(key);
    _costTracker = new CostTracker();
  }
  return _anthropic;
}

async function getCloudStorage(): Promise<CloudStorageClient> {
  if (!_cloudStorage) {
    const bucket = await getSecret('gcp-storage-bucket');
    _cloudStorage = new CloudStorageClient(staticConfig.gcpProjectId, bucket);
  }
  return _cloudStorage;
}

function getFirestore(): FirestoreClient {
  if (!_firestore) {
    _firestore = new FirestoreClient({
      projectId: staticConfig.gcpProjectId,
      databaseId: process.env.FIRESTORE_DATABASE_ID || undefined,
    });
  }
  return _firestore;
}

async function getStructify(): Promise<StructifyClient> {
  if (!_structify) {
    const apiKey = await getSecret('structify-api-key');
    const baseUrl = await getOptionalSecret('structify-base-url') || 'https://api.structify.com/v1';
    const datasetId = await getOptionalSecret('structify-dataset-id');
    _structify = new StructifyClient({ apiKey, baseUrl, datasetId });
  }
  return _structify;
}

async function getExa(): Promise<ExaClient> {
  if (!_exa) {
    const apiKey = await getSecret('exa-api-key');
    try {
      const anthropic = await getAnthropic();
      _exa = new ExaClient(apiKey, anthropic);
    } catch {
      _exa = new ExaClient(apiKey);
    }
  }
  return _exa;
}

async function getClay(): Promise<ClayClient> {
  if (!_clay) {
    const apiKey = await getSecret('clay-api-key');
    const baseUrl = await getOptionalSecret('clay-base-url') || 'https://api.clay.com/v1';
    const tableId = await getOptionalSecret('clay-table-id');
    _clay = new ClayClient({ apiKey, baseUrl, tableId });
  }
  return _clay;
}

function getScoring(): ScoringService {
  if (!_scoring) {
    _scoring = new ScoringService();
  }
  return _scoring;
}

async function getUploadPipeline(): Promise<UploadPipeline> {
  if (!_uploadPipeline) {
    const anthropic = await getAnthropic();
    _uploadPipeline = createUploadPipeline(anthropic);
  }
  return _uploadPipeline;
}

async function getDataProcessor(): Promise<DataProcessor> {
  if (!_dataProcessor) {
    const [storage, exa] = await Promise.all([getCloudStorage(), getExa()]);
    // Structify is optional — used only for extraction features. Falls back gracefully if unavailable.
    let structify: StructifyClient | undefined;
    try {
      structify = await getStructify();
    } catch {
      // Structify key not configured — extraction step will be skipped
    }
    _dataProcessor = new DataProcessor(storage, exa, structify);
  }
  return _dataProcessor;
}

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

function registerTools(server: McpServer): void {
  // =========================================================================
  // SEARCH / QUERY TOOLS
  // =========================================================================

  server.tool(
    'search_patients',
    'Search for patients/contacts in the healthcare CRM by name, email, company, title, or LinkedIn URL.',
    {
      query: z.string().describe('Search query — name, email, company, domain, or keyword'),
      entity_type: z.enum(['person', 'company']).default('person').describe('Type of entity to search'),
      limit: z.number().min(1).max(100).default(20).describe('Maximum results to return'),
    },
    withAuditLog('search_patients', withRateLimit('search_patients', async ({ query, entity_type, limit }) => {
      try {
        const tenant = getCurrentTenant();
        const firestore = getFirestore();
        if (entity_type === 'person') {
          const result = await firestore.listPersons({
            filters: [{ field: 'fullName', operator: 'contains', value: query }],
            limit,
            clientId: tenant.tenantId,
          });
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                total: result.total,
                results: result.data,
                hasMore: result.hasMore,
              }, null, 2),
            }],
          };
        } else {
          const result = await firestore.listCompanies({
            filters: [{ field: 'name', operator: 'contains', value: query }],
            limit,
            clientId: tenant.tenantId,
          });
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                total: result.total,
                results: result.data,
                hasMore: result.hasMore,
              }, null, 2),
            }],
          };
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }))
  );

  // =========================================================================
  // ENRICHMENT TOOLS
  // =========================================================================

  server.tool(
    'enrich_contact',
    'Enrich a contact/patient record with data from Exa (web search) and/or Clay (LinkedIn + company data). ' +
      'Provide an email, LinkedIn URL, or "Name at Company" identifier.',
    {
      identifier: z.string().describe('Email, LinkedIn URL, or "Name at Company" to look up'),
      source: z.enum(['exa', 'clay', 'both']).default('exa').describe('Enrichment data source'),
      domain: z.string().optional().describe('Company domain for company-level enrichment'),
    },
    withAuditLog('enrich_contact', withRateLimit('enrich_contact', async ({ identifier, source, domain }) => {
      try {
        const tenant = getCurrentTenant();
        const results: Record<string, unknown> = { _tenant: tenant.tenantId };

        if (source === 'exa' || source === 'both') {
          const exa = await getExa();
          results.exa_contact = await exa.enrichContact(identifier);
          if (domain) {
            results.exa_company = await exa.enrichCompany(domain);
          }
        }

        if (source === 'clay' || source === 'both') {
          const clay = await getClay();
          results.clay = await clay.enrichPerson({
            linkedinUrl: identifier.includes('linkedin.com') ? identifier : undefined,
            email: identifier.includes('@') ? identifier : undefined,
            fullName: !identifier.includes('@') && !identifier.includes('linkedin.com') ? identifier : undefined,
            companyDomain: domain,
          });
        }

        publishEnrichmentEvent(identifier, 'person', source);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(results, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }))
  );

  server.tool(
    'enrich_company',
    'Enrich a healthcare company with firmographic data — industry, employee count, tech stack, funding, location. ' +
      'Uses Exa web search and optionally Clay.',
    {
      domain: z.string().describe('Company domain to enrich (e.g., "acmehealth.com")'),
      source: z.enum(['exa', 'clay', 'both']).default('exa').describe('Enrichment data source'),
    },
    withAuditLog('enrich_company', withRateLimit('enrich_company', async ({ domain, source }) => {
      try {
        const tenant = getCurrentTenant();
        const results: Record<string, unknown> = { _tenant: tenant.tenantId };

        if (source === 'exa' || source === 'both') {
          const exa = await getExa();
          results.exa = await exa.enrichCompany(domain);
        }

        if (source === 'clay' || source === 'both') {
          const clay = await getClay();
          results.clay = await clay.enrichCompany(domain);
        }

        publishEnrichmentEvent(domain, 'company', source);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(results, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }))
  );

  // =========================================================================
  // FILE PROCESSING TOOLS
  // =========================================================================

  server.tool(
    'upload_file',
    'Upload a file (CSV, Excel, or JSON) to Cloud Storage for processing. ' +
      'Returns the stored file metadata with a GCS path.',
    {
      file_name: z.string().describe('Original file name including extension'),
      file_content_base64: z.string().describe('Base64-encoded file content'),
      mime_type: z.string().describe('MIME type (e.g., text/csv, application/json, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)'),
      user_id: z.string().default('system').describe('User ID for tracking'),
      folder: z.string().default('uploads').describe('Storage folder'),
    },
    withAuditLog('upload_file', withRateLimit('upload_file', async ({ file_name, file_content_base64, mime_type, user_id, folder }) => {
      try {
        const tenant = getCurrentTenant();
        const storage = await getCloudStorage();
        const buffer = Buffer.from(file_content_base64, 'base64');
        const result = await storage.uploadFile(buffer, {
          fileName: file_name,
          mimeType: mime_type,
          userId: user_id,
          folder,
          clientId: tenant.tenantId,
        });
        publishEntityEvent('file_uploaded', 'file', file_name, { mime_type, folder });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }))
  );

  server.tool(
    'process_file',
    'Process an uploaded file through the full pipeline: parse, map columns, validate, ' +
      'normalize with AI, and optionally enrich. Supports CSV, Excel, and JSON files.',
    {
      file_content_base64: z.string().describe('Base64-encoded file content'),
      file_type: z.enum(['csv', 'xlsx', 'json']).describe('File format'),
      entity_type: z.enum(['company', 'contact']).describe('Type of data in the file'),
      validate_only: z.boolean().default(false).describe('Only validate without normalizing'),
      skip_normalization: z.boolean().default(false).describe('Skip AI normalization step'),
      user_id: z.string().default('system').describe('User ID for tracking'),
    },
    withAuditLog('process_file', withRateLimit('process_file', async ({ file_content_base64, file_type, entity_type, validate_only, skip_normalization, user_id }) => {
      try {
        const tenant = getCurrentTenant();
        const pipeline = await getUploadPipeline();
        const content = file_type === 'xlsx'
          ? Buffer.from(file_content_base64, 'base64')
          : Buffer.from(file_content_base64, 'base64').toString('utf-8');

        let result;
        let normalizationSkipped = false;
        try {
          result = await pipeline.process(content, file_type, {
            entityType: entity_type,
            validateOnly: validate_only,
            skipNormalization: skip_normalization,
            userId: user_id,
            clientId: tenant.tenantId,
            tier: (tenant as Record<string, unknown>).tier as 'free' | 'pro' | 'enterprise' | undefined,
          });
        } catch (pipelineError) {
          // If normalization failed but parsing/validation would work, retry without normalization
          const isPipelineNormError = pipelineError instanceof Error &&
            (pipelineError.message.includes('Circuit breaker') || pipelineError.message.includes('timed out'));
          if (isPipelineNormError && !skip_normalization && !validate_only) {
            logger.warn('process_file degraded — retrying without normalization', { file_type, entity_type });
            normalizationSkipped = true;
            result = await pipeline.process(content, file_type, {
              entityType: entity_type,
              validateOnly: validate_only,
              skipNormalization: true,
              userId: user_id,
              clientId: tenant.tenantId,
              tier: (tenant as Record<string, unknown>).tier as 'free' | 'pro' | 'enterprise' | undefined,
            });
          } else {
            throw pipelineError;
          }
        }

        publishEntityEvent('file_processed', 'file', file_type, { entity_type, validate_only });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ...result,
              ...(normalizationSkipped ? { normalization_skipped: true } : {}),
              meta: {
                degraded: normalizationSkipped,
                warnings: normalizationSkipped ? ['AI normalization unavailable — data parsed and validated only'] : [],
                capabilities: getCapabilities(),
              },
            }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }))
  );

  // =========================================================================
  // SCORING TOOLS
  // =========================================================================

  server.tool(
    'score_lead',
    'Calculate lead scores for a patient/contact. Returns internal score (channel, budget, authority, GTM maturity), ' +
      'external score (vertical fit, engagement, timing), composite score, and routing tier.',
    {
      full_name: z.string().optional().describe('Contact full name'),
      current_title: z.string().optional().describe('Job title'),
      current_company: z.string().optional().describe('Company name'),
      vertical: z.enum(['healthcare', 'mental_health', 'wellness', 'fitness', 'digital_health', 'medical_supply']).optional().describe('Industry vertical'),
      source_channel: z.enum(['warm_referral', 'event', 'cold_outbound', 'inbound_marketing', 'partner', 'direct', 'social_media', 'paid_ads']).optional().describe('How the lead was acquired'),
      employee_count: z.number().optional().describe('Company employee count'),
      tech_stack: z.array(z.string()).optional().describe('Technologies used by the company'),
      touch_count: z.number().optional().describe('Number of touchpoints/interactions'),
      persona: z.enum(['decision_maker', 'influencer', 'champion', 'end_user', 'gatekeeper']).optional().describe('Contact persona type'),
      personalization_hooks: z.array(z.string()).optional().describe('Timing signals (e.g., "hiring", "funding", "new role")'),
    },
    withAuditLog('score_lead', withRateLimit('score_lead', async (params) => {
      try {
        const tenant = getCurrentTenant();
        const scoring = getScoring();
        const person = {
          fullName: params.full_name,
          currentTitle: params.current_title,
          currentCompany: params.current_company,
          vertical: params.vertical,
          sourceChannel: params.source_channel,
          companyData: params.employee_count ? { employeeCount: params.employee_count } : undefined,
          techStack: params.tech_stack,
          touchCount: params.touch_count,
          persona: params.persona,
          personalizationHooks: params.personalization_hooks,
        };

        const result = scoring.calculateScores(person as any);
        publishScoringEvent(
          params.full_name || 'unknown',
          { composite: result.compositeScore, internal: result.internalScore, external: result.externalScore },
          result.routingTier,
          result.factors,
        );

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              internalScore: result.internalScore,
              externalScore: result.externalScore,
              compositeScore: result.compositeScore,
              routingTier: result.routingTier,
              factors: result.factors,
            }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }))
  );

  // =========================================================================
  // CRUD TOOLS
  // =========================================================================

  server.tool(
    'create_patient',
    'Create a new patient/contact record in the healthcare CRM.',
    {
      linkedin_url: z.string().describe('LinkedIn profile URL'),
      full_name: z.string().describe('Full name'),
      vertical: z.enum(['healthcare', 'mental_health', 'wellness', 'fitness', 'digital_health', 'medical_supply']).describe('Industry vertical'),
      source_type: z.enum(['amber_form', 'csv_upload', 'manual_entry', 'crm_sync', 'website_visitor', 'linkedin_import', 'api_integration']).describe('How the contact entered the system'),
      source_channel: z.enum(['warm_referral', 'event', 'cold_outbound', 'inbound_marketing', 'partner', 'direct', 'social_media', 'paid_ads']).describe('Acquisition channel'),
      work_email: z.string().optional().describe('Work email'),
      current_title: z.string().optional().describe('Job title'),
      current_company: z.string().optional().describe('Company name'),
      company_domain: z.string().optional().describe('Company domain'),
      phone: z.string().optional().describe('Phone number'),
    },
    withAuditLog('create_patient', withRateLimit('create_patient', async (params) => {
      try {
        const tenant = getCurrentTenant();
        const firestore = getFirestore();
        const person = await firestore.createPerson({
          linkedinUrl: params.linkedin_url,
          fullName: params.full_name,
          vertical: params.vertical,
          sourceType: params.source_type,
          sourceChannel: params.source_channel,
          client_id: tenant.tenantId,
          workEmail: params.work_email,
          currentTitle: params.current_title,
          currentCompany: params.current_company,
          companyDomain: params.company_domain,
          phone: params.phone,
        });
        publishEntityEvent('person_created', 'person', (person as any).id || params.linkedin_url, { vertical: params.vertical });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(person, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }))
  );

  server.tool(
    'get_patient',
    'Get a patient/contact record by ID.',
    {
      person_id: z.string().describe('Person ID to look up'),
    },
    withAuditLog('get_patient', withRateLimit('get_patient', async ({ person_id }) => {
      try {
        const tenant = getCurrentTenant();
        const firestore = getFirestore();
        // Path-based isolation: getPerson reads from /tenants/{tenantId}/persons/{id}
        const person = await firestore.getPerson(person_id, tenant.tenantId);
        if (!person) {
          return { content: [{ type: 'text' as const, text: 'Patient not found' }] };
        }
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(person, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }))
  );

  server.tool(
    'update_patient',
    'Update fields on an existing patient/contact record.',
    {
      person_id: z.string().describe('Person ID to update'),
      updates: z.record(z.unknown()).describe('Fields to update (e.g., { "currentTitle": "VP Sales", "currentStatus": "engaged" })'),
    },
    withAuditLog('update_patient', withRateLimit('update_patient', async ({ person_id, updates }) => {
      try {
        const tenant = getCurrentTenant();
        const firestore = getFirestore();
        // Verify person exists in this tenant before updating (path-based isolation)
        const existing = await firestore.getPerson(person_id, tenant.tenantId);
        if (!existing) {
          return { content: [{ type: 'text' as const, text: 'Patient not found' }] };
        }
        // Prevent client_id from being overwritten via updates
        const sanitizedUpdates = { ...updates } as Record<string, unknown>;
        delete sanitizedUpdates.client_id;
        const person = await firestore.updatePerson(person_id, sanitizedUpdates as any, tenant.tenantId);
        publishEntityEvent('person_updated', 'person', person_id, { fields: Object.keys(sanitizedUpdates) });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(person, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }))
  );

  // =========================================================================
  // DATA QUERY TOOLS
  // =========================================================================

  server.tool(
    'query_data',
    'Run a natural-language or structured query against the healthcare data. ' +
      'Lists persons, companies, campaigns, touchpoints, or relationships with filters.',
    {
      entity: z.enum(['person', 'company', 'campaign', 'touchpoint', 'relationship']).describe('Entity type to query'),
      filters: z.array(z.object({
        field: z.string(),
        operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in']),
        value: z.unknown(),
      })).optional().describe('Query filters'),
      limit: z.number().min(1).max(100).default(20).describe('Maximum results'),
      order_by: z.string().optional().describe('Field to sort by'),
      order_direction: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
    },
    withAuditLog('query_data', withRateLimit('query_data', async ({ entity, filters, limit, order_by, order_direction }) => {
      try {
        const tenant = getCurrentTenant();
        const firestore = getFirestore();
        // clientId routes to the correct tenant subcollection — no field filter needed
        const sanitizedFilters = ((filters as any) || []).filter((f: any) => f.field !== 'client_id');
        const options = {
          filters: sanitizedFilters,
          limit,
          orderBy: order_by,
          orderDirection: order_direction,
          clientId: tenant.tenantId,
        };

        let result;
        switch (entity) {
          case 'person':
            result = await firestore.listPersons(options);
            break;
          case 'company':
            result = await firestore.listCompanies(options);
            break;
          case 'campaign':
            result = await firestore.listCampaigns(options);
            break;
          case 'touchpoint':
            result = await firestore.listTouchpoints(options);
            break;
          case 'relationship':
            result = await firestore.listRelationships(options);
            break;
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }))
  );

  // =========================================================================
  // NORMALIZATION TOOLS
  // =========================================================================

  server.tool(
    'normalize_data',
    'Normalize raw patient/company data into structured format using AI. ' +
      'Takes messy input and produces clean, validated records matching the schema.',
    {
      raw_data: z.unknown().describe('Raw data to normalize (object or string)'),
      entity_type: z.enum(['company', 'contact']).describe('Type of entity'),
      source: z.string().default('manual').describe('Source of the data (e.g., "csv", "api", "manual")'),
    },
    withAuditLog('normalize_data', withRateLimit('normalize_data', async ({ raw_data, entity_type, source }) => {
      try {
        const tenant = getCurrentTenant();
        const anthropic = await getAnthropic();
        const modelSelector = new ModelSelector();
        const normalizer = new Normalizer(anthropic, modelSelector, _costTracker ?? undefined);

        const result = await normalizer.normalize(raw_data, entity_type, source);
        publishEnrichmentEvent(entity_type, entity_type, source, { model: result.model, tokensUsed: result.tokensUsed });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              data: result.data,
              confidence: result.confidence,
              issues: result.issues,
              model: result.model,
              tokensUsed: result.tokensUsed,
              meta: { degraded: false, capabilities: getCapabilities() },
            }, null, 2),
          }],
        };
      } catch (error) {
        // Degraded mode: if Claude is unavailable, return raw data instead of crashing
        const isUpstreamFailure = error instanceof Error &&
          (error.message.includes('Circuit breaker') || error.message.includes('timed out') || error.message.includes('not configured'));

        if (isUpstreamFailure) {
          logger.warn('normalize_data degraded — returning raw data', { entity_type, source });
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                data: raw_data,
                confidence: 0,
                issues: ['AI normalization unavailable — returning raw data'],
                model: null,
                tokensUsed: 0,
                degraded: true,
                meta: { degraded: true, warnings: ['Anthropic API unavailable'], capabilities: getCapabilities() },
              }, null, 2),
            }],
          };
        }

        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }))
  );

  // =========================================================================
  // WEB SEARCH TOOL
  // =========================================================================

  server.tool(
    'search_web',
    'Search the web for healthcare-related information using Exa neural search. ' +
      'Useful for researching companies, providers, clinical trials, etc.',
    {
      query: z.string().describe('Search query'),
      num_results: z.number().min(1).max(20).default(5).describe('Number of results'),
      include_domains: z.array(z.string()).optional().describe('Only search these domains'),
      exclude_domains: z.array(z.string()).optional().describe('Exclude these domains'),
    },
    withAuditLog('search_web', withRateLimit('search_web', async ({ query, num_results, include_domains, exclude_domains }) => {
      try {
        const tenant = getCurrentTenant();
        const exa = await getExa();
        const result = await exa.search(query, {
          numResults: num_results,
          includeText: true,
          includeDomains: include_domains,
          excludeDomains: exclude_domains,
        });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }))
  );

  // =========================================================================
  // ANALYTICS TOOL
  // =========================================================================

  server.tool(
    'healthcare_analytics',
    'Run cross-entity analytics queries on healthcare data. Returns aggregated insights: ' +
      'lead funnel, scoring distribution, enrichment coverage, touchpoint analysis, vertical breakdown, or scoring trends.',
    {
      query_type: z.enum([
        'lead_funnel',
        'scoring_distribution',
        'enrichment_coverage',
        'touchpoint_analysis',
        'vertical_breakdown',
        'scoring_trend',
      ]).describe('Type of analytics query to run'),
      person_id: z.string().optional().describe('Person ID (required for scoring_trend)'),
      time_range_start: z.string().optional().describe('Start of time range (ISO 8601)'),
      time_range_end: z.string().optional().describe('End of time range (ISO 8601)'),
      limit: z.number().min(1).max(100).default(20).optional().describe('Max results for scoring_trend'),
    },
    withAuditLog('healthcare_analytics', withRateLimit('healthcare_analytics', async ({ query_type, person_id, time_range_start, time_range_end, limit }) => {
      try {
        const tenant = getCurrentTenant();
        const timeRange = (time_range_start && time_range_end)
          ? { start: time_range_start, end: time_range_end }
          : undefined;

        let result: unknown;
        switch (query_type) {
          case 'lead_funnel':
            result = await leadFunnel(tenant.tenantId, timeRange);
            break;
          case 'scoring_distribution':
            result = await scoringDistribution(tenant.tenantId, timeRange);
            break;
          case 'enrichment_coverage':
            result = await enrichmentCoverage(tenant.tenantId);
            break;
          case 'touchpoint_analysis':
            result = await touchpointAnalysis(tenant.tenantId, timeRange);
            break;
          case 'vertical_breakdown':
            result = await verticalBreakdown(tenant.tenantId);
            break;
          case 'scoring_trend':
            if (!person_id) {
              return { content: [{ type: 'text' as const, text: 'Error: person_id required for scoring_trend' }], isError: true };
            }
            result = await scoringTrend(tenant.tenantId, person_id, limit);
            break;
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }))
  );

  // =========================================================================
  // HEALTH CHECK TOOL
  // =========================================================================

  server.tool(
    'health_check',
    'Check connectivity to configured external services (Structify, Exa, Clay, GCS).',
    {},
    withAuditLog('health_check', withRateLimit('health_check', async () => {
      // Tenant context is optional for health check (allow unauthenticated diagnostics)
      let tenantId = 'unknown';
      try { tenantId = getCurrentTenant().tenantId; } catch { /* ok */ }

      /**
       * Probe a service and measure latency.
       */
      async function probe(name: string, fn: () => Promise<boolean | void>): Promise<{ healthy: boolean; latency_ms: number; last_error?: string }> {
        const start = Date.now();
        try {
          const result = await fn();
          return { healthy: result !== false, latency_ms: Date.now() - start };
        } catch (error) {
          return {
            healthy: false,
            latency_ms: Date.now() - start,
            last_error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      // Probe all services with latency measurement
      const [anthropic, firestore, exa, clay, gcs] = await Promise.all([
        probe('anthropic', async () => { await getAnthropic(); }),
        probe('firestore', async () => { return await getFirestore().healthCheck(); }),
        probe('exa', async () => { await getExa(); }),
        probe('clay', async () => { const c = await getClay(); return await c.healthCheck(); }),
        probe('gcs', async () => { await getCloudStorage(); }),
      ]);

      const services = { anthropic, firestore, exa, clay, gcs };

      // Resilience status from connector registry (circuit breakers, bulkheads)
      const resilience: Record<string, unknown> = {};
      for (const status of connectorRegistry.getAllStatuses()) {
        resilience[status.name] = {
          circuitState: status.circuitState,
          healthy: status.healthy,
          bulkheadAvailable: status.bulkheadAvailable,
          ...(status.lastError ? { lastError: status.lastError, lastErrorAt: status.lastErrorAt } : {}),
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            server: 'togari-healthcare',
            version: '1.0.0',
            status: getSystemStatus(),
            tenant: tenantId,
            services,
            resilience,
            capabilities: getCapabilities(),
          }, null, 2),
        }],
      };
    }))
  );

  process.stderr.write(
    'Registered tools: search_patients, enrich_contact, enrich_company, ' +
    'upload_file, process_file, score_lead, create_patient, get_patient, ' +
    'update_patient, query_data, normalize_data, search_web, healthcare_analytics, health_check\n'
  );
}

// ---------------------------------------------------------------------------
// Server Creation
// ---------------------------------------------------------------------------

function createServer(): McpServer {
  const server = new McpServer({
    name: 'togari-healthcare',
    version: '1.0.0',
  });

  registerTools(server);

  return server;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Initialize connector resilience policies (cockatiel: timeout, retry, circuit breaker, bulkhead)
  connectorRegistry.register('anthropic');
  connectorRegistry.register('exa');
  connectorRegistry.register('clay');
  connectorRegistry.register('structify');
  connectorRegistry.register('firestore');
  connectorRegistry.register('gcs');

  // Initialize Redis for rate limiting (non-blocking — falls back to in-memory)
  const redisUrl = await getOptionalSecret('redis-url');
  if (redisUrl) {
    await initRedis(redisUrl);
  }

  const port = process.env.PORT;

  if (port) {
    // =========================================================================
    // HTTP mode — Streamable HTTP (stateless for Cloud Run)
    // =========================================================================
    const app = express();

    // JSON body parsing for Streamable HTTP
    app.use(express.json());

    // CORS
    app.use((_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, x-api-key, Content-Type, Mcp-Session-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      next();
    });

    app.options('*', (_req, res) => {
      res.status(204).end();
    });

    // Health check — unauthenticated
    app.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        service: 'togari-healthcare',
        version: '1.0.0',
        transport: 'streamable-http',
        tools: 14,
      });
    });

    // Detailed status endpoint — unauthenticated, returns degraded/healthy/critical
    app.get('/api/status', (_req, res) => {
      const capabilities = getCapabilities();
      const status = getSystemStatus();
      const services: Record<string, unknown> = {};
      for (const s of connectorRegistry.getAllStatuses()) {
        services[s.name] = {
          healthy: s.healthy,
          circuitState: s.circuitState,
          ...(s.lastError ? { lastError: s.lastError } : {}),
        };
      }
      res.json({ status, capabilities, services });
    });

    // Auth0 JWT middleware (applied to /mcp route only)
    const authDomain = await getOptionalSecret('auth0-domain');
    const authAudience = await getOptionalSecret('auth0-audience');
    const authMiddleware = (authDomain && authAudience)
      ? createAuthMiddleware(authDomain, authAudience)
      : [
          // Dev fallback: no Auth0 configured, use TENANT_ID from env
          (req: express.Request, _res: express.Response, next: express.NextFunction) => {
            const ctx = createStdioTenantContext();
            tenantStorage.run(ctx, () => next());
          },
        ];

    // Streamable HTTP transport — stateless (no sticky sessions on Cloud Run)
    app.post('/mcp', ...authMiddleware, async (req, res) => {
      try {
        // Read the tenant context set by auth middleware (Auth0 JWT or dev fallback)
        const tenantCtx = tenantStorage.getStore();
        if (!tenantCtx) {
          res.status(401).json({ error: 'No tenant context — authentication required' });
          return;
        }

        const server = createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // Stateless — critical for Cloud Run
        });
        await server.connect(transport);

        // Re-wrap in tenant context so AsyncLocalStorage propagates into
        // the MCP SDK's internal async execution (tool handlers)
        await tenantStorage.run(tenantCtx, async () => {
          await transport.handleRequest(req, res);
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error('MCP request failed', { error: msg });
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // Handle GET and DELETE on /mcp for SSE streaming and session cleanup
    app.get('/mcp', (_req, res) => {
      res.status(405).json({ error: 'Method not allowed. Use POST for Streamable HTTP.' });
    });

    app.delete('/mcp', (_req, res) => {
      // Stateless mode — no sessions to clean up
      res.status(200).json({ ok: true });
    });

    // Sentry Express error handler (must be after all routes)
    if (Sentry && typeof Sentry.setupExpressErrorHandler === 'function') {
      Sentry.setupExpressErrorHandler(app);
    }

    app.listen(Number(port), () => {
      process.stderr.write(
        `Togari Healthcare MCP Server listening on port ${port} (Streamable HTTP, stateless)\n` +
        `Health: http://localhost:${port}/health\n` +
        `Status: http://localhost:${port}/api/status\n` +
        `MCP:    POST http://localhost:${port}/mcp\n`
      );
    });
  } else {
    // =========================================================================
    // stdio mode — Claude Desktop / local dev
    // =========================================================================
    const stdioCtx = createStdioTenantContext();
    process.stderr.write(`STDIO TENANT CONTEXT CREATED: ${JSON.stringify(stdioCtx)}\n`);
    const server = createServer();
    const transport = new StdioServerTransport();

    // enterWith() binds the tenant context to the current async execution
    // resource. However, the MCP SDK's StdioServerTransport may dispatch tool
    // handlers in async contexts that don't inherit AsyncLocalStorage stores.
    // setStdioFallback() provides a module-level fallback that getCurrentTenant()
    // checks when getStore() returns undefined. Belt-and-suspenders approach.
    tenantStorage.enterWith(stdioCtx);
    setStdioFallback(stdioCtx);
    await server.connect(transport);
  }
}

main().catch((error) => {
  process.stderr.write(`Fatal error starting Togari Healthcare MCP Server: ${error}\n`);
  process.exit(1);
});
