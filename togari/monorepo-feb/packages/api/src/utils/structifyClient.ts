import { StructifyClient } from '@togari/structify';
import { createLogger } from '@togari/core';

const logger = createLogger('StructifyClient');

/**
 * Create Structify client with proper error handling
 * Shared utility to avoid duplicating client creation logic
 *
 * @throws Error if STRUCTIFY_API_KEY or STRUCTIFY_DATASET_ID not configured
 */
export function createStructifyClient(): StructifyClient {
  const apiKey = process.env.STRUCTIFY_API_KEY;
  const datasetId = process.env.STRUCTIFY_DATASET_ID;

  if (!apiKey || !datasetId) {
    logger.error('Structify credentials not configured');
    throw new Error('STRUCTIFY_API_KEY and STRUCTIFY_DATASET_ID must be set');
  }

  return new StructifyClient({ apiKey, datasetId });
}

/**
 * Singleton Structify client instance
 * Reuses the same client across requests for connection pooling
 */
let clientInstance: StructifyClient | null = null;

export function getStructifyClient(): StructifyClient {
  if (!clientInstance) {
    clientInstance = createStructifyClient();
  }
  return clientInstance;
}
