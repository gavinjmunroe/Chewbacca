/**
 * OAuth platform env-var requirements.
 *
 * Each provider needs a subset of the OAuth env vars set in order for /init
 * to mint an authorize URL. When any of them is missing we surface a 503
 * `platform_not_configured` from the route handler so the frontend can render
 * a disabled state instead of a 500 + crash log.
 *
 * Source of truth: each provider's init.js / callback.js currently throws on
 * missing env. We mirror those names here so the frontend learns about
 * misconfig BEFORE the user clicks Connect.
 */

export const PLATFORM_ENV_REQUIRED = {
  google: [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    // The public URL this service builds redirect URIs from. Either name
    // satisfies it -- see src/oauth/lib/public-url.js for why there are two
    // and why the old one is still honored.
    "AMBER_API_BASE_URL|MEDHA_ID_PUBLIC_URL",
  ],
  linkedin: [
    "LINKEDIN_OAUTH_CLIENT_ID",
    "LINKEDIN_OAUTH_CLIENT_SECRET",
    "AMBER_API_BASE_URL|MEDHA_ID_PUBLIC_URL",
  ],
  slack: [
    "SLACK_OAUTH_CLIENT_ID",
    "SLACK_OAUTH_CLIENT_SECRET",
    "AMBER_API_BASE_URL|MEDHA_ID_PUBLIC_URL",
    "AMBER_WEB_URL|MEDHA_FRONTEND_URL",
  ],
  notion: [
    "NOTION_OAUTH_CLIENT_ID",
    "NOTION_OAUTH_CLIENT_SECRET",
    "AMBER_API_BASE_URL|MEDHA_ID_PUBLIC_URL",
  ],
  microsoft: [
    "MS_OAUTH_CLIENT_ID",
    "MS_OAUTH_CLIENT_SECRET",
    "AMBER_API_BASE_URL|MEDHA_ID_PUBLIC_URL",
  ],
  twitter: [
    "TWITTER_OAUTH_CLIENT_ID",
    "TWITTER_OAUTH_CLIENT_SECRET",
    "AMBER_API_BASE_URL|MEDHA_ID_PUBLIC_URL",
  ],
  github: [
    "GITHUB_OAUTH_CLIENT_ID",
    "GITHUB_OAUTH_CLIENT_SECRET",
    "AMBER_API_BASE_URL|MEDHA_ID_PUBLIC_URL",
  ],
  railway: [
    "RAILWAY_OAUTH_CLIENT_ID",
    "RAILWAY_OAUTH_CLIENT_SECRET",
    "AMBER_API_BASE_URL|MEDHA_ID_PUBLIC_URL",
  ],
};

export function configCheck(platform) {
  const required = PLATFORM_ENV_REQUIRED[platform] || [];
  /*
   * A requirement may name alternatives with "A|B", satisfied by either.
   * That is how a renamed variable stops being an outage: the new name is
   * what people are told to set, the old one keeps working until every
   * environment has moved.
   */
  const missing = required.filter(
    (name) => !name.split("|").some((n) => process.env[n]?.trim()),
  );
  return {
    configured: missing.length === 0,
    missing_config: missing,
  };
}

export const SUPPORTED_PLATFORMS = Object.keys(PLATFORM_ENV_REQUIRED);
