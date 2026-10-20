import { StoredFile } from '../../connectors/gcp';
import { ExtractionResult } from '../../connectors/structify';
import { CompanyEnrichmentResult, ContactEnrichmentResult } from '../../connectors/exa';

export type EntityType = 'company' | 'contact';

export interface ProcessingOptions {
  entityType: EntityType;
  userId: string;
  enrichWithExa?: boolean; // default true
  enrichmentFields?: string[]; // specific fields to enrich, or all if not specified
  saveResults?: boolean; // save final results to Cloud Storage, default true
}

export interface ProcessingStep {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  result?: unknown;
}

export interface ProcessingJob {
  id: string;
  userId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  entityType: EntityType;

  // Input
  rawFile: StoredFile;

  // Processing steps
  steps: ProcessingStep[];

  // Results at each stage
  structuredData?: ExtractionResult;
  enrichedData?: Array<CompanyEnrichmentResult | ContactEnrichmentResult>;

  // Output
  resultFile?: StoredFile; // JSON file with final results

  // Stats
  totalRecords: number;
  successfulRecords: number;
  failedRecords: number;

  // Timing
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface ProcessingResult {
  job: ProcessingJob;
  data: Array<Record<string, unknown>>; // final enriched records
  downloadUrl?: string; // signed URL to download results
}
