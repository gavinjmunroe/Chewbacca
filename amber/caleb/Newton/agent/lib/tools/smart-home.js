/**
 * smart-home.js — Home Assistant REST API integration.
 *
 * Home Assistant is the dominant open-source smart-home hub; supports 1000+
 * device integrations (lights, thermostats, locks, sensors). One API covers
 * everything the user has wired up in their HA install.
 *
 * Per-user secrets:
 *   HOMEASSISTANT_URL       (e.g. "https://home.example.com" or "http://homeassistant.local:8123")
 *   HOMEASSISTANT_TOKEN     (long-lived access token from HA profile page)
 *
 * Exposed tools:
 *   home_list_entities   — filter by domain (light, switch, sensor, etc.)
 *   home_get_state       — current state + attributes for one entity
 *   home_call_service    — trigger any service (turn_on, set_temperature, lock, …)
 *
 * All handlers return { error: "…" } on failure, never throw.
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";

registerCapability("_tools_SmartHome", [
  "List Home Assistant entities (home_list_entities)",
  "Read current state of a device (home_get_state)",
  "Control lights, thermostats, locks, etc. (home_call_service)",
]);

const DEFAULT_TIMEOUT_MS = 15_000;

async function getConfig(tenant) {
  const url = await getSecret(tenant, "HOMEASSISTANT_URL", {
    fallbackEnv: "HOMEASSISTANT_URL",
  });
  const token = await getSecret(tenant, "HOMEASSISTANT_TOKEN", {
    fallbackEnv: "HOMEASSISTANT_TOKEN",
  });
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

async function haFetch(cfg, path, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.url}/api${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`homeassistant ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Tool handlers ────────────────────────────────────────────────────────────

async function homeListEntities(input, tenant) {
  const cfg = await getConfig(tenant);
  if (!cfg) {
    return { error: "HOMEASSISTANT_URL / HOMEASSISTANT_TOKEN not configured" };
  }
  const { domain, limit } = input || {};
  try {
    const states = await haFetch(cfg, "/states");
    let filtered = Array.isArray(states) ? states : [];
    if (domain) {
      const prefix = `${domain}.`;
      filtered = filtered.filter((s) => s.entity_id?.startsWith(prefix));
    }
    const cap = Math.min(Number(limit) || 100, 500);
    return {
      entities: filtered.slice(0, cap).map((s) => ({
        entity_id: s.entity_id,
        state: s.state,
        friendly_name: s.attributes?.friendly_name || s.entity_id,
        domain: s.entity_id.split(".")[0],
      })),
      total: filtered.length,
      truncated: filtered.length > cap,
    };
  } catch (err) {
    return { error: String(err).slice(0, 200) };
  }
}

async function homeGetState(input, tenant) {
  const cfg = await getConfig(tenant);
  if (!cfg) {
    return { error: "HOMEASSISTANT_URL / HOMEASSISTANT_TOKEN not configured" };
  }
  const { entity_id } = input || {};
  if (!entity_id) return { error: "entity_id is required" };
  try {
    const data = await haFetch(
      cfg,
      `/states/${encodeURIComponent(entity_id)}`,
    );
    return {
      entity_id: data.entity_id,
      state: data.state,
      attributes: data.attributes || {},
      last_changed: data.last_changed,
      last_updated: data.last_updated,
    };
  } catch (err) {
    return { error: String(err).slice(0, 200) };
  }
}

async function homeCallService(input, tenant) {
  const cfg = await getConfig(tenant);
  if (!cfg) {
    return { error: "HOMEASSISTANT_URL / HOMEASSISTANT_TOKEN not configured" };
  }
  const { domain, service, entity_id, data } = input || {};
  if (!domain || !service) {
    return { error: "domain and service are required" };
  }
  const body = { ...(data || {}) };
  if (entity_id) body.entity_id = entity_id;
  try {
    const result = await haFetch(
      cfg,
      `/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`,
      { method: "POST", body: JSON.stringify(body) },
    );
    return {
      ok: true,
      affected: Array.isArray(result)
        ? result.map((s) => ({
            entity_id: s.entity_id,
            state: s.state,
          }))
        : [],
    };
  } catch (err) {
    return { error: String(err).slice(0, 200) };
  }
}

// ── Tool schemas ─────────────────────────────────────────────────────────────

export const SMART_HOME_TOOLS = [
  {
    name: "home_list_entities",
    description:
      "List Home Assistant entities with their current states. Filter by domain (light, switch, sensor, climate, lock, media_player, cover, fan, etc.) to narrow results. Use this to discover what devices are available before calling services.",
    input_schema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description:
            "Optional domain filter. Examples: 'light', 'switch', 'climate', 'lock', 'sensor', 'media_player'.",
        },
        limit: {
          type: "integer",
          description: "Max entities to return (default 100, max 500).",
        },
      },
    },
  },
  {
    name: "home_get_state",
    description:
      "Get the current state and all attributes of a single Home Assistant entity.",
    input_schema: {
      type: "object",
      properties: {
        entity_id: {
          type: "string",
          description: "Full entity ID, e.g. 'light.living_room'.",
        },
      },
      required: ["entity_id"],
    },
  },
  {
    name: "home_call_service",
    description:
      "Call any Home Assistant service to control a device. Examples: turn on a light (domain='light', service='turn_on', entity_id='light.bedroom'), set thermostat (domain='climate', service='set_temperature', entity_id='climate.main', data={temperature: 68}), lock door (domain='lock', service='lock', entity_id='lock.front').",
    input_schema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "Service domain, e.g. 'light', 'climate', 'lock'.",
        },
        service: {
          type: "string",
          description: "Service name, e.g. 'turn_on', 'set_temperature'.",
        },
        entity_id: {
          type: "string",
          description:
            "Target entity ID. Required for most services; omit for broadcast services.",
        },
        data: {
          type: "object",
          description:
            "Optional service data parameters, e.g. {brightness: 128, color_name: 'red'} for lights, {temperature: 68} for climate.",
        },
      },
      required: ["domain", "service"],
    },
  },
];

export async function executeSmartHomeTool(toolName, input, ctx = {}) {
  const tenant = ctx.tenant || null;
  switch (toolName) {
    case "home_list_entities":
      return homeListEntities(input, tenant);
    case "home_get_state":
      return homeGetState(input, tenant);
    case "home_call_service":
      return homeCallService(input, tenant);
    default:
      return { error: `unknown smart-home tool: ${toolName}` };
  }
}
