/**
 * Drizzle ORM schema for amber-id PostgreSQL.
 *
 * Ported from amber-ios/services/app/src/db/schema.ts — identity tables only.
 * Tables that stay in amber-ios (signals, circles, persons, wallets, etc.) are
 * deliberately excluded.
 */

import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  varchar,
  integer,
  pgEnum,
  boolean,
} from "drizzle-orm/pg-core";

// ─── Enums ──────────────────────────────────────────────────────────────────

export const privacyTierEnum = pgEnum("privacy_tier", [
  "local_only",
  "selective_cloud",
  "full_social",
]);

export const personalityTypeEnum = pgEnum("personality_type", [
  "horoscope",
  "myers_briggs",
  "enneagram",
  "big_five",
]);

export const onboardingStepEnum = pgEnum("onboarding_step", [
  "welcome",
  "basics",
  "birthday",
  "location",
  "education",
  "permissions",
  "privacy_tier",
  "complete",
]);

// ─── Users ──────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  privyUserId: varchar("privy_user_id", { length: 255 }).notNull().unique(),
  auth0UserId: varchar("auth0_user_id", { length: 255 }).unique(),
  didPrimary: varchar("did_primary", { length: 255 }),
  privacyTier: varchar("privacy_tier", { length: 50 }).default("local_only"),
  apnsDeviceToken: varchar("apns_device_token", { length: 512 }),
  // Solana cNFT identity — the auth key for the user's private Pinecone KB.
  // Filled in by POST /identity/mint. Null until the user mints.
  cnftMint: varchar("cnft_mint", { length: 64 }).unique(),
  cnftAssetId: varchar("cnft_asset_id", { length: 64 }),
  cnftTxSignature: varchar("cnft_tx_signature", { length: 128 }),
  cnftMerkleTree: varchar("cnft_merkle_tree", { length: 64 }),
  cnftMintedAt: timestamp("cnft_minted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── User Profiles ──────────────────────────────────────────────────────────

export const userProfiles = pgTable("user_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id)
    .notNull()
    .unique(),
  displayName: varchar("display_name", { length: 100 }),
  username: varchar("username", { length: 50 }).unique(),
  birthday: timestamp("birthday", { withTimezone: true }).notNull(),
  birthdayTime: varchar("birthday_time", { length: 10 }),
  birthLocation: varchar("birth_location", { length: 255 }),
  almaMater: varchar("alma_mater", { length: 255 }),
  hometown: varchar("hometown", { length: 255 }),
  currentCity: varchar("current_city", { length: 255 }),
  bio: text("bio"),
  avatarUrl: varchar("avatar_url", { length: 500 }),
  privacyTier: privacyTierEnum("privacy_tier").default("selective_cloud"),
  contentHash: varchar("content_hash", { length: 66 }),
  onboardingCompletedAt: timestamp("onboarding_completed_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── Onboarding Progress ────────────────────────────────────────────────────

export const onboardingProgress = pgTable("onboarding_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id)
    .unique(),
  currentStep: onboardingStepEnum("current_step").default("welcome"),
  stepsCompleted: jsonb("steps_completed").default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── Personality Profiles ───────────────────────────────────────────────────

export const personalityProfiles = pgTable("personality_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  profileType: personalityTypeEnum("profile_type").notNull(),
  result: jsonb("result").notNull(),
  derivedFrom: varchar("derived_from", { length: 50 }),
  confidence: integer("confidence"),
  contentHash: varchar("content_hash", { length: 66 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── User Permissions (field-level sync control) ────────────────────────────

export const userPermissions = pgTable("user_permissions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  fieldType: varchar("field_type", { length: 100 }).notNull(),
  syncEnabled: boolean("sync_enabled").default(false).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── Permission Audit Log ───────────────────────────────────────────────────

export const permissionAuditLog = pgTable("permission_audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  fieldType: varchar("field_type", { length: 100 }).notNull(),
  oldValue: boolean("old_value"),
  newValue: boolean("new_value").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── Contacts ───────────────────────────────────────────────────────────────

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  externalId: varchar("external_id", { length: 255 }),
  name: text("name").notNull(),
  phoneNumbers: jsonb("phone_numbers").default([]),
  emails: jsonb("emails").default([]),
  birthday: timestamp("birthday", { withTimezone: true }),
  messageFrequency: integer("message_frequency").default(0),
  lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
  relationshipScore: integer("relationship_score").default(0),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── VC Records (Verifiable Credentials) ────────────────────────────────────

export const vcRecords = pgTable("vc_records", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  issuer: varchar("issuer", { length: 255 }).notNull(),
  schemaId: varchar("schema_id", { length: 255 }),
  s3Uri: varchar("s3_uri", { length: 512 }),
  contentHash: varchar("content_hash", { length: 255 }).notNull(),
  status: varchar("status", { length: 50 }).default("active"),
  issuedAt: timestamp("issued_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
