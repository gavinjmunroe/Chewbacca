/**
 * Railway OAuth scope catalog.
 *
 * Source of truth for the scope list Railway will show on the consent
 * screen. Pulled from Railway's OIDC discovery document at
 * https://backboard.railway.com/oauth/.well-known/openid-configuration
 * — `scopes_supported`.
 *
 * Why each scope:
 *   openid                    OIDC identity (needed to call /oauth/me)
 *   email                     email claim on the id_token (Connected as
 *                             foo@bar.com label on /connect)
 *   profile                   name + picture claims
 *   offline_access            issue a refresh_token; without this the
 *                             agent has to re-prompt the user every
 *                             ~hour when the access token expires
 *   workspace:admin           full read + write on the user's workspace
 *                             (lets the agent see all projects + manage
 *                             them — load-bearing for deploy ops)
 *   project:admin             explicit project-level write (deploys,
 *                             rollbacks, env reads). Requested
 *                             alongside workspace:admin in case
 *                             workspace scopes don't transitively grant
 *                             project mutations.
 */

export const RAILWAY_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "workspace:admin",
  "project:admin",
];

/**
 * Railway's authorize endpoint accepts space-separated scopes (standard
 * OAuth 2.0 form). Kept as a helper in case we ever need to switch
 * separators per RFC 6749.
 */
export function buildScopeString(scopes) {
  return scopes.join(" ");
}

export const RAILWAY_AUTHORIZE_URL = "https://backboard.railway.com/oauth/auth";
export const RAILWAY_TOKEN_URL = "https://backboard.railway.com/oauth/token";
export const RAILWAY_USERINFO_URL = "https://backboard.railway.com/oauth/me";
