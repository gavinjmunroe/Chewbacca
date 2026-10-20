/**
 * Togari V1 MCP tools — the client-centric source of truth Sagar talks to.
 *
 * One small, powerful surface (Perplexity caps the tool list, so these register
 * FIRST): load a CSV, ask anything, add/update clients and tasks, and attach
 * searchable context. Everything writes into the migration-0032 core tables via
 * V1Service; the two LLM-powered tools (ingest_csv, ask) mirror the Anthropic
 * fetch pattern used across the codebase.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolModule, type ToolModule } from "./registry";
import { BigQueryClient } from "../../bigquery/client";
import { parseCsv, normalizePayload } from "../../ingest/universal/parsers";
import { SONNET } from "../../config/models";
import { createLogger } from "../../observability/logger";
import { V1Service, domainFromEmail } from "../../v1/service";
import { fetchGmailMessages } from "../../sources/gmail-fetch";
import { fetchFirefliesMeetings } from "../../sources/fireflies-fetch";
import { fetchSlackMessages } from "../../sources/slack-fetch";
import { fetchCalendarEvents } from "../../sources/calendar-fetch";

const logger = createLogger("mcp/tools/v1");

function defaultBq(): BigQueryClient {
  return new BigQueryClient(
    process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3",
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

function svc(deps: { bq?: BigQueryClient }): V1Service {
  return new V1Service({ bq: deps.bq ?? defaultBq() });
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

function invalidArgs(message: string) {
  return textResult(`Invalid arguments: ${message}`, true);
}

/** Anthropic call returning parsed JSON, tolerant of code fences. Empty on any failure. */
async function askModelJson<T>(
  system: string,
  user: string,
  fallback: T,
): Promise<T> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn("ANTHROPIC_API_KEY not set — v1 LLM call skipped");
    return fallback;
  }
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: SONNET,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!response.ok) {
      logger.error(
        "v1 model call failed",
        new Error(`Anthropic ${response.status}: ${await response.text()}`),
      );
      return fallback;
    }
    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const raw = (data.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("")
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    try {
      return JSON.parse(raw) as T;
    } catch {
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      if (s !== -1 && e > s) return JSON.parse(raw.slice(s, e + 1)) as T;
      return fallback;
    }
  } catch (err) {
    logger.error(
      "v1 model call threw",
      err instanceof Error ? err : new Error(String(err)),
    );
    return fallback;
  }
}

/** Return the model's plain-text answer (not JSON). Empty string on failure. */
async function askModelText(system: string, user: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "";
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: SONNET,
        max_tokens: 2048,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!response.ok) return "";
    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    return (data.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("")
      .trim();
  } catch {
    return "";
  }
}

// ── togari_ingest_csv ───────────────────────────────────────────────

const ingestCsvShape = {
  csv: z
    .string()
    .min(1)
    .describe("Raw CSV text: clients + info + follow-up tasks."),
};
const IngestCsv = z.object(ingestCsvShape);

interface MappedClient {
  name?: string;
  primary_email?: string;
  stage?: string;
  owner?: string;
  status?: string;
  summary?: string;
  attributes?: Record<string, unknown>;
  tasks?: Array<{
    description?: string;
    owner?: string;
    due_date?: string;
    priority?: string;
  }>;
}

const INGEST_SYSTEM = `You are Togari's ingestion engine. You receive a raw CSV of a sales team's leads/clients with current info and follow-up tasks, plus TODAY's date. Map it into clients and their tasks.

Return ONLY valid JSON:
{ "clients": [ { "name": string, "primary_email"?: string, "stage"?: string, "owner"?: string, "status"?: string, "summary"?: string, "attributes"?: object, "tasks"?: [ { "description": string, "owner"?: string, "due_date"?: string, "priority"?: string } ] } ] }

Rules:
- One entry per distinct client/company/lead. Merge duplicate rows for the same client into one entry.
- "name" is required and should be the company or lead name.
- Put any column that does not map to a core field into "attributes" (key = column name).
- INFER a "stage" from the notes even when there is no stage column, using this pipeline vocabulary (pick the best fit): researching (cold, unqualified, needs research), contacted (cold outreach reply, no call yet), conversation_started, meeting_scheduled (call/meeting/demo booked), discovery, proposal (proposal sent/stage), negotiation, closed_won, closed_lost (closed lost / dead), closed_engagement (paused). If the notes give no signal at all, omit stage.
- NORMALIZE "status" to exactly one of: active, closed_won, closed_lost, paused (lowercase). Default to active.
- Extract follow-up tasks into "tasks". RESOLVE relative dates against TODAY into ISO (YYYY-MM-DD): "tomorrow", weekday names like "Wednesday"/"Thursday" (the NEXT such weekday on/after tomorrow), "next week" (7 days out), "end of week" (this coming Friday). If a date is given absolutely, use it. Omit due_date only when there is truly no timing.
- Do NOT invent data other than the stage/date inferences above. Omit fields you cannot support.
- Return raw JSON only, no prose, no fences.`;

export function buildIngestCsvTool(
  deps: { bq?: BigQueryClient } = {},
): ToolModule {
  return {
    name: "togari_ingest_csv",
    description:
      "Load a raw CSV of clients (with current info and follow-up tasks) into Togari as the source of truth. The LLM maps columns to clients and tasks, merging duplicates. Use this for the first data load or any bulk client import.",
    inputSchema: ingestCsvShape,
    handler: async (args, ctx) => {
      const parsed = IngestCsv.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);

      const records = parseCsv(parsed.data.csv);
      if (!records.length) return textResult("No rows found in the CSV.", true);

      // Map in CHUNKS, in parallel. One giant LLM call over 65 rows is slow and
      // can blow past max_tokens; small chunks keep each call fast and bounded,
      // and running them concurrently keeps wall-clock low.
      const CHUNK = 20;
      const chunks: Record<string, unknown>[][] = [];
      for (let i = 0; i < records.length; i += CHUNK) {
        chunks.push(records.slice(i, i + CHUNK));
      }
      const today = new Date().toISOString().slice(0, 10);
      const mappedChunks = await Promise.all(
        chunks.map((chunk) =>
          askModelJson<{ clients: MappedClient[] }>(
            INGEST_SYSTEM,
            `TODAY is ${today}.\n\nMap these ${chunk.length} CSV rows:\n\n${JSON.stringify(chunk)}`,
            { clients: [] },
          ),
        ),
      );
      const clients = mappedChunks.flatMap((m) => m.clients ?? []);

      const service = svc(deps);
      const tenant = { brand: ctx.tenantId };

      // One bulk insert (a few round trips) instead of one write per row.
      const result = await service.bulkIngest(
        clients
          .filter((c) => c.name && c.name.trim())
          .map((c) => ({
            name: c.name!,
            primaryEmail: c.primary_email,
            stage: c.stage,
            owner: c.owner,
            status: c.status,
            summary: c.summary,
            attributes: c.attributes,
            source: "csv",
            tasks: (c.tasks ?? [])
              .filter((tk) => tk.description && tk.description.trim())
              .map((tk) => ({
                description: tk.description!,
                owner: tk.owner,
                dueDate: tk.due_date,
                priority: tk.priority,
                source: "csv",
              })),
          })),
        tenant,
      );

      const lines = [
        `**CSV ingested** (org: ${ctx.tenantId})`,
        "",
        `Rows read: ${records.length}`,
        `Clients created: ${result.clientsCreated}` +
          (result.clientsUpdated
            ? ` (+${result.clientsUpdated} merged/updated)`
            : ""),
        `Tasks created: ${result.tasks}`,
      ];
      return textResult(lines.join("\n"));
    },
  };
}

// ── togari_ask ──────────────────────────────────────────────────────

const askShape = {
  question: z
    .string()
    .min(1)
    .describe("Any question about any client, task, or context."),
};
const Ask = z.object(askShape);

export function buildAskTool(deps: { bq?: BigQueryClient } = {}): ToolModule {
  return {
    name: "togari_ask",
    description:
      "Ask ANY question about the Togari source of truth: clients, their stages, tasks, follow-ups, or attached context. Returns a direct answer grounded in the data (e.g. 'what needs to happen with Joe', 'which clients are in negotiation', 'what are Tyler's tasks tonight').",
    inputSchema: askShape,
    handler: async (args, ctx) => {
      const parsed = Ask.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const question = parsed.data.question;
      const service = svc(deps);
      const tenant = { brand: ctx.tenantId };

      // Retrieve-then-answer. Pull the whole (small) client + task set, the
      // most RECENT context (with content) so freshly-attached emails/meetings
      // are always visible, AND keyword matches for older targeted items. The
      // recency pull is what makes "what did Joe's email say" work right after
      // togari_context_add — a keyword search alone missed it.
      const [clients, tasks, recent, matches] = await Promise.all([
        service.listClients({ limit: 300 }, tenant),
        service.listTasks({ limit: 300 }, tenant),
        service.recentContext({ limit: 40 }, tenant),
        service.searchContext(question, { limit: 15 }, tenant),
      ]);

      // Merge recent + keyword matches, de-duped by context_id.
      const seen = new Set<string>();
      const context: Record<string, unknown>[] = [];
      for (const row of [...recent, ...matches]) {
        const id = row.context_id as string;
        if (id && !seen.has(id)) {
          seen.add(id);
          context.push(row);
        }
      }

      if (!clients.length && !tasks.length && !context.length) {
        return textResult(
          `**No data yet** (org: ${ctx.tenantId})\n\nThe source of truth is empty. Load a CSV with togari_ingest_csv or add a client first.`,
        );
      }

      const dataBlock = JSON.stringify({ clients, tasks, context }).slice(
        0,
        120000,
      );
      const system = `You are Togari, the analyst over a sales team's source of truth. Answer the user's question using ONLY the DATA provided (clients, tasks, context). Be direct and specific. Cite client names. If the data does not contain the answer, say so plainly. Never invent facts. Keep it tight, no fluff.`;
      const answer = await askModelText(
        system,
        `DATA:\n${dataBlock}\n\nQUESTION:\n${question}`,
      );

      if (!answer) {
        return textResult(
          `Pulled ${clients.length} clients, ${tasks.length} tasks, ${context.length} context matches, but the model could not answer (check ANTHROPIC_API_KEY).`,
          true,
        );
      }
      return textResult(answer);
    },
  };
}

// ── togari_client_upsert ────────────────────────────────────────────

const upsertShape = {
  name: z.string().min(1).describe("Client / company / lead name."),
  client_id: z
    .string()
    .optional()
    .describe("Existing client id to update; omit to create or auto-merge."),
  primary_email: z.string().optional(),
  stage: z
    .string()
    .optional()
    .describe("Pipeline stage (you define the vocabulary)."),
  pipeline: z.string().optional(),
  owner: z.string().optional(),
  status: z.string().optional().describe("active / won / lost / paused."),
  summary: z.string().optional().describe("One-line summary for fast recall."),
  attributes: z
    .record(z.any())
    .optional()
    .describe("Any extra structured facts."),
};
const Upsert = z.object(upsertShape);

export function buildClientUpsertTool(
  deps: { bq?: BigQueryClient } = {},
): ToolModule {
  return {
    name: "togari_client_upsert",
    description:
      "Add a new client or update an existing one by talking. Omit client_id to create (auto-merges to an existing client if the email/domain/name matches). Any field is optional except name.",
    inputSchema: upsertShape,
    handler: async (args, ctx) => {
      const parsed = Upsert.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const d = parsed.data;
      const { clientId, operation } = await svc(deps).upsertClient(
        {
          name: d.name,
          primaryEmail: d.primary_email,
          stage: d.stage,
          pipeline: d.pipeline,
          owner: d.owner,
          status: d.status,
          summary: d.summary,
          attributes: d.attributes,
          source: "ask",
        },
        { clientId: d.client_id, tenant: { brand: ctx.tenantId } },
      );
      return textResult(
        `**Client ${operation}** (org: ${ctx.tenantId})\n\n- id: \`${clientId}\`\n- name: ${d.name}`,
      );
    },
  };
}

// ── togari_client_get ───────────────────────────────────────────────

const getShape = {
  client_id: z.string().min(1).describe("The client id to open."),
};
const Get = z.object(getShape);

export function buildClientGetTool(
  deps: { bq?: BigQueryClient } = {},
): ToolModule {
  return {
    name: "togari_client_get",
    description:
      "Open the full view of one client: its fields, all its tasks, and its recent attached context.",
    inputSchema: getShape,
    handler: async (args, ctx) => {
      const parsed = Get.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const { client, tasks, context } = await svc(deps).getClient(
        parsed.data.client_id,
        { brand: ctx.tenantId },
      );
      if (!client)
        return textResult(
          `No client \`${parsed.data.client_id}\` found.`,
          true,
        );
      return textResult(JSON.stringify({ client, tasks, context }, null, 2));
    },
  };
}

// ── togari_clients_list ─────────────────────────────────────────────

const listShape = {
  stage: z.string().optional(),
  owner: z.string().optional(),
  status: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
};
const List = z.object(listShape);

export function buildClientsListTool(
  deps: { bq?: BigQueryClient } = {},
): ToolModule {
  return {
    name: "togari_clients_list",
    description:
      "List clients, optionally filtered by stage, owner, or status. Returns a compact JSON array.",
    inputSchema: listShape,
    handler: async (args, ctx) => {
      const parsed = List.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const rows = await svc(deps).listClients(parsed.data, {
        brand: ctx.tenantId,
      });
      return textResult(`${rows.length} client(s):\n\n${JSON.stringify(rows)}`);
    },
  };
}

// ── togari_task_add / togari_task_update / togari_tasks_list ─────────

const taskAddShape = {
  description: z.string().min(1),
  client_id: z.string().optional(),
  owner: z.string().optional(),
  due_date: z.string().optional().describe("ISO date YYYY-MM-DD."),
  priority: z.string().optional().describe("high / medium / low."),
};
const TaskAdd = z.object(taskAddShape);

export function buildTaskAddTool(
  deps: { bq?: BigQueryClient } = {},
): ToolModule {
  return {
    name: "togari_task_add",
    description: "Add a follow-up task, optionally tied to a client.",
    inputSchema: taskAddShape,
    handler: async (args, ctx) => {
      const parsed = TaskAdd.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const d = parsed.data;
      const { taskId } = await svc(deps).addTask(
        {
          clientId: d.client_id,
          description: d.description,
          owner: d.owner,
          dueDate: d.due_date,
          priority: d.priority,
          source: "ask",
        },
        { brand: ctx.tenantId },
      );
      return textResult(`**Task added** \`${taskId}\`: ${d.description}`);
    },
  };
}

const taskUpdateShape = {
  task_id: z.string().min(1),
  status: z.string().optional().describe("open / done."),
  due_date: z.string().optional(),
  owner: z.string().optional(),
  priority: z.string().optional(),
};
const TaskUpdate = z.object(taskUpdateShape);

export function buildTaskUpdateTool(
  deps: { bq?: BigQueryClient } = {},
): ToolModule {
  return {
    name: "togari_task_update",
    description:
      "Update a task: mark it done, change its due date, owner, or priority.",
    inputSchema: taskUpdateShape,
    handler: async (args, ctx) => {
      const parsed = TaskUpdate.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const d = parsed.data;
      const { updated } = await svc(deps).updateTask(
        d.task_id,
        {
          status: d.status,
          dueDate: d.due_date,
          owner: d.owner,
          priority: d.priority,
        },
        { brand: ctx.tenantId },
      );
      return textResult(
        updated
          ? `**Task updated** \`${d.task_id}\`.`
          : `No task \`${d.task_id}\` found (nothing updated).`,
        !updated,
      );
    },
  };
}

const tasksListShape = {
  owner: z.string().optional().describe("Filter to one owner, e.g. Tyler."),
  status: z.string().optional().describe("open / done."),
  client_id: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
};
const TasksList = z.object(tasksListShape);

export function buildTasksListTool(
  deps: { bq?: BigQueryClient } = {},
): ToolModule {
  return {
    name: "togari_tasks_list",
    description:
      "List tasks, optionally by owner, status, or client. Use for 'what does Tyler need to do' style questions.",
    inputSchema: tasksListShape,
    handler: async (args, ctx) => {
      const parsed = TasksList.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const rows = await svc(deps).listTasks(parsed.data, {
        brand: ctx.tenantId,
      });
      return textResult(`${rows.length} task(s):\n\n${JSON.stringify(rows)}`);
    },
  };
}

// ── togari_context_add ──────────────────────────────────────────────

const contextAddShape = {
  content: z
    .string()
    .min(1)
    .describe(
      "The full text to store (email body, notes, transcript, file text).",
    ),
  client_id: z.string().optional().describe("Attach to a specific client."),
  title: z.string().optional(),
  content_type: z
    .string()
    .optional()
    .describe("email / fireflies / note / file / pdf."),
  source: z.string().optional(),
  source_ref: z.string().optional(),
  occurred_at: z
    .string()
    .optional()
    .describe("ISO timestamp of the underlying event."),
};
const ContextAdd = z.object(contextAddShape);

export function buildContextAddTool(
  deps: { bq?: BigQueryClient } = {},
): ToolModule {
  return {
    name: "togari_context_add",
    description:
      "Attach any context (email, meeting notes, file text) to a client. Stored full-text so it is searchable by asking. E.g. 'scan the email Joe sent me' -> store it here and it becomes part of the source of truth.",
    inputSchema: contextAddShape,
    handler: async (args, ctx) => {
      const parsed = ContextAdd.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const d = parsed.data;
      const { contextId, operation } = await svc(deps).addContext(
        {
          clientId: d.client_id,
          title: d.title,
          content: d.content,
          contentType: d.content_type,
          source: d.source,
          sourceRef: d.source_ref,
          occurredAt: d.occurred_at,
        },
        { brand: ctx.tenantId },
      );
      return textResult(
        operation === "updated"
          ? `**Context updated in place** \`${contextId}\` (same source + source_ref already ingested). Searchable now.`
          : `**Context stored** \`${contextId}\`${d.client_id ? ` on \`${d.client_id}\`` : ""}. Searchable now.`,
      );
    },
  };
}

// ── togari_pull (Gmail / Slack / Fireflies -> source of truth) ──────

/** A source item normalized across Gmail, Slack, and Fireflies. */
export type PullSource = "gmail" | "slack" | "fireflies" | "calendar";

interface SourceItem {
  source: PullSource;
  externalId: string;
  title: string;
  text: string;
  participants: string[];
  occurredAt?: string;
}

const pullShape = {
  source: z
    .enum(["gmail", "slack", "fireflies", "calendar", "all"])
    .describe(
      "Which connected source to pull from, or 'all' to refresh from every available source at once (Gmail, Fireflies, Calendar, Slack).",
    ),
  since_days: z
    .number()
    .int()
    .min(1)
    .max(90)
    .optional()
    .describe("How many days back to pull (default 7)."),
  query: z
    .string()
    .optional()
    .describe("Gmail only: optional search query to narrow the pull."),
  channel: z
    .string()
    .optional()
    .describe("Slack only: channel name or id to read (required for slack)."),
  user: z
    .string()
    .optional()
    .describe("Gmail only: mailbox to read; defaults to Sagar's."),
  limit: z.number().int().min(1).max(200).optional(),
};
const Pull = z.object(pullShape);

/** Bound the source-mapping LLM call so a slow model can't sever MCP. */
const PULL_LLM_TIMEOUT_MS = 20_000;

const PULL_SYSTEM = `You route freshly pulled source items (emails, Slack messages, meeting summaries) into a sales team's source of truth.

You are given EXISTING_CLIENTS (id + name) and ITEMS (each with an index, source, title, text, participants). For each item return which client it belongs to and any follow-up tasks it implies.

Return ONLY valid JSON:
{ "items": [ { "index": number, "client_id"?: string, "new_client_name"?: string, "tasks"?: [ { "description": string, "owner"?: string, "due_date"?: string, "priority"?: string } ] } ] }

Rules:
- Match to an EXISTING client_id when the participants or content clearly refer to one. If it is clearly a new lead/company, set new_client_name. If it fits no client, omit both (it will be stored unattached but still searchable).
- NEVER attach an item to a client just because nothing else fits. Internal meetings (standups, team syncs, 1:1s where every attendee is at the user's own company) belong to NO external client: omit client_id and new_client_name for them.
- Only extract tasks that are real, actionable follow-ups. due_date as ISO (YYYY-MM-DD) when stated. Omit if none.
- Do not invent clients or tasks. Return raw JSON only, no prose, no fences.`;

interface PullMapping {
  items: Array<{
    index: number;
    client_id?: string;
    new_client_name?: string;
    tasks?: Array<{
      description?: string;
      owner?: string;
      due_date?: string;
      priority?: string;
    }>;
  }>;
}

async function normalizePull(
  source: PullSource,
  args: {
    sinceDays?: number;
    query?: string;
    channel?: string;
    user?: string;
    limit?: number;
  },
): Promise<{ items: SourceItem[]; note?: string }> {
  if (source === "calendar") {
    const res = await fetchCalendarEvents({
      user: args.user,
      sinceDays: args.sinceDays,
      maxEvents: args.limit,
    });
    if (!res.configured) return { items: [], note: res.note };
    return {
      items: res.events.map((e) => ({
        source: "calendar" as const,
        externalId: e.id,
        title: e.title || "(no title)",
        text: `Meeting: ${e.title}\nWhen: ${e.start}\nAttendees: ${(e.attendees ?? []).join(", ")}`,
        participants: e.attendees ?? [],
        occurredAt: e.start || undefined,
      })),
      note: res.note,
    };
  }
  if (source === "gmail") {
    const res = await fetchGmailMessages({
      user: args.user,
      sinceDays: args.sinceDays,
      max: args.limit,
      query: args.query,
    });
    if (!res.configured) return { items: [], note: res.note };
    return {
      items: res.messages.map((m) => ({
        source: "gmail" as const,
        externalId: m.id,
        title: m.subject || "(no subject)",
        text: `From: ${m.from}\nDate: ${m.date}\n\n${m.snippet}`,
        participants: [m.from].filter(Boolean),
        occurredAt: m.date ? new Date(m.date).toISOString() : undefined,
      })),
      note: res.note,
    };
  }
  if (source === "fireflies") {
    const res = await fetchFirefliesMeetings({
      sinceDays: args.sinceDays,
      max: args.limit,
    });
    if (!res.configured) return { items: [], note: res.note };
    return {
      items: res.meetings.map((m) => ({
        source: "fireflies" as const,
        externalId: m.id,
        title: m.title || "(untitled meeting)",
        text: [
          m.overview ? `Overview: ${m.overview}` : "",
          m.actionItems?.length
            ? `Action items:\n- ${m.actionItems.join("\n- ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        participants: m.attendees ?? [],
        occurredAt: m.date || undefined,
      })),
      note: res.note,
    };
  }
  // slack
  if (!args.channel) return { items: [], note: "Slack pull needs a channel." };
  const res = await fetchSlackMessages({
    channel: args.channel,
    sinceDays: args.sinceDays,
    limit: args.limit,
  });
  if (!res.configured || res.note) return { items: [], note: res.note };
  return {
    items: res.messages.map((m) => ({
      source: "slack" as const,
      externalId: m.ts,
      title: `Slack #${res.channel} — ${m.user}`,
      text: m.text,
      participants: [m.user].filter(Boolean),
      occurredAt: m.date || undefined,
    })),
  };
}

/** A client row with the identity fields deterministic matching needs. */
export interface MatchableClient {
  client_id: string;
  name: string;
  primary_domain: string | null;
  primary_email: string | null;
}

/**
 * The org's own email domains. Attendees at these domains never indicate an
 * external client. Configurable via TOGARI_INTERNAL_DOMAINS (comma-separated);
 * defaults to the domain of the ingest mailbox.
 */
export function internalDomainSet(): Set<string> {
  const raw =
    process.env.TOGARI_INTERNAL_DOMAINS ||
    domainFromEmail(
      process.env.GMAIL_INGEST_USER || "sagar@bluemodernadvisory.com",
    );
  return new Set(
    raw
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Meeting-bot / infrastructure attendees. Their domains show up on nearly
 * every call and carry no signal about which client a meeting belongs to.
 */
const NOISE_DOMAINS = new Set([
  "fireflies.ai",
  "otter.ai",
  "spinach.io",
  "read.ai",
  "fathom.video",
  "grain.com",
  "gong.io",
  "zoom.us",
]);

function isNoiseDomain(domain: string): boolean {
  return NOISE_DOMAINS.has(domain) || domain.endsWith(".calendar.google.com");
}

/**
 * Free-mail providers. A client whose primary_domain is one of these (e.g. a
 * lead reached at a gmail address) must only ever match by EXACT email —
 * matching by domain would attach every meeting with any gmail attendee to
 * that client (how "College Apps w/ Sagar" ended up under Spinach Records).
 */
const FREEMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Deterministic check of the LLM's client mapping for one pulled item.
 *
 * For meeting-shaped sources (calendar, fireflies) the attendee list is the
 * ground truth: an item only attaches to a client one of its attendees
 * belongs to. A meeting with no external attendees (an internal standup)
 * routes to the org's own client record if one exists, otherwise stays
 * unattached — it NEVER falls back to an unrelated external client, and it
 * never mints a new client. Email/Slack items attach by content, so the LLM
 * mapping stands there (unknown client_ids are still dropped).
 */
export function resolvePullAttachment(opts: {
  source: PullSource;
  participants: string[];
  llmClientId?: string;
  llmNewClientName?: string;
  clients: MatchableClient[];
  internal: Set<string>;
}): { clientId?: string; newClientName?: string } {
  const { source, participants, clients, internal } = opts;
  const known = new Set(clients.map((c) => c.client_id));
  // An id the LLM made up would store a dangling attachment — drop it.
  const llmClientId =
    opts.llmClientId && known.has(opts.llmClientId)
      ? opts.llmClientId
      : undefined;
  const llmNewClientName = opts.llmNewClientName?.trim() || undefined;

  if (source !== "calendar" && source !== "fireflies") {
    return { clientId: llmClientId, newClientName: llmNewClientName };
  }

  const emails = participants
    .map((p) => p.trim().toLowerCase())
    .filter((p) => EMAIL_RE.test(p));
  if (!emails.length) {
    // No attendee emails to validate against (e.g. Fireflies returned names).
    return { clientId: llmClientId, newClientName: llmNewClientName };
  }

  const domains = new Set(
    emails.map(domainFromEmail).filter((d) => d && !isNoiseDomain(d)),
  );
  const externalDomains = [...domains].filter((d) => !internal.has(d));

  const matched = new Set<string>();
  const matchedExternal: string[] = [];
  const matchedInternal: string[] = [];
  for (const c of clients) {
    const cEmail = (c.primary_email ?? "").trim().toLowerCase();
    const cDomain =
      (c.primary_domain ?? "").trim().toLowerCase() ||
      (cEmail ? domainFromEmail(cEmail) : "");
    const emailHit = Boolean(cEmail && emails.includes(cEmail));
    const domainHit = Boolean(
      cDomain && domains.has(cDomain) && !FREEMAIL_DOMAINS.has(cDomain),
    );
    if (!emailHit && !domainHit) continue;
    matched.add(c.client_id);
    (internal.has(cDomain) ? matchedInternal : matchedExternal).push(
      c.client_id,
    );
  }

  if (!externalDomains.length) {
    // Fully internal meeting: the org's own client record or nothing.
    return { clientId: matchedInternal[0] };
  }
  if (llmClientId && matched.has(llmClientId)) {
    return { clientId: llmClientId };
  }
  if (matchedExternal.length) {
    // The attendee list names a client the LLM missed (or contradicts).
    return { clientId: matchedExternal[0] };
  }
  // No attendee corroborates the LLM's pick: leave the meeting unattached
  // (still searchable, reattachable via togari_context_move) rather than risk
  // filing it under an unrelated client. A proposed NEW lead is kept — that is
  // exactly the unknown-external-attendee case.
  return { newClientName: llmNewClientName };
}

/**
 * LLM-map a batch of normalized source items onto clients and store them
 * (context + tasks). Shared by single-source and "all" pulls. Returns counts.
 * Items whose (source, external id) is already in the store are skipped up
 * front — re-running the same pull re-ingests nothing.
 */
async function storePulledItems(
  items: SourceItem[],
  service: V1Service,
  tenant: { brand: string },
): Promise<{
  stored: number;
  skipped: number;
  attached: number;
  tasksAdded: number;
  newClients: number;
}> {
  if (!items.length)
    return { stored: 0, skipped: 0, attached: 0, tasksAdded: 0, newClients: 0 };

  const existingRefs = await service.existingContextRefs(
    items.map((it) => it.externalId),
    tenant,
  );
  const fresh: SourceItem[] = [];
  const seenInBatch = new Set<string>();
  let skipped = 0;
  for (const it of items) {
    if (
      it.externalId &&
      (existingRefs.has(it.externalId) || seenInBatch.has(it.externalId))
    ) {
      skipped += 1;
      continue;
    }
    seenInBatch.add(it.externalId);
    fresh.push(it);
  }
  if (!fresh.length)
    return { stored: 0, skipped, attached: 0, tasksAdded: 0, newClients: 0 };

  const matchable = await service.listClientsForMatching(tenant);
  const internal = internalDomainSet();
  const clientDigest = matchable.map((c) => ({
    client_id: c.client_id,
    name: c.name,
  }));
  const itemDigest = fresh.map((it, i) => ({
    index: i,
    source: it.source,
    title: it.title,
    text: it.text.slice(0, 1200),
    participants: it.participants,
  }));

  const mapping = await Promise.race([
    askModelJson<PullMapping>(
      PULL_SYSTEM,
      `EXISTING_CLIENTS:\n${JSON.stringify(clientDigest)}\n\nITEMS:\n${JSON.stringify(itemDigest).slice(0, 80000)}`,
      { items: [] },
    ),
    new Promise<PullMapping>((resolve) =>
      setTimeout(() => resolve({ items: [] }), PULL_LLM_TIMEOUT_MS),
    ),
  ]);

  const byIndex = new Map<number, PullMapping["items"][number]>();
  for (const m of mapping.items ?? []) byIndex.set(m.index, m);

  let stored = 0;
  let attached = 0;
  let tasksAdded = 0;
  const newClients = new Map<string, string>();

  for (let i = 0; i < fresh.length; i++) {
    const it = fresh[i];
    const map = byIndex.get(i);
    const resolved = resolvePullAttachment({
      source: it.source,
      participants: it.participants,
      llmClientId: map?.client_id,
      llmNewClientName: map?.new_client_name,
      clients: matchable,
      internal,
    });
    let clientId = resolved.clientId;

    if (!clientId && resolved.newClientName) {
      const key = resolved.newClientName.toLowerCase();
      if (newClients.has(key)) {
        clientId = newClients.get(key);
      } else {
        const created = await service.upsertClient(
          { name: resolved.newClientName, source: it.source },
          { tenant },
        );
        clientId = created.clientId;
        newClients.set(key, clientId);
      }
    }

    try {
      await service.addContext(
        {
          clientId,
          title: it.title,
          content: it.text,
          contentType: it.source,
          source: it.source,
          sourceRef: it.externalId,
          occurredAt: it.occurredAt,
        },
        tenant,
      );
      stored += 1;
      if (clientId) attached += 1;
      for (const task of map?.tasks ?? []) {
        if (!task.description?.trim()) continue;
        await service.addTask(
          {
            clientId,
            description: task.description,
            owner: task.owner,
            dueDate: task.due_date,
            priority: task.priority,
            source: it.source,
          },
          tenant,
        );
        tasksAdded += 1;
      }
    } catch (err) {
      logger.warn("pull.store_failed", {
        source: it.source,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { stored, skipped, attached, tasksAdded, newClients: newClients.size };
}

export function buildPullTool(deps: { bq?: BigQueryClient } = {}): ToolModule {
  return {
    name: "togari_pull",
    description:
      "Pull recent items from a connected source (gmail, fireflies, calendar, slack) into the Togari source of truth on command, or use source 'all' to refresh from every available source at once (the daily refresh). Each item is stored as searchable context, attached to the matching client, and follow-up tasks are extracted. E.g. 'refresh Togari from all my sources for the last day', 'pull my Gmail from the last 3 days'.",
    inputSchema: pullShape,
    handler: async (args, ctx) => {
      const parsed = Pull.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const d = parsed.data;
      const service = svc(deps);
      const tenant = { brand: ctx.tenantId };

      const pullArgs = {
        sinceDays: d.since_days,
        query: d.query,
        channel: d.channel,
        user: d.user,
        limit: d.limit,
      };

      // "all" — refresh from every available source in one shot. Blocked
      // sources (Calendar/Slack pending scopes) report their note and are
      // skipped, they never fail the whole refresh.
      if (d.source === "all") {
        const sources: PullSource[] = [
          "gmail",
          "fireflies",
          "calendar",
          "slack",
        ];
        const perSource: Array<{
          source: string;
          count: number;
          note?: string;
        }> = [];
        const allItems: SourceItem[] = [];
        for (const s of sources) {
          if (s === "slack" && !d.channel) {
            perSource.push({
              source: s,
              count: 0,
              note: "skipped (give a channel to include Slack)",
            });
            continue;
          }
          const { items, note } = await normalizePull(s, pullArgs);
          allItems.push(...items);
          perSource.push({ source: s, count: items.length, note });
        }
        const res = await storePulledItems(allItems, service, tenant);
        return textResult(
          [
            `**Refreshed Togari from all sources** (org: ${ctx.tenantId})`,
            "",
            ...perSource.map(
              (p) =>
                `- ${p.source}: ${p.count} item(s)${p.note ? ` — ${p.note}` : ""}`,
            ),
            "",
            `Stored: ${res.stored} · already ingested (skipped): ${res.skipped} · attached to a client: ${res.attached} · tasks: ${res.tasksAdded}${res.newClients ? ` · new clients: ${res.newClients}` : ""}`,
            "",
            "All searchable now via togari_ask.",
          ].join("\n"),
        );
      }

      const { items, note } = await normalizePull(d.source, pullArgs);
      if (!items.length) {
        return textResult(
          `**Nothing pulled from ${d.source}** (org: ${ctx.tenantId})\n\n${note ?? "No items in range."}`,
          Boolean(note && /not configured|failed|needs a channel/i.test(note)),
        );
      }
      const res = await storePulledItems(items, service, tenant);
      return textResult(
        [
          `**Pulled from ${d.source}** (org: ${ctx.tenantId})`,
          "",
          `Items stored as context: ${res.stored}`,
          `Already ingested (skipped): ${res.skipped}`,
          `Attached to a client: ${res.attached}`,
          `Follow-up tasks extracted: ${res.tasksAdded}`,
          res.newClients ? `New clients created: ${res.newClients}` : "",
          "",
          "All of it is searchable now via togari_ask.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
  };
}

// ── togari_ingest_file (any file type -> searchable context) ────────

/** Post an Anthropic message with mixed content blocks; return the text reply. */
async function askModelBlocks(
  system: string,
  blocks: unknown[],
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "";
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: SONNET,
        max_tokens: 8192,
        system,
        messages: [{ role: "user", content: blocks }],
      }),
    });
    if (!response.ok) {
      logger.error(
        "ingest_file model call failed",
        new Error(`Anthropic ${response.status}: ${await response.text()}`),
      );
      return "";
    }
    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    return (data.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("")
      .trim();
  } catch (err) {
    logger.error(
      "ingest_file model threw",
      err instanceof Error ? err : new Error(String(err)),
    );
    return "";
  }
}

const IMAGE_EXTS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/**
 * Extract text from ANY file. Tabular/text types use the existing parsers;
 * PDFs and images are read natively by Claude (document/image blocks) so no
 * extra parsing deps are needed. Returns the text plus a content_type label.
 */
async function extractFileText(
  base64: string,
  filename: string,
): Promise<{ text: string; contentType: string }> {
  const ext = (filename.split(".").pop() || "").toLowerCase();

  if (ext === "pdf") {
    const text = await askModelBlocks(
      "You extract document text. Return ALL text from the document verbatim, preserving structure and tables as best you can. Output only the extracted text, no commentary.",
      [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: base64,
          },
        },
        { type: "text", text: "Extract all text from this document." },
      ],
    );
    return { text, contentType: "pdf" };
  }

  if (IMAGE_EXTS[ext]) {
    const text = await askModelBlocks(
      "You transcribe and describe images. Transcribe all visible text verbatim, then briefly describe any non-text content. Output only that.",
      [
        {
          type: "image",
          source: { type: "base64", media_type: IMAGE_EXTS[ext], data: base64 },
        },
        { type: "text", text: "Transcribe and describe this image." },
      ],
    );
    return { text, contentType: "image" };
  }

  if (ext === "csv") {
    const raw = Buffer.from(base64, "base64").toString("utf8");
    const records = parseCsv(raw);
    return {
      text: records.length ? JSON.stringify(records) : raw,
      contentType: "csv",
    };
  }
  if (ext === "xlsx" || ext === "xls") {
    const parsed = normalizePayload({ contentType: "xlsx", rawText: base64 });
    return {
      text: parsed.records?.length
        ? JSON.stringify(parsed.records)
        : (parsed.text ?? ""),
      contentType: "xlsx",
    };
  }
  // json / txt / md / anything else: decode as UTF-8 text.
  return {
    text: Buffer.from(base64, "base64").toString("utf8"),
    contentType: ext || "file",
  };
}

const ingestFileShape = {
  file_base64: z.string().min(1).describe("The file contents, base64-encoded."),
  filename: z
    .string()
    .min(1)
    .describe("Filename with extension (pdf, png, jpg, csv, xlsx, txt, ...)."),
  client_id: z
    .string()
    .optional()
    .describe("Attach to this client; omit to auto-match by content."),
  title: z.string().optional(),
};
const IngestFile = z.object(ingestFileShape);

export function buildIngestFileTool(
  deps: { bq?: BigQueryClient } = {},
): ToolModule {
  return {
    name: "togari_ingest_file",
    description:
      "Ingest ANY file (PDF, image/screenshot, deck, CSV, XLSX, text) into the Togari source of truth. Text is extracted (PDFs and images are read natively), stored as searchable context on a client, and follow-up tasks are pulled out. E.g. drop in a signed proposal PDF or a screenshot of a message.",
    inputSchema: ingestFileShape,
    handler: async (args, ctx) => {
      const parsed = IngestFile.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const d = parsed.data;
      const service = svc(deps);
      const tenant = { brand: ctx.tenantId };

      const { text, contentType } = await extractFileText(
        d.file_base64,
        d.filename,
      );
      if (!text.trim()) {
        return textResult(
          `Could not extract any text from ${d.filename}.`,
          true,
        );
      }

      // Attach to a client: explicit id, else best LLM match against existing.
      let clientId = d.client_id;
      const extract = await Promise.race([
        askModelJson<{
          client_id?: string;
          new_client_name?: string;
          tasks?: Array<{
            description?: string;
            owner?: string;
            due_date?: string;
            priority?: string;
          }>;
        }>(
          `You file a document into a sales team's source of truth. Given EXISTING_CLIENTS and the DOCUMENT text, pick the client it belongs to (client_id) or propose a new_client_name if it is clearly a new lead, and extract real follow-up tasks. Return ONLY JSON: { "client_id"?: string, "new_client_name"?: string, "tasks"?: [ { "description": string, "owner"?: string, "due_date"?: string, "priority"?: string } ] }. No prose.`,
          `EXISTING_CLIENTS:\n${JSON.stringify(
            (await service.listClients({ limit: 300 }, tenant)).map((c) => ({
              client_id: c.client_id,
              name: c.name,
            })),
          )}\n\nDOCUMENT (${d.filename}):\n${text.slice(0, 40000)}`,
          {},
        ),
        new Promise<{ client_id?: string }>((r) =>
          setTimeout(() => r({}), 25_000),
        ),
      ]);

      if (!clientId && extract.client_id) clientId = extract.client_id;
      if (
        !clientId &&
        (extract as { new_client_name?: string }).new_client_name
      ) {
        const created = await service.upsertClient(
          {
            name: (
              extract as { new_client_name?: string }
            ).new_client_name!.trim(),
            source: "file",
          },
          { tenant },
        );
        clientId = created.clientId;
      }

      const { contextId } = await service.addContext(
        {
          clientId,
          title: d.title || d.filename,
          content: text,
          contentType,
          source: "upload",
          sourceRef: d.filename,
        },
        tenant,
      );

      let tasksAdded = 0;
      for (const task of (
        extract as {
          tasks?: Array<{
            description?: string;
            owner?: string;
            due_date?: string;
            priority?: string;
          }>;
        }
      ).tasks ?? []) {
        if (!task.description?.trim()) continue;
        await service.addTask(
          {
            clientId,
            description: task.description,
            owner: task.owner,
            dueDate: task.due_date,
            priority: task.priority,
            source: "file",
          },
          tenant,
        );
        tasksAdded += 1;
      }

      return textResult(
        [
          `**File ingested** (org: ${ctx.tenantId})`,
          "",
          `- file: ${d.filename} (${contentType})`,
          `- stored as context: \`${contextId}\`${clientId ? ` on \`${clientId}\`` : " (unattached)"}`,
          `- follow-up tasks extracted: ${tasksAdded}`,
          `- extracted ${text.length} chars, searchable now via togari_ask`,
        ].join("\n"),
      );
    },
  };
}

// ── togari_client_delete / togari_task_delete / togari_reset ────────

const clientDeleteShape = {
  client_id: z
    .string()
    .min(1)
    .describe("The client to delete (also removes its tasks and context)."),
};
const ClientDelete = z.object(clientDeleteShape);

export function buildClientDeleteTool(
  deps: { bq?: BigQueryClient } = {},
): ToolModule {
  return {
    name: "togari_client_delete",
    description:
      "Permanently delete a client and everything attached to it (its tasks and context). Use for removing a bad or test record. Scoped to your org.",
    inputSchema: clientDeleteShape,
    handler: async (args, ctx) => {
      const parsed = ClientDelete.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const res = await svc(deps).deleteClient(parsed.data.client_id, {
        brand: ctx.tenantId,
      });
      return textResult(
        res.deleted
          ? `**Client deleted** \`${parsed.data.client_id}\` (removed ${res.tasks} task(s), ${res.context} context row(s)).`
          : `No client \`${parsed.data.client_id}\` found. Nothing deleted.`,
        !res.deleted,
      );
    },
  };
}

const taskDeleteShape = {
  task_id: z.string().min(1).describe("The task to delete."),
};
const TaskDelete = z.object(taskDeleteShape);

export function buildTaskDeleteTool(
  deps: { bq?: BigQueryClient } = {},
): ToolModule {
  return {
    name: "togari_task_delete",
    description: "Permanently delete a task. Scoped to your org.",
    inputSchema: taskDeleteShape,
    handler: async (args, ctx) => {
      const parsed = TaskDelete.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const res = await svc(deps).deleteTask(parsed.data.task_id, {
        brand: ctx.tenantId,
      });
      return textResult(
        res.deleted
          ? `**Task deleted** \`${parsed.data.task_id}\`.`
          : `No task \`${parsed.data.task_id}\` found. Nothing deleted.`,
        !res.deleted,
      );
    },
  };
}

const contextDeleteShape = {
  context_id: z.string().min(1).describe("The context row to delete."),
};
const ContextDelete = z.object(contextDeleteShape);

export function buildContextDeleteTool(
  deps: { bq?: BigQueryClient } = {},
): ToolModule {
  return {
    name: "togari_context_delete",
    description:
      "Permanently delete a single context row (a stored email/meeting/note) by its context_id — e.g. to remove a duplicate or a wrongly ingested item without touching the client it was attached to. Scoped to your org.",
    inputSchema: contextDeleteShape,
    handler: async (args, ctx) => {
      const parsed = ContextDelete.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const res = await svc(deps).deleteContext(parsed.data.context_id, {
        brand: ctx.tenantId,
      });
      return textResult(
        res.deleted
          ? `**Context deleted** \`${parsed.data.context_id}\`.`
          : `No context row \`${parsed.data.context_id}\` found. Nothing deleted.`,
        !res.deleted,
      );
    },
  };
}

const contextMoveShape = {
  context_id: z.string().min(1).describe("The context row to reattach."),
  new_client_id: z
    .string()
    .optional()
    .describe(
      "Client to attach the row to. Omit to detach it (leave it unattached but searchable).",
    ),
};
const ContextMove = z.object(contextMoveShape);

export function buildContextMoveTool(
  deps: { bq?: BigQueryClient } = {},
): ToolModule {
  return {
    name: "togari_context_move",
    description:
      "Reattach a single context row (a stored email/meeting/note) to a different client, or detach it from its client entirely — the fix for items the daily refresh attached to the wrong client. Scoped to your org.",
    inputSchema: contextMoveShape,
    handler: async (args, ctx) => {
      const parsed = ContextMove.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const target = parsed.data.new_client_id?.trim() || null;
      const res = await svc(deps).moveContext(parsed.data.context_id, target, {
        brand: ctx.tenantId,
      });
      if (!res.moved) {
        return textResult(
          `Move failed: ${res.reason ?? "unknown error"} (context \`${parsed.data.context_id}\`${target ? `, client \`${target}\`` : ""}).`,
          true,
        );
      }
      const from = res.previousClientId
        ? `\`${res.previousClientId}\``
        : "(unattached)";
      const to = target ? `\`${target}\`` : "(unattached)";
      return textResult(
        `**Context moved** \`${parsed.data.context_id}\`: ${from} → ${to}.`,
      );
    },
  };
}

const resetShape = {
  confirm: z
    .string()
    .min(1)
    .describe(
      'Type "RESET" to confirm. This wipes ALL clients, tasks, and context for your org.',
    ),
};
const Reset = z.object(resetShape);

export function buildResetTool(deps: { bq?: BigQueryClient } = {}): ToolModule {
  return {
    name: "togari_reset",
    description:
      'Wipe the ENTIRE source of truth for your org — every client, task, and context row — to start fresh (e.g. after testing). Destructive and irreversible. Requires confirm:"RESET".',
    inputSchema: resetShape,
    handler: async (args, ctx) => {
      const parsed = Reset.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      if (parsed.data.confirm.trim().toUpperCase() !== "RESET") {
        return textResult(
          'Not confirmed. Call again with confirm:"RESET" to wipe everything.',
          true,
        );
      }
      const res = await svc(deps).reset({ brand: ctx.tenantId });
      return textResult(
        `**Togari reset** (org: ${ctx.tenantId})\n\nDeleted ${res.clients} client(s), ${res.tasks} task(s), ${res.context} context row(s). Clean slate.`,
      );
    },
  };
}

// ── Registration ────────────────────────────────────────────────────

export function registerV1Tools(server: McpServer): void {
  registerToolModule(server, buildIngestCsvTool());
  registerToolModule(server, buildAskTool());
  registerToolModule(server, buildClientUpsertTool());
  registerToolModule(server, buildClientGetTool());
  registerToolModule(server, buildClientsListTool());
  registerToolModule(server, buildTaskAddTool());
  registerToolModule(server, buildTaskUpdateTool());
  registerToolModule(server, buildTasksListTool());
  registerToolModule(server, buildContextAddTool());
  registerToolModule(server, buildPullTool());
  registerToolModule(server, buildIngestFileTool());
  registerToolModule(server, buildClientDeleteTool());
  registerToolModule(server, buildTaskDeleteTool());
  registerToolModule(server, buildContextDeleteTool());
  registerToolModule(server, buildContextMoveTool());
  registerToolModule(server, buildResetTool());
}

export const register = registerV1Tools;
