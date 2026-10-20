/**
 * Environment variable validation.
 *
 * Hard-fails boot if a REQUIRED variable is missing. Logs a warning for an
 * OPTIONAL-but-recommended variable so operators see what's degraded but the
 * server still starts. Returns a structured report so the health endpoint can
 * surface the same picture.
 */

export interface EnvCheckResult {
  ok: boolean;
  missingRequired: string[];
  missingOptional: string[];
}

/**
 * Required: server boot or a core path fails without these.
 * Optional-but-recommended: a specific feature degrades (an OAuth platform
 * returns 503, Sentry stops capturing, etc) but the rest of the API still
 * works.
 */
const REQUIRED: ReadonlyArray<string | string[]> = [
  // BQ — either a credentials path or a base64 blob
  ["GCP_CREDENTIALS_BASE64", "GOOGLE_APPLICATION_CREDENTIALS"],
  // Auth0 JWT verification — used by dashboard + magic-link routes
  "AUTH0_DOMAIN",
  "AUTH0_AUDIENCE",
];

const OPTIONAL: ReadonlyArray<string> = [
  "ANTHROPIC_API_KEY", // Haiku realness escalation falls back to heuristic
  "GCP_PROJECT_ID", // defaults to midyear-glazing-485303-u3
  "PUBLIC_URL", // OAuth redirect target
  "SENTRY_DSN", // error tracking disabled if absent
  "SLACK_SIGNING_SECRET", // /togari commands disabled
  "SLACK_BOT_TOKEN",
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
  "META_APP_ID",
  "META_APP_SECRET",
  "TWITTER_CLIENT_ID",
  "TWITTER_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "SNAPCHAT_CLIENT_ID",
  "SNAPCHAT_CLIENT_SECRET",
  "TIKTOK_CLIENT_KEY",
  "TIKTOK_CLIENT_SECRET",
  "CHROME_EXTENSION_ID",
  "MAGIC_LINK_INTERNAL_SECRET",
];

function isSet(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.length > 0;
}

export function checkEnv(): EnvCheckResult {
  const missingRequired: string[] = [];
  for (const entry of REQUIRED) {
    if (typeof entry === "string") {
      if (!isSet(entry)) missingRequired.push(entry);
    } else {
      // OR group: at least one must be set
      if (!entry.some(isSet)) missingRequired.push(entry.join(" OR "));
    }
  }
  const missingOptional = OPTIONAL.filter((name) => !isSet(name));
  return {
    ok: missingRequired.length === 0,
    missingRequired,
    missingOptional,
  };
}

/**
 * Validate env at boot. Throws if any REQUIRED var is missing. Logs to stderr
 * for OPTIONAL gaps so the operator can see what's degraded.
 */
export function validateEnv(): void {
  const report = checkEnv();

  if (report.missingOptional.length > 0) {
    process.stderr.write(
      `[env] missing optional vars (feature(s) will degrade):\n  ${report.missingOptional.join("\n  ")}\n`,
    );
  }

  if (!report.ok) {
    process.stderr.write(
      `[env] FATAL: missing required env vars:\n  ${report.missingRequired.join("\n  ")}\n`,
    );
    throw new Error(
      `Missing required env vars: ${report.missingRequired.join(", ")}`,
    );
  }

  process.stderr.write(
    `[env] all required vars present (${OPTIONAL.length - report.missingOptional.length}/${OPTIONAL.length} optional vars configured)\n`,
  );
}
