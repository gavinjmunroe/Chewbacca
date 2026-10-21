/**
 * Vercel tools — REST API client.
 *
 * Per-tenant secret: VERCEL_API_TOKEN
 * Endpoint base: https://api.vercel.com/
 *
 * Tools:
 *   vercel_list_projects
 *   vercel_get_project      (projectId)
 *   vercel_list_deployments (projectId?, limit?)
 *   vercel_get_deployment   (deploymentId)
 *   vercel_list_domains
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";

registerCapability(
  "_tools_Vercel",
  "List and inspect Vercel projects, deployments, and domains",
);

const API_BASE = "https://api.vercel.com/";

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

export const VERCEL_TOOLS = [
  {
    name: "vercel_list_projects",
    description: "List all Vercel projects for the authenticated account.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "vercel_get_project",
    description: "Get details for a specific Vercel project.",
    input_schema: {
      type: "object",
      required: ["projectId"],
      properties: {
        projectId: {
          type: "string",
          description: "Vercel project ID or name",
        },
      },
    },
  },
  {
    name: "vercel_list_deployments",
    description: "List recent deployments, optionally filtered by project.",
    input_schema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Filter by project ID or name",
        },
        limit: {
          type: "integer",
          description: "Max results (1-100). Defaults to 20.",
        },
      },
    },
  },
  {
    name: "vercel_get_deployment",
    description: "Get details for a specific deployment.",
    input_schema: {
      type: "object",
      required: ["deploymentId"],
      properties: {
        deploymentId: {
          type: "string",
          description: "Vercel deployment ID",
        },
      },
    },
  },
  {
    name: "vercel_list_domains",
    description: "List all domains registered in the Vercel account.",
    input_schema: { type: "object", properties: {} },
  },
];

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeVercelTool(toolName, input, ctx) {
  const tenant = ctx?.tenant ?? ctx;
  const token = await getSecret(tenant, "VERCEL_API_TOKEN").catch(() => null);
  if (!token) {
    return { error: "VERCEL_API_TOKEN not set", hint: "connect-first" };
  }

  try {
    switch (toolName) {
      case "vercel_list_projects":
        return listProjects(token);
      case "vercel_get_project":
        return getProject(token, input);
      case "vercel_list_deployments":
        return listDeployments(token, input);
      case "vercel_get_deployment":
        return getDeployment(token, input);
      case "vercel_list_domains":
        return listDomains(token);
      default:
        return { error: `Unknown Vercel tool: ${toolName}` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

async function vGet(path, token, qs = {}) {
  const params = new URLSearchParams(qs);
  const url = `${API_BASE}${path}${params.toString() ? `?${params}` : ""}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Vercel GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function listProjects(token) {
  const data = await vGet("v9/projects", token, { limit: "100" });
  return {
    projects: (data.projects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      framework: p.framework,
      link: p.link,
      latestDeployments: p.latestDeployments?.map((d) => ({
        id: d.id,
        url: d.url,
        state: d.readyState,
        createdAt: d.createdAt,
      })),
    })),
  };
}

async function getProject(token, { projectId }) {
  const data = await vGet(`v9/projects/${encodeURIComponent(projectId)}`, token);
  return {
    id: data.id,
    name: data.name,
    framework: data.framework,
    buildCommand: data.buildCommand,
    outputDirectory: data.outputDirectory,
    installCommand: data.installCommand,
    devCommand: data.devCommand,
    env: (data.env ?? []).map((e) => ({
      key: e.key,
      target: e.target,
      type: e.type,
    })),
    domains: data.alias ?? [],
  };
}

async function listDeployments(token, { projectId, limit = 20 } = {}) {
  const qs = { limit: String(Math.min(limit, 100)) };
  if (projectId) qs.projectId = projectId;
  const data = await vGet("v6/deployments", token, qs);
  return {
    deployments: (data.deployments ?? []).map((d) => ({
      id: d.uid,
      url: d.url,
      name: d.name,
      state: d.readyState,
      target: d.target,
      createdAt: d.createdAt,
      buildingAt: d.buildingAt,
      ready: d.ready,
    })),
  };
}

async function getDeployment(token, { deploymentId }) {
  const data = await vGet(
    `v13/deployments/${encodeURIComponent(deploymentId)}`,
    token,
  );
  return {
    id: data.id,
    url: data.url,
    name: data.name,
    state: data.readyState,
    target: data.target,
    createdAt: data.createdAt,
    meta: data.meta,
    builds: data.builds,
    errorMessage: data.errorMessage,
  };
}

async function listDomains(token) {
  const data = await vGet("v5/domains", token, { limit: "100" });
  return {
    domains: (data.domains ?? []).map((d) => ({
      name: d.name,
      serviceType: d.serviceType,
      configured: d.configured,
      verified: d.verified,
      expiresAt: d.expiresAt,
    })),
  };
}
