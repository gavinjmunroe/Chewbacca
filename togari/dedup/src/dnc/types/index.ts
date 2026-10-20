/**
 * Shared types for Togari DNC Social Connections sync + Dedup v2 API.
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
  owner_id: string;
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

/** In-memory cache — avoids BQ query every 60s */
export interface PlatformCache {
  /** Togari/Auth0 user id (tenant) — required for owner_id filtering on every BQ query */
  ownerId: string;
  ownerAccountId: string;
  ownerUsername: string;
  knownIds: Set<string>;
  lastPollAt: string | null;
  lastConnectedAt: number | null;
  followerCount: number | null;
}

export type CacheMap = Map<Platform, PlatformCache>;

// ─── Dedup v2 API contracts ──────────────────────────────────────────────────
// Used by WS-1 (matcher), WS-2 (api keys), WS-3 (apple), WS-4 (realness).
// Defined here so all parallel workstreams import from one place.

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
  owner_id: string | null;
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
  ownerId: string;
  keyId: string;
  keyPrefix: string;
}

export interface RealnessVerdict {
  is_real: boolean;
  score: number;
  reason: string;
}
