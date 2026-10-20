import { z } from 'zod';

/**
 * Job status enum
 */
export const JobStatus = z.enum(['pending', 'processing', 'completed', 'failed']);

/**
 * Job type enum
 */
export const JobType = z.enum(['enrichment', 'file_upload', 'batch_normalize']);

/**
 * Job schema with full validation
 */
export const JobSchema = z.object({
  id: z.string(),
  type: JobType,
  status: JobStatus,
  userId: z.string(),
  progress: z.number()
    .min(0, 'Progress must be at least 0')
    .max(100, 'Progress cannot exceed 100'),
  total: z.number()
    .int()
    .nonnegative('Total must be a non-negative integer'),
  completed: z.number()
    .int()
    .nonnegative('Completed must be a non-negative integer'),
  failed: z.number()
    .int()
    .nonnegative('Failed must be a non-negative integer'),
  result: z.unknown().optional(),
  error: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  completedAt: z.date().optional(),
});

// Export TypeScript types
export type JobStatusType = z.infer<typeof JobStatus>;
export type JobTypeType = z.infer<typeof JobType>;
export type Job = z.infer<typeof JobSchema>;
