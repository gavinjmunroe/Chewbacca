/**
 * @togari/core
 * Core configuration and shared utilities for the Togari API Server
 * Healthcare-focused data integration and enrichment platform
 */

// Configuration
export * from './config';

// Type definitions (these are the runtime-free interfaces)
export type {
  Vertical,
  RoutingTier,
  SourceType,
  SourceChannel,
  LeadStatus,
  Persona,
  CompanyTier,
  CampaignType,
  CampaignStatus,
  TouchpointType,
  TouchpointSentiment,
  RelationshipType,
  Location,
  LinkedInExperience,
  CompanyData,
  LeadScoring,
  Person,
  Company,
  Campaign,
  Touchpoint,
  Relationship,
  CreatePersonInput,
  UpdatePersonInput,
  CreateCompanyInput,
  CreateCampaignInput,
  CreateTouchpointInput,
  CreateRelationshipInput,
  AmberSubmission,
  EnrichmentSource,
  EnrichmentResult,
  ClayEnrichmentData,
  ScoringUpdate,
  InternalScoringFactors,
  ExternalScoringFactors,
} from './types';

// Constants (scoring, healthcare-specific)
export * from './constants';

// Zod schemas (runtime validators)
export {
  // Enum schemas
  verticalSchema,
  routingTierSchema,
  sourceTypeSchema,
  sourceChannelSchema,
  leadStatusSchema,
  personaSchema,
  companyTierSchema,
  campaignTypeSchema,
  campaignStatusSchema,
  touchpointTypeSchema,
  touchpointSentimentSchema,
  touchpointDirectionSchema,
  relationshipTypeSchema,
  // Entity schemas
  linkedInExperienceSchema,
  companyDataSchema,
  personSchema,
  createPersonSchema,
  updatePersonSchema,
  amberSubmissionSchema,
  companySchema,
  createCompanySchema,
  updateCompanySchema,
  campaignSchema,
  createCampaignSchema,
  updateCampaignSchema,
  touchpointSchema,
  createTouchpointSchema,
  updateTouchpointSchema,
  relationshipSchema,
  createRelationshipSchema,
  updateRelationshipSchema,
  // Legacy schemas (backward compatibility)
  CompanySchema,
  ContactSchema,
  LeadSchema,
  StoredLeadSchema,
  // Job schemas
  JobStatus,
  JobType,
  JobSchema,
  // API response schemas
  NormalizationResultSchema,
  SearchResultSchema,
  StructifyExtractionRequestSchema,
  StructifyExtractionResultSchema,
  CloudStorageFileSchema,
  ProcessedResultSchema,
} from './schemas';

// Schema types (inferred from Zod)
export type {
  PersonInput,
  PersonOutput,
  CompanyInput,
  CompanyOutput,
  CampaignInput,
  CampaignOutput,
  TouchpointInput,
  TouchpointOutput,
  RelationshipInput,
  RelationshipOutput,
  // Legacy types
  Contact,
  Lead,
  StoredLead,
  Enrichment,
  // Job types
  JobStatusType,
  JobTypeType,
  Job,
  // API response types
  TokenUsage,
  NormalizationResult,
  SearchResult,
  StructifyExtractionRequest,
  StructifyExtractionResult,
  CloudStorageFile,
  ProcessedResult,
} from './schemas';

// Error handling
export * from './errors';

// Utilities
export * from './utils';

// External API connectors
export {
  // Anthropic
  AnthropicClient,
  CostTracker,
  // GCP
  CloudStorageClient,
  // Structify
  StructifyClient,
  // Exa
  ExaClient,
  // Clay
  ClayClient,
} from './connectors';

// Connector types
export type {
  // Anthropic types
  CompletionParams,
  CompletionResult,
  // GCP types
  StoredFile,
  FileUploadOptions,
  DownloadResult,
  // Structify types
  StructifyConfig,
  ExtractionRequest,
  ExtractionResult,
  ExtractedRecord,
  QueryOptions,
  QueryFilter,
  FilterOperator,
  PaginatedResponse,
  EntityType,
  // Exa types
  ExaSearchOptions,
  ExaSearchResult,
  ExaSearchResponse,
  CompanyEnrichmentResult,
  ContactEnrichmentResult,
  // Clay types
  ClayConfig,
  ClayEnrichmentRequest,
  ClayLinkedInData,
  ClayCompanyData,
  ClayEmailVerification,
  ClayApiResponse,
  ClayWebhookPayload,
  ClayTableRow,
  ClayBatchResult,
} from './connectors';

// Core services
export {
  // Normalizer service
  Normalizer,
  BatchNormalizer,
  // File parser service
  FileParser,
  DataValidator,
  ColumnMapper,
  UploadPipeline,
  createUploadPipeline,
  // Pipeline service
  DataProcessor,
  // Scoring service
  ScoringService,
  scoringService,
} from './services';

// Service types
export type {
  // Normalizer types
  NormalizerOptions,
  NormalizerResult,
  BatchOptions,
  BatchProgress,
  BatchItemResult,
  BatchResult,
  // File parser types
  FileType,
  ParseResult,
  RowValidation,
  ValidationResult,
  ColumnMapping,
  UploadResult,
  // Pipeline types
  ProcessingOptions,
  ProcessingStep,
  ProcessingJob,
  ProcessingResult,
} from './services';
