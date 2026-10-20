import { z } from 'zod';
import { LeadSchema } from './lead';

/**
 * Token usage schema for tracking API token consumption
 */
const TokenUsageSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
});

/**
 * Normalization result schema
 */
export const NormalizationResultSchema = z.object({
  data: LeadSchema,
  confidence: z.number()
    .min(0, 'Confidence must be at least 0')
    .max(1, 'Confidence cannot exceed 1'),
  issues: z.array(z.string()).default([]),
  model: z.string(),
  tokensUsed: TokenUsageSchema,
});

/**
 * Search result schema
 */
export const SearchResultSchema = z.object({
  query: z.string(),
  results: z.array(LeadSchema),
  sources: z.array(z.string().url('Invalid source URL')),
  totalFound: z.number()
    .int()
    .nonnegative('Total found must be a non-negative integer'),
});

/**
 * Structify extraction request schema
 */
export const StructifyExtractionRequestSchema = z.object({
  source: z.enum(['file', 'url', 'text']),
  content: z.string(),  // base64 for files, URL string, or raw text
  contentType: z.string().optional(),  // mime type for files
  schema: z.record(z.unknown()).optional(),  // target schema hint
  options: z.object({
    includeConfidence: z.boolean().default(true),
    language: z.string().default('en'),
  }).optional(),
});

/**
 * Structify extraction result schema
 */
export const StructifyExtractionResultSchema = z.object({
  id: z.string(),
  status: z.enum(['completed', 'failed', 'partial']),
  data: z.array(z.record(z.unknown())),  // extracted records
  confidence: z.number().optional(),
  metadata: z.object({
    rowCount: z.number(),
    columnCount: z.number(),
    processingTimeMs: z.number(),
  }).optional(),
  errors: z.array(z.object({
    row: z.number().optional(),
    field: z.string().optional(),
    message: z.string(),
  })).optional(),
});

/**
 * Cloud Storage file schema
 */
export const CloudStorageFileSchema = z.object({
  id: z.string(),
  bucket: z.string(),
  path: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  size: z.number(),
  uploadedBy: z.string(),
  uploadedAt: z.date(),
  url: z.string(),  // gs:// URL
  publicUrl: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

/**
 * Processed result schema
 */
export const ProcessedResultSchema = z.object({
  fileId: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  rawFileUrl: z.string(),
  structuredData: z.array(z.record(z.unknown())).optional(),
  enrichedData: z.array(z.record(z.unknown())).optional(),
  resultFileUrl: z.string().optional(),  // URL to JSON results in Cloud Storage
  processingSteps: z.array(z.object({
    step: z.string(),
    status: z.enum(['pending', 'completed', 'failed']),
    timestamp: z.date(),
    error: z.string().optional(),
  })),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Export TypeScript types
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type NormalizationResult = z.infer<typeof NormalizationResultSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type StructifyExtractionRequest = z.infer<typeof StructifyExtractionRequestSchema>;
export type StructifyExtractionResult = z.infer<typeof StructifyExtractionResultSchema>;
export type CloudStorageFile = z.infer<typeof CloudStorageFileSchema>;
export type ProcessedResult = z.infer<typeof ProcessedResultSchema>;
