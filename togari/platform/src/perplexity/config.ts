/**
 * Perplexity Computer MCP — endpoints and the per-client account setting
 * (plan step 05a).
 *
 * The four URLs come from discovery, captured in docs/PERPLEXITY_COMPUTER_MCP.md.
 * They are constants rather than a runtime fetch: they have not moved, and a
 * discovery call on every sign-in is a failure mode for no benefit.
 */

import { getReplybotClient } from "../agents/replybot/client-config";

export const PPLX_RESOURCE = "https://www.perplexity.ai/rest/computer/mcp";
export const PPLX_AUTHORIZE_URL = `${PPLX_RESOURCE}/authorize`;
export const PPLX_TOKEN_URL = `${PPLX_RESOURCE}/token`;
export const PPLX_REGISTRATION_URL = `${PPLX_RESOURCE}/register`;
export const PPLX_SCOPE = "asi:query";

/** Secret keys under which a registered client and its tokens are stored. */
export const PPLX_CLIENT_SECRET_KEY = "PERPLEXITY_OAUTH_CLIENT";
export const PPLX_TOKENS_SECRET_KEY = "PERPLEXITY_OAUTH_TOKENS";

/**
 * Which Perplexity login a given replybot client uses.
 *
 * Per client, not global: each client's drafting bills to their own Perplexity
 * account, so Serif's replies must not run on ours (or on another client's).
 * Everything downstream is keyed on the account this returns — the stored
 * tokens, the broken-login halt, and reply_items.pplx_account.
 *
 * Resolution order:
 *   1. PERPLEXITY_ACCOUNT_<CLIENT_ID>  — a setting, so the step 14 swap from
 *      our account to the client's is one variable and a restart, no deploy.
 *   2. the client's `perplexityAccount` in the replybot registry.
 *   3. the client id itself, so a new client works with no configuration and
 *      gets its own isolated account rather than silently sharing one.
 *
 * Never falls back to a shared default. A typo should mean "that account has
 * never signed in", not "bill this to whoever is configured".
 */
export function perplexityAccountForClient(clientId: string): string {
  const envKey = `PERPLEXITY_ACCOUNT_${clientId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) return fromEnv;

  const fromRegistry = getReplybotClient(clientId)?.perplexityAccount?.trim();
  if (fromRegistry) return fromRegistry;

  return clientId;
}

/** Port the sign-in script listens on for the OAuth callback. */
export function perplexityOauthPort(): number {
  const n = Number(process.env.PERPLEXITY_OAUTH_PORT);
  return Number.isInteger(n) && n > 0 ? n : 8765;
}

/**
 * How long one Computer call may run before we stop waiting on it.
 *
 * This is the duration of the WHOLE TASK, not of an acknowledgement. The plan
 * describes Computer as asynchronous, and it is in the sense that the finished
 * draft arrives by a POST to /replies/result — but the MCP call itself blocks
 * until the work is done and returns `event: "complete"` with the answer text.
 * A real run: the call went out at 14:16:10Z and the result landed 12 minutes
 * later.
 *
 * 15 minutes because abandoning the call is not free and not neutral. We have
 * already paid for the task by the time it starts (recordCall runs first), and
 * the thread id — the only handle that makes a row addressable afterwards —
 * comes back with the completion. Give up early and the task still runs, still
 * bills, and we are left holding a row we cannot chase, cancel or ask about.
 * Waiting costs a held connection; not waiting costs the handle.
 *
 * Typical work finishes in under a minute, so this ceiling is for a degraded
 * Perplexity rather than the normal case. It bounds how long one row can block
 * the dispatch loop, which is why dispatchBudgetMs() and the sweep's run lock
 * exist, and why the stuck-mid-dispatch alert is floored above it: a row whose
 * call is still legitimately running must never be reported as stranded.
 */
export function perplexityCallTimeoutMs(): number {
  const n = Number(process.env.PERPLEXITY_CALL_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 15 * 60_000;
}

/**
 * How long one sweep may go on STARTING new dispatches.
 *
 * Dispatch is sequential, so without a budget a pass costs
 * dispatchPerPass() x perplexityCallTimeoutMs() in the worst case — over an
 * hour at the defaults, during which the same pass's alerting, give-up and
 * chase phases have not run yet because they come after it.
 *
 * Derived from the call timeout rather than being its own number, so raising
 * one cannot silently invalidate the other. The check is before each row, so
 * the first row always gets to start and a pass ends at worst one call past
 * the budget.
 *
 * Stopping early is the right behaviour, not a compromise: rows left queued
 * are picked up by the next pass, and a Perplexity slow enough to exhaust this
 * is not a Perplexity to keep feeding work to.
 */
export function dispatchBudgetMs(): number {
  return perplexityCallTimeoutMs();
}

/**
 * Where Perplexity sends the browser back after the one-time "allow" click.
 *
 * Loopback, and it has to be. Perplexity's authorize endpoint only accepts
 * http://localhost:* and http://127.0.0.1:* — a hosted https callback is
 * rejected with "Redirect URI does not match allowed patterns". Registration
 * accepts any URI, so this only shows up at the authorize step.
 *
 * That is why signing in is a local script (scripts/perplexity-signin.ts) and
 * not a route on the deployed server. The tokens it obtains land in the shared
 * encrypted store, so the server reads and refreshes them normally afterwards.
 */
export function perplexityRedirectUri(): string {
  return `http://localhost:${perplexityOauthPort()}/callback`;
}

/**
 * The Perplexity project a task runs inside, per account.
 *
 * The plan's section 6 payload sends `project_uuid: null`, and that is where
 * credentials go missing: step 10 saves the Togari token to a PROJECT vault,
 * but a session started with no project is not in that project and cannot see
 * it. Measured — both a fresh session and a resumed thread reported no
 * credential for the host while the token was sitting in the project vault.
 *
 * Null is still allowed, for a Computer setup whose credentials live in the
 * user vault with "Always allow" instead.
 */
export function perplexityProjectUuid(account: string): string | null {
  const envKey = `PERPLEXITY_PROJECT_UUID_${account.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return (
    process.env[envKey]?.trim() ||
    process.env.PERPLEXITY_PROJECT_UUID?.trim() ||
    null
  );
}
