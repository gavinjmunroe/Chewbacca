/**
 * Togari V1 service — the client-centric source of truth.
 *
 * One place, everything queryable. Backs the V1 MCP tools with read/write
 * access to the three core tables created in migration 0032:
 *   - clients        the root record (a lead/company worked through the pipeline)
 *   - client_tasks   follow-up tasks tied to a client
 *   - client_context any file/note attached to a client, full-text searchable
 *
 * Tenancy: client_brand is the org (default 'bma'); client_id identifies the
 * individual lead/company. Every method scopes by brand so the source of truth
 * stays isolated per org as we generalize past Sagar later.
 *
 * Identity/dedup is LLM-assisted at the tool layer; this service exposes a
 * best-effort findClient() (by email, domain, or normalized name) that the
 * upsert path uses so the same lead from different sources merges into one row.
 */

import crypto from "crypto";
import { BigQueryClient } from "../bigquery/client";
import { createLogger } from "../observability/logger";

const logger = createLogger("v1/service");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DATASET = "togari_data_lake";
const DEFAULT_BRAND = "bma";

function table(name: string): string {
  return `\`${PROJECT_ID}.${DATASET}.${name}\``;
}

/** Lowercase + trim a value to "" when blank. */
function norm(v?: string | null): string {
  return (v ?? "").trim().toLowerCase();
}

/** Slugify a name into a stable-ish id fragment. */
function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "client"
  );
}

/** Derive the domain portion of an email ("a@b.com" -> "b.com"). */
export function domainFromEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return "";
  return norm(email.slice(at + 1)).replace(/^www\./, "");
}

export interface ClientInput {
  name: string;
  primaryEmail?: string;
  primaryDomain?: string;
  stage?: string;
  pipeline?: string;
  owner?: string;
  status?: string;
  summary?: string;
  attributes?: Record<string, unknown>;
  source?: string;
}

export interface ClientRow {
  client_id: string;
  client_brand: string;
  name: string;
  primary_domain?: string;
  primary_email?: string;
  stage?: string;
  pipeline?: string;
  owner?: string;
  status?: string;
  summary?: string;
  attributes?: unknown;
  source?: string;
}

export interface TaskInput {
  clientId?: string;
  description: string;
  status?: string;
  dueDate?: string;
  owner?: string;
  priority?: string;
  source?: string;
}

export interface ContextInput {
  clientId?: string;
  title?: string;
  content: string;
  contentType?: string;
  source?: string;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}

export interface V1Tenant {
  brand?: string;
}

export class V1Service {
  private bq: BigQueryClient;

  constructor(deps: { bq: BigQueryClient }) {
    this.bq = deps.bq;
  }

  private brand(t?: V1Tenant): string {
    return (t?.brand || DEFAULT_BRAND).trim() || DEFAULT_BRAND;
  }

  // ── clients ────────────────────────────────────────────────────────

  /**
   * Best-effort identity match so the same lead from different sources merges
   * into one row. Order: exact email, then domain, then normalized name.
   * Returns the existing client_id or null.
   */
  async findClient(
    input: { email?: string; domain?: string; name?: string },
    t?: V1Tenant,
  ): Promise<string | null> {
    const brand = this.brand(t);
    const email = norm(input.email);
    const domain = norm(input.domain) || (email ? domainFromEmail(email) : "");
    const name = norm(input.name);
    if (!email && !domain && !name) return null;

    const sql = `
      SELECT client_id,
             CASE
               WHEN @email != "" AND LOWER(primary_email) = @email THEN 3
               WHEN @domain != "" AND LOWER(primary_domain) = @domain THEN 2
               WHEN @name != "" AND LOWER(name) = @name THEN 1
               ELSE 0
             END AS score
        FROM ${table("clients")}
       WHERE client_brand = @brand
         AND (
           (@email != "" AND LOWER(primary_email) = @email)
           OR (@domain != "" AND LOWER(primary_domain) = @domain)
           OR (@name != "" AND LOWER(name) = @name)
         )
       ORDER BY score DESC
       LIMIT 1
    `.trim();

    const { rows } = await this.bq.executeQuery(sql, {
      brand,
      email,
      domain,
      name,
    });
    return rows.length ? (rows[0].client_id as string) : null;
  }

  /**
   * Insert or update a client. If clientId is provided it updates that row;
   * otherwise it tries findClient() to merge, and inserts a new row if none.
   * Returns { clientId, operation }.
   */
  async upsertClient(
    input: ClientInput,
    opts?: { clientId?: string; tenant?: V1Tenant },
  ): Promise<{ clientId: string; operation: "created" | "updated" }> {
    const brand = this.brand(opts?.tenant);
    const email = norm(input.primaryEmail);
    const domain =
      norm(input.primaryDomain) || (email ? domainFromEmail(email) : "");

    let clientId =
      opts?.clientId ||
      (await this.findClient(
        { email, domain, name: input.name },
        opts?.tenant,
      ));

    // Build the SET/VALUES params, dropping undefined so we never overwrite
    // an existing value with null on update.
    const fields: Record<string, unknown> = {
      name: input.name,
      primary_email: input.primaryEmail,
      primary_domain: domain || undefined,
      stage: input.stage,
      pipeline: input.pipeline,
      owner: input.owner,
      status: input.status,
      summary: input.summary,
      source: input.source,
    };
    const attributesJson =
      input.attributes && Object.keys(input.attributes).length
        ? JSON.stringify(input.attributes)
        : undefined;

    if (clientId) {
      const setClauses: string[] = [];
      const params: Record<string, unknown> = { clientId, brand };
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined && v !== null && v !== "") {
          setClauses.push(`${k} = @${k}`);
          params[k] = v;
        }
      }
      if (attributesJson) {
        // Overwrite attributes with the new bag. Pass as a JSON string param
        // and PARSE_JSON server-side (same pattern as the insert path) so the
        // BigQuery client never has to type a struct/object parameter.
        setClauses.push(`attributes = PARSE_JSON(@attributes)`);
        params.attributes = attributesJson;
      }
      setClauses.push("updated_at = CURRENT_TIMESTAMP()");
      const sql = `
        UPDATE ${table("clients")}
           SET ${setClauses.join(", ")}
         WHERE client_id = @clientId AND client_brand = @brand
      `.trim();
      await this.bq.executeWrite(sql, params);
      return { clientId, operation: "updated" };
    }

    clientId = `${slugify(input.name)}_${crypto.randomBytes(3).toString("hex")}`;
    const sql = `
      INSERT INTO ${table("clients")}
        (client_id, client_brand, name, primary_domain, primary_email,
         stage, pipeline, owner, status, summary, attributes, source,
         created_at, updated_at)
      VALUES
        (@client_id, @brand, @name, @primary_domain, @primary_email,
         @stage, @pipeline, @owner, @status, @summary,
         ${attributesJson ? "PARSE_JSON(@attributes)" : "NULL"}, @source,
         CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
    `.trim();
    await this.bq.executeWrite(sql, {
      client_id: clientId,
      brand,
      name: input.name,
      primary_domain: domain || null,
      primary_email: input.primaryEmail || null,
      stage: input.stage || null,
      pipeline: input.pipeline || "default",
      owner: input.owner || null,
      status: input.status || "active",
      summary: input.summary || null,
      attributes: attributesJson || null,
      source: input.source || "ask",
    });
    return { clientId, operation: "created" };
  }

  /** Full view of one client: the row plus its tasks and recent context. */
  async getClient(
    clientId: string,
    t?: V1Tenant,
  ): Promise<{
    client: Record<string, unknown> | null;
    tasks: Record<string, unknown>[];
    context: Record<string, unknown>[];
  }> {
    const brand = this.brand(t);
    const { rows } = await this.bq.executeQuery(
      `SELECT * FROM ${table("clients")} WHERE client_id = @clientId AND client_brand = @brand LIMIT 1`,
      { clientId, brand },
    );
    if (!rows.length) return { client: null, tasks: [], context: [] };
    const tasks = (
      await this.bq.executeQuery(
        `SELECT task_id, description, status, due_date, owner, priority
           FROM ${table("client_tasks")}
          WHERE client_id = @clientId AND client_brand = @brand
          ORDER BY status, due_date`,
        { clientId, brand },
      )
    ).rows;
    const context = (
      await this.bq.executeQuery(
        `SELECT context_id, title, content_type, source, occurred_at
           FROM ${table("client_context")}
          WHERE client_id = @clientId AND client_brand = @brand
          ORDER BY COALESCE(occurred_at, created_at) DESC
          LIMIT 25`,
        { clientId, brand },
      )
    ).rows;
    return { client: rows[0], tasks, context };
  }

  /** List/filter clients. All filters optional. */
  async listClients(
    filter: { stage?: string; owner?: string; status?: string; limit?: number },
    t?: V1Tenant,
  ): Promise<Record<string, unknown>[]> {
    const brand = this.brand(t);
    const limit = Math.max(1, Math.min(500, Math.floor(filter.limit ?? 100)));
    const where: string[] = ["client_brand = @brand"];
    const params: Record<string, unknown> = { brand, limit };
    if (filter.stage) {
      where.push("LOWER(stage) = @stage");
      params.stage = norm(filter.stage);
    }
    if (filter.owner) {
      where.push("LOWER(owner) = @owner");
      params.owner = norm(filter.owner);
    }
    if (filter.status) {
      where.push("LOWER(status) = @status");
      params.status = norm(filter.status);
    }
    const { rows } = await this.bq.executeQuery(
      `SELECT client_id, name, stage, pipeline, owner, status, summary, primary_email
         FROM ${table("clients")}
        WHERE ${where.join(" AND ")}
        ORDER BY updated_at DESC
        LIMIT @limit`,
      params,
    );
    return rows;
  }

  // ── bulk ingest (CSV / large imports) ──────────────────────────────

  /**
   * Insert many clients + their tasks in a HANDFUL of BigQuery round trips
   * instead of one-per-row. Per-row upserts made a 65-row CSV take minutes and
   * time out the MCP; this collapses it to ~3 statements.
   *
   * Dedup/merge is done in-memory against a single pre-fetch of existing
   * clients (by email, then domain, then name), so re-uploads and in-file
   * duplicates (e.g. the same company twice) merge into one client. Clients
   * that already exist in the store are updated individually (few, if any, on a
   * first load); genuinely new clients go in as one multi-row INSERT, and all
   * tasks go in as another.
   */
  async bulkIngest(
    items: Array<ClientInput & { tasks?: TaskInput[] }>,
    t?: V1Tenant,
  ): Promise<{
    clientsCreated: number;
    clientsUpdated: number;
    tasks: number;
  }> {
    const brand = this.brand(t);
    if (!items.length)
      return { clientsCreated: 0, clientsUpdated: 0, tasks: 0 };

    const { rows: existing } = await this.bq.executeQuery(
      `SELECT client_id, LOWER(name) AS name, LOWER(primary_email) AS email,
              LOWER(primary_domain) AS domain
         FROM ${table("clients")} WHERE client_brand = @brand`,
      { brand },
    );
    const byEmail = new Map<string, string>();
    const byDomain = new Map<string, string>();
    const byName = new Map<string, string>();
    const inStore = new Set<string>();
    for (const r of existing) {
      const id = r.client_id as string;
      inStore.add(id);
      if (r.email) byEmail.set(r.email as string, id);
      if (r.domain) byDomain.set(r.domain as string, id);
      if (r.name) byName.set(r.name as string, id);
    }

    const newClients: Array<{ cid: string; it: ClientInput; domain: string }> =
      [];
    const updates: Array<{ cid: string; it: ClientInput }> = [];
    const tasks: Array<{ cid: string; tk: TaskInput }> = [];

    for (const it of items) {
      if (!it.name || !it.name.trim()) continue;
      const email = norm(it.primaryEmail);
      const domain =
        norm(it.primaryDomain) || (email ? domainFromEmail(email) : "");
      const name = norm(it.name);
      let cid =
        (email && byEmail.get(email)) ||
        (domain && byDomain.get(domain)) ||
        (name && byName.get(name)) ||
        null;

      if (!cid) {
        cid = `${slugify(it.name)}_${crypto.randomBytes(3).toString("hex")}`;
        newClients.push({ cid, it, domain });
        // Register so later rows for the same company merge into this one.
        if (email) byEmail.set(email, cid);
        if (domain) byDomain.set(domain, cid);
        if (name) byName.set(name, cid);
      } else if (inStore.has(cid)) {
        updates.push({ cid, it });
      }
      for (const tk of it.tasks ?? []) {
        if (tk.description && tk.description.trim()) tasks.push({ cid, tk });
      }
    }

    if (newClients.length) await this.insertClientsBulk(newClients, brand);
    for (const u of updates) {
      await this.upsertClient(u.it, { clientId: u.cid, tenant: t });
    }
    if (tasks.length) await this.insertTasksBulk(tasks, brand);

    return {
      clientsCreated: newClients.length,
      clientsUpdated: updates.length,
      tasks: tasks.length,
    };
  }

  private async insertClientsBulk(
    rows: Array<{ cid: string; it: ClientInput; domain: string }>,
    brand: string,
  ): Promise<void> {
    const cols =
      "client_id, client_brand, name, primary_domain, primary_email, stage, pipeline, owner, status, summary, attributes, source, created_at, updated_at";
    const params: Record<string, unknown> = { brand };
    const tuples = rows.map((n, i) => {
      const p = `c${i}`;
      params[`${p}_id`] = n.cid;
      params[`${p}_name`] = n.it.name;
      params[`${p}_domain`] = n.domain || null;
      params[`${p}_email`] = n.it.primaryEmail || null;
      params[`${p}_stage`] = n.it.stage || null;
      params[`${p}_pipeline`] = n.it.pipeline || "default";
      params[`${p}_owner`] = n.it.owner || null;
      params[`${p}_status`] = n.it.status || "active";
      params[`${p}_summary`] = n.it.summary || null;
      params[`${p}_attr`] = JSON.stringify(n.it.attributes || {});
      params[`${p}_source`] = n.it.source || "csv";
      return `(@${p}_id,@brand,@${p}_name,@${p}_domain,@${p}_email,@${p}_stage,@${p}_pipeline,@${p}_owner,@${p}_status,@${p}_summary,PARSE_JSON(@${p}_attr),@${p}_source,CURRENT_TIMESTAMP(),CURRENT_TIMESTAMP())`;
    });
    await this.bq.executeWrite(
      `INSERT INTO ${table("clients")} (${cols}) VALUES ${tuples.join(",")}`,
      params,
    );
  }

  private async insertTasksBulk(
    rows: Array<{ cid: string; tk: TaskInput }>,
    brand: string,
  ): Promise<void> {
    const cols =
      "task_id, client_id, client_brand, description, status, due_date, owner, priority, source, created_at, updated_at";
    const params: Record<string, unknown> = { brand };
    const tuples = rows.map((r, i) => {
      const p = `t${i}`;
      params[`${p}_id`] = `task_${crypto.randomBytes(5).toString("hex")}`;
      params[`${p}_cid`] = r.cid;
      params[`${p}_desc`] = r.tk.description;
      params[`${p}_status`] = r.tk.status || "open";
      params[`${p}_due`] = r.tk.dueDate || null;
      params[`${p}_owner`] = r.tk.owner || null;
      params[`${p}_prio`] = r.tk.priority || null;
      params[`${p}_source`] = r.tk.source || "csv";
      // SAFE.PARSE_DATE tolerates null and non-ISO strings (-> NULL) so a bad
      // date never fails the whole batch.
      return `(@${p}_id,@${p}_cid,@brand,@${p}_desc,@${p}_status,SAFE.PARSE_DATE('%Y-%m-%d',@${p}_due),@${p}_owner,@${p}_prio,@${p}_source,CURRENT_TIMESTAMP(),CURRENT_TIMESTAMP())`;
    });
    await this.bq.executeWrite(
      `INSERT INTO ${table("client_tasks")} (${cols}) VALUES ${tuples.join(",")}`,
      params,
    );
  }

  // ── tasks ──────────────────────────────────────────────────────────

  async addTask(input: TaskInput, t?: V1Tenant): Promise<{ taskId: string }> {
    const brand = this.brand(t);
    const taskId = `task_${crypto.randomBytes(5).toString("hex")}`;
    await this.bq.executeWrite(
      `INSERT INTO ${table("client_tasks")}
         (task_id, client_id, client_brand, description, status, due_date,
          owner, priority, source, created_at, updated_at)
       VALUES
         (@task_id, @client_id, @brand, @description, @status, @due_date,
          @owner, @priority, @source, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
      {
        task_id: taskId,
        client_id: input.clientId || null,
        brand,
        description: input.description,
        status: input.status || "open",
        due_date: input.dueDate || null,
        owner: input.owner || null,
        priority: input.priority || null,
        source: input.source || "ask",
      },
    );
    return { taskId };
  }

  async updateTask(
    taskId: string,
    updates: {
      status?: string;
      dueDate?: string;
      owner?: string;
      priority?: string;
    },
    t?: V1Tenant,
  ): Promise<{ updated: boolean }> {
    const brand = this.brand(t);
    const set: string[] = [];
    const params: Record<string, unknown> = { taskId, brand };
    if (updates.status) {
      set.push("status = @status");
      params.status = updates.status;
      if (norm(updates.status) === "done")
        set.push("completed_at = CURRENT_TIMESTAMP()");
    }
    if (updates.dueDate) {
      set.push("due_date = @due_date");
      params.due_date = updates.dueDate;
    }
    if (updates.owner) {
      set.push("owner = @owner");
      params.owner = updates.owner;
    }
    if (updates.priority) {
      set.push("priority = @priority");
      params.priority = updates.priority;
    }
    if (!set.length) return { updated: false };

    // Confirm the task exists BEFORE the UPDATE and report on that. executeWrite
    // reads numDmlAffectedRows off job.metadata, which is not refreshed after
    // the write and can read "0" on a successful update — so a real update was
    // reporting "not found". An existence SELECT is the reliable signal.
    const { rows: exists } = await this.bq.executeQuery(
      `SELECT task_id FROM ${table("client_tasks")}
        WHERE task_id = @taskId AND client_brand = @brand LIMIT 1`,
      { taskId, brand },
    );
    if (!exists.length) return { updated: false };

    set.push("updated_at = CURRENT_TIMESTAMP()");
    await this.bq.executeWrite(
      `UPDATE ${table("client_tasks")} SET ${set.join(", ")}
        WHERE task_id = @taskId AND client_brand = @brand`,
      params,
    );
    return { updated: true };
  }

  /** List tasks, optionally by owner/status/client, newest-due first. */
  async listTasks(
    filter: {
      owner?: string;
      status?: string;
      clientId?: string;
      limit?: number;
    },
    t?: V1Tenant,
  ): Promise<Record<string, unknown>[]> {
    const brand = this.brand(t);
    const limit = Math.max(1, Math.min(500, Math.floor(filter.limit ?? 100)));
    const where: string[] = ["t.client_brand = @brand"];
    const params: Record<string, unknown> = { brand, limit };
    if (filter.owner) {
      where.push("LOWER(t.owner) = @owner");
      params.owner = norm(filter.owner);
    }
    if (filter.status) {
      where.push("LOWER(t.status) = @status");
      params.status = norm(filter.status);
    }
    if (filter.clientId) {
      where.push("t.client_id = @clientId");
      params.clientId = filter.clientId;
    }
    const { rows } = await this.bq.executeQuery(
      `SELECT t.task_id, t.description, t.status, t.due_date, t.owner, t.priority,
              c.name AS client_name
         FROM ${table("client_tasks")} t
         LEFT JOIN ${table("clients")} c
           ON t.client_id = c.client_id AND t.client_brand = c.client_brand
        WHERE ${where.join(" AND ")}
        ORDER BY t.status, t.due_date NULLS LAST
        LIMIT @limit`,
      params,
    );
    return rows;
  }

  // ── context ────────────────────────────────────────────────────────

  /**
   * Find an already-ingested context row by its origin id. (brand,
   * source_ref) is the logical upsert key for pulled items — BigQuery has no
   * unique constraints, so dedup is enforced here rather than in the schema.
   * source_ref alone (not source + source_ref) because callers label the
   * source inconsistently across runs ("fireflies" vs "daily-refresh-<date>")
   * while the underlying meeting/message/event id is stable and unique.
   */
  async findContextBySourceRef(
    sourceRef: string,
    t?: V1Tenant,
  ): Promise<{ contextId: string; clientId: string | null } | null> {
    const brand = this.brand(t);
    const { rows } = await this.bq.executeQuery(
      `SELECT context_id, client_id FROM ${table("client_context")}
        WHERE client_brand = @brand AND source_ref = @sourceRef
        ORDER BY created_at ASC
        LIMIT 1`,
      { brand, sourceRef },
    );
    if (!rows.length) return null;
    return {
      contextId: rows[0].context_id as string,
      clientId: (rows[0].client_id as string | null) ?? null,
    };
  }

  /**
   * Batch version of findContextBySourceRef for the pull path: given the
   * external ids of a freshly pulled batch, return the subset that already
   * exists in the store. One query per 100 refs instead of one per item.
   */
  async existingContextRefs(
    sourceRefs: string[],
    t?: V1Tenant,
  ): Promise<Set<string>> {
    const brand = this.brand(t);
    const out = new Set<string>();
    const list = Array.from(new Set(sourceRefs.filter(Boolean)));
    const CHUNK = 100;
    for (let start = 0; start < list.length; start += CHUNK) {
      const chunk = list.slice(start, start + CHUNK);
      const params: Record<string, unknown> = { brand };
      const ors = chunk.map((ref, i) => {
        params[`r${i}`] = ref;
        return `@r${i}`;
      });
      const { rows } = await this.bq.executeQuery(
        `SELECT DISTINCT source_ref FROM ${table("client_context")}
          WHERE client_brand = @brand AND source_ref IN (${ors.join(", ")})`,
        params,
      );
      for (const row of rows) {
        out.add(row.source_ref as string);
      }
    }
    return out;
  }

  /**
   * Insert a context row — or, when it carries a source_ref that was already
   * ingested, update that row in place instead of inserting a duplicate. The
   * existing row's client_id is preserved so a manual moveContext() is never
   * undone by a later refresh.
   */
  async addContext(
    input: ContextInput,
    t?: V1Tenant,
  ): Promise<{ contextId: string; operation: "created" | "updated" }> {
    const brand = this.brand(t);
    const metaJson =
      input.metadata && Object.keys(input.metadata).length
        ? JSON.stringify(input.metadata)
        : null;

    if (input.sourceRef) {
      const existing = await this.findContextBySourceRef(input.sourceRef, t);
      if (existing) {
        await this.bq.executeWrite(
          `UPDATE ${table("client_context")}
              SET title = @title, content = @content,
                  content_type = @content_type,
                  metadata = ${metaJson ? "PARSE_JSON(@metadata)" : "metadata"},
                  occurred_at = COALESCE(@occurred_at, occurred_at)
            WHERE context_id = @context_id AND client_brand = @brand`,
          {
            context_id: existing.contextId,
            brand,
            title: input.title || null,
            content: input.content,
            content_type: input.contentType || "note",
            ...(metaJson ? { metadata: metaJson } : {}),
            occurred_at: input.occurredAt || null,
          },
        );
        return { contextId: existing.contextId, operation: "updated" };
      }
    }

    const contextId = `ctx_${crypto.randomBytes(6).toString("hex")}`;
    await this.bq.executeWrite(
      `INSERT INTO ${table("client_context")}
         (context_id, client_id, client_brand, title, content, content_type,
          source, source_ref, metadata, occurred_at, created_at)
       VALUES
         (@context_id, @client_id, @brand, @title, @content, @content_type,
          @source, @source_ref, ${metaJson ? "PARSE_JSON(@metadata)" : "NULL"},
          @occurred_at, CURRENT_TIMESTAMP())`,
      {
        context_id: contextId,
        client_id: input.clientId || null,
        brand,
        title: input.title || null,
        content: input.content,
        content_type: input.contentType || "note",
        source: input.source || "ask",
        source_ref: input.sourceRef || null,
        metadata: metaJson,
        occurred_at: input.occurredAt || null,
      },
    );
    return { contextId, operation: "created" };
  }

  /**
   * Reattach a single context row to a different client (or detach it with
   * newClientId null). The correction path for rows the pull mapped to the
   * wrong client — deleting the whole client is no longer the only fix.
   */
  async moveContext(
    contextId: string,
    newClientId: string | null,
    t?: V1Tenant,
  ): Promise<{
    moved: boolean;
    reason?: string;
    previousClientId?: string | null;
  }> {
    const brand = this.brand(t);
    const { rows } = await this.bq.executeQuery(
      `SELECT context_id, client_id FROM ${table("client_context")}
        WHERE context_id = @contextId AND client_brand = @brand LIMIT 1`,
      { contextId, brand },
    );
    if (!rows.length) return { moved: false, reason: "context not found" };
    const previousClientId = (rows[0].client_id as string | null) ?? null;

    if (newClientId) {
      const { rows: client } = await this.bq.executeQuery(
        `SELECT client_id FROM ${table("clients")}
          WHERE client_id = @clientId AND client_brand = @brand LIMIT 1`,
        { clientId: newClientId, brand },
      );
      if (!client.length)
        return { moved: false, reason: "target client not found" };
    }

    await this.bq.executeWrite(
      `UPDATE ${table("client_context")}
          SET client_id = @newClientId
        WHERE context_id = @contextId AND client_brand = @brand`,
      { contextId, brand, newClientId: newClientId || null },
    );
    return { moved: true, previousClientId };
  }

  /**
   * Clients with their identity fields (domain/email), for deterministic
   * attendee-domain matching in the pull path.
   */
  async listClientsForMatching(t?: V1Tenant): Promise<
    Array<{
      client_id: string;
      name: string;
      primary_domain: string | null;
      primary_email: string | null;
    }>
  > {
    const brand = this.brand(t);
    const { rows } = await this.bq.executeQuery(
      `SELECT client_id, name, primary_domain, primary_email
         FROM ${table("clients")}
        WHERE client_brand = @brand
        ORDER BY updated_at DESC
        LIMIT 300`,
      { brand },
    );
    return rows as Array<{
      client_id: string;
      name: string;
      primary_domain: string | null;
      primary_email: string | null;
    }>;
  }

  /**
   * Keyword search over context content + title. Tokenizes the query into
   * meaningful words and matches ANY of them — a whole natural-language
   * question ("what did Joe's email say") never matches as one substring, so
   * we OR the significant tokens instead. Returns a longer snippet so callers
   * (esp. togari_ask) get enough of the email/transcript to answer.
   */
  async searchContext(
    query: string,
    filter: { clientId?: string; limit?: number },
    t?: V1Tenant,
  ): Promise<Record<string, unknown>[]> {
    const brand = this.brand(t);
    const limit = Math.max(1, Math.min(100, Math.floor(filter.limit ?? 20)));

    const stop = new Set([
      "what",
      "when",
      "where",
      "which",
      "that",
      "this",
      "with",
      "from",
      "about",
      "does",
      "did",
      "the",
      "and",
      "for",
      "are",
      "was",
      "were",
      "his",
      "her",
      "their",
      "them",
      "you",
      "your",
      "need",
      "before",
      "after",
      "have",
      "has",
      "who",
      "how",
      "why",
      "say",
      "said",
      "latest",
      "email",
      "tell",
      "give",
      "show",
      "them",
      "they",
    ]);
    const tokens = norm(query)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !stop.has(w))
      .slice(0, 12);

    const where: string[] = ["client_brand = @brand"];
    const params: Record<string, unknown> = { brand, limit };
    if (tokens.length) {
      const ors = tokens.map((tok, i) => {
        params[`q${i}`] = `%${tok}%`;
        return `LOWER(content) LIKE @q${i} OR LOWER(IFNULL(title, '')) LIKE @q${i}`;
      });
      where.push(`(${ors.join(" OR ")})`);
    }
    if (filter.clientId) {
      where.push("client_id = @clientId");
      params.clientId = filter.clientId;
    }
    const { rows } = await this.bq.executeQuery(
      `SELECT context_id, client_id, title, content_type, source,
              SUBSTR(content, 0, 1500) AS snippet, occurred_at
         FROM ${table("client_context")}
        WHERE ${where.join(" AND ")}
        ORDER BY COALESCE(occurred_at, created_at) DESC
        LIMIT @limit`,
      params,
    );
    return rows;
  }

  // ── deletes (guarded) ──────────────────────────────────────────────

  /**
   * Delete a client and everything hanging off it (its tasks + context).
   * Existence-checked so the caller gets an honest "not found". Scoped by brand.
   */
  async deleteClient(
    clientId: string,
    t?: V1Tenant,
  ): Promise<{ deleted: boolean; tasks: number; context: number }> {
    const brand = this.brand(t);
    const { rows } = await this.bq.executeQuery(
      `SELECT client_id FROM ${table("clients")}
        WHERE client_id = @clientId AND client_brand = @brand LIMIT 1`,
      { clientId, brand },
    );
    if (!rows.length) return { deleted: false, tasks: 0, context: 0 };

    // Count children BEFORE deleting — numDmlAffectedRows off job.metadata is
    // unreliable, so a pre-count gives truthful numbers back to the caller.
    const counts = await this.bq.executeQuery(
      `SELECT
         (SELECT COUNT(*) FROM ${table("client_tasks")}
           WHERE client_id = @clientId AND client_brand = @brand) AS tasks,
         (SELECT COUNT(*) FROM ${table("client_context")}
           WHERE client_id = @clientId AND client_brand = @brand) AS context`,
      { clientId, brand },
    );
    const tasks = Number(counts.rows[0]?.tasks ?? 0);
    const context = Number(counts.rows[0]?.context ?? 0);

    await this.bq.executeDelete(
      `DELETE FROM ${table("client_context")}
        WHERE client_id = @clientId AND client_brand = @brand`,
      { clientId, brand },
    );
    await this.bq.executeDelete(
      `DELETE FROM ${table("client_tasks")}
        WHERE client_id = @clientId AND client_brand = @brand`,
      { clientId, brand },
    );
    await this.bq.executeDelete(
      `DELETE FROM ${table("clients")}
        WHERE client_id = @clientId AND client_brand = @brand`,
      { clientId, brand },
    );
    return { deleted: true, tasks, context };
  }

  /** Delete a single task. Existence-checked for a truthful result. */
  async deleteTask(
    taskId: string,
    t?: V1Tenant,
  ): Promise<{ deleted: boolean }> {
    const brand = this.brand(t);
    const { rows } = await this.bq.executeQuery(
      `SELECT task_id FROM ${table("client_tasks")}
        WHERE task_id = @taskId AND client_brand = @brand LIMIT 1`,
      { taskId, brand },
    );
    if (!rows.length) return { deleted: false };
    await this.bq.executeDelete(
      `DELETE FROM ${table("client_tasks")}
        WHERE task_id = @taskId AND client_brand = @brand`,
      { taskId, brand },
    );
    return { deleted: true };
  }

  /** Delete a single context row. Existence-checked. */
  async deleteContext(
    contextId: string,
    t?: V1Tenant,
  ): Promise<{ deleted: boolean }> {
    const brand = this.brand(t);
    const { rows } = await this.bq.executeQuery(
      `SELECT context_id FROM ${table("client_context")}
        WHERE context_id = @contextId AND client_brand = @brand LIMIT 1`,
      { contextId, brand },
    );
    if (!rows.length) return { deleted: false };
    await this.bq.executeDelete(
      `DELETE FROM ${table("client_context")}
        WHERE context_id = @contextId AND client_brand = @brand`,
      { contextId, brand },
    );
    return { deleted: true };
  }

  /**
   * Wipe the whole source of truth for this org — every client, task, and
   * context row. Brand-scoped, so it only ever clears the caller's org. For
   * starting fresh (e.g. after testing).
   */
  async reset(
    t?: V1Tenant,
  ): Promise<{ clients: number; tasks: number; context: number }> {
    const brand = this.brand(t);
    // Pre-count for truthful reporting (numDmlAffectedRows is unreliable).
    const counts = await this.bq.executeQuery(
      `SELECT
         (SELECT COUNT(*) FROM ${table("clients")} WHERE client_brand = @brand) AS clients,
         (SELECT COUNT(*) FROM ${table("client_tasks")} WHERE client_brand = @brand) AS tasks,
         (SELECT COUNT(*) FROM ${table("client_context")} WHERE client_brand = @brand) AS context`,
      { brand },
    );
    await this.bq.executeDelete(
      `DELETE FROM ${table("client_context")} WHERE client_brand = @brand`,
      { brand },
    );
    await this.bq.executeDelete(
      `DELETE FROM ${table("client_tasks")} WHERE client_brand = @brand`,
      { brand },
    );
    await this.bq.executeDelete(
      `DELETE FROM ${table("clients")} WHERE client_brand = @brand`,
      { brand },
    );
    return {
      clients: Number(counts.rows[0]?.clients ?? 0),
      tasks: Number(counts.rows[0]?.tasks ?? 0),
      context: Number(counts.rows[0]?.context ?? 0),
    };
  }

  /**
   * Most-recent context rows WITH content, for grounding answers. togari_ask
   * uses this so freshly-attached emails/meetings are always visible even when
   * a keyword search would miss them. Small V1 scale makes a recency pull the
   * reliable path (vector search comes later at bigger scale).
   */
  async recentContext(
    filter: { clientId?: string; limit?: number },
    t?: V1Tenant,
  ): Promise<Record<string, unknown>[]> {
    const brand = this.brand(t);
    const limit = Math.max(1, Math.min(100, Math.floor(filter.limit ?? 40)));
    const where: string[] = ["client_brand = @brand"];
    const params: Record<string, unknown> = { brand, limit };
    if (filter.clientId) {
      where.push("client_id = @clientId");
      params.clientId = filter.clientId;
    }
    const { rows } = await this.bq.executeQuery(
      `SELECT context_id, client_id, title, content_type, source,
              SUBSTR(content, 0, 2000) AS content, occurred_at
         FROM ${table("client_context")}
        WHERE ${where.join(" AND ")}
        ORDER BY COALESCE(occurred_at, created_at) DESC
        LIMIT @limit`,
      params,
    );
    return rows;
  }
}
