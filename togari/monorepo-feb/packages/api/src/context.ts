import { inferAsyncReturnType } from '@trpc/server';
import { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { StructifyClient, MockStructifyClient } from '@togari/structify';
import { createLogger } from '@togari/core';

const logger = createLogger('Context');

/**
 * Create context for tRPC requests
 * This runs on every request and provides auth info + clients
 *
 * FUTURE: Will integrate with Amber ID for authentication
 * For now, using dev organization ID for testing
 */
export async function createContext({ req, res }: CreateExpressContextOptions) {
  // TODO: Replace with Amber ID authentication
  // For now, use dev defaults to allow testing
  const userId = 'dev_user';
  const organizationId = 'dev_org';

  // Initialize Structify client (use mock if enabled)
  const useMock = process.env.USE_MOCK_STRUCTIFY === 'true';

  let structify;
  if (useMock) {
    logger.warn('Using Mock Structify Client (development mode)');
    structify = new MockStructifyClient();
  } else {
    const apiKey = process.env.STRUCTIFY_API_KEY;
    const datasetId = process.env.STRUCTIFY_DATASET_ID;

    if (!apiKey || !datasetId) {
      logger.error('Structify credentials not configured', undefined, { apiKey: !!apiKey, datasetId: !!datasetId });
      throw new Error('STRUCTIFY_API_KEY and STRUCTIFY_DATASET_ID must be set');
    }

    structify = new StructifyClient({ apiKey, datasetId });
  }

  return {
    userId,
    organizationId,
    structify,
    req,
    res,
  };
}

export type Context = inferAsyncReturnType<typeof createContext>;
