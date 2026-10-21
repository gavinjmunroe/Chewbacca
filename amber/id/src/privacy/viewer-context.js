/**
 * Viewer context for the privacy policy engine: given a viewer + owner, resolve
 * the two facts canView/filterForViewer need — { connected, ownerShares }.
 *
 * viewer === owner short-circuits live in canView (owner-of-self), NOT here.
 */

import { resolveAudience } from "./audience.js";

/**
 * @returns {Promise<{ connected: boolean, ownerShares: boolean }>}
 *   connected   — viewer & owner have a live `connections` row.
 *   ownerShares — owner's users.privacy_tier === 'full_social' (treated as
 *                 "shares baseline with my mutuals"; mapping refinable later).
 * Fail-closed: any error → { connected:false, ownerShares:false }.
 */
export async function getViewerContext(viewerId, ownerId) {
  if (!viewerId || !ownerId) return { connected: false, ownerShares: false, audience: null };
  // ONE RESOLVER. This used to ask two questions of its own -- are they
  // connected, and is the owner's privacy_tier 'full_social' -- while the notes
  // and feeds side asked a completely different set through viewer-reach.js.
  // Both now come from src/privacy/audience.js, so a viewer who is in one of
  // the owner's circles or cohorts is the same person to both surfaces.
  const audience = await resolveAudience(viewerId, ownerId).catch(() => null);
  return {
    connected: Boolean(audience?.connected),
    ownerShares: Boolean(audience?.ownerSharesBaseline),
    audience,
  };
}
