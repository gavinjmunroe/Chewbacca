/**
 * @togari/core/schemas/relationship
 * Zod schemas for Relationship entity
 */

import { z } from 'zod';

// ============================================================================
// ENUM SCHEMAS
// ============================================================================

export const relationshipTypeSchema = z.enum([
  'colleague',
  'manager',
  'direct_report',
  'peer',
  'external_contact',
  'referral',
]);

// ============================================================================
// RELATIONSHIP SCHEMA
// ============================================================================

export const relationshipSchema = z.object({
  relationshipId: z.string(),
  personAId: z.string(),
  personBId: z.string(),

  // Connection details
  relationshipType: relationshipTypeSchema,
  strength: z.number().min(0).max(100).default(50),
  context: z.string().optional(),

  // Tracking
  interactionCount: z.number().default(0),
  lastInteractionAt: z.date().optional(),

  // Multi-tenant
  client_id: z.string().min(1).describe('Auth0 Organization ID for tenant isolation'),

  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date(),
});

// ============================================================================
// INPUT SCHEMAS
// ============================================================================

export const createRelationshipSchema = z.object({
  personAId: z.string(),
  personBId: z.string(),
  relationshipType: relationshipTypeSchema,
  client_id: z.string().min(1).describe('Auth0 Organization ID for tenant isolation'),

  // Optional fields
  strength: z.number().min(0).max(100).optional(),
  context: z.string().optional(),
});

export const updateRelationshipSchema = createRelationshipSchema.partial().extend({
  interactionCount: z.number().optional(),
  lastInteractionAt: z.date().optional(),
});

// ============================================================================
// TYPES
// ============================================================================

export type RelationshipInput = z.input<typeof relationshipSchema>;
export type RelationshipOutput = z.output<typeof relationshipSchema>;
export type CreateRelationshipInput = z.infer<typeof createRelationshipSchema>;
export type UpdateRelationshipInput = z.infer<typeof updateRelationshipSchema>;
