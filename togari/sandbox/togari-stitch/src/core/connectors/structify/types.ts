export interface StructifyConfig {
  apiKey: string;
  baseUrl: string;
  datasetId?: string;
}

export interface ExtractionRequest {
  source: 'file' | 'url' | 'text';
  content: string; // base64 for files, URL, or raw text
  contentType?: string; // mime type
  targetSchema?: Record<string, unknown>; // hint for expected structure
  options?: {
    includeConfidence?: boolean;
    language?: string;
    extractionMode?: 'table' | 'document' | 'auto';
  };
}

export interface ExtractedRecord {
  index: number;
  data: Record<string, unknown>;
  confidence?: number;
  source?: {
    row?: number;
    page?: number;
  };
}

export interface ExtractionResult {
  id: string;
  status: 'completed' | 'failed' | 'partial';
  records: ExtractedRecord[];
  totalRecords: number;
  metadata: {
    sourceType: string;
    processingTimeMs: number;
    extractionMode: string;
  };
  errors?: Array<{
    code: string;
    message: string;
    row?: number;
    field?: string;
  }>;
}

export interface StructifyError {
  code: string;
  message: string;
  details?: unknown;
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Query filter operators
 */
export type FilterOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';

/**
 * Query filter
 */
export interface QueryFilter {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

/**
 * Query options for list operations
 */
export interface QueryOptions {
  filters?: QueryFilter[];
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
  clientId?: string;
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// ============================================================================
// ENTITY TYPES (for Structify storage)
// ============================================================================

/**
 * Structify entity types
 */
export type EntityType = 'person' | 'company' | 'campaign' | 'touchpoint' | 'relationship';

/**
 * Generic entity response
 */
export interface EntityResponse<T> {
  id: string;
  type: EntityType;
  data: T;
  createdAt: string;
  updatedAt: string;
}

/**
 * Batch operation result
 */
export interface BatchOperationResult {
  total: number;
  successful: number;
  failed: number;
  errors: Array<{
    id: string;
    error: string;
  }>;
}
