/**
 * @togari/core/schemas
 * Comprehensive Zod schemas for all data types
 */

// ============================================================================
// PERSON SCHEMAS (Healthcare Lead Model)
// ============================================================================
export {
  // Enum schemas
  verticalSchema,
  routingTierSchema,
  sourceTypeSchema,
  sourceChannelSchema,
  leadStatusSchema,
  personaSchema,
  // Helper schemas
  linkedInExperienceSchema,
  companyDataSchema,
  // Main schemas
  personSchema,
  createPersonSchema,
  updatePersonSchema,
  amberSubmissionSchema,
  // Types
  type PersonInput,
  type PersonOutput,
  type CreatePersonInput,
  type UpdatePersonInput,
  type AmberSubmission,
  type LinkedInExperience,
  type CompanyDataEmbedded,
} from './person';

// ============================================================================
// COMPANY SCHEMAS
// ============================================================================
export {
  // Enum schemas
  companyTierSchema,
  // Main schemas
  companySchema,
  createCompanySchema,
  updateCompanySchema,
  // Types
  type CompanyInput,
  type CompanyOutput,
  type CreateCompanyInput as CreateCompanySchemaInput,
  type UpdateCompanyInput as UpdateCompanySchemaInput,
} from './company';

// ============================================================================
// CAMPAIGN SCHEMAS
// ============================================================================
export {
  // Enum schemas
  campaignTypeSchema,
  campaignStatusSchema,
  // Main schemas
  campaignSchema,
  createCampaignSchema,
  updateCampaignSchema,
  // Types
  type CampaignInput,
  type CampaignOutput,
  type CreateCampaignInput as CreateCampaignSchemaInput,
  type UpdateCampaignInput as UpdateCampaignSchemaInput,
} from './campaign';

// ============================================================================
// TOUCHPOINT SCHEMAS
// ============================================================================
export {
  // Enum schemas
  touchpointTypeSchema,
  touchpointSentimentSchema,
  touchpointDirectionSchema,
  // Main schemas
  touchpointSchema,
  createTouchpointSchema,
  updateTouchpointSchema,
  // Types
  type TouchpointInput,
  type TouchpointOutput,
  type CreateTouchpointInput,
  type UpdateTouchpointInput,
} from './touchpoint';

// ============================================================================
// RELATIONSHIP SCHEMAS
// ============================================================================
export {
  // Enum schemas
  relationshipTypeSchema,
  // Main schemas
  relationshipSchema,
  createRelationshipSchema,
  updateRelationshipSchema,
  // Types
  type RelationshipInput,
  type RelationshipOutput,
  type CreateRelationshipInput,
  type UpdateRelationshipInput,
} from './relationship';

// ============================================================================
// LEGACY LEAD SCHEMAS (Backward Compatibility)
// ============================================================================
export {
  CompanySchema,
  ContactSchema,
  LeadSchema,
  StoredLeadSchema,
  type Company,
  type Contact,
  type Lead,
  type StoredLead,
  type Enrichment,
  type Location,
} from './lead';

// ============================================================================
// JOB SCHEMAS
// ============================================================================
export {
  JobStatus,
  JobType,
  JobSchema,
  type JobStatusType,
  type JobTypeType,
  type Job,
} from './job';

// ============================================================================
// API RESPONSE SCHEMAS
// ============================================================================
export {
  NormalizationResultSchema,
  SearchResultSchema,
  StructifyExtractionRequestSchema,
  StructifyExtractionResultSchema,
  CloudStorageFileSchema,
  ProcessedResultSchema,
  type TokenUsage,
  type NormalizationResult,
  type SearchResult,
  type StructifyExtractionRequest,
  type StructifyExtractionResult,
  type CloudStorageFile,
  type ProcessedResult,
} from './api-responses';
