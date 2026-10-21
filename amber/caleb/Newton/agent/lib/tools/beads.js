/**
 * Beads task-graph tools.
 *
 * Replaces Todoist as the task management layer. Each tenant has a
 * Beads graph stored as `/beads/issues.json` inside their context repo
 * (via lib/context-repo.js). This is the "pure-JS fallback" implementation;
 * it is also the primary path since Railway containers do not ship the
 * `bd` binary.
 *
 * Schema for each task record:
 *   {
 *     id:          "bd-NNN"          // auto-incremented, padded
 *     title:       string
 *     description: string | null
 *     status:      "todo" | "in_progress" | "done" | "closed"
 *     priority:    0|1|2|3           // 0 = urgent, 3 = low (bd convention)
 *     tags:        string[]
 *     dimension:   "financial"|"intellectual"|"social"|"spiritual"|"emotional"|"physical" | null
 *     deps:        string[]          // IDs this task is blocked by
 *     created:     ISO8601
 *     updated:     ISO8601
 *   }
 *
 * bd sync note:
 *   When a real `bd` binary is available on PATH we shell out and delegate;
 *   the pure-JS graph is kept in sync as the source of truth. A future
 *   `bd sync` command (bd pull → issues.json export → bd push) can layer on
 *   top once Dolt export APIs stabilize.
 */

import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import { registerCapability } from "../capabilities.js";
import { readWikiFile, writeWikiFile } from "../context-repo.js";

const execFile = promisify(_execFile);

registerCapability(
  "_tools_Beads",
  "Task graph with dependency tracking across the six life dimensions",
);

// ── constants ──────────────────────────────────────────────────────────────

const ISSUES_PATH = "beads/issues.json";
const README_PATH = "beads/README.md";
const VALID_STATUSES = ["todo", "in_progress", "done", "closed"];
const VALID_DIMENSIONS = [
  "financial",
  "intellectual",
  "social",
  "spiritual",
  "emotional",
  "physical",
];

// ── bd binary detection ────────────────────────────────────────────────────

let _bdAvailable = null; // cached tri-state: true | false | null (unknown)

async function isBdAvailable() {
  if (_bdAvailable !== null) return _bdAvailable;
  try {
    await execFile("bd", ["--version"], { timeout: 3000 });
    _bdAvailable = true;
  } catch {
    _bdAvailable = false;
  }
  return _bdAvailable;
}

// ── pure-JS graph store ────────────────────────────────────────────────────

/**
 * Load the issues graph from the tenant's context repo.
 * Returns { tasks: Task[], nextId: number, sha: string|null }.
 * On first use (404) returns an empty graph with a README scaffold.
 */
async function loadGraph(tenant) {
  const res = await readWikiFile(tenant, ISSUES_PATH);
  if (!res.success) {
    if (res.status === 404) {
      return { tasks: [], nextId: 1, sha: null };
    }
    return { error: res.error || "could not read beads/issues.json" };
  }
  try {
    const parsed = JSON.parse(res.content);
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      nextId: typeof parsed.nextId === "number" ? parsed.nextId : 1,
      sha: res.sha,
    };
  } catch {
    return { error: "beads/issues.json is not valid JSON" };
  }
}

/**
 * Persist the graph back to the tenant's context repo.
 */
async function saveGraph(tenant, { tasks, nextId, sha }, commitMessage) {
  const content = JSON.stringify({ tasks, nextId }, null, 2) + "\n";
  const msg = commitMessage || "update(beads): task graph";
  const result = await writeWikiFile(tenant, ISSUES_PATH, content, msg, {
    sha: sha ?? undefined,
    skipShaLookup: sha !== null,
  });
  return result;
}

/**
 * Ensure README exists (fire-and-forget; don't fail the main op).
 */
async function ensureReadme(tenant) {
  const existing = await readWikiFile(tenant, README_PATH);
  if (existing.success) return;
  const readme = `# Beads task graph

This directory holds the Beads-compatible task graph for this context repo.

## \`issues.json\` schema

\`\`\`jsonc
{
  "nextId": 42,           // auto-increment counter
  "tasks": [
    {
      "id":          "bd-1",        // Beads-style ID
      "title":       "string",
      "description": "string|null",
      "status":      "todo|in_progress|done|closed",
      "priority":    0,             // 0=urgent … 3=low
      "tags":        ["string"],
      "dimension":   "financial|intellectual|social|spiritual|emotional|physical|null",
      "deps":        ["bd-2"],      // IDs that must be done first
      "created":     "ISO8601",
      "updated":     "ISO8601"
    }
  ]
}
\`\`\`

## Syncing with a real \`bd\` install

\`\`\`bash
# (future) export this JSON into a Dolt repo and push
bd prime --from=beads/issues.json
bd backup sync
\`\`\`

Until the \`bd sync\` bridge is stable, amber-agent writes directly to this
file. All historical state is preserved via git commit history.
`;
  await writeWikiFile(tenant, README_PATH, readme, "init(beads): README", {
    skipShaLookup: true,
  });
}

// ── dimension wiki cross-listing ───────────────────────────────────────────

/**
 * Rebuild the "Open Tasks" section of a dimension wiki page.
 * Non-destructive: replaces the block between <!-- beads:start --> and
 * <!-- beads:end --> markers, or appends a new block if absent.
 */
async function syncDimensionPage(tenant, dimension, allTasks) {
  if (!VALID_DIMENSIONS.includes(dimension)) return;
  const pagePath = `wiki/dimensions/${dimension}.md`;
  const openTasks = allTasks.filter(
    (t) => t.dimension === dimension && !["done", "closed"].includes(t.status),
  );

  const block = buildDimensionBlock(openTasks);
  const pageRes = await readWikiFile(tenant, pagePath);
  let pageContent;
  let sha = null;

  if (pageRes.success) {
    sha = pageRes.sha;
    const startMarker = "<!-- beads:start -->";
    const endMarker = "<!-- beads:end -->";
    const si = pageRes.content.indexOf(startMarker);
    const ei = pageRes.content.indexOf(endMarker);
    if (si !== -1 && ei !== -1 && ei > si) {
      pageContent =
        pageRes.content.slice(0, si) +
        startMarker +
        "\n" +
        block +
        endMarker +
        pageRes.content.slice(ei + endMarker.length);
    } else {
      pageContent =
        pageRes.content.trimEnd() +
        "\n\n" +
        startMarker +
        "\n" +
        block +
        endMarker +
        "\n";
    }
  } else {
    pageContent =
      `# ${capitalize(dimension)}\n\n` +
      "<!-- beads:start -->\n" +
      block +
      "<!-- beads:end -->\n";
  }

  await writeWikiFile(
    tenant,
    pagePath,
    pageContent,
    `update(${dimension}): open tasks`,
    { sha: sha ?? undefined, skipShaLookup: sha !== null },
  );
}

function buildDimensionBlock(tasks) {
  if (tasks.length === 0) return "## Open Tasks\n\n_No open tasks._\n\n";
  const lines = ["## Open Tasks", ""];
  for (const t of tasks) {
    const pri = t.priority !== undefined ? ` [P${t.priority}]` : "";
    const dep =
      t.deps && t.deps.length > 0 ? ` (blocked by ${t.deps.join(", ")})` : "";
    lines.push(`- **${t.id}**${pri} ${t.title}${dep} — _${t.status}_`);
  }
  lines.push("");
  return lines.join("\n");
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── task logic helpers ─────────────────────────────────────────────────────

function makeId(n) {
  return `bd-${n}`;
}

function now() {
  return new Date().toISOString();
}

/**
 * A task is "ready" if all of its deps are done/closed (or it has none).
 */
function isReady(task, allTasks) {
  if (!task.deps || task.deps.length === 0) return true;
  const taskMap = Object.fromEntries(allTasks.map((t) => [t.id, t]));
  return task.deps.every((depId) => {
    const dep = taskMap[depId];
    return dep && ["done", "closed"].includes(dep.status);
  });
}

// ── pure-JS action handlers ────────────────────────────────────────────────

async function jsCreate(tenant, { title, description, priority, dimension }) {
  const graph = await loadGraph(tenant);
  if (graph.error) return { error: graph.error };

  const ts = now();
  const id = makeId(graph.nextId);
  const task = {
    id,
    title: title.trim(),
    description: description ?? null,
    status: "todo",
    priority: priority ?? 2,
    tags: [],
    dimension: VALID_DIMENSIONS.includes(dimension) ? dimension : null,
    deps: [],
    created: ts,
    updated: ts,
  };
  graph.tasks.push(task);
  graph.nextId += 1;

  const save = await saveGraph(
    tenant,
    graph,
    `create(beads): ${id} — ${task.title.slice(0, 60)}`,
  );
  if (!save.success) return { error: save.error || "save failed" };

  // Async: ensure README + sync dimension page
  ensureReadme(tenant).catch(() => {});
  if (task.dimension) {
    syncDimensionPage(tenant, task.dimension, graph.tasks).catch(() => {});
  }

  return { id, title: task.title, status: task.status, priority: task.priority };
}

async function jsList(tenant, { status, dimension } = {}) {
  const graph = await loadGraph(tenant);
  if (graph.error) return { error: graph.error };

  let tasks = graph.tasks;
  if (status) tasks = tasks.filter((t) => t.status === status);
  if (dimension) tasks = tasks.filter((t) => t.dimension === dimension);
  return { tasks };
}

async function jsReady(tenant) {
  const graph = await loadGraph(tenant);
  if (graph.error) return { error: graph.error };

  const active = graph.tasks.filter(
    (t) => !["done", "closed"].includes(t.status),
  );
  const ready = active.filter((t) => isReady(t, graph.tasks));
  return { tasks: ready };
}

async function jsUpdate(tenant, { id, status, title, description }) {
  const graph = await loadGraph(tenant);
  if (graph.error) return { error: graph.error };

  const task = graph.tasks.find((t) => t.id === id);
  if (!task) return { error: `task ${id} not found` };

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status))
      return { error: `invalid status: ${status}` };
    task.status = status;
  }
  if (title !== undefined) task.title = title.trim();
  if (description !== undefined) task.description = description;
  task.updated = now();

  const save = await saveGraph(
    tenant,
    graph,
    `update(beads): ${id} — ${task.title.slice(0, 60)}`,
  );
  if (!save.success) return { error: save.error || "save failed" };

  if (task.dimension) {
    syncDimensionPage(tenant, task.dimension, graph.tasks).catch(() => {});
  }

  return { id, status: task.status, title: task.title, updated: task.updated };
}

async function jsDepend(tenant, { parent_id, child_id }) {
  const graph = await loadGraph(tenant);
  if (graph.error) return { error: graph.error };

  const parent = graph.tasks.find((t) => t.id === parent_id);
  const child = graph.tasks.find((t) => t.id === child_id);
  if (!parent) return { error: `parent task ${parent_id} not found` };
  if (!child) return { error: `child task ${child_id} not found` };

  // child is blocked by parent  (parent must be done before child)
  if (!child.deps.includes(parent_id)) {
    child.deps.push(parent_id);
    child.updated = now();
  }

  const save = await saveGraph(
    tenant,
    graph,
    `dep(beads): ${child_id} blocked-by ${parent_id}`,
  );
  if (!save.success) return { error: save.error || "save failed" };

  return { parent_id, child_id, message: `${child_id} now blocked by ${parent_id}` };
}

async function jsClose(tenant, { id }) {
  return jsUpdate(tenant, { id, status: "closed" });
}

// ── bd binary delegation (optional) ───────────────────────────────────────

/**
 * Try to run bd and return parsed JSON. Returns null on any failure so the
 * caller can fall back to the pure-JS path.
 */
async function bdRun(args, { cwd } = {}) {
  try {
    const { stdout } = await execFile("bd", args, {
      cwd: cwd || process.cwd(),
      timeout: 10000,
      env: { ...process.env },
    });
    try {
      return JSON.parse(stdout);
    } catch {
      return { raw: stdout.trim() };
    }
  } catch {
    return null;
  }
}

// ── public dispatcher ──────────────────────────────────────────────────────

/**
 * Execute a Beads tool call.
 * @param {string} toolName  - e.g. "task_create"
 * @param {object} input     - tool input from Claude
 * @param {{ tenant: object }} ctx
 */
export async function executeBeadsTool(toolName, input, ctx = {}) {
  const tenant = ctx.tenant || null;

  // Prefer bd binary when available, degrade to pure-JS.
  const useBd = await isBdAvailable();

  try {
    switch (toolName) {
      case "task_create": {
        if (useBd) {
          const args = ["create", input.title];
          if (input.priority != null) args.push("-p", String(input.priority));
          const res = await bdRun([...args, "--json"]);
          if (res && res.id) return res;
        }
        return jsCreate(tenant, {
          title: input.title,
          description: input.description,
          priority: input.priority,
          dimension: input.dimension,
        });
      }

      case "task_list": {
        if (useBd) {
          const args = ["list", "--json"];
          if (input.status) args.push("--status", input.status);
          const res = await bdRun(args);
          if (res && res.tasks) return res;
        }
        return jsList(tenant, {
          status: input.status,
          dimension: input.dimension,
        });
      }

      case "task_ready": {
        if (useBd) {
          const res = await bdRun(["ready", "--json"]);
          if (res && res.tasks) return res;
        }
        return jsReady(tenant);
      }

      case "task_update": {
        if (useBd) {
          const args = ["update", input.id];
          if (input.status) args.push("--status", input.status);
          const res = await bdRun([...args, "--json"]);
          if (res && res.id) return res;
        }
        return jsUpdate(tenant, {
          id: input.id,
          status: input.status,
          title: input.title,
          description: input.description,
        });
      }

      case "task_depend": {
        if (useBd) {
          const res = await bdRun([
            "dep", "add", input.parent_id, input.child_id, "--json",
          ]);
          if (res && !res.error) return res;
        }
        return jsDepend(tenant, {
          parent_id: input.parent_id,
          child_id: input.child_id,
        });
      }

      case "task_close": {
        if (useBd) {
          const res = await bdRun(["close", input.id, "--json"]);
          if (res && res.id) return res;
        }
        return jsClose(tenant, { id: input.id });
      }

      default:
        return { error: `Unknown beads tool: ${toolName}` };
    }
  } catch (err) {
    return { error: err.message };
  }
}

// ── Claude tool schemas ────────────────────────────────────────────────────

export const BEADS_TOOLS = [
  {
    name: "task_create",
    description:
      "Create a new task in the Beads task graph. Returns the new task ID (e.g. bd-1). " +
      "Use this whenever the user asks to create a task, reminder, or to-do item.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short, imperative task title",
        },
        description: {
          type: "string",
          description: "Optional longer description or acceptance criteria",
        },
        priority: {
          type: "integer",
          description: "0=urgent, 1=high, 2=normal (default), 3=low",
          enum: [0, 1, 2, 3],
        },
        dimension: {
          type: "string",
          description:
            "Life dimension this task belongs to. " +
            "One of: financial, intellectual, social, spiritual, emotional, physical",
          enum: [
            "financial",
            "intellectual",
            "social",
            "spiritual",
            "emotional",
            "physical",
          ],
        },
      },
      required: ["title"],
    },
  },
  {
    name: "task_list",
    description:
      "List tasks in the Beads graph. Supports filtering by status and/or dimension.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Filter by status: todo, in_progress, done, or closed",
          enum: ["todo", "in_progress", "done", "closed"],
        },
        dimension: {
          type: "string",
          description: "Filter by life dimension",
          enum: [
            "financial",
            "intellectual",
            "social",
            "spiritual",
            "emotional",
            "physical",
          ],
        },
      },
    },
  },
  {
    name: "task_ready",
    description:
      "List tasks that are unblocked (all dependencies are done/closed) and not yet done. " +
      "Use this to answer 'what can I work on next?'",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "task_update",
    description:
      "Update a task's status, title, or description. Use task_close to close a task instead.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The task ID to update (e.g. bd-3)",
        },
        status: {
          type: "string",
          description: "New status",
          enum: ["todo", "in_progress", "done", "closed"],
        },
        title: {
          type: "string",
          description: "New task title",
        },
        description: {
          type: "string",
          description: "New task description",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "task_depend",
    description:
      "Add a dependency edge: child_id is blocked by parent_id and cannot be " +
      "considered ready until parent_id is done. " +
      "Use this to model task sequences and project graphs.",
    input_schema: {
      type: "object",
      properties: {
        parent_id: {
          type: "string",
          description: "The task that must be completed first (the blocker)",
        },
        child_id: {
          type: "string",
          description: "The task that is blocked until parent is done",
        },
      },
      required: ["parent_id", "child_id"],
    },
  },
  {
    name: "task_close",
    description:
      "Close a task (marks it closed and removes it from active views). " +
      "Use when a task is cancelled or done-and-archived.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The task ID to close (e.g. bd-7)",
        },
      },
      required: ["id"],
    },
  },
];
