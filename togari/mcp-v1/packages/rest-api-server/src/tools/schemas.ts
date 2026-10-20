import { z } from 'zod';

// Upload and process a file
export const ProcessFileInput = z.object({
  content: z.string().describe('File content as base64 encoded string'),
  fileName: z.string().describe('Original file name with extension'),
  mimeType: z.string().describe('MIME type of the file (e.g., text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)'),
  entityType: z.enum(['company', 'contact']).describe('Type of entities in the file'),
  enrichWithExa: z.boolean().default(true).describe('Whether to enrich data using Exa web search'),
});
export type ProcessFileParams = z.infer<typeof ProcessFileInput>;

// Search for entities
export const SearchEntitiesInput = z.object({
  query: z.string().describe('Natural language search query'),
  entityType: z.enum(['company', 'contact']).describe('Type of entity to search for'),
  limit: z.number().default(10).describe('Maximum number of results'),
  filters: z.object({
    location: z.string().optional(),
    industry: z.string().optional(),
  }).optional(),
});
export type SearchEntitiesParams = z.infer<typeof SearchEntitiesInput>;

// Enrich a single entity
export const EnrichEntityInput = z.object({
  identifier: z.string().describe('Domain for companies, email or LinkedIn URL for contacts'),
  entityType: z.enum(['company', 'contact']).describe('Type of entity to enrich'),
});
export type EnrichEntityParams = z.infer<typeof EnrichEntityInput>;

// Get job status
export const GetJobStatusInput = z.object({
  jobId: z.string().describe('The job ID returned from process_file'),
});
export type GetJobStatusParams = z.infer<typeof GetJobStatusInput>;

// Download results
export const DownloadResultsInput = z.object({
  jobId: z.string().describe('The job ID to download results for'),
});
export type DownloadResultsParams = z.infer<typeof DownloadResultsInput>;

// Preview file (parse and show column mapping without processing)
export const PreviewFileInput = z.object({
  content: z.string().describe('File content as base64 or raw text'),
  fileName: z.string(),
  mimeType: z.string(),
  entityType: z.enum(['company', 'contact']),
});
export type PreviewFileParams = z.infer<typeof PreviewFileInput>;

export {
  ProcessFileInput as processFileSchema,
  SearchEntitiesInput as searchEntitiesSchema,
  EnrichEntityInput as enrichEntitySchema,
  GetJobStatusInput as getJobStatusSchema,
  DownloadResultsInput as downloadResultsSchema,
  PreviewFileInput as previewFileSchema,
};
