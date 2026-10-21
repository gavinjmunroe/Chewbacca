/**
 * amber-core shared types
 *
 * All core domain objects for the Amber platform.
 * Based on the Amber data model spec.
 */

// ============================================================================
// ENUMS
// ============================================================================

export type PrivacyTier = 'standard' | 'private' | 'sacred' | 'restricted_outbound'
export type TrustLevel = 1 | 2 | 3 | 4 | 5
export type RelationshipType =
  | 'family'
  | 'close_friend'
  | 'friend'
  | 'acquaintance'
  | 'colleague'
  | 'mentor'
  | 'collaborator'
  | 'lead'
  | 'retreat_connection'
  | 'community'
  | 'other'

export type MemorySource =
  | 'manual_note'
  | 'imessage'
  | 'email'
  | 'call'
  | 'meeting'
  | 'photo'
  | 'health_signal'
  | 'location_signal'
  | 'social_media'
  | 'fireflies'
  | 'loom'

export type ActionItemStatus = 'open' | 'pending' | 'completed' | 'cancelled'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'edited'
export type RelationshipTemperature = 'hot' | 'warm' | 'neutral' | 'cool' | 'cold'

// ============================================================================
// PERSON
// ============================================================================

export interface Person {
  id: string
  userId: string // Amber user who owns this record

  // Basic identity
  fullName: string
  nicknames: string[]
  phone?: string
  email?: string
  instagram?: string
  linkedin?: string
  otherHandles: Record<string, string>

  // Relationship context
  relationshipType: RelationshipType
  trustLevel: TrustLevel
  emotionalSafetyScore?: number // 0-100
  reliabilityScore?: number // 0-100
  connectionStrength?: number // 0-100
  lastInteractionAt?: Date
  nextRecommendedMoveAt?: Date

  // Deeper human context
  personalityNotes?: string
  communicationStyle?: string
  spiritualOrientation?: string
  professionalContext?: string
  currentSeasonOfLife?: string
  interests: string[]
  values: string[]
  preferences: string[]
  aversions: string[]
  location?: string
  timezone?: string

  // Search and retrieval
  tags: string[]
  embeddingVector?: number[] // pgvector
  summaryText?: string // for semantic search

  // System
  privacyTier: PrivacyTier
  createdAt: Date
  updatedAt: Date
}

// ============================================================================
// MEMORY
// ============================================================================

export interface Memory {
  id: string
  userId: string
  personIds: string[] // people this memory is about

  source: MemorySource
  rawContent: string
  summary?: string

  // Structured extraction
  traits: string[]
  emotionalLabel?: string
  trustSignals: string[]
  lifeEvents: string[]
  actionItemIds: string[] // linked action items

  // Metadata
  confidence: number // 0-1
  privacyTier: PrivacyTier
  tags: string[]
  embeddingVector?: number[] // pgvector
  isActionable: boolean

  // System
  createdAt: Date
  updatedAt: Date
}

// ============================================================================
// ACTION ITEM
// ============================================================================

export interface ActionItem {
  id: string
  userId: string
  personIds: string[]
  memoryId?: string

  description: string
  suggestedMessage?: string
  dueAt?: Date
  priority: 1 | 2 | 3
  status: ActionItemStatus
  requiresApproval: boolean

  createdAt: Date
  updatedAt: Date
  completedAt?: Date
}

// ============================================================================
// RELATIONSHIP STATE
// ============================================================================

export interface RelationshipState {
  id: string
  userId: string
  personId: string

  temperature: RelationshipTemperature
  trustStage: number // 1-5
  emotionalTone?: string
  lastMeaningfulTouchpointAt?: Date
  nextRecommendedMove?: string
  topicsToAvoid: string[]
  topicsToLeanInto: string[]
  reciprocityLevel?: number // 0-100
  ghostRisk?: number // 0-100
  sharedCommunities: string[]

  createdAt: Date
  updatedAt: Date
}

// ============================================================================
// APPROVAL TASK
// ============================================================================

export interface ApprovalTask {
  id: string
  userId: string
  personIds: string[]

  actionType:
    | 'send_message'
    | 'create_group_chat'
    | 'send_email'
    | 'schedule_event'
    | 'share_contact'
    | 'post_publicly'
    | 'other'

  description: string // what Amber wants to do
  reasoning: string // why Amber thinks this is good
  draftContent: string // exact message / content
  affectedChannels: string[] // 'imessage', 'email', etc.

  status: ApprovalStatus
  userFeedback?: string
  editedContent?: string

  createdAt: Date
  updatedAt: Date
  resolvedAt?: Date
}

// ============================================================================
// AMBER IDENTITY
// ============================================================================

export interface AmberIdentity {
  id: string
  userId: string
  handle: string // @handle
  displayName: string
  bio?: string

  // Permissioned profile fields
  publicFields: (keyof Person)[]
  shareableUrl?: string
  qrCode?: string
  solanaWalletAddress?: string

  createdAt: Date
  updatedAt: Date
}

// ============================================================================
// AGENT SUGGESTION
// ============================================================================

export interface AgentSuggestion {
  id: string
  userId: string
  personId?: string

  suggestionType:
    | 'reach_out'
    | 'follow_up'
    | 'retreat_invite'
    | 'check_in'
    | 'relationship_repair'
    | 'introduce_to'
    | 'other'

  reasoning: string
  confidence: number
  urgency: 'high' | 'medium' | 'low'
  suggestedAction?: string
  suggestedMessage?: string

  dismissed: boolean
  actedOn: boolean
  createdAt: Date
}

// ============================================================================
// RETREAT CANDIDATE
// ============================================================================

export interface RetreatCandidate {
  id: string
  userId: string
  retreatId: string
  personId: string

  status:
    | 'considering'
    | 'soft_pitched'
    | 'warm'
    | 'undecided'
    | 'confirmed'
    | 'declined'
    | 'do_not_invite'

  fitScore?: number
  fitReasons: string[]
  notes?: string

  createdAt: Date
  updatedAt: Date
}

// ============================================================================
// API REQUEST / RESPONSE TYPES
// ============================================================================

export interface PersonSearchResult {
  person: Person
  score: number
  matchReasons: string[]
  relevantMemories: Memory[]
  latestInteraction?: Date
  suggestedNextMove?: string
  openActionItems: ActionItem[]
}

export interface MemoryIngestionRequest {
  rawText: string
  source: MemorySource
  personName?: string // optional hint
  privacy?: PrivacyTier
}

export interface MemoryIngestionResult {
  memory: Memory
  linkedPeople: Person[]
  createdActionItems: ActionItem[]
  updatedRelationships: string[]
}
