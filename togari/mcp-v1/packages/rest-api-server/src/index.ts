import {
  config,
  logger,
  CloudStorageClient,
  StructifyClient,
  ExaClient,
  AnthropicClient,
  DataProcessor,
  createUploadPipeline,
} from '@natural-language-mcp/core';
import { createApiServer } from './api';
import { ToolServices } from './tools/handlers';
import { Server } from 'http';

async function main(): Promise<void> {
  let server: Server | null = null;

  try {
    logger.info('Starting Natural Language Processing API Server...');

    // Validate config loads
    logger.info('Loading configuration...', { env: config.env });

    // Initialize connectors
    logger.info('Initializing connectors...');

    const cloudStorage = new CloudStorageClient(
      config.gcp.projectId,
      config.gcp.storageBucket
    );

    const structify = new StructifyClient({
      apiKey: config.structify.apiKey,
      baseUrl: config.structify.baseUrl,
    });

    const anthropic = new AnthropicClient(config.anthropic.apiKey);

    const exa = new ExaClient(config.exa.apiKey, anthropic);

    // Initialize services
    logger.info('Initializing services...');

    const dataProcessor = new DataProcessor(cloudStorage, structify, exa);

    const uploadPipeline = createUploadPipeline(anthropic);

    // Create services object
    const services: ToolServices = {
      cloudStorage,
      structify,
      exa,
      dataProcessor,
      uploadPipeline,
    };

    // Get port from environment
    const port = parseInt(process.env.API_PORT || '3000', 10);

    // Create and start API server
    logger.info('Creating API server...');
    server = await createApiServer(services, port);

    logger.info('API Server is ready and accepting requests', {
      port,
      healthCheck: `http://localhost:${port}/api/health`,
    });

    // Graceful shutdown handlers
    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`Received ${signal}, shutting down gracefully...`);

      if (server) {
        server.close((err) => {
          if (err) {
            logger.error('Error during server shutdown', err);
            process.exit(1);
          }
          logger.info('Server closed successfully');
          process.exit(0);
        });

        // Force close after 10 seconds
        setTimeout(() => {
          logger.warn('Forcing shutdown after timeout');
          process.exit(1);
        }, 10000);
      } else {
        process.exit(0);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    logger.error('Failed to start API server', error as Error);
    process.exit(1);
  }
}

main();
