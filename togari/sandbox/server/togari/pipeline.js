import { runQuery, table } from "./bigquery.js";
import { callTogariTool } from "./mcpClient.js";
import { togariConfig } from "./config.js";
import { ok, fail, wrap } from "./routes.js";

// Matches the stage names in live togari_data_lake.clients (client_brand bma).
const STAGE_ORDER = [
  "Researching",
  "Discovery",
  "Conversation Started",
  "Proposal",
  "Verbal Commit",
  "Closed Won",
];

export function registerPipelineRoutes(router) {
  router.get(
    "/pipeline",
    wrap(async (req, res) => {
      const rows = await runQuery(
        `SELECT client_id, name, stage, pipeline, owner, status,
                primary_email, summary, updated_at
         FROM ${table("lake", "clients")}
         WHERE client_brand = @brand AND status != 'lost'
         ORDER BY updated_at DESC`,
        { brand: togariConfig.brand },
      );
      const byStage = new Map();
      for (const row of rows) {
        const stage = row.stage || "unstaged";
        if (!byStage.has(stage)) byStage.set(stage, []);
        byStage.get(stage).push(row);
      }
      const known = STAGE_ORDER.filter((s) => byStage.has(s));
      const unknown = [...byStage.keys()]
        .filter((s) => !STAGE_ORDER.includes(s))
        .sort();
      const stages = [...known, ...unknown].map((stage) => ({
        stage,
        clients: byStage.get(stage),
      }));
      ok(res, { stages });
    }),
  );

  router.patch(
    "/pipeline/:clientId",
    wrap(async (req, res) => {
      const { stage, name } = req.body || {};
      if (!stage || !name) return fail(res, 400, "stage_and_name_required");
      await callTogariTool("togari_client_upsert", {
        client_id: req.params.clientId,
        name,
        stage,
      });
      ok(res, { moved: true, stage });
    }),
  );

  router.get(
    "/clients/:clientId",
    wrap(async (req, res) => {
      const params = {
        brand: togariConfig.brand,
        clientId: req.params.clientId,
      };
      const clients = await runQuery(
        `SELECT client_id, name, stage, pipeline, owner, status, primary_email,
                primary_domain, summary, attributes, updated_at, created_at
         FROM ${table("lake", "clients")}
         WHERE client_brand = @brand AND client_id = @clientId`,
        params,
      );
      if (!clients.length) return fail(res, 404, "client_not_found");
      const [tasks, context] = await Promise.all([
        runQuery(
          `SELECT task_id, description, status, due_date, owner, priority, created_at
           FROM ${table("lake", "client_tasks")}
           WHERE client_brand = @brand AND client_id = @clientId
           ORDER BY created_at DESC LIMIT 100`,
          params,
        ),
        runQuery(
          `SELECT context_id, title, content_type, source, occurred_at, created_at
           FROM ${table("lake", "client_context")}
           WHERE client_brand = @brand AND client_id = @clientId
           ORDER BY COALESCE(occurred_at, created_at) DESC LIMIT 50`,
          params,
        ),
      ]);
      const contextByType = {};
      for (const c of context) {
        const t = c.content_type || "note";
        contextByType[t] = (contextByType[t] || 0) + 1;
      }
      ok(res, {
        entity: clients[0],
        related: { tasks, context },
        analytics: {
          openTasks: tasks.filter((t) => t.status === "open").length,
          doneTasks: tasks.filter((t) => t.status === "done").length,
          contextByType,
          lastTouch: context[0]?.occurred_at || context[0]?.created_at || null,
        },
      });
    }),
  );
}
