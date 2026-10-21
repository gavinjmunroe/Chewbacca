/**
 * togari-adapter — thin client for the togari-opportunity MCP server.
 *
 * togari-opportunity (internal name "togari-clay") runs on its own Railway
 * service and exposes an MCP server plus a /webhooks and /direct-api HTTP
 * surface. Rather than spin up the MCP transport from inside amber-agent
 * we call the direct-api HTTP endpoints, which cover the same 8 tools:
 *
 *   Signal Subscriptions:
 *     signal_create_subscription, signal_list_subscriptions,
 *     signal_update_subscription, signal_trigger_scan, signal_get_results
 *   One-Time Data Pulls:
 *     create_data_pull, get_data_pull_status, list_data_pulls
 *
 * The URL + api key come from env so the submodule pin stays the source
 * of truth for the *interface*, and the live service owns runtime state
 * (BigQuery, Stripe, Clay webhooks).
 */

const DEFAULT_TIMEOUT_MS = 15_000;

function baseUrl() {
  return (
    process.env.TOGARI_OPPORTUNITY_URL ||
    process.env.TOGARI_CLAY_URL ||
    "https://togari-clay-production.up.railway.app"
  );
}

function apiKey() {
  return (
    process.env.TOGARI_OPPORTUNITY_API_KEY ||
    process.env.TOGARI_CLAY_API_KEY ||
    ""
  );
}

async function call(path, { method = "POST", body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = `${baseUrl().replace(/\/$/, "")}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(apiKey() ? { Authorization: `Bearer ${apiKey()}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const err = new Error(
        `togari-opportunity ${method} ${path} -> ${res.status}`,
      );
      err.status = res.status;
      err.body = data ?? text;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// ── exported operations ───────────────────────────────────────────────────

export async function ping() {
  try {
    const data = await call("/health", { method: "GET", timeoutMs: 5_000 });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message, status: err.status };
  }
}

/**
 * Create a signal subscription. Maps to MCP tool signal_create_subscription.
 */
export async function createSignalSubscription({
  clientId,
  name,
  naturalLanguageQuery,
  frequency = "daily",
  plan = "starter",
  channels = [],
}) {
  return call("/direct-api/signal/create", {
    body: { clientId, name, naturalLanguageQuery, frequency, plan, channels },
  });
}

/**
 * Trigger a signal scan manually (typed test / on-demand opportunity pull).
 * Maps to signal_trigger_scan.
 */
export async function triggerSignalScan({ subscriptionId, dryRun = false }) {
  return call("/direct-api/signal/trigger", {
    body: { subscriptionId, dryRun },
  });
}

/**
 * Fetch recent signal results. Maps to signal_get_results.
 */
export async function getSignalResults({ subscriptionId, limit = 25 }) {
  return call("/direct-api/signal/results", {
    body: { subscriptionId, limit },
  });
}

/**
 * Create a one-time data pull. Maps to create_data_pull.
 */
export async function createDataPull({
  clientId,
  naturalLanguageQuery,
  maxContacts = 250,
}) {
  return call("/direct-api/data-pull/create", {
    body: { clientId, naturalLanguageQuery, maxContacts },
  });
}

/**
 * Check a data pull's status. Maps to get_data_pull_status.
 */
export async function getDataPullStatus({ dataPullId }) {
  return call(`/direct-api/data-pull/status`, {
    body: { dataPullId },
  });
}

export default {
  ping,
  createSignalSubscription,
  triggerSignalScan,
  getSignalResults,
  createDataPull,
  getDataPullStatus,
};
