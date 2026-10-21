/**
 * Minimal Expo push sender — POSTs to the Expo push HTTP API. No SDK, no new
 * provider. Best-effort: every failure is logged and swallowed so a push never
 * breaks the caller's flow.
 *
 * THE THING THIS FILE GOT WRONG, AND WHY NOTHING EVER ARRIVED.
 *
 * It only checked `res.ok`. Expo returns HTTP **200** for a request it accepted and
 * then reports per-message outcomes in the body:
 *
 *   {"data":[{"status":"error","details":{"error":"InvalidCredentials"}}, …]}
 *
 * So a completely dead pipeline — no APNs key uploaded, key under the wrong Apple
 * team, every token stale — looked exactly like a successful send. Every push in
 * this product could have been failing since the day it was written and nothing
 * anywhere would have said so. The response body is now parsed, every ticket error
 * is logged with its token, and a `DeviceNotRegistered` token is handed back to the
 * caller so it can be deleted instead of retried forever.
 *
 * https://docs.expo.dev/push-notifications/sending-notifications/
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE = 100;
const TIMEOUT_MS = 10000;

// Expo push tokens look like ExponentPushToken[...] or ExpoPushToken[...].
function isExpoToken(to) {
  return (
    typeof to === "string" &&
    (to.startsWith("ExponentPushToken[") || to.startsWith("ExpoPushToken["))
  );
}

/**
 * Send Expo push messages. `messages` = [{ to, title, body, data }].
 * Entries whose `to` is not an Expo token are dropped. Sends in batches of
 * <=100. Never throws.
 *
 * Returns { sent, failed, unregistered } — `unregistered` being the tokens Expo
 * says belong to an app that has been uninstalled or whose token has rotated. The
 * caller should delete those; nothing will ever be delivered to them again.
 */
export async function sendExpoPush(messages, { fetchImpl = fetch } = {}) {
  const result = { sent: 0, failed: 0, unregistered: [] };
  try {
    const valid = (Array.isArray(messages) ? messages : []).filter((m) =>
      isExpoToken(m?.to),
    );
    const dropped = (Array.isArray(messages) ? messages.length : 0) - valid.length;
    if (dropped > 0) {
      console.warn(`[expo-push] dropped ${dropped} message(s) with a non-Expo token`);
    }
    if (valid.length === 0) return result;

    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
      const batch = valid.slice(i, i + BATCH_SIZE);
      try {
        const res = await fetchImpl(EXPO_PUSH_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res || !res.ok) {
          const body = await res?.text?.().catch(() => "");
          result.failed += batch.length;
          console.warn(
            `[expo-push] send ${res?.status}: ${String(body || "").slice(0, 300)}`,
          );
          continue;
        }
        // HTTP 200 does NOT mean delivered. Read the tickets.
        const payload = await res.json().catch(() => null);
        const tickets = Array.isArray(payload?.data) ? payload.data : [];
        if (tickets.length === 0) {
          // Accepted but told us nothing: count it as sent rather than inventing a
          // failure, and say so, because it is not a shape we expect.
          result.sent += batch.length;
          console.warn("[expo-push] 200 with no ticket array in the response body");
          continue;
        }
        tickets.forEach((ticket, idx) => {
          if (ticket?.status === "ok") {
            result.sent += 1;
            return;
          }
          result.failed += 1;
          const code = ticket?.details?.error || "unknown";
          const to = batch[idx]?.to;
          // Logged at error, not warn: every one of these is a notification a user
          // was supposed to receive and did not.
          console.error(
            `[expo-push] ticket error ${code}: ${ticket?.message || ""} token=${String(to).slice(0, 30)}`,
          );
          if (code === "DeviceNotRegistered" && to) result.unregistered.push(to);
        });
      } catch (err) {
        result.failed += batch.length;
        console.warn(`[expo-push] batch send failed: ${err?.message || err}`);
      }
    }
    return result;
  } catch (err) {
    // Belt-and-suspenders: never let a push error escape.
    console.warn(`[expo-push] sendExpoPush error: ${err?.message || err}`);
    return result;
  }
}
