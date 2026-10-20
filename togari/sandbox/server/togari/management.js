import { runQuery, table } from "./bigquery.js";
import { callTogariTool } from "./mcpClient.js";
import { togariConfig } from "./config.js";
import { ok, fail, wrap } from "./routes.js";

function parseAttributes(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function registerManagementRoutes(router) {
  router.get(
    "/management",
    wrap(async (req, res) => {
      // scope=paying (default): won clients only. scope=all: every active
      // account under management, so the live tracker covers accounts still
      // mid-pipeline (the day-to-day book, not just closed business).
      const scope = req.query.scope === "all" ? "all" : "paying";
      const where =
        scope === "all"
          ? `client_brand = @brand AND status = 'active'`
          : `client_brand = @brand AND (status = 'won' OR stage = 'Closed Won')`;
      const rows = await runQuery(
        `SELECT client_id, name, stage, owner, status, primary_email,
                primary_domain, summary, attributes, updated_at
         FROM ${table("lake", "clients")}
         WHERE ${where}
         ORDER BY updated_at DESC`,
        { brand: togariConfig.brand },
      );
      // One batched query for every card's open tasks; overdue computed in SQL
      // so the client never has to reason about dates.
      const ids = rows.map((r) => r.client_id);
      const tasksByClient = {};
      if (ids.length) {
        const tasks = await runQuery(
          `SELECT client_id, task_id, description, owner, priority,
                  FORMAT_DATE('%F', due_date) AS due_date,
                  (due_date IS NOT NULL AND due_date < CURRENT_DATE()) AS overdue
           FROM ${table("lake", "client_tasks")}
           WHERE status = 'open' AND client_id IN UNNEST(@ids)
           ORDER BY due_date IS NULL, due_date ASC`,
          { ids },
        );
        for (const t of tasks) {
          (tasksByClient[t.client_id] ||= []).push(t);
        }
      }
      ok(res, {
        scope,
        clients: rows.map((r) => ({
          ...r,
          attributes: parseAttributes(r.attributes),
          tasks: tasksByClient[r.client_id] || [],
        })),
      });
    }),
  );

  router.post(
    "/management/:clientId/meta",
    wrap(async (req, res) => {
      const { name, slack_url, contract_url, notes } = req.body || {};
      if (!name) return fail(res, 400, "name_required");
      const attributes = {};
      if (slack_url !== undefined) attributes.slack_url = slack_url;
      if (contract_url !== undefined) attributes.contract_url = contract_url;
      if (notes !== undefined) attributes.notes = notes;
      await callTogariTool("togari_client_upsert", {
        client_id: req.params.clientId,
        name,
        attributes,
      });
      ok(res, { updated: true, attributes });
    }),
  );

  router.post(
    "/management/:clientId/dnc",
    wrap(async (req, res) => {
      const { name, filename, content } = req.body || {};
      if (!name || !filename || !content) {
        return fail(res, 400, "name_filename_content_required");
      }
      await callTogariTool("togari_context_add", {
        client_id: req.params.clientId,
        title: `Do not contact list (${filename})`,
        content,
        content_type: "file",
        source: "dashboard",
      });
      ok(res, { stored: true });
    }),
  );
}
