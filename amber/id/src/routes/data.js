/**
 * Data routes: operational storage for amber-agent. Backed by GCP Firestore
 * via src/db/firestore.js.
 *
 *   /v1/data/:table/get      fetch one doc matching the filter
 *   /v1/data/:table/query    list docs matching the filter
 *   /v1/data/:table/upsert   merge a row onto the conflict key
 *   /v1/data/:table/insert   same as upsert for keyed tables; append for log tables
 *   /v1/data/:table/delete   remove matching docs
 *
 * Each tenant gets their own sub-collections under
 * agent_data/{tenant_did}/{table} and agent_log/{tenant_did}/{table}.
 * All routes require the server-to-server API key.
 */

import { randomUUID } from "node:crypto";
import { requireApiKey } from "../lib/auth.js";
import {
  agentDataGet,
  agentDataUpsert,
  agentDataQuery,
  agentDataDelete,
  agentLogInsert,
  agentLogQuery,
} from "../db/agent-data.js";

const CONFLICT_KEYS = {
  contacts: ["handle"],
  conversations: ["chat_key"],
  health_profiles: ["handle"],
  health_checkins: ["handle", "checkin_date", "source"],
  user_sessions: ["handle"],
  context_files: ["file_key"],
  group_memories: ["group_id"],
  memories: ["id"],
  trips: ["id"],
  reservations: ["id"],
  budget_items: ["id"],
  packing_items: ["id"],
  group_tasks: ["id"],
  events: ["event_id"],
  // amber-imessage Rave Master persists its in-memory event card here via
  // sbGet/sbUpsert. Keyed by event_id (e.g. "event:<did>:edc:2026") so the
  // upsert is idempotent across restarts. Same private/Sagar-scoped contract
  // as `events` — every row lives under agent_data/{tenant_did}/event_cards/.
  event_cards: ["event_id"],
};

const LOG_TABLES = new Set(["interactions", "event_items"]);

const ALLOWED_TABLES = new Set([
  ...Object.keys(CONFLICT_KEYS),
  ...LOG_TABLES,
]);

const ALLOWED_FILTER_OPS = new Set(["eq", "ne", "lt", "lte", "gt", "gte", "in", "array-contains"]);

// Filter / order column names come from request bodies. Restrict to identifier
// shape so a caller cannot probe arbitrary nested paths (e.g. "__proto__",
// "secrets.master_key") that some Firestore tooling treats specially.
const COLUMN_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

function isSafeColumn(col) {
  return typeof col === "string" && COLUMN_RE.test(col);
}

/**
 * Validate that a table name is in the explicit allowlist.
 * Returns an error string if invalid, null if valid.
 */
function validateTable(table) {
  if (typeof table !== "string" || !ALLOWED_TABLES.has(table)) {
    return `Unknown table "${table}". Allowed tables: ${[...ALLOWED_TABLES].join(", ")}`;
  }
  return null;
}

/**
 * Validate filter operator against allowlist to prevent injection.
 */
function validateFilterOp(op) {
  return ALLOWED_FILTER_OPS.has(op);
}

function rowKeyFor(table, row) {
  if (LOG_TABLES.has(table)) return null;
  const cols = CONFLICT_KEYS[table];
  if (!cols) return null;
  const parts = cols.map((c) => {
    let v = row[c];
    if (v === undefined || v === null) {
      if (c === "id") {
        v = randomKey();
        row[c] = v;
      } else {
        return "";
      }
    }
    return String(v).replace(/\//g, "_");
  });
  if (parts.some((p) => p === "")) return null;
  return parts.join("|");
}

function parseFilter(input) {
  if (!input) return [];
  if (typeof input === "object") {
    const out = [];
    for (const [col, spec] of Object.entries(input)) {
      if (col === "_limit" || col === "_order" || col === "_offset") continue;
      if (!isSafeColumn(col)) continue;
      if (spec && typeof spec === "object" && "op" in spec) {
        const op = validateFilterOp(spec.op) ? spec.op : "eq";
        out.push({ col, op, value: spec.value });
      } else {
        out.push({ col, op: "eq", value: spec });
      }
    }
    return out;
  }
  if (typeof input !== "string") return [];
  const out = [];
  for (const part of input.split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const col = part.slice(0, eq);
    const rest = part.slice(eq + 1);
    if (col === "select" || col === "order" || col === "limit") continue;
    if (!isSafeColumn(col)) continue;
    const dot = rest.indexOf(".");
    if (dot < 0) continue;
    const rawOp = rest.slice(0, dot);
    const op = validateFilterOp(rawOp) ? rawOp : "eq";
    const value = decodeURIComponent(rest.slice(dot + 1));
    out.push({ col, op, value });
  }
  return out;
}

function parseOrder(orderStr) {
  if (!orderStr || typeof orderStr !== "string" || !orderStr.includes(".")) {
    return null;
  }
  const [col, dir] = orderStr.split(".");
  if (!isSafeColumn(col)) return null;
  return {
    col,
    dir: dir && dir.toLowerCase() === "asc" ? "asc" : "desc",
  };
}

/**
 * No-op on Firestore — collections are implicit. Kept exported because
 * src/index.js still calls it on boot; removing the call would require a
 * separate edit.
 */
export async function ensureAmberAgentSchema() {
  return;
}

export function registerDataRoutes(app) {
  app.post(
    "/v1/data/:table/get",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const { table } = request.params;
      const tableErr = validateTable(table);
      if (tableErr) return reply.code(400).send({ error: tableErr });
      const body = request.body || {};
      const tenantDid = body.tenant_did || body.tenantDid || null;
      if (!tenantDid) {
        return reply.code(400).send({ error: "tenant_did required" });
      }
      const filters = parseFilter(body.filter);
      try {
        // Most callers pass a single eq filter whose value is the rowKey.
        // If we can resolve the rowKey via CONFLICT_KEYS, do a direct doc
        // read — otherwise fall back to a bounded query.
        if (!LOG_TABLES.has(table)) {
          const synthetic = {};
          for (const f of filters) {
            if (f.op === "eq") synthetic[f.col] = f.value;
          }
          const rowKey = rowKeyFor(table, synthetic);
          if (rowKey) {
            const doc = await agentDataGet({ tenantDid, table, rowKey });
            return { data: doc || null };
          }
        }
        const rows = await agentDataQuery({
          tenantDid,
          table,
          filters,
          limit: 1,
          order: { col: "updated_at", dir: "desc" },
        });
        return { data: rows[0] || null };
      } catch (err) {
        request.log.error(err, "data.get failed");
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  app.post(
    "/v1/data/:table/query",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const { table } = request.params;
      const tableErr = validateTable(table);
      if (tableErr) return reply.code(400).send({ error: tableErr });
      const body = request.body || {};
      const tenantDid = body.tenant_did || body.tenantDid || null;
      if (!tenantDid) {
        return reply.code(400).send({ error: "tenant_did required" });
      }
      const filters = parseFilter(body.filter);
      const limit = Math.min(parseInt(body.limit, 10) || 100, 1000);
      const order = parseOrder(body.order);
      try {
        const rows = LOG_TABLES.has(table)
          ? await agentLogQuery({
              tenantDid,
              table,
              filters,
              limit,
              order: order || { col: "created_at", dir: "desc" },
            })
          : await agentDataQuery({
              tenantDid,
              table,
              filters,
              limit,
              order: order || { col: "updated_at", dir: "desc" },
            });
        return { data: rows };
      } catch (err) {
        request.log.error(err, "data.query failed");
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  app.post(
    "/v1/data/:table/upsert",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const { table } = request.params;
      const tableErr = validateTable(table);
      if (tableErr) return reply.code(400).send({ error: tableErr });
      const body = request.body || {};
      const tenantDid = body.tenant_did || body.tenantDid || null;
      const row = body.row || {};
      if (!tenantDid) {
        return reply.code(400).send({ error: "tenant_did required" });
      }
      if (LOG_TABLES.has(table)) {
        try {
          await agentLogInsert({ tenantDid, table, row });
          return { data: row };
        } catch (err) {
          request.log.error(err, "log upsert failed");
          return reply.code(500).send({ error: "internal_error" });
        }
      }
      const rowKey = rowKeyFor(table, row);
      if (!rowKey) {
        return reply.code(400).send({
          error: `upsert requires conflict keys for table "${table}"`,
          expected: CONFLICT_KEYS[table] || null,
        });
      }
      try {
        await agentDataUpsert({ tenantDid, table, rowKey, row });
        return { data: row };
      } catch (err) {
        request.log.error(err, "data.upsert failed");
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  app.post(
    "/v1/data/:table/insert",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const { table } = request.params;
      const tableErr = validateTable(table);
      if (tableErr) return reply.code(400).send({ error: tableErr });
      const body = request.body || {};
      const tenantDid = body.tenant_did || body.tenantDid || null;
      const row = body.row || {};
      if (!tenantDid) {
        return reply.code(400).send({ error: "tenant_did required" });
      }
      if (LOG_TABLES.has(table)) {
        try {
          await agentLogInsert({ tenantDid, table, row });
          return { data: row };
        } catch (err) {
          request.log.error(err, "log insert failed");
          return reply.code(500).send({ error: "internal_error" });
        }
      }
      const rowKey = rowKeyFor(table, row) || randomKey();
      try {
        await agentDataUpsert({ tenantDid, table, rowKey, row });
        return { data: row };
      } catch (err) {
        request.log.error(err, "data.insert failed");
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  app.post(
    "/v1/data/:table/delete",
    { preHandler: [requireApiKey] },
    async (request, reply) => {
      const { table } = request.params;
      const tableErr = validateTable(table);
      if (tableErr) return reply.code(400).send({ error: tableErr });
      const body = request.body || {};
      const tenantDid = body.tenant_did || body.tenantDid || null;
      if (!tenantDid) {
        return reply.code(400).send({ error: "tenant_did required" });
      }
      const filters = parseFilter(body.filter);
      try {
        if (!LOG_TABLES.has(table)) {
          const synthetic = {};
          for (const f of filters) {
            if (f.op === "eq") synthetic[f.col] = f.value;
          }
          const rowKey = rowKeyFor(table, synthetic);
          if (rowKey) {
            await agentDataDelete({ tenantDid, table, rowKey });
            return { data: { deleted: 1 } };
          }
        }
        return reply
          .code(400)
          .send({ error: "delete requires a conflict-key filter" });
      } catch (err) {
        request.log.error(err, "data.delete failed");
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );
}

function randomKey() {
  return randomUUID();
}
