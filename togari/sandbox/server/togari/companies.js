import { runQuery, table } from "./bigquery.js";
import { togariConfig } from "./config.js";
import { ok, wrap } from "./routes.js";

const COMPANY_FIELDS = `client_id, name, stage, pipeline, owner, status,
  primary_email, primary_domain, updated_at`;

export function registerCompanyRoutes(router) {
  router.get(
    "/companies",
    wrap(async (req, res) => {
      const search = String(req.query.search || "");
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Number(req.query.offset) || 0;
      const params = { brand: togariConfig.brand, search, limit, offset };
      const where = `client_brand = @brand AND (
        @search = '' OR LOWER(COALESCE(name, '')) LIKE CONCAT('%', LOWER(@search), '%')
        OR LOWER(COALESCE(primary_domain, '')) LIKE CONCAT('%', LOWER(@search), '%')
      )`;
      const [rows, counts] = await Promise.all([
        runQuery(
          `SELECT ${COMPANY_FIELDS} FROM ${table("lake", "clients")}
           WHERE ${where}
           ORDER BY updated_at DESC NULLS LAST
           LIMIT @limit OFFSET @offset`,
          params,
        ),
        runQuery(
          `SELECT COUNT(*) AS total FROM ${table("lake", "clients")} WHERE ${where}`,
          { brand: params.brand, search },
        ),
      ]);
      ok(res, { rows, total: Number(counts[0]?.total || 0) });
    }),
  );
}
