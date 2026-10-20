/**
 * @togari/admin — Connector Ontology
 *
 * Centralized definitions for ALL external connectors in the Togari ecosystem.
 * Product repos import this to configure their connector instances.
 */

import { type SecretName } from '../secrets/known-secrets';

export interface ConnectorDefinition {
  id: string;
  displayName: string;
  baseUrl: string;
  authMethod: 'api-key-header' | 'bearer-token' | 'service-account' | 'oauth2';
  authHeaderName?: string;
  secretName: SecretName;
  rateLimits: {
    requestsPerMinute: number;
    requestsPerDay?: number;
    concurrentRequests?: number;
  };
  resilienceProfile: string;
  healthCheckPath?: string;
  docsUrl?: string;
}

export const CONNECTORS: Record<string, ConnectorDefinition> = {
  anthropic: {
    id: 'anthropic',
    displayName: 'Anthropic Claude API',
    baseUrl: 'https://api.anthropic.com',
    authMethod: 'api-key-header',
    authHeaderName: 'x-api-key',
    secretName: 'anthropicApiKey',
    rateLimits: { requestsPerMinute: 900, concurrentRequests: 50 },
    resilienceProfile: 'anthropic',
    healthCheckPath: '/v1/messages',
    docsUrl: 'https://docs.anthropic.com',
  },
  exa: {
    id: 'exa',
    displayName: 'Exa Search API',
    baseUrl: 'https://api.exa.ai',
    authMethod: 'api-key-header',
    authHeaderName: 'x-api-key',
    secretName: 'exaApiKey',
    rateLimits: { requestsPerMinute: 400, requestsPerDay: 10000 },
    resilienceProfile: 'exa',
    docsUrl: 'https://docs.exa.ai',
  },
  clay: {
    id: 'clay',
    displayName: 'Clay API',
    baseUrl: 'https://api.clay.com',
    authMethod: 'bearer-token',
    secretName: 'clayApiKey',
    rateLimits: { requestsPerMinute: 200, concurrentRequests: 10 },
    resilienceProfile: 'clay',
    docsUrl: 'https://docs.clay.com',
  },
  structify: {
    id: 'structify',
    displayName: 'Structify API',
    baseUrl: 'https://api.structify.com',
    authMethod: 'api-key-header',
    authHeaderName: 'api_key',
    secretName: 'structifyApiKey',
    rateLimits: { requestsPerMinute: 300, concurrentRequests: 20 },
    resilienceProfile: 'structify',
    docsUrl: 'https://docs.structify.com',
  },
  gcs: {
    id: 'gcs',
    displayName: 'Google Cloud Storage',
    baseUrl: 'https://storage.googleapis.com',
    authMethod: 'service-account',
    secretName: 'gcpServiceAccount',
    rateLimits: { requestsPerMinute: 1000 },
    resilienceProfile: 'gcs',
  },
  bigquery: {
    id: 'bigquery',
    displayName: 'Google BigQuery',
    baseUrl: 'https://bigquery.googleapis.com',
    authMethod: 'service-account',
    secretName: 'gcpServiceAccount',
    rateLimits: { requestsPerMinute: 100, concurrentRequests: 10 },
    resilienceProfile: 'bigquery',
  },
  gmail: {
    id: 'gmail',
    displayName: 'Gmail API',
    baseUrl: 'https://gmail.googleapis.com',
    authMethod: 'oauth2',
    secretName: 'googleOAuthClientId',
    rateLimits: { requestsPerMinute: 250 },
    resilienceProfile: 'gcs',
  },
  fireflies: {
    id: 'fireflies',
    displayName: 'Fireflies.ai API',
    baseUrl: 'https://api.fireflies.ai/graphql',
    authMethod: 'bearer-token',
    secretName: 'firefliesApiKey',
    rateLimits: { requestsPerMinute: 60 },
    resilienceProfile: 'exa',
  },
  loom: {
    id: 'loom',
    displayName: 'Loom API',
    baseUrl: 'https://developer.loom.com',
    authMethod: 'bearer-token',
    secretName: 'loomApiKey',
    rateLimits: { requestsPerMinute: 60 },
    resilienceProfile: 'exa',
  },
  gdrive: {
    id: 'gdrive',
    displayName: 'Google Drive API',
    baseUrl: 'https://www.googleapis.com/drive/v3',
    authMethod: 'oauth2',
    secretName: 'googleOAuthClientId',
    rateLimits: { requestsPerMinute: 300 },
    resilienceProfile: 'gcs',
  },
};

/** Get a connector definition by ID, throws if not found */
export function getConnector(id: string): ConnectorDefinition {
  const connector = CONNECTORS[id];
  if (!connector) throw new Error(`Unknown connector: ${id}. Known: ${Object.keys(CONNECTORS).join(', ')}`);
  return connector;
}

/** List all connector IDs */
export function listConnectorIds(): string[] {
  return Object.keys(CONNECTORS);
}
