/**
 * Environment Variable Validation
 * Validates required environment variables at startup to fail fast
 */

import { createLogger } from '@togari/core';
import { DEFAULT_VALUES } from './constants';

const logger = createLogger('EnvValidation');

interface EnvConfig {
  // Required variables
  PORT: string;
  NODE_ENV: string;

  // Optional but recommended
  STRUCTIFY_API_KEY?: string;
  STRUCTIFY_DATASET_ID?: string;
  GCP_PROJECT_ID?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;

  // Configuration
  API_BASE_URL: string;
  ALLOWED_ORIGINS: string;

  // Optional integrations
  N8N_BASE_URL?: string;
  REDIS_URL?: string;
  AMBER_API_KEY?: string;
}

export function validateEnv(): EnvConfig {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required variables
  const requiredVars = ['NODE_ENV', 'API_BASE_URL'];

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      errors.push(`Missing required environment variable: ${varName}`);
    }
  }

  // Recommended variables
  const recommendedVars = [
    { name: 'STRUCTIFY_API_KEY', desc: 'Required for data enrichment' },
    { name: 'STRUCTIFY_DATASET_ID', desc: 'Required for Structify operations' },
    { name: 'GCP_PROJECT_ID', desc: 'Required for BigQuery integration' },
  ];

  for (const { name, desc } of recommendedVars) {
    if (!process.env[name]) {
      warnings.push(`Missing recommended variable: ${name} - ${desc}`);
    }
  }

  // Log warnings
  if (warnings.length > 0 && process.env.NODE_ENV !== 'test') {
    logger.warn('Configuration warnings detected', {
      warnings,
      message: 'Some features may not work without these variables'
    });
  }

  // Throw errors
  if (errors.length > 0) {
    logger.error('Environment validation failed', undefined, { errors });
    throw new Error('Invalid environment configuration. Check .env file.');
  }

  return {
    PORT: process.env.PORT || String(DEFAULT_VALUES.PORT),
    NODE_ENV: process.env.NODE_ENV!,
    API_BASE_URL: process.env.API_BASE_URL!,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || DEFAULT_VALUES.ALLOWED_ORIGINS,
    STRUCTIFY_API_KEY: process.env.STRUCTIFY_API_KEY,
    STRUCTIFY_DATASET_ID: process.env.STRUCTIFY_DATASET_ID,
    GCP_PROJECT_ID: process.env.GCP_PROJECT_ID,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    N8N_BASE_URL: process.env.N8N_BASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    AMBER_API_KEY: process.env.AMBER_API_KEY,
  };
}
