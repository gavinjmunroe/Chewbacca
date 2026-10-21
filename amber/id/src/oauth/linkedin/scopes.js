/**
 * LinkedIn OAuth 2.0 scopes requested by amber-id.
 *
 * Coverage:
 *   r_liteprofile        - basic profile (name, headline, photo)
 *   r_emailaddress       - primary email
 *   r_organization_admin - read analytics + posts for company pages the user
 *                          administers (BMA company page metrics)
 *   w_member_social      - publish posts on behalf of the user
 *
 * The LinkedIn Developer Portal app must have the corresponding products
 * approved ("Sign In with LinkedIn", "Marketing Developer Platform",
 * "Share on LinkedIn") for these scopes to be granted at consent time.
 */

export const LINKEDIN_SCOPES = [
  "r_liteprofile",
  "r_emailaddress",
  "r_organization_admin",
  "w_member_social",
];

export const LINKEDIN_AUTHORIZE_URL =
  "https://www.linkedin.com/oauth/v2/authorization";
export const LINKEDIN_TOKEN_URL =
  "https://www.linkedin.com/oauth/v2/accessToken";
export const LINKEDIN_REVOKE_URL = "https://www.linkedin.com/oauth/v2/revoke";
