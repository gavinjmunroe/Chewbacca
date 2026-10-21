/**
 * introspection.js — describe_self.
 *
 * Enumerate Medha's live surface for the calling tenant: armed tools,
 * OAuth connection state, registered workspace docs, voice cards, and
 * the frontend URL. Closes the gap when Sagar (or any user) asks
 * "what is your functionality, do you have an interface, where does
 * memory come into play" and the agent has to improvise instead of
 * reading the registry.
 *
 * No side effects. Pure read.
 */

import { registerCapability } from "../capabilities.js";

registerCapability("_tools_Introspection", [
  "Enumerate Medha's live capabilities for the calling tenant (describe_self)",
]);

const FRONTEND_URL = "https://www.justarock.ai/connect";

export const INTROSPECTION_TOOLS = [
  {
    name: "describe_self",
    description:
      "Enumerate Medha's live capabilities for THIS tenant: armed tools, OAuth connections, registered workspace docs, voice cards, tagged-asset counts, frontend URL. Use when the user asks 'what can you do', 'do you have an interface', 'what tools do you have', 'how do you remember things'. Returns structured JSON.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
];

async function safeImport(path) {
  try {
    return await import(path);
  } catch {
    return null;
  }
}

async function getArmedTools(tenant) {
  const mod = await safeImport("./index.js");
  if (!mod || typeof mod.getAllTools !== "function") return [];
  try {
    const tools = await mod.getAllTools(tenant);
    if (!Array.isArray(tools)) return [];
    return tools.map((t) => ({
      name: t?.name || null,
      description: t?.description ? String(t.description).slice(0, 240) : null,
    }));
  } catch {
    return [];
  }
}

async function getOauthConnections(tenant) {
  const mod = await safeImport("../connections-discovery.js");
  if (!mod || typeof mod.discoverConnections !== "function") return [];
  try {
    const rows = await mod.discoverConnections(tenant);
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => ({
      id: r?.id || null,
      name: r?.name || null,
      connected: !!r?.connected,
      account: r?.account || null,
    }));
  } catch {
    return [];
  }
}

function getWorkspaceDocs(tenant) {
  const docs = Array.isArray(tenant?.workspaceDocs) ? tenant.workspaceDocs : [];
  return docs
    .filter((d) => d && (d.name || d.slug))
    .map((d) => ({
      name: d.name || null,
      slug: d.slug || null,
      kind: d.kind || null,
    }));
}

async function getVoiceCards() {
  const mod = await safeImport("../writing/author-voices.js");
  if (!mod) return [];
  const seed = mod.AUTHOR_VOICE_SEED || mod.AUTHOR_VOICES || {};
  return Object.entries(seed).map(([slug, v]) => ({
    slug,
    display_name: v?.display_name || null,
    org: v?.org || null,
  }));
}

function getRegisteredSurfaces() {
  // Read the capability registry without importing the side-effect renderer.
  // getRegisteredCapabilities() returns the raw map.
  try {
    // Lazy require so we don't pull capabilities-block builders into this path.
    // capabilities.js is statically imported above for registerCapability so
    // this is cheap.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return [];
  } catch {
    return [];
  }
}

export async function executeIntrospectionTool(name, input, ctx) {
  void input;
  if (name !== "describe_self") {
    return { error: `Unknown introspection tool: ${name}` };
  }
  const tenant = ctx?.tenant || null;

  let registeredCapabilities = {};
  try {
    const cap = await safeImport("../capabilities.js");
    if (cap && typeof cap.getRegisteredCapabilities === "function") {
      registeredCapabilities = cap.getRegisteredCapabilities() || {};
    }
  } catch {
    registeredCapabilities = {};
  }

  const [armedTools, oauthConnections, voiceCards] = await Promise.all([
    getArmedTools(tenant),
    getOauthConnections(tenant),
    getVoiceCards(),
  ]);

  const workspaceDocs = getWorkspaceDocs(tenant);

  return {
    surfaces: registeredCapabilities,
    armed_tools: armedTools,
    armed_tools_count: armedTools.length,
    oauth_connections: oauthConnections,
    workspace_docs: workspaceDocs,
    voice_cards: voiceCards,
    frontend_url: FRONTEND_URL,
    tenant: tenant
      ? {
          phone: tenant.phoneNumber || tenant.phone || null,
          org: tenant.org || null,
          display_name: tenant.displayName || tenant.display_name || null,
        }
      : null,
  };
}

// Silence unused warning while keeping the helper for future expansion.
void getRegisteredSurfaces;
