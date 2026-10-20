/**
 * Warn #test-channel before a client's saved Clay session runs out, and when
 * Clay has already signed it out.
 *
 * Everything that reads Clay from the server rides on that one cookie (the
 * inbox poller, the stuck-investor DM, /dash, the bounce guard, thread lookups
 * on Send). When it lapses each of them only logs a warning, so Zeutara
 * replies would quietly stop arriving. The stored session said 2026-10-21 on
 * 2026-10-13; Clay re-issues it as it is used, and whether that ever pushes
 * the date out indefinitely is unknown, so the warning goes by what Clay last
 * said.
 *
 * At most one post per kind per UTC day, across restarts and running copies
 * of Togari, keyed by a marker saved next to the session.
 */
import { getTenantSecret, setTenantSecret } from "../../secrets/tenantSecrets";
import {
  clayClients,
  clayWorkspace,
  getReplybotClient,
} from "../../agents/replybot/client-config";
import { slackBotTokenFor } from "../../transports/slack/installations";
import { createLogger } from "../../observability/logger";
import { sessionHealth, type SessionHealth } from "./campaign-read";

const logger = createLogger("ClaySessionAlert");

// #test-channel in our workspace. Overridable without a deploy.
const ALERT_CHANNEL = () =>
  process.env.CLAY_SESSION_ALERT_CHANNEL || "C0C14UKEEUR";
// Three days leaves a weekend to re-save the cookie (guessed, never measured).
const WARN_MS = 3 * 24 * 3_600_000;
const MARKER_KEY = "clay_session_alerted";

export type SessionAlert = { kind: "signed_out" | "expiring"; text: string };

export function sessionAlert(
  clientName: string,
  health: SessionHealth,
  now = Date.now(),
): SessionAlert | null {
  const what =
    "Togari's reads of their Clay inbox and campaigns (new replies, the dashboard and calendar numbers)";
  const fix =
    "Sign in to Clay, copy the `claysession` cookie, and save it with `npx tsx scripts/save-clay-session.ts <client>`.";
  const expired = health.expiresAt && health.expiresAt.getTime() <= now;
  if (health.signedOut || expired)
    return {
      kind: "signed_out",
      text: `:rotating_light: ${clientName}'s Clay session is signed out, so ${what} have stopped. ${fix}`,
    };
  if (health.expiresAt && health.expiresAt.getTime() - now < WARN_MS) {
    const hours = Math.round((health.expiresAt.getTime() - now) / 3_600_000);
    const left = hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours}h`;
    return {
      kind: "expiring",
      text: `:warning: ${clientName}'s Clay session expires ${health.expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC, in ${left}. When it does, ${what} stop. ${fix}`,
    };
  }
  return null;
}

export async function runSessionAlert(
  clientId: string,
  now = Date.now(),
): Promise<SessionAlert | null> {
  const client = getReplybotClient(clientId);
  if (!client || !clayWorkspace(client)) return null;
  const alert = sessionAlert(
    client.displayName,
    await sessionHealth(clientId),
    now,
  );
  if (!alert) return null;
  const marker = `${alert.kind}|${new Date(now).toISOString().slice(0, 10)}`;
  if ((await getTenantSecret(clientId, MARKER_KEY)) === marker) return null;
  // Saved before posting: a lost post beats the channel getting it every hour.
  await setTenantSecret(clientId, MARKER_KEY, marker);
  const res = (await (
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${await slackBotTokenFor()}`,
      },
      body: JSON.stringify({ channel: ALERT_CHANNEL(), text: alert.text }),
    })
  ).json()) as { ok?: boolean; error?: string };
  if (!res.ok)
    logger.warn("clay_session_alert.post_failed", {
      clientId,
      error: res.error,
    });
  return alert;
}

/** Hourly; the first check waits for the poller's first Clay call. */
export function startClaySessionAlert(
  clientIds = clayClients("sessionAlert"),
): void {
  if (process.env.CLAY_SESSION_ALERT_OFF === "1") return;
  const tick = () => {
    for (const id of clientIds)
      runSessionAlert(id)
        .then((a) => {
          if (a) logger.info("clay_session_alert.sent", { clientId: id, kind: a.kind });
        })
        .catch((err) =>
          logger.warn("clay_session_alert.failed", {
            clientId: id,
            error: String(err),
          }),
        );
  };
  setTimeout(tick, 2 * 60_000).unref();
  setInterval(tick, 3_600_000).unref();
}
