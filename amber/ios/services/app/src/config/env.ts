/**
 * Environment configuration with validation
 * Ensures required env vars are set at startup
 *
 * Note: dotenv is loaded in index.ts before this module
 */

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}. Check your .env file.`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] || defaultValue;
}

export const config = {
  // Privy (auth)
  privy: {
    appId: requireEnv('PRIVY_APP_ID'),
    appSecret: requireEnv('PRIVY_APP_SECRET'),
  },

  // Database
  database: {
    url: optionalEnv('DATABASE_URL'),
  },

  // Storage (GCP Cloud Storage)
  storage: {
    bucket: optionalEnv('STORAGE_BUCKET'),
  },

  // INFRA-04: Sentry error tracking
  sentry: {
    dsn: optionalEnv('SENTRY_DSN'),
  },

  // INFRA-04: PostHog analytics
  posthog: {
    apiKey: optionalEnv('POSTHOG_API_KEY'),
    host: optionalEnv('POSTHOG_HOST', 'https://app.posthog.com'),
  },

  // SIGNAL-02: APNs push notifications
  apns: {
    keyId: optionalEnv('APNS_KEY_ID'),
    teamId: optionalEnv('APNS_TEAM_ID'),
    bundleId: optionalEnv('APNS_BUNDLE_ID', 'com.amber.app'),
    privateKey: optionalEnv('APNS_PRIVATE_KEY'), // PEM string from GCP Secret Manager
    sandbox: optionalEnv('APNS_SANDBOX', 'true') === 'true',
  },

  // Server
  server: {
    port: Number(optionalEnv('PORT', '8080')),
    host: optionalEnv('HOST', '0.0.0.0'),
  },

  // Environment
  env: optionalEnv('NODE_ENV', 'development'),
  isDevelopment: optionalEnv('NODE_ENV', 'development') === 'development',
  isProduction: optionalEnv('NODE_ENV', 'development') === 'production',
};

// In production, Privy must be configured
if (config.isProduction) {
  requireEnv('PRIVY_APP_ID');
  requireEnv('PRIVY_APP_SECRET');
  requireEnv('DATABASE_URL');
}
