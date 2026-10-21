/**
 * Linear tools — GraphQL API client.
 *
 * Per-tenant secret: LINEAR_API_KEY
 * Endpoint: https://api.linear.app/graphql
 *
 * Tools:
 *   linear_list_issues   (teamId?, assigneeId?, state?)
 *   linear_create_issue  (teamId, title, description?, priority?)
 *   linear_update_issue  (issueId, state?, title?, priority?)
 *   linear_list_teams
 *   linear_search        (query)
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";

registerCapability("_tools_Linear", "Read and manage Linear issues and teams");

const GQL_URL = "https://api.linear.app/graphql";

// Priority map: human label → Linear int
const PRIORITY = { urgent: 1, high: 2, medium: 3, low: 4, none: 0 };

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

export const LINEAR_TOOLS = [
  {
    name: "linear_list_issues",
    description:
      "List Linear issues. Optionally filter by team, assignee, or state.",
    input_schema: {
      type: "object",
      properties: {
        teamId: { type: "string", description: "Linear team ID" },
        assigneeId: {
          type: "string",
          description: "Filter by assignee user ID",
        },
        state: {
          type: "string",
          description:
            "Filter by state name (e.g. 'In Progress', 'Todo', 'Done')",
        },
      },
    },
  },
  {
    name: "linear_create_issue",
    description: "Create a new Linear issue.",
    input_schema: {
      type: "object",
      required: ["teamId", "title"],
      properties: {
        teamId: { type: "string", description: "Linear team ID" },
        title: { type: "string" },
        description: {
          type: "string",
          description: "Markdown body of the issue",
        },
        priority: {
          type: "string",
          enum: ["urgent", "high", "medium", "low", "none"],
        },
      },
    },
  },
  {
    name: "linear_update_issue",
    description: "Update an existing Linear issue (state, title, or priority).",
    input_schema: {
      type: "object",
      required: ["issueId"],
      properties: {
        issueId: { type: "string" },
        state: { type: "string", description: "New state name" },
        title: { type: "string" },
        priority: {
          type: "string",
          enum: ["urgent", "high", "medium", "low", "none"],
        },
      },
    },
  },
  {
    name: "linear_list_teams",
    description: "List all Linear teams accessible with the API key.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "linear_search",
    description: "Full-text search across Linear issues.",
    input_schema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Search query string" },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeLinearTool(toolName, input, ctx) {
  const tenant = ctx?.tenant ?? ctx;
  const apiKey = await getSecret(tenant, "LINEAR_API_KEY").catch(() => null);
  if (!apiKey) {
    return {
      error: "LINEAR_API_KEY not set",
      hint: "connect-first",
    };
  }

  try {
    switch (toolName) {
      case "linear_list_issues":
        return listIssues(apiKey, input);
      case "linear_create_issue":
        return createIssue(apiKey, input);
      case "linear_update_issue":
        return updateIssue(apiKey, input);
      case "linear_list_teams":
        return listTeams(apiKey);
      case "linear_search":
        return searchIssues(apiKey, input);
      default:
        return { error: `Unknown Linear tool: ${toolName}` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

async function gql(apiKey, query, variables = {}) {
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey, // Linear accepts raw key (no Bearer prefix)
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data;
}

async function listIssues(apiKey, { teamId, assigneeId, state } = {}) {
  const filters = [];
  if (teamId) filters.push(`team: { id: { eq: "${teamId}" } }`);
  if (assigneeId) filters.push(`assignee: { id: { eq: "${assigneeId}" } }`);
  if (state) filters.push(`state: { name: { eq: "${state}" } }`);

  const filterStr = filters.length ? `(filter: { ${filters.join(", ")} })` : "";

  const query = `
    query {
      issues${filterStr} {
        nodes {
          id
          title
          description
          priority
          state { name }
          assignee { name email }
          team { id name }
          createdAt
          updatedAt
          url
        }
      }
    }`;

  const data = await gql(apiKey, query);
  return { issues: data.issues.nodes };
}

async function createIssue(apiKey, { teamId, title, description, priority }) {
  const priorityNum =
    priority !== undefined ? (PRIORITY[priority] ?? 0) : undefined;

  const mutation = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          title
          url
          state { name }
          priority
        }
      }
    }`;

  const inputVars = { teamId, title };
  if (description) inputVars.description = description;
  if (priorityNum !== undefined) inputVars.priority = priorityNum;

  const data = await gql(apiKey, mutation, { input: inputVars });
  return data.issueCreate;
}

async function updateIssue(apiKey, { issueId, state, title, priority }) {
  // If state name given, resolve to state ID first
  let stateId;
  if (state) {
    stateId = await resolveStateId(apiKey, issueId, state);
  }

  const mutation = `
    mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue {
          id
          title
          url
          state { name }
          priority
        }
      }
    }`;

  const inputVars = {};
  if (stateId) inputVars.stateId = stateId;
  if (title) inputVars.title = title;
  if (priority !== undefined) inputVars.priority = PRIORITY[priority] ?? 0;

  const data = await gql(apiKey, mutation, { id: issueId, input: inputVars });
  return data.issueUpdate;
}

async function resolveStateId(apiKey, issueId, stateName) {
  // Get the team from the issue, then find state in that team
  const q = `
    query($id: String!) {
      issue(id: $id) {
        team {
          states {
            nodes { id name }
          }
        }
      }
    }`;
  const data = await gql(apiKey, q, { id: issueId });
  const states = data.issue?.team?.states?.nodes ?? [];
  const found = states.find(
    (s) => s.name.toLowerCase() === stateName.toLowerCase(),
  );
  return found?.id ?? null;
}

async function listTeams(apiKey) {
  const query = `
    query {
      teams {
        nodes { id name key description }
      }
    }`;
  const data = await gql(apiKey, query);
  return { teams: data.teams.nodes };
}

async function searchIssues(apiKey, { query }) {
  const q = `
    query($term: String!) {
      issueSearch(query: $term) {
        nodes {
          id
          title
          state { name }
          assignee { name }
          team { name }
          url
          priority
        }
      }
    }`;
  const data = await gql(apiKey, q, { term: query });
  return { results: data.issueSearch.nodes };
}
