/**
 * WHERE THIS SERVICE LIVES, FOR THE PURPOSE OF BUILDING A REDIRECT URI.
 *
 * Every OAuth provider needs an absolute URL to send the browser back to, and
 * that URL has to be byte-identical to one registered in the provider's
 * console. Getting it from an environment variable is correct; getting it
 * from TWO environment variables, as this service did, is how a workspace
 * ends up with sign-in working and calendars answering redirect_uri_mismatch.
 *
 * This service used MEDHA_ID_PUBLIC_URL -- the name it had before it was
 * Amber -- for every OAuth integration, while the newer org sign-in used
 * AMBER_API_BASE_URL. Same service, same host, two variables, and whichever
 * one you had not set was the half that broke. The old name is also simply
 * wrong now: there is no Medha, and a variable named after a product that no
 * longer exists is a variable nobody will think to set.
 *
 * So: AMBER_API_BASE_URL is the name, and MEDHA_ID_PUBLIC_URL is honored
 * after it so that an existing deployment does not break the moment this
 * ships. The fallback is deliberate and temporary -- it can go once every
 * environment has been migrated, and leaving it out today would turn a rename
 * into an outage.
 *
 * Throwing when neither is set is the right failure. An OAuth flow built on a
 * guessed origin produces a redirect URI that does not match anything, which
 * surfaces as an error at Google rather than at us, in somebody else's
 * console, days later.
 */

const NAMES = ["AMBER_API_BASE_URL", "MEDHA_ID_PUBLIC_URL"];

/** The public origin of this API, with any trailing slash removed. */
export function publicBaseUrl() {
  for (const name of NAMES) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim().replace(/\/+$/, "");
  }
  throw new Error(
    "missing_env:AMBER_API_BASE_URL — the public URL of this API, used to build OAuth redirect URIs",
  );
}

/** Whether a redirect URI can be built at all, for a config check. */
export function hasPublicBaseUrl() {
  return NAMES.some((n) => Boolean(process.env[n]?.trim()));
}

/** The callback this service exposes for a provider, as the provider must have it. */
export function callbackUrlFor(provider) {
  return `${publicBaseUrl()}/v1/oauth/${provider}/callback`;
}

/* ------------------------------------------------------- the website ---- */

/**
 * WHERE THE BROWSER GOES AFTER A CALLBACK.
 *
 * Same story as the API's own URL, one layer out: an OAuth callback has to
 * send the browser back to a page, and that page is on the website rather
 * than on this service. It was read from MEDHA_FRONTEND_URL -- named, again,
 * after a product that no longer exists -- so AMBER_WEB_URL is the name now
 * and the old one is honored behind it.
 *
 * This one throws too. A callback that cannot work out where to send
 * somebody has nowhere to put them except an error page, and failing at the
 * top with the variable's name in the message is more useful than a redirect
 * to "undefined/connect".
 */
const WEB_NAMES = ["AMBER_WEB_URL", "MEDHA_FRONTEND_URL"];

export function webBaseUrl() {
  for (const name of WEB_NAMES) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim().replace(/\/+$/, "");
  }
  throw new Error(
    "missing_env:AMBER_WEB_URL — the public URL of the website, used to send people back after OAuth",
  );
}

export function hasWebBaseUrl() {
  return WEB_NAMES.some((n) => Boolean(process.env[n]?.trim()));
}
