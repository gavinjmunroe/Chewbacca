export interface FirestoreConfig {
  projectId: string;
  databaseId?: string;
}

// Re-export storage-agnostic query types from structify/types
export type {
  FilterOperator,
  QueryFilter,
  QueryOptions,
  PaginatedResponse,
} from '../structify/types';
