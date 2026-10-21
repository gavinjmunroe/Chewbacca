/**
 * retell/client.js — Retell SDK seam.
 *
 * Wraps `new Retell({ apiKey })` so the adapter can be tested without
 * importing the real SDK and without making live API calls. The default
 * factory lazy-imports `retell-sdk` only when a non-mock client is
 * actually requested — environments running tests can swap in a fake
 * factory via {@link setRetellClientFactory} and never touch the real
 * package.
 *
 * The SDK exposes:
 *   - client.call.createPhoneCall({ from_number, to_number, ... })
 *   - client.agent.create(...)
 *
 * We surface only the methods we use, and we surface them through this
 * thin façade so future SDK churn does not ripple out into adapter
 * callers.
 */

let factory = defaultFactory;

async function defaultFactory(apiKey) {
  // Lazy import so tests and the disabled path never load the package.
  const mod = await import("retell-sdk");
  const Retell = mod.default || mod.Retell || mod;
  return new Retell({ apiKey });
}

/**
 * Swap the client factory. Tests use this to inject a fake that records
 * calls. Pass `null` to restore the default.
 */
export function setRetellClientFactory(fn) {
  factory = typeof fn === "function" ? fn : defaultFactory;
}

/**
 * Build a Retell client. Caller owns the lifetime — there is no cache,
 * because we don't want a long-lived in-process handle for a key that
 * may rotate.
 */
export async function buildRetellClient(apiKey) {
  if (!apiKey) throw new Error("retell: apiKey required");
  return factory(apiKey);
}
