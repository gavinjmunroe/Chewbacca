/**
 * @togari/bma-content/schemas/opportunity-engine
 * Zod schemas for Opportunity Engine V2: Signal Subscriptions + One-Time Data Pulls
 */

import { z } from 'zod';

// Re-export schemas from the agent types module for central access
export {
  monitorFrequencySchema,
  dataPullStatusSchema,
  contactSourceSchema,
  contactMatchSchema,
  exaResultSchema,
  signalResultSchema,
  structuredContactSchema,
  dataPullRequestSchema,
  dataPullResultSchema,
} from '../agents/opportunity-notifications/types';
