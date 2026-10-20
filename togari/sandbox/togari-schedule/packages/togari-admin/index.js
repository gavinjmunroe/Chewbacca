'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

// ── Secrets ──────────────────────────────────────────────────────────────────

function getSecret(name) {
  const val = process.env[name.replace(/-/g, '_').toUpperCase()] || process.env[name];
  if (!val) throw new Error(`Secret not found: ${name}`);
  return Promise.resolve(val);
}

function getOptionalSecret(name) {
  const val = process.env[name.replace(/-/g, '_').toUpperCase()] || process.env[name] || undefined;
  return Promise.resolve(val);
}

// ── Tenant context ───────────────────────────────────────────────────────────

const tenantStorage = new AsyncLocalStorage();

let _stdioFallback = null;

function getCurrentTenant() {
  const ctx = tenantStorage.getStore();
  if (ctx) return ctx;
  if (_stdioFallback) return _stdioFallback;
  return { tenantId: process.env.TENANT_ID || 'default', userId: undefined };
}

function checkTenantLimit(_tenantId, _operation) {
  // No-op stub — no rate limiting enforced
}

function setStdioFallback(ctx) {
  _stdioFallback = ctx;
}

function createStdioTenantContext() {
  return { tenantId: process.env.TENANT_ID || 'stdio-default' };
}

// ── Auth middleware ───────────────────────────────────────────────────────────

function createAuthMiddleware(_domain, _audience) {
  // Stub: passes all requests through — replace with real JWT verification in production
  const middleware = (_req, _res, next) => next();
  return [middleware];
}

// ── OAuth handlers ────────────────────────────────────────────────────────────

function oauthProtectedResourceHandler(_req, res) {
  res.status(501).json({ error: 'OAuth not configured' });
}

function oauthDiscoveryHandler(_req, res) {
  res.status(501).json({ error: 'OAuth not configured' });
}

// ── Audit ─────────────────────────────────────────────────────────────────────

function createAuditEntry(operation, tenantId, transport, durationMs, status, error) {
  return { operation, tenantId, transport, durationMs, status, error, timestamp: new Date().toISOString() };
}

function logAudit(entry) {
  process.stderr.write(`[audit] ${entry.operation} tenant=${entry.tenantId} status=${entry.status} ${entry.durationMs}ms\n`);
}

// ── Sentry ────────────────────────────────────────────────────────────────────

function initSentry() {}
function flushSentry() { return Promise.resolve(); }
function captureException(err) {
  process.stderr.write(`[sentry-stub] ${err && err.message ? err.message : String(err)}\n`);
}

// ── Events ────────────────────────────────────────────────────────────────────

function publishEvent(eventName, data) {
  process.stderr.write(`[event] ${eventName} ${JSON.stringify(data)}\n`);
  return Promise.resolve();
}

// ── BigQuery ──────────────────────────────────────────────────────────────────

class BigQueryClient {
  constructor(projectId, credentialsPath, credentialsBase64) {
    this.projectId = projectId;
    this.credentialsPath = credentialsPath;
    this.credentialsBase64 = credentialsBase64;
    this._bq = null;
  }

  _getClient() {
    if (this._bq) return this._bq;

    const { BigQuery } = require('@google-cloud/bigquery');

    const opts = { projectId: this.projectId };

    if (this.credentialsBase64) {
      const json = Buffer.from(this.credentialsBase64, 'base64').toString('utf8');
      opts.credentials = JSON.parse(json);
    } else if (this.credentialsPath) {
      opts.keyFilename = this.credentialsPath;
    }

    this._bq = new BigQuery(opts);
    return this._bq;
  }

  async executeQuery(sql, params) {
    const bq = this._getClient();
    const options = { query: sql, params: params || [] };
    const [rows] = await bq.query(options);
    return rows;
  }
}

// ── SQL Generator ─────────────────────────────────────────────────────────────

class SqlGenerator {
  constructor(anthropicApiKey, projectId, dataset, table, schema) {
    this.anthropicApiKey = anthropicApiKey;
    this.projectId = projectId;
    this.dataset = dataset;
    this.table = table;
    this.schema = schema;
  }

  async generate(naturalLanguageQuery) {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic.default({ apiKey: this.anthropicApiKey });

    const prompt = `You are a BigQuery SQL expert. Generate a valid BigQuery SQL query for the following request.

Table: \`${this.projectId}.${this.dataset}.${this.table}\`

Schema:
${this.schema}

Request: ${naturalLanguageQuery}

Return ONLY the SQL query, no explanation or markdown.`;

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    return msg.content[0].text.trim();
  }
}

// ── Connector policy (resilience) ─────────────────────────────────────────────

function buildConnectorPolicy(options) {
  // Stub: returns a pass-through policy object
  return {
    name: options.name,
    execute: async (fn) => fn(),
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Secrets
  getSecret,
  getOptionalSecret,
  // Tenant
  tenantStorage,
  getCurrentTenant,
  checkTenantLimit,
  setStdioFallback,
  createStdioTenantContext,
  // Auth
  createAuthMiddleware,
  // OAuth
  oauthProtectedResourceHandler,
  oauthDiscoveryHandler,
  // Audit
  createAuditEntry,
  logAudit,
  // Sentry
  initSentry,
  flushSentry,
  captureException,
  // Events
  publishEvent,
  // BigQuery
  BigQueryClient,
  SqlGenerator,
  // Resilience
  buildConnectorPolicy,
};
