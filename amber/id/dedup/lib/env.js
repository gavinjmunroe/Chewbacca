/**
 * Boot-time env validation for the dedup layer.
 *
 * Logs a fatal-style warning when REQUIRED vars are missing but does NOT
 * throw — the rest of amber-id keeps booting and the absent dedup routes
 * degrade to 503 at request time. This is intentional: dedup is one feature
 * group inside amber-id, and a missing ANTHROPIC_API_KEY shouldn't take down
 * /tenants, /v1/secrets, /knowledge, etc.
 *
 * amber-id is Privy-native, so AUTH0_* is intentionally NOT required here.
 * The dedup layer wants three things at minimum:
 *   - GCP credentials (path, base64 blob, OR the JSON-in-env variant Railway
 *     uses for amber-id) for BigQuery
 *   - ANTHROPIC_API_KEY so the realness classifier can escalate to Haiku
 *   - MAGIC_LINK_INTERNAL_SECRET so magic-link issuance can HMAC-sign tokens
 *
 * Plain JS so src/index.js can call this synchronously at boot without
 * needing tsx loaded. Route files written in TS can still
 * `import { validateEnv } from "../lib/env.js"` — TS happily consumes JS.
 */

const REQUIRED = [
  [
    "GCP_CREDENTIALS_BASE64",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  ],
  "ANTHROPIC_API_KEY",
  "MAGIC_LINK_INTERNAL_SECRET",
];

const OPTIONAL = [
  "GCP_PROJECT_ID",
  "PUBLIC_URL",
  "SENTRY_DSN",
  "SLACK_SIGNING_SECRET",
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
];

function isSet(name) {
  const v = process.env[name];
  return typeof v === "string" && v.length > 0;
}

export function checkEnv() {
  const missingRequired = [];
  for (const entry of REQUIRED) {
    if (typeof entry === "string") {
      if (!isSet(entry)) missingRequired.push(entry);
    } else if (!entry.some(isSet)) {
      missingRequired.push(entry.join(" OR "));
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
 * Validate dedup env. Soft-fails: logs but never throws. Returns true if all
 * required vars are present, false otherwise. Callers (src/index.js and the
 * route registrar) can use the return value to decide whether to mount the
 * dedup route groups or skip them with a "503 dedup not configured" stub.
 */
export function validateEnv() {
  const report = checkEnv();

  if (report.missingOptional.length > 0) {
    process.stderr.write(
      `[dedup-env] missing optional vars (features will degrade):\n  ${report.missingOptional.join("\n  ")}\n`,
    );
  }

  if (!report.ok) {
    process.stderr.write(
      `[dedup-env] WARN: dedup routes will NOT mount because required vars are missing:\n  ${report.missingRequired.join("\n  ")}\n`,
    );
    process.stderr.write(
      `[dedup-env] amber-id will continue booting; non-dedup routes are unaffected.\n`,
    );
    return false;
  }

  process.stderr.write(
    `[dedup-env] all required vars present (${OPTIONAL.length - report.missingOptional.length}/${OPTIONAL.length} optional configured)\n`,
  );
  return true;
}
