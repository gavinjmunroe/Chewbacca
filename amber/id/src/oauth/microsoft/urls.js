import { publicBaseUrl } from "../lib/public-url.js";
/**
 * Microsoft OAuth URL helpers that are safe to import from both the
 * init and callback paths without dragging in the state-store module.
 */

export function microsoftRedirectUri() {
  const base = publicBaseUrl();
  return `${base.replace(/\/+$/, "")}/v1/oauth/microsoft/callback`;
}
