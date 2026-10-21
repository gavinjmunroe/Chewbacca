/**
 * Shared OAuth return-target helper.
 *
 * On desktop/web the OAuth callbacks redirect back to the frontend /connect
 * page. On iOS that strands the user on justarock.ai instead of returning to
 * the app. When the flow is initiated from the app, the client passes
 * `return_to=amber://oauth-callback`; the app opens the consent flow in an
 * in-app auth session (expo-web-browser openAuthSessionAsync) that auto-closes
 * the moment it sees a redirect to that scheme.
 *
 * Each provider keeps its own web redirect shape (`?google=connected`,
 * `?slack=connected`, ...). These helpers ONLY add the app-scheme branch: the
 * provider's return-to sanitizer lets the scheme through, and its redirect
 * builder emits the deep link the iOS DeepLinkBridge understands:
 *   amber://oauth-callback?platform=<id>&status=connected|failed[&reason=...]
 */

// Allowlisted custom app schemes an OAuth flow may deep-link back into. Kept
// tight (exact host) so this never becomes an open redirect into an arbitrary
// scheme.
const APP_RETURN_PREFIXES = ["amber://oauth-callback"];

/**
 * True when returnTo is one of our app deep links (not a web path/URL).
 */
export function isAppReturnTo(returnTo) {
  return (
    typeof returnTo === "string" &&
    APP_RETURN_PREFIXES.some((p) => returnTo.startsWith(p))
  );
}

/**
 * Build the app deep link. The iOS DeepLinkBridge parses
 * ?platform=<id>&status=connected|failed (+ optional reason).
 *
 * @param {string} returnTo  e.g. "amber://oauth-callback"
 * @param {object} opts      { platform, status, reason? }
 */
export function appReturnUrl(returnTo, { platform, status, reason } = {}) {
  const sep = returnTo.includes("?") ? "&" : "?";
  let url = `${returnTo}${sep}platform=${encodeURIComponent(
    platform,
  )}&status=${encodeURIComponent(status)}`;
  if (reason) url += `&reason=${encodeURIComponent(reason)}`;
  return url;
}
