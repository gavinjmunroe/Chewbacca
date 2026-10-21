/**
 * Shared types for Medha Dedup v2 — per-user contact matcher + social sync.
 *
 * Ported from togari-bma-dvlp/src/dnc/types/index.ts (decommissioned) with
 * one rename across the board: every `owner_id` field becomes `owner_did`
 * to match amber-id's DID-first identity model. Privy DIDs (`did:privy:...`)
 * are the canonical owner key everywhere in the medha-id codebase.
 *
 * Imported by every WS-1 through WS-9 workstream. Do not put framework
 * code here — only contracts.
 */

export type Platform =
  | "apple"
  | "linkedin"
  | "instagram"
  | "twitter"
  | "facebook"
  | "gmail"
  | "github"
  | "tiktok"
  | "snapchat";

export type ConnectionType = "connection" | "follower" | "following";

export interface SocialConnectionRow {
  connection_id: string;
  platform: Platform;
  owner_did: string;
  owner_account_id: string;
  owner_username: string;
  platform_user_id: string;
  username: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  profile_url: string;
  avatar_url: string | null;
  bio: string | null;
  follower_count: number | null;
  following_count: number | null;
  is_verified: boolean;
  connection_type: ConnectionType;
  connected_at: string;
  connection_degree: number;
  dnc_contact_id: string | null;
  work_email: string | null;
  current_title: string | null;
  current_company: string | null;
  company_domain: string | null;
  is_dnc: boolean;
  dnc_reason: string | null;
  dnc_added_at: string | null;
  raw_platform_data: Record<string, unknown>;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface SyncResult {
  platform: Platform;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
  durationMs: number;
  status: "success" | "partial" | "failed";
}

/** In-memory cache: avoids BQ query every 60s. */
export interface PlatformCache {
  /** Privy DID (tenant): required for owner_did filtering on every BQ query. */
  ownerDid: string;
  ownerAccountId: string;
  ownerUsername: string;
  knownIds: Set<string>;
  lastPollAt: string | null;
  lastConnectedAt: number | null;
  followerCount: number | null;
}

export type CacheMap = Map<Platform, PlatformCache>;

// ─── Dedup v2 API contracts ──────────────────────────────────────────────────
// Used by WS-1 (matcher), WS-2 (api keys), WS-5 (apple), and the realness
// classifier inside WS-1. Defined here so every parallel workstream imports
// from one place and types stay in sync.

export interface UnifiedContact {
  contact_id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  linkedin_username: string | null;
  instagram_username: string | null;
  twitter_username: string | null;
  facebook_username: string | null;
  tiktok_username: string | null;
  current_title: string | null;
  current_company: string | null;
  company_domain: string | null;
  sources: string;
  source_detail: Record<string, unknown>;
  is_dnc: boolean;
  dnc_reason: string | null;
  dnc_added_at: string | null;
  confidence_score: number;
  merge_count: number;
  first_seen_at: string;
  last_updated_at: string;
  is_real_person: boolean | null;
  realness_score: number | null;
  realness_reason: string | null;
  apple_contact_id: string | null;
  apple_etag: string | null;
  owner_did: string | null;
}

export interface MatchRequest {
  name?: string;
  email?: string;
  linkedin?: string;
  phone?: string;
}

export interface MatchResult {
  matched: boolean;
  contact?: UnifiedContact;
  confidence: number;
  matched_on?: "email" | "linkedin" | "phone" | "name";
}

export interface ApiKeyContext {
  ownerDid: string;
  keyId: string;
  keyPrefix: string;
}

export interface RealnessVerdict {
  is_real: boolean;
  score: number;
  reason: string;
}
