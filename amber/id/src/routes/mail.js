/**
 * MAIL SYNC: status, and a way to run it.
 *
 *   GET  /v1/me/mail/accounts   which mailboxes are connected, when each last
 *                               synced, and what went wrong if anything did
 *   POST /v1/me/mail/sync       read headers now, then refresh the frequency
 *                               numbers the cards and the ranker read
 *
 * There is no route here that reads message content, because nothing in this
 * service fetches message content. Turning that on is a per-mailbox flag on
 * mail_sync_state and a separate path; it is deliberately not a query
 * parameter on a sync anybody can call.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone } from "../db/store.js";
import { readSyncableAccounts } from "../db/calendar-accounts.js";
import { syncOwnerMail } from "../lib/gmail-sync.js";
import { getMailSyncState } from "../db/email-interactions.js";
import { refreshChannelStats, refreshInteractionStats } from "../db/contact-rollup.js";

export function registerMailRoutes(app, deps = {}) {
  const {
    // Injected the way contact-notes and the other route modules inject it, so
    // these routes can be exercised without minting a real session token.
    requireAuth = defaultRequireAuth,
    syncMail = syncOwnerMail,
    accountsFor = readSyncableAccounts,
    stateFor = getMailSyncState,
    refreshChannels = refreshChannelStats,
    refreshTotals = refreshInteractionStats,
    resolveOwnerId = resolveAmberIdByPhone,
  } = deps;

  async function owner(request, reply) {
    const phone = request.privyUser?.phone;
    if (!phone) {
      reply.code(400).send({
        error: "no_phone_on_session",
        message: "Session carries no phone — cannot resolve owner.",
      });
      return null;
    }
    const ownerId = await resolveOwnerId(phone).catch(() => null);
    if (!ownerId) {
      reply.code(500).send({ error: "could_not_resolve_owner" });
      return null;
    }
    return ownerId;
  }

  app.get("/v1/me/mail/accounts", { preHandler: [requireAuth] }, async (request, reply) => {
    const ownerId = await owner(request, reply);
    if (!ownerId) return;

    const accounts = (await accountsFor(ownerId).catch(() => [])).filter(
      (a) => a.provider === "google",
    );
    const out = [];
    for (const a of accounts) {
      const state = await stateFor(ownerId, a.id).catch(() => null);
      out.push({
        accountId: String(a.id),
        email: a.account_email ?? null,
        provider: a.provider,
        lastSyncedAt: state?.last_synced_at ?? null,
        backfilledTo: state?.backfilled_to ?? null,
        lastError: state?.last_error ?? null,
        lastErrorAt: state?.last_error_at ?? null,
        // Said out loud so a settings screen can show it rather than assume it.
        readsContents: Boolean(state?.read_contents),
        neverSynced: !state?.last_synced_at,
      });
    }
    return { accounts: out, count: out.length };
  });

  app.post("/v1/me/mail/sync", { preHandler: [requireAuth] }, async (request, reply) => {
    const ownerId = await owner(request, reply);
    if (!ownerId) return;

    const accounts = await accountsFor(ownerId).catch(() => []);
    if (!accounts.length) {
      return reply.code(409).send({
        error: "no_connected_accounts",
        message: "Connect a Google account before syncing mail.",
      });
    }

    const result = await syncMail(ownerId, accounts).catch((err) => {
      request.log?.error?.({ err: err?.message }, "[mail] sync threw");
      return null;
    });
    if (!result) return reply.code(503).send({ error: "sync_failed" });

    // The numbers cards and ranking read are derived, so they are stale the
    // moment new messages land. Refreshed here rather than on a timer, because
    // the person who just triggered a sync is the one about to look at them.
    //
    // Best-effort, and in this order: totals are what the ranker reads, so they
    // matter more than the per-channel breakdown a card shows.
    let totals = 0;
    let channels = 0;
    try {
      totals = await refreshTotals(ownerId);
      channels = await refreshChannels(ownerId);
    } catch (err) {
      request.log?.warn?.({ err: err?.message }, "[mail] stats refresh failed after sync");
    }

    return { ...result, stats: { totals, channels } };
  });
}
