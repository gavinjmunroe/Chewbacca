/**
 * Refresh-failure alarm: emit an iMessage to Caleb when an OAuth refresh
 * tool fails repeatedly for a tenant + provider pair.
 *
 * Hooked into the audit middleware so every refresh-flavor tool error
 * flows through `recordToolError`. We track a rolling 1h window of
 * failures per (tenantId, provider). When the count crosses
 * ALARM_THRESHOLD, we send one iMessage to Caleb naming the tenant +
 * provider + the reconnect URL, then reset the counter so subsequent
 * failures within the cooldown don't spam.
 *
 * In-memory state only. A restart wipes counters, which is fine: a
 * genuinely broken refresh re-trips the threshold within minutes.
 *
 * Env:
 *   MEDHA_REFRESH_ALARM_THRESHOLD   (default 5)
 *   MEDHA_REFRESH_ALARM_WINDOW_MS   (default 3_600_000, 1h)
 *   MEDHA_REFRESH_ALARM_COOLDOWN_MS (default 3_600_000, 1h)
 *   MEDHA_REFRESH_ALARM_DISABLED    (set to '1' to disable)
 *   MEDHA_REFRESH_ALARM_TARGET      (E.164 phone to alert; defaults to
 *                                    +15550100009 Caleb's known number)
 */

const ALARM_THRESHOLD = Number(process.env.MEDHA_REFRESH_ALARM_THRESHOLD || 5);
const WINDOW_MS = Number(
  process.env.MEDHA_REFRESH_ALARM_WINDOW_MS || 3_600_000,
);
const COOLDOWN_MS = Number(
  process.env.MEDHA_REFRESH_ALARM_COOLDOWN_MS || 3_600_000,
);
const DEFAULT_TARGET = "+15550100009";

// Map of `${tenantId}::${provider}` → { failures: number[], lastAlertAt: number }
const state = new Map();

/**
 * Pattern-match a tool name to a provider. Returns null if the tool
 * isn't recognized as a refresh-flavor call (no alarm to record).
 *
 * The tool surface uses two shapes:
 *   - `<provider>_refresh`         (e.g. `twitter_refresh`)
 *   - `refresh_<provider>_token`   (e.g. `refresh_railway_token`)
 *
 * Also catches the internal helpers when they get exposed via the
 * audit middleware (e.g. tool_name="gcal_token_refresh" from the
 * gcal/client.js logger).
 */
function detectProvider(toolName) {
  if (typeof toolName !== "string" || !toolName) return null;
  const lower = toolName.toLowerCase();
  if (!lower.includes("refresh")) return null;
  // <provider>_refresh
  const suffixMatch = lower.match(/^([a-z0-9_]+?)_(?:token_)?refresh$/);
  if (suffixMatch) return suffixMatch[1];
  // refresh_<provider>(_token)?
  const prefixMatch = lower.match(/^refresh_([a-z0-9_]+?)(?:_token)?$/);
  if (prefixMatch) return prefixMatch[1];
  return null;
}

function bucketKey(tenantId, provider) {
  return `${tenantId || "_no_tenant_"}::${provider}`;
}

function prune(entry, now) {
  entry.failures = entry.failures.filter((ts) => now - ts < WINDOW_MS);
}

async function sendAlert(target, body) {
  try {
    const { sendMessage } = await import("../transport.js");
    await sendMessage(target, body, {
      allowDuplicate: true,
      auditOrigin: "admin",
      webhookContact: target,
    });
  } catch (err) {
    console.warn(
      `[refresh-alarm] could not send iMessage alert: ${err?.message || err}`,
    );
  }
}

function buildAlertBody({ tenantId, provider, count, lastError }) {
  const lines = [
    `[medha alarm] ${provider} refresh failed ${count}x in the last hour.`,
    `tenant: ${tenantId || "(none)"}`,
    lastError ? `last error: ${String(lastError).slice(0, 200)}` : null,
    `https://medha-frontend-production-5f4f.up.railway.app/connect`,
  ].filter(Boolean);
  return lines.join("\n");
}

/**
 * Record a tool error. Called from the audit middleware's catch path.
 * Fire-and-forget — never throws. Skips silently when the tool isn't a
 * refresh-flavor call or when alarming is disabled.
 *
 * @param {string} toolName
 * @param {string|null} tenantId
 * @param {string|null} errorMessage
 */
export function recordToolError(toolName, tenantId, errorMessage) {
  if (process.env.MEDHA_REFRESH_ALARM_DISABLED === "1") return;
  const provider = detectProvider(toolName);
  if (!provider) return;

  const now = Date.now();
  const key = bucketKey(tenantId, provider);
  let entry = state.get(key);
  if (!entry) {
    entry = { failures: [], lastAlertAt: 0 };
    state.set(key, entry);
  }
  prune(entry, now);
  entry.failures.push(now);

  if (entry.failures.length < ALARM_THRESHOLD) return;
  if (now - entry.lastAlertAt < COOLDOWN_MS) return;

  entry.lastAlertAt = now;
  const target = process.env.MEDHA_REFRESH_ALARM_TARGET || DEFAULT_TARGET;
  const body = buildAlertBody({
    tenantId,
    provider,
    count: entry.failures.length,
    lastError: errorMessage,
  });
  console.warn(
    `[refresh-alarm] threshold hit tenant=${tenantId || "-"} provider=${provider} count=${entry.failures.length} target=${target}`,
  );
  sendAlert(target, body).catch(() => {});
}

// Test-only helpers.
export const __internals = {
  detectProvider,
  state,
  reset() {
    state.clear();
  },
};
