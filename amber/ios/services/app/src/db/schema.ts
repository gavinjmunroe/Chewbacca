import { pgTable, serial, text, timestamp, jsonb, varchar, integer, pgEnum, boolean } from 'drizzle-orm/pg-core';

export const relationshipTypeEnum = pgEnum('relationship_type', ['parent', 'sibling', 'partner', 'child', 'other']);
export const insightPriorityEnum = pgEnum('insight_priority', ['high', 'medium', 'low']);
export const insightTopicEnum = pgEnum('insight_topic', ['health', 'connection', 'memory']);
export const runStatusEnum = pgEnum('run_status', ['queued', 'running', 'succeeded', 'failed']);

// Users (linked to Privy)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  privyUserId: varchar('privy_user_id', { length: 255 }).notNull().unique(),
  auth0UserId: varchar('auth0_user_id', { length: 255 }).unique(),
  didPrimary: varchar('did_primary', { length: 255 }),
  privacyTier: varchar('privacy_tier', { length: 50 }).default('local_only'),
  apnsDeviceToken: varchar('apns_device_token', { length: 512 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Persons (family members)
export const persons = pgTable('persons', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  name: text('name').notNull(),
  dob: timestamp('dob', { withTimezone: true }),
  email: varchar('email', { length: 255 }),
  cNFT: varchar('c_nft', { length: 255 }), // Solana compressed NFT mint address
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Wallets (Solana addresses)
export const wallets = pgTable('wallets', {
  id: serial('id').primaryKey(),
  personId: integer('person_id').references(() => persons.id).notNull(),
  chain: varchar('chain', { length: 50 }).default('solana').notNull(),
  address: varchar('address', { length: 255 }).notNull(),
  verified: timestamp('verified', { withTimezone: true }),
  labels: jsonb('labels'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Relationships (family graph edges)
export const relationships = pgTable('relationships', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  fromId: integer('from_id').references(() => persons.id).notNull(),
  toId: integer('to_id').references(() => persons.id).notNull(),
  type: relationshipTypeEnum('type').notNull(),
  strength: integer('strength').default(50), // 0-100, AI-calculated
  evidenceHash: varchar('evidence_hash', { length: 255 }),
  s3Uri: varchar('s3_uri', { length: 512 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Pipeline definitions
export const pipelineDefs = pgTable('pipeline_defs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  name: varchar('name', { length: 255 }).notNull(),
  def: jsonb('def').notNull(), // Pipeline DAG definition
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Pipeline runs
export const pipelineRuns = pgTable('pipeline_runs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  defId: integer('def_id').references(() => pipelineDefs.id),
  status: runStatusEnum('status').notNull(),
  log: jsonb('log').$type<string[]>().default([]),
  result: jsonb('result'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
});

// Insight cards (AI-generated feed items)
export const insights = pgTable('insights', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  priority: insightPriorityEnum('priority').notNull(),
  topic: insightTopicEnum('topic').notNull(),
  content: text('content').notNull(),
  sources: jsonb('sources').$type<string[]>().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// VC records (verifiable credentials)
export const vcRecords = pgTable('vc_records', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  issuer: varchar('issuer', { length: 255 }).notNull(),
  schemaId: varchar('schema_id', { length: 255 }),
  s3Uri: varchar('s3_uri', { length: 512 }),
  contentHash: varchar('content_hash', { length: 255 }).notNull(),
  status: varchar('status', { length: 50 }).default('active'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

// Anchors (Solana on-chain anchors)
export const anchors = pgTable('anchors', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  kind: varchar('kind', { length: 100 }), // 'graph', 'pipeline', 'vc'
  contentHash: varchar('content_hash', { length: 255 }).notNull(),
  chainTx: varchar('chain_tx', { length: 255 }), // Solana transaction signature
  uri: varchar('uri', { length: 512 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─── GCP+Onboarding+Auth Enums ──────────────────────────────────────────────

export const privacyTierEnum = pgEnum('privacy_tier', ['local_only', 'selective_cloud', 'full_social']);
export const signalTypeEnum = pgEnum('signal_type', ['birthday', 'shared_event', 'questionnaire_match', 'health_sync', 'location_proximity', 'interest_overlap']);
export const signalStatusEnum = pgEnum('signal_status', ['pending', 'sent', 'seen', 'acted_on', 'dismissed', 'expired']);
export const notificationStatusEnum = pgEnum('notification_status', ['queued', 'sent', 'delivered', 'opened', 'failed']);
export const circleTypeEnum = pgEnum('circle_type', ['auto', 'manual']);
export const personalityTypeEnum = pgEnum('personality_type', ['horoscope', 'myers_briggs', 'enneagram', 'big_five']);
export const devicePlatformEnum = pgEnum('device_platform', ['ios', 'android']);
export const onboardingStepEnum = pgEnum('onboarding_step', ['welcome', 'basics', 'birthday', 'location', 'education', 'permissions', 'privacy_tier', 'complete']);

// Sprint 1 MVP: Circle visibility enum
export const circleVisibilityEnum = pgEnum('circle_visibility', ['private', 'members', 'public']);

// ─── GCP+Onboarding+Auth Tables ─────────────────────────────────────────────

// User profiles (onboarding immutable objects)
export const userProfiles = pgTable('user_profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull().unique(),
  displayName: varchar('display_name', { length: 100 }),
  username: varchar('username', { length: 50 }).unique(),
  birthday: timestamp('birthday', { withTimezone: true }).notNull(),
  birthdayTime: varchar('birthday_time', { length: 10 }),
  birthLocation: varchar('birth_location', { length: 255 }),
  almaMater: varchar('alma_mater', { length: 255 }),
  hometown: varchar('hometown', { length: 255 }),
  currentCity: varchar('current_city', { length: 255 }),
  bio: text('bio'),
  avatarUrl: varchar('avatar_url', { length: 500 }),
  privacyTier: privacyTierEnum('privacy_tier').default('selective_cloud'),
  contentHash: varchar('content_hash', { length: 66 }),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Onboarding progress (tracks wizard state)
export const onboardingProgress = pgTable('onboarding_progress', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).unique(),
  currentStep: onboardingStepEnum('current_step').default('welcome'),
  stepsCompleted: jsonb('steps_completed').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Personality profiles (derived personality data)
export const personalityProfiles = pgTable('personality_profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  profileType: personalityTypeEnum('profile_type').notNull(),
  result: jsonb('result').notNull(),
  derivedFrom: varchar('derived_from', { length: 50 }),
  confidence: integer('confidence'),
  contentHash: varchar('content_hash', { length: 66 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─── Sprint 1 MVP Tables (merged from main) ────────────────────────────────

// PRIVACY-01: Field-level permission table — controls which fields sync to cloud
export const userPermissions = pgTable('user_permissions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  fieldType: varchar('field_type', { length: 100 }).notNull(),
  syncEnabled: boolean('sync_enabled').default(false).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// PRIVACY-01: Audit log for permission changes
export const permissionAuditLog = pgTable('permission_audit_log', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  fieldType: varchar('field_type', { length: 100 }).notNull(),
  oldValue: boolean('old_value'),
  newValue: boolean('new_value').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
});

// DATA-01: iMessage contact graph — synced for selective/full_social users
export const contacts = pgTable('contacts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  externalId: varchar('external_id', { length: 255 }),
  name: text('name').notNull(),
  phoneNumbers: jsonb('phone_numbers').$type<string[]>().default([]),
  emails: jsonb('emails').$type<string[]>().default([]),
  birthday: timestamp('birthday', { withTimezone: true }),
  messageFrequency: integer('message_frequency').default(0),
  lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
  relationshipScore: integer('relationship_score').default(0),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─── Signals & Social ───────────────────────────────────────────────────────

// Signals (detected connection signals)
export const signals = pgTable('signals', {
  id: serial('id').primaryKey(),
  signalType: signalTypeEnum('signal_type').notNull(),
  sourceUserId: integer('source_user_id').references(() => users.id).notNull(),
  targetUserId: integer('target_user_id').references(() => users.id),
  userId: integer('user_id').references(() => users.id),
  contactId: integer('contact_id').references(() => contacts.id),
  triggerDate: timestamp('trigger_date', { withTimezone: true }),
  data: jsonb('data').notNull(),
  priority: insightPriorityEnum('priority').default('medium'),
  status: signalStatusEnum('status').default('pending'),
  payload: jsonb('payload'),
  dedupeKey: varchar('dedupe_key', { length: 255 }).unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  actedAt: timestamp('acted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Notifications (push notification log)
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  signalId: integer('signal_id').references(() => signals.id),
  title: varchar('title', { length: 255 }).notNull(),
  body: text('body').notNull(),
  deepLink: varchar('deep_link', { length: 500 }),
  status: notificationStatusEnum('status').default('queued'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Circles (friend groups)
export const circles = pgTable('circles', {
  id: serial('id').primaryKey(),
  ownerId: integer('owner_id').references(() => users.id).notNull(),
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  name: varchar('name', { length: 100 }).notNull(),
  type: circleTypeEnum('type').default('manual'),
  visibility: circleVisibilityEnum('visibility').default('private'),
  inviteToken: varchar('invite_token', { length: 64 }).unique(),
  source: varchar('source', { length: 50 }),
  metadata: jsonb('metadata'),
  contentHash: varchar('content_hash', { length: 66 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Circle members (junction table)
export const circleMembers = pgTable('circle_members', {
  id: serial('id').primaryKey(),
  circleId: integer('circle_id').references(() => circles.id).notNull(),
  userId: integer('user_id').references(() => users.id),
  personId: integer('person_id').references(() => persons.id),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow(),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),
});

// Device tokens (for push notifications)
export const deviceTokens = pgTable('device_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  token: varchar('token', { length: 500 }).notNull(),
  platform: devicePlatformEnum('platform').notNull(),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
