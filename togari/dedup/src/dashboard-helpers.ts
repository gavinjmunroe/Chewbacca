/**
 * Pure helpers for the inline dashboard routes in src/index.ts.
 * Extracted so the validation logic is unit-testable without
 * spinning up the full Express app or BigQuery client.
 */

export const ALLOWED_SOCIAL_PLATFORMS = [
  "linkedin",
  "instagram",
  "twitter",
  "facebook",
  "tiktok",
] as const;

export type AllowedSocialPlatform = (typeof ALLOWED_SOCIAL_PLATFORMS)[number];

export function isAllowedSocialPlatform(
  value: string,
): value is AllowedSocialPlatform {
  return (ALLOWED_SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

export const CORS_ALLOWLIST = [
  "https://mcp.bluemodern.ai",
  "https://togari.bluemodernadvisory.com",
  "http://localhost:3000",
  "http://localhost:4100",
  // Karthik: add chrome-extension://<id> once the extension is published
  // Future (next sprint MOF Slack/Teams pipeline bot): outgoing webhook origins
  // 'https://hooks.slack.com',
  // 'https://outlook.office.com',
];

export function isAllowedOrigin(origin: string | undefined): boolean {
  return !!origin && CORS_ALLOWLIST.includes(origin);
}

export function requireProjectId(): string {
  const id = process.env.GCP_PROJECT_ID;
  if (!id) {
    throw new Error(
      "GCP_PROJECT_ID env var is required. Set it in Railway or your .env file.",
    );
  }
  return id;
}

export function capLimit(raw: unknown, max = 500, fallback = 100): number {
  return Math.min(Number(raw) || fallback, max);
}

export interface SocialConnectionsQuery {
  sql: string;
  params: Record<string, unknown>;
  types: Record<string, string>;
}

export function buildSocialConnectionsQuery(
  projectId: string,
  platform: string | undefined,
  limit: number,
): SocialConnectionsQuery {
  const table = `\`${projectId}.togari_dnc.social_connections\``;
  if (platform) {
    return {
      sql: `SELECT * FROM ${table} WHERE platform = @platform ORDER BY connected_at DESC LIMIT @limit`,
      params: { platform, limit },
      types: { platform: "STRING", limit: "INT64" },
    };
  }
  return {
    sql: `SELECT * FROM ${table} ORDER BY connected_at DESC LIMIT @limit`,
    params: { limit },
    types: { limit: "INT64" },
  };
}
