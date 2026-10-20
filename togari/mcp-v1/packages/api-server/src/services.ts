/**
 * @togari/api-server/services
 * Service initialization and dependency injection
 */

import {
  config,
  logger,
  CloudStorageClient,
  StructifyClient,
  ExaClient,
  AnthropicClient,
  ClayClient,
  DataProcessor,
  ScoringService,
  createUploadPipeline,
  type UploadPipeline,
} from '@natural-language-mcp/core';

/**
 * All services available to the API
 */
export interface Services {
  cloudStorage: CloudStorageClient;
  structify: StructifyClient;
  exa: ExaClient | null;
  clay: ClayClient | null;
  anthropic: AnthropicClient;
  dataProcessor: DataProcessor | null;
  uploadPipeline: UploadPipeline;
  scoring: ScoringService;
}

/**
 * Initialize all services with configuration
 */
export function initializeServices(): Services {
  logger.info('Initializing Cloud Storage client...');
  const cloudStorage = new CloudStorageClient(
    config.gcp.projectId,
    config.gcp.storageBucket
  );

  logger.info('Initializing Structify client...');
  const structify = new StructifyClient({
    apiKey: config.structify.apiKey,
    baseUrl: config.structify.baseUrl,
    datasetId: config.structify.datasetId,
  });

  logger.info('Initializing Anthropic client...');
  const anthropic = new AnthropicClient(config.anthropic.apiKey);

  // Exa is optional
  let exa: ExaClient | null = null;
  if (config.exa.apiKey) {
    logger.info('Initializing Exa client...');
    exa = new ExaClient(config.exa.apiKey, anthropic);
  } else {
    logger.warn('Exa API key not configured, Exa enrichment disabled');
  }

  // Clay is optional
  let clay: ClayClient | null = null;
  if (config.clay.apiKey) {
    logger.info('Initializing Clay client...');
    clay = new ClayClient({
      apiKey: config.clay.apiKey,
      baseUrl: config.clay.baseUrl,
      tableId: config.clay.tableId,
    });
  } else {
    logger.warn('Clay API key not configured, Clay enrichment disabled');
  }

  // DataProcessor requires ExaClient - only create if Exa is available
  // Note: dataProcessor may be null if Exa is not configured
  logger.info('Initializing Data Processor...');
  const dataProcessor = exa
    ? new DataProcessor(cloudStorage, structify, exa)
    : null;

  logger.info('Initializing Upload Pipeline...');
  const uploadPipeline = createUploadPipeline(anthropic);

  logger.info('Initializing Scoring Service...');
  const scoring = new ScoringService();

  logger.info('All services initialized successfully');

  return {
    cloudStorage,
    structify,
    exa,
    clay,
    anthropic,
    dataProcessor,
    uploadPipeline,
    scoring,
  };
}
