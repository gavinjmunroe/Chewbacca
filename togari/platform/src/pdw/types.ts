/**
 * @togari/admin — Personal Data Warehouse types
 *
 * Interfaces matching the BigQuery togari_pdw schema for 360-degree
 * relationship mapping across Gmail, Fireflies, Google Drive, and Loom.
 */

// ---------------------------------------------------------------------------
// Enums / union types
// ---------------------------------------------------------------------------

export type IngestSource = 'gmail' | 'fireflies' | 'gdrive' | 'loom';

export type PdwChannel =
  | 'gmail'
  | 'fireflies'
  | 'gdrive'
  | 'loom'
  | 'slack'
  | 'linkedin'
  | 'manual';

export type Direction = 'inbound' | 'outbound' | 'bilateral';

export type PdwInteractionType =
  | 'email'
  | 'meeting'
  | 'document_share'
  | 'video'
  | 'call'
  | 'message';

export type RelationshipType =
  | 'colleague'
  | 'prospect'
  | 'partner'
  | 'friend'
  | 'vendor'
  | 'advisor';

export type IngestionStatus = 'running' | 'completed' | 'failed' | 'partial';

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

export interface Person {
  person_id: string;             // SHA-256 of primary email
  owner_id: string;              // e.g. "sagar"
  full_name: string | null;
  email_addresses: string[];
  phone_numbers: string[];
  linkedin_url: string | null;
  company: string | null;
  title: string | null;
  relationship_score: number | null; // 0-100
  last_interaction_at: string | null; // ISO timestamp
  first_interaction_at: string | null;
  interaction_count: number;
  tags: string[];
  metadata: Record<string, unknown> | null;
  created_at: string;            // ISO timestamp
  updated_at: string;
}

export interface Interaction {
  interaction_id: string;
  owner_id: string;
  person_id: string;             // FK to persons
  counterparty_person_ids: string[];
  channel: PdwChannel;
  direction: Direction;
  interaction_type: PdwInteractionType;
  subject: string | null;
  summary: string | null;        // AI-generated
  raw_content_gcs_uri: string | null;
  sentiment: number | null;      // -1 to 1
  topics: string[];
  action_items: string[];
  duration_seconds: number | null;
  participants: string[];
  source_id: string;             // original ID from source system
  source_metadata: Record<string, unknown> | null;
  occurred_at: string;           // ISO timestamp
  ingested_at: string;
}

export interface Relationship {
  relationship_id: string;
  owner_id: string;
  person_a_id: string;
  person_b_id: string;
  relationship_type: RelationshipType | null;
  strength_score: number | null; // 0-100
  total_interactions: number;
  last_interaction_at: string | null;
  first_interaction_at: string | null;
  shared_topics: string[];
  context_summary: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface IngestionRun {
  run_id: string;
  owner_id: string;
  source: IngestSource;
  status: IngestionStatus;
  records_processed: number;
  records_failed: number;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  watermark: string | null;      // last processed ID/timestamp for incremental sync
}

// ---------------------------------------------------------------------------
// Ingest configuration per source
// ---------------------------------------------------------------------------

export interface GmailIngestConfig {
  source: 'gmail';
  /** OAuth2 credentials for Gmail API */
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  /** Optional label filter (e.g. "INBOX") */
  labelFilter?: string;
  /** Max messages per fetch batch */
  maxResults?: number;
}

export interface FirefliesIngestConfig {
  source: 'fireflies';
  /** Fireflies API key */
  apiKey: string;
  /** Fireflies GraphQL endpoint (default: https://api.fireflies.ai/graphql) */
  endpoint?: string;
  /** Max transcripts per fetch */
  maxResults?: number;
}

export interface GDriveIngestConfig {
  source: 'gdrive';
  /** OAuth2 credentials for Drive API */
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  /** Whether to export Google Docs as plain text */
  exportContent?: boolean;
  /** Max files per fetch batch */
  maxResults?: number;
}

export interface LoomIngestConfig {
  source: 'loom';
  /** Loom Developer API key / bearer token */
  apiKey: string;
  /** Loom API base URL (default: https://developer.loom.com/v1) */
  baseUrl?: string;
  /** Max recordings per fetch */
  maxResults?: number;
}

export type IngestConfig =
  | GmailIngestConfig
  | FirefliesIngestConfig
  | GDriveIngestConfig
  | LoomIngestConfig;

// ---------------------------------------------------------------------------
// Person resolution (dedup)
// ---------------------------------------------------------------------------

export interface PersonResolution {
  /** Lowercase email that was resolved */
  email: string;
  /** The person_id (SHA-256 of primary email) this email maps to */
  person_id: string;
  /** Whether this was a newly created person or matched to existing */
  is_new: boolean;
}

// ---------------------------------------------------------------------------
// Raw record (source-agnostic wrapper)
// ---------------------------------------------------------------------------

export interface RawRecord {
  source_id: string;
  source: IngestSource;
  raw_data: Record<string, unknown>;
  fetched_at: string; // ISO timestamp
}

// ---------------------------------------------------------------------------
// Ingest run summary
// ---------------------------------------------------------------------------

export interface IngestRunSummary {
  run_id: string;
  source: IngestSource;
  status: IngestionStatus;
  records_processed: number;
  records_failed: number;
  new_persons: number;
  updated_persons: number;
  new_interactions: number;
  duration_ms: number;
  watermark: string | null;
}
