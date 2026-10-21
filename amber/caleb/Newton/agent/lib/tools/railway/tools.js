/**
 * railway/tools.js — Anthropic tool schemas + dispatcher for Railway.
 *
 * Tool naming: railway_<verb>_<noun>. Each handler returns either a
 * plain result object on success or the NOT_CONNECTED payload (via
 * client.js' buildNotConnected) when the tenant has no Railway PAT.
 *
 * v1 scope: read-mostly + the two write operations Caleb actually
 * wants from iMessage (trigger_deploy + rollback_deploy). Both writes
 * carry an explicit `confirm: true` requirement so the model can't
 * fire them off without a clear user signal.
 *
 * Intentionally NOT in v1:
 *   - railway_set_variable     too easy for a model to leak secret
 *                              values back to chat
 *   - railway_create_service   large blast radius, low frequency
 *   - railway_delete_service   destructive, irreversible
 *
 * The list_variable_names tool returns KEYS only (not values), so
 * Medha can answer "which env vars are set on medha-platform" without
 * ever seeing the secret values.
 */

import {
  railwayQuery,
  buildNotConnected,
  resolveRailwayAuth,
} from "./client.js";

// ─── Tool schemas ────────────────────────────────────────────────────────────

export const RAILWAY_TOOLS = [
  {
    name: "railway_get_user",
    description:
      "Get the connected Railway account (email, name, username). Use this to confirm which Railway identity Medha is acting as.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "railway_list_projects",
    description:
      "List the projects the connected Railway user has access to. Returns id, name, description, createdAt.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "railway_list_services",
    description:
      "List services on a Railway project. Pass the project id from railway_list_projects.",
    input_schema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "railway_list_deployments",
    description:
      "List recent deployments for a service. Returns id, status, createdAt, commit info if available. Use to find a previous deploy to roll back to.",
    input_schema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        service_id: { type: "string" },
        environment_id: {
          type: "string",
          description:
            "Defaults to the first environment on the project (usually production).",
        },
        limit: { type: "number" },
      },
      required: ["project_id", "service_id"],
    },
  },
  {
    name: "railway_get_deploy_status",
    description:
      "Get the current status of the latest deployment for a service (queued, building, deploying, success, failed, crashed). Use this when the user asks 'is the deploy done yet?'",
    input_schema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        service_id: { type: "string" },
        environment_id: { type: "string" },
      },
      required: ["project_id", "service_id"],
    },
  },
  {
    name: "railway_get_deploy_logs",
    description:
      "Get logs from a deployment. Default returns the last 100 lines from the latest deployment for the service.",
    input_schema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        service_id: { type: "string" },
        environment_id: { type: "string" },
        deployment_id: {
          type: "string",
          description:
            "Optional. If omitted, uses the latest deployment for the service.",
        },
        limit: {
          type: "number",
          description: "Max log lines (default 100, hard cap 500).",
        },
      },
      required: ["project_id", "service_id"],
    },
  },
  {
    name: "railway_trigger_deploy",
    description:
      "Trigger a redeploy of the latest build for a service. ALWAYS confirm with the user verbally BEFORE calling this -- this kicks off a production deploy. The `confirm` parameter must be set to true; without it, the call returns a preview instead of executing.",
    input_schema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        service_id: { type: "string" },
        environment_id: { type: "string" },
        confirm: {
          type: "boolean",
          description:
            "Must be true to actually trigger. Without it, the call returns a 'pending_confirmation' preview that you should relay to the user.",
        },
      },
      required: ["project_id", "service_id"],
    },
  },
  {
    name: "railway_rollback_deploy",
    description:
      "Redeploy a specific past deployment (rollback). ALWAYS confirm with the user verbally BEFORE calling. Pass `confirm: true` and the `deployment_id` of the deploy you want to redeploy as-is.",
    input_schema: {
      type: "object",
      properties: {
        deployment_id: { type: "string" },
        confirm: { type: "boolean" },
      },
      required: ["deployment_id"],
    },
  },
  {
    name: "railway_list_variable_names",
    description:
      "List env var NAMES set on a service (NOT their values -- values are not returned to protect secrets). Use to answer 'which env vars are set on X'.",
    input_schema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        service_id: { type: "string" },
        environment_id: { type: "string" },
      },
      required: ["project_id", "service_id"],
    },
  },
  {
    name: "railway_get_service_url",
    description:
      "Get the public URL(s) for a service (Railway-assigned + any custom domains).",
    input_schema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        service_id: { type: "string" },
        environment_id: { type: "string" },
      },
      required: ["project_id", "service_id"],
    },
  },
];

export const RAILWAY_TOOL_NAMES = new Set(RAILWAY_TOOLS.map((t) => t.name));

// ─── Helpers ────────────────────────────────────────────────────────────────

const MAX_LOG_LINES = 500;

function clampInt(n, fallback, cap) {
  const v = Number.isFinite(n) ? Number(n) : fallback;
  return Math.max(1, Math.min(cap, v));
}

/**
 * Resolve an environment_id, defaulting to the first environment on the
 * project. Most Railway projects have one environment ("production").
 */
async function defaultEnvironmentId(tenant, projectId, override) {
  if (override) return override;
  const data = await railwayQuery(
    tenant,
    `query ProjectEnvs($id: String!) {
       project(id: $id) {
         environments {
           edges { node { id name } }
         }
       }
     }`,
    { id: projectId },
  );
  const edges = data?.project?.environments?.edges || [];
  if (edges.length === 0) {
    throw new Error("no_environment_on_project");
  }
  // Prefer "production" if present; otherwise first.
  const prod = edges.find(
    (e) => (e.node?.name || "").toLowerCase() === "production",
  );
  return (prod || edges[0])?.node?.id;
}

async function latestDeploymentId(tenant, projectId, serviceId, environmentId) {
  const data = await railwayQuery(
    tenant,
    `query LatestDeploy($projectId: String!, $serviceId: String!, $environmentId: String!) {
       deployments(
         input: {
           projectId: $projectId,
           serviceId: $serviceId,
           environmentId: $environmentId
         },
         first: 1
       ) {
         edges { node { id status createdAt } }
       }
     }`,
    { projectId, serviceId, environmentId },
  );
  return data?.deployments?.edges?.[0]?.node || null;
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export async function executeRailwayTool(toolName, input, tenant = null) {
  try {
    return await execute(toolName, input || {}, tenant);
  } catch (err) {
    if (err.code === "railway_not_connected") {
      return err.notConnected;
    }
    return {
      error: err.code || "railway_tool_error",
      message: err.message,
      details: err.railwayErrors || null,
    };
  }
}

async function execute(toolName, input, tenant) {
  switch (toolName) {
    case "railway_get_user": {
      const data = await railwayQuery(
        tenant,
        `query Me {
           me { id email name username }
         }`,
      );
      return { user: data?.me || null };
    }

    case "railway_list_projects": {
      const data = await railwayQuery(
        tenant,
        `query Projects {
           me {
             projects {
               edges {
                 node { id name description createdAt }
               }
             }
           }
         }`,
      );
      const edges = data?.me?.projects?.edges || [];
      return {
        projects: edges.map((e) => ({
          id: e.node?.id,
          name: e.node?.name,
          description: e.node?.description,
          created: e.node?.createdAt,
        })),
      };
    }

    case "railway_list_services": {
      const data = await railwayQuery(
        tenant,
        `query ProjectServices($id: String!) {
           project(id: $id) {
             id name
             services {
               edges { node { id name } }
             }
             environments {
               edges { node { id name } }
             }
           }
         }`,
        { id: input.project_id },
      );
      const p = data?.project;
      if (!p)
        return { error: "project_not_found", project_id: input.project_id };
      return {
        project: { id: p.id, name: p.name },
        environments: (p.environments?.edges || []).map((e) => ({
          id: e.node?.id,
          name: e.node?.name,
        })),
        services: (p.services?.edges || []).map((e) => ({
          id: e.node?.id,
          name: e.node?.name,
        })),
      };
    }

    case "railway_list_deployments": {
      const environmentId = await defaultEnvironmentId(
        tenant,
        input.project_id,
        input.environment_id,
      );
      const limit = clampInt(input.limit, 10, 50);
      const data = await railwayQuery(
        tenant,
        `query Deployments($projectId: String!, $serviceId: String!, $environmentId: String!, $first: Int) {
           deployments(
             input: {
               projectId: $projectId,
               serviceId: $serviceId,
               environmentId: $environmentId
             },
             first: $first
           ) {
             edges {
               node {
                 id status createdAt updatedAt
                 meta
                 staticUrl
                 url
               }
             }
           }
         }`,
        {
          projectId: input.project_id,
          serviceId: input.service_id,
          environmentId,
          first: limit,
        },
      );
      const edges = data?.deployments?.edges || [];
      return {
        environment_id: environmentId,
        deployments: edges.map((e) => ({
          id: e.node?.id,
          status: e.node?.status,
          created: e.node?.createdAt,
          updated: e.node?.updatedAt,
          commit_sha:
            e.node?.meta?.commitHash || e.node?.meta?.commitSHA || null,
          commit_message: e.node?.meta?.commitMessage || null,
          branch: e.node?.meta?.branch || null,
          url: e.node?.staticUrl || e.node?.url || null,
        })),
      };
    }

    case "railway_get_deploy_status": {
      const environmentId = await defaultEnvironmentId(
        tenant,
        input.project_id,
        input.environment_id,
      );
      const latest = await latestDeploymentId(
        tenant,
        input.project_id,
        input.service_id,
        environmentId,
      );
      if (!latest) {
        return { error: "no_deployments", service_id: input.service_id };
      }
      return {
        deployment_id: latest.id,
        status: latest.status,
        created: latest.createdAt,
      };
    }

    case "railway_get_deploy_logs": {
      const limit = clampInt(input.limit, 100, MAX_LOG_LINES);
      let deploymentId = input.deployment_id;
      if (!deploymentId) {
        const environmentId = await defaultEnvironmentId(
          tenant,
          input.project_id,
          input.environment_id,
        );
        const latest = await latestDeploymentId(
          tenant,
          input.project_id,
          input.service_id,
          environmentId,
        );
        if (!latest) {
          return { error: "no_deployments", service_id: input.service_id };
        }
        deploymentId = latest.id;
      }
      const data = await railwayQuery(
        tenant,
        `query DeployLogs($deploymentId: String!, $limit: Int) {
           deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
             timestamp message severity
           }
         }`,
        { deploymentId, limit },
      );
      const lines = data?.deploymentLogs || [];
      return {
        deployment_id: deploymentId,
        count: lines.length,
        // Truncate each line so the payload doesn't balloon the context.
        lines: lines.map((l) => ({
          ts: l.timestamp,
          severity: l.severity,
          msg: (l.message || "").slice(0, 1000),
        })),
      };
    }

    case "railway_trigger_deploy": {
      if (!input.confirm) {
        return {
          pending_confirmation: true,
          message:
            "About to trigger a redeploy of the latest build. Confirm with the user before re-calling with confirm: true.",
          project_id: input.project_id,
          service_id: input.service_id,
        };
      }
      const environmentId = await defaultEnvironmentId(
        tenant,
        input.project_id,
        input.environment_id,
      );
      const data = await railwayQuery(
        tenant,
        `mutation Redeploy($serviceId: String!, $environmentId: String!) {
           serviceInstanceRedeploy(
             serviceId: $serviceId,
             environmentId: $environmentId
           )
         }`,
        {
          serviceId: input.service_id,
          environmentId,
        },
      );
      return {
        triggered: !!data?.serviceInstanceRedeploy,
        project_id: input.project_id,
        service_id: input.service_id,
        environment_id: environmentId,
      };
    }

    case "railway_rollback_deploy": {
      if (!input.confirm) {
        return {
          pending_confirmation: true,
          message:
            "About to redeploy a previous deployment (rollback). Confirm with the user before re-calling with confirm: true.",
          deployment_id: input.deployment_id,
        };
      }
      const data = await railwayQuery(
        tenant,
        `mutation Rollback($id: String!) {
           deploymentRedeploy(id: $id) {
             id status createdAt
           }
         }`,
        { id: input.deployment_id },
      );
      const r = data?.deploymentRedeploy;
      return {
        rollback_triggered: !!r,
        new_deployment_id: r?.id,
        status: r?.status,
      };
    }

    case "railway_list_variable_names": {
      const environmentId = await defaultEnvironmentId(
        tenant,
        input.project_id,
        input.environment_id,
      );
      // Railway's `variables` query returns a JSON map of key -> value.
      // We pull it, throw away the values, and return just the names so
      // the agent can never echo secret values back to chat.
      const data = await railwayQuery(
        tenant,
        `query Vars($projectId: String!, $environmentId: String!, $serviceId: String) {
           variables(
             projectId: $projectId,
             environmentId: $environmentId,
             serviceId: $serviceId
           )
         }`,
        {
          projectId: input.project_id,
          environmentId,
          serviceId: input.service_id,
        },
      );
      const vars = data?.variables || {};
      const names = Object.keys(vars).sort();
      return {
        environment_id: environmentId,
        count: names.length,
        names,
      };
    }

    case "railway_get_service_url": {
      const environmentId = await defaultEnvironmentId(
        tenant,
        input.project_id,
        input.environment_id,
      );
      const data = await railwayQuery(
        tenant,
        `query ServiceDomains($projectId: String!, $serviceId: String!, $environmentId: String!) {
           domains(
             projectId: $projectId,
             serviceId: $serviceId,
             environmentId: $environmentId
           ) {
             serviceDomains { domain }
             customDomains { domain }
           }
         }`,
        {
          projectId: input.project_id,
          serviceId: input.service_id,
          environmentId,
        },
      );
      const d = data?.domains || {};
      return {
        service_id: input.service_id,
        environment_id: environmentId,
        railway_domains: (d.serviceDomains || []).map((x) => x.domain),
        custom_domains: (d.customDomains || []).map((x) => x.domain),
      };
    }

    default:
      return { error: `Unknown Railway tool: ${toolName}` };
  }
}

/**
 * Service-to-service helper: returns { connected, account } shape.
 * Never throws.
 */
export async function railwayStatus(tenant) {
  const auth = await resolveRailwayAuth(tenant).catch(() => null);
  return {
    connected: !!auth,
    account: auth?.email || null,
    connect_url: !auth ? buildNotConnected().connect_url : null,
  };
}
