/**
 * Perplexity Computer MCP — the one function every call goes through
 * (plan step 05 f–g).
 *
 * Two jobs, and the second matters more than the first:
 *   - renew proactively, before a request can fail on an expired token;
 *   - when renewing fails, alert loudly and STOP sending work. A broken login
 *     that only writes a log line means replies pile up and nobody notices.
 */

import { createLogger } from "../observability/logger";
import { perplexityAccountForClient } from "./config";
import { loadTokens, refreshTokens, type StoredTokens } from "./oauth";

const logger = createLogger("perplexity/tokens");

/**
 * Renew once the remaining lifetime drops below 20% of the total, rather than
 * waiting for a 401. On a one-hour token that is the last twelve minutes.
 */
const REFRESH_AT_REMAINING_FRACTION = 0.2;

// ── The halt switch (g) ───────────────────────────────────────────

/**
 * Halted accounts, keyed by account id.
 *
 * Per account, not one global flag: clients run on their own Perplexity
 * accounts, so Serif's login expiring must not stop BMA's drafting. A global
 * switch would turn one client's billing problem into an outage for everyone.
 *
 * In-process by design — a redeploy clears it, which is the same act as fixing
 * the credentials. The cost is that a crash-looping instance re-enables itself
 * silently, so the alert is the real signal, not this map.
 */
const halted = new Map<string, { reason: string; since: number }>();

export function isPerplexityHalted(account: string): boolean {
  return halted.has(account);
}

export function perplexityHaltReason(account: string): string | null {
  return halted.get(account)?.reason ?? null;
}

/** Clear one account, or every account when called with no argument. */
export function clearPerplexityHalt(account?: string): void {
  if (account === undefined) halted.clear();
  else halted.delete(account);
}

/**
 * Stop sending work for one account, and say so once.
 *
 * Exported because a broken login is not the only reason to stop: an account
 * that cannot pay is equally unable to do the work, and the caller that finds
 * that out is the dispatcher, not this module. Without this, the only halt was
 * the private login one below, so a billing failure had nowhere to go — which
 * is how 35 replies in a row were dispatched into an account that could not
 * run any of them.
 *
 * `alertText` carries the remedy, which differs per cause: re-run the sign-in,
 * or top up the balance. The repeat guard is on the halt, not the alert, so a
 * per-row caller cannot turn one outage into a stream of identical messages.
 */
export function haltPerplexityAccount(
  account: string,
  reason: string,
  alertText: string,
): void {
  if (halted.has(account)) return; // already stopped; don't re-alert per caller
  halted.set(account, { reason, since: Date.now() });
  logger.error("perplexity.halted", new Error(reason), { account });
  void sendUrgentAlert(alertText);
}

function halt(account: string, reason: string): void {
  haltPerplexityAccount(
    account,
    reason,
    `:rotating_light: *Perplexity login is broken — reply drafting has stopped.*\n` +
      `Account: \`${account}\`\n` +
      `Reason: ${reason}\n` +
      `Replies for this account will keep queueing, but nothing is being sent to ` +
      `Perplexity until someone re-runs the sign-in at ` +
      `\`/perplexity/oauth/start?account=${account}\`. Other accounts are unaffected.`,
  );
}

/**
 * Urgent alert over the Slack bot token.
 *
 * Deliberately not notifyInternal(): that posts to an optional webhook and
 * returns silently when it is unset, which is precisely the failure this alert
 * exists to prevent.
 */
export async function sendUrgentAlert(text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel =
    process.env.PERPLEXITY_ALERT_SLACK_CHANNEL || process.env.REPLYBOT_ALERT_CHANNEL;
  if (!token || !channel) {
    logger.error(
      "perplexity.alert.undeliverable — set PERPLEXITY_ALERT_SLACK_CHANNEL",
      new Error(text),
    );
    return;
  }
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text }),
    });
    const body = (await res.json()) as { ok?: boolean; error?: string };
    if (!body.ok) {
      logger.error("perplexity.alert.rejected", new Error(body.error || "unknown"));
    }
  } catch (err) {
    logger.error(
      "perplexity.alert.failed",
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

// ── The token function (f) ────────────────────────────────────────

/** True when less than 20% of this token's lifetime remains. */
export function needsRefresh(tokens: StoredTokens, now = Date.now()): boolean {
  const lifetime = tokens.expires_at - tokens.issued_at;
  if (lifetime <= 0) return true;
  const remaining = tokens.expires_at - now;
  return remaining / lifetime < REFRESH_AT_REMAINING_FRACTION;
}

/**
 * Get a usable access token, renewing first if it is close to expiry.
 *
 * Every Perplexity call goes through this. Throws when the login is broken,
 * having already alerted and halted — callers should let that propagate rather
 * than falling back to an expired token.
 */
export async function getPerplexityAccessToken(account: string): Promise<string> {
  const stopped = halted.get(account);
  if (stopped) {
    throw new Error(`Perplexity account "${account}" is halted: ${stopped.reason}`);
  }

  const tokens = await loadTokens(account);
  if (!tokens) {
    halt(account, "no stored tokens — the one-time browser sign-in has not been done");
    throw new Error(`Perplexity account "${account}" is not signed in`);
  }

  if (!needsRefresh(tokens)) return tokens.access_token;

  // Nothing to renew with. Perplexity does not always issue a refresh token,
  // so this is a normal state, not corruption — but it does mean the login
  // runs out and only a person can restore it. Halt and say exactly that,
  // rather than looping on a renewal that cannot work.
  if (!tokens.refresh_token) {
    halt(
      account,
      "the access token is expiring and Perplexity issued no refresh token — " +
        "re-run: npx tsx scripts/perplexity-signin.ts --client=<id>",
    );
    throw new Error(
      `Perplexity account "${account}" needs a manual sign-in: no refresh token`,
    );
  }

  try {
    const renewed = await refreshTokens(account, tokens);
    return renewed.access_token;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    halt(account, `refresh failed: ${detail}`);
    throw new Error(`Perplexity token refresh failed for "${account}": ${detail}`);
  }
}

/**
 * Convenience for callers that hold a replybot client id rather than an
 * account — the reply loop reads reply_items.client_id. Returns both so the
 * caller can record which account did the work in reply_items.pplx_account;
 * a conversation can only be continued by the account that started it.
 */
export async function getAccessTokenForClient(
  clientId: string,
): Promise<{ account: string; accessToken: string }> {
  const account = perplexityAccountForClient(clientId);
  return { account, accessToken: await getPerplexityAccessToken(account) };
}
