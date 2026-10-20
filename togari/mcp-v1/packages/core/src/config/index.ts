/**
 * Configuration module for loading and validating environment variables
 */

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  gcp: {
    projectId: string;
    storageBucket: string;
  };
  anthropic: {
    apiKey: string;
  };
  exa: {
    apiKey: string;
  };
  structify: {
    apiKey: string;
    baseUrl: string;
    datasetId?: string;
  };
  clay: {
    apiKey: string;
    baseUrl: string;
    tableId?: string;
  };
  redis: {
    url: string;
  };
  amber: {
    apiKey: string;
  };
  n8n: {
    webhookUrl?: string;
  };
}

/**
 * Validates that all required configuration fields are present
 * @throws Error if any required field is missing
 */
function validateConfig(config: Partial<Config>): asserts config is Config {
  const missingFields: string[] = [];

  // Validate environment
  if (!config.env) {
    missingFields.push('NODE_ENV');
  } else if (!['development', 'production', 'test'].includes(config.env)) {
    throw new Error(
      `Invalid NODE_ENV: "${config.env}". Must be one of: development, production, test`
    );
  }

  // Validate GCP configuration
  if (!config.gcp?.projectId) {
    missingFields.push('GCP_PROJECT_ID');
  }
  if (!config.gcp?.storageBucket) {
    missingFields.push('GCP_STORAGE_BUCKET');
  }

  // Validate Anthropic API key
  if (!config.anthropic?.apiKey) {
    missingFields.push('ANTHROPIC_API_KEY');
  }

  // Validate Exa API key (optional - can use Clay instead)
  // if (!config.exa?.apiKey) {
  //   missingFields.push('EXA_API_KEY');
  // }

  // Note: STRUCTIFY_API_KEY is optional for now - will be validated when used
  // Note: CLAY_API_KEY is optional - can use Exa instead
  // Note: AMBER_API_KEY is optional - only needed for Amber webhook

  // Validate Redis URL (optional in development)
  if (config.env === 'production' && !config.redis?.url) {
    missingFields.push('REDIS_URL');
  }

  if (missingFields.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingFields.join(', ')}\n` +
      'Please ensure all required environment variables are set in your .env file.'
    );
  }
}

/**
 * Loads and validates configuration from environment variables
 * @returns Validated configuration object
 * @throws Error if required environment variables are missing or invalid
 */
function loadConfig(): Config {
  const config: Partial<Config> = {
    env: (process.env.NODE_ENV as Config['env']) || 'development',
    port: parseInt(process.env.PORT || '4000', 10),
    gcp: {
      projectId: process.env.GCP_PROJECT_ID || '',
      storageBucket: process.env.GCP_STORAGE_BUCKET || '',
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
    },
    exa: {
      apiKey: process.env.EXA_API_KEY || '',
    },
    structify: {
      apiKey: process.env.STRUCTIFY_API_KEY || '',
      baseUrl: process.env.STRUCTIFY_BASE_URL || 'https://api.structify.com/v1',
      datasetId: process.env.STRUCTIFY_DATASET_ID,
    },
    clay: {
      apiKey: process.env.CLAY_API_KEY || '',
      baseUrl: process.env.CLAY_BASE_URL || 'https://api.clay.com/v1',
      tableId: process.env.CLAY_TABLE_ID,
    },
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    amber: {
      apiKey: process.env.AMBER_API_KEY || '',
    },
    n8n: {
      webhookUrl: process.env.N8N_WEBHOOK_URL,
    },
  };

  validateConfig(config);
  return config;
}

/**
 * Global configuration instance
 * Loaded once when the module is imported
 */
export const config = loadConfig();

// Re-export types and constants from other config modules
export * from './models';
export * from './limits';
