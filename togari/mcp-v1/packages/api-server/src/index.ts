/**
 * @togari/api-server
 * Main entry point for the Togari REST API Server
 */

import 'dotenv/config';
import { createApp } from './app';
import { initializeServices } from './services';
import {
  config,
  logger,
} from '@natural-language-mcp/core';

async function main() {
  try {
    logger.info('Starting Togari API Server...');
    logger.info('Loading configuration...', { env: config.env });

    // Initialize all services
    logger.info('Initializing services...');
    const services = initializeServices();

    // Create Express app with services
    const app = createApp(services);

    // Start server
    const port = config.port;
    app.listen(port, () => {
      logger.info(`Togari API Server is running`, { port });
      logger.info('Available endpoints:', {
        health: `http://localhost:${port}/health`,
        api: `http://localhost:${port}/api/v1`,
        webhooks: `http://localhost:${port}/api/v1/webhooks`,
        amber: `http://localhost:${port}/api/v1/amber`,
      });
    });
  } catch (error) {
    logger.error('Failed to start API server', error as Error);
    process.exit(1);
  }
}

main();

// Export types for external use
export type { Services } from './services';
