import { runQuery, table } from "./bigquery.js";
import { togariConfig } from "./config.js";
import { ok, fail, wrap } from "./routes.js";

const PERSON_FIELDS = `person_id, full_name, company, title,
  email_addresses[SAFE_OFFSET(0)] AS email,
  relationship_score, interaction_count, last_interaction_at`;

export function registerPeopleRoutes(router) {
  router.get(
    "/people",
    wrap(async (req, res) => {
      const search = String(req.query.search || "");
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Number(req.query.offset) || 0;
      const params = { ownerId: togariConfig.ownerId, search, limit, offset };
      const where = `owner_id = @ownerId AND (
        @search = '' OR LOWER(COALESCE(full_name, '')) LIKE CONCAT('%', LOWER(@search), '%')
        OR LOWER(COALESCE(company, '')) LIKE CONCAT('%', LOWER(@search), '%')
      )`;
      const [rows, counts] = await Promise.all([
        runQuery(
          `SELECT ${PERSON_FIELDS} FROM ${table("pdw", "persons")}
           WHERE ${where}
           ORDER BY last_interaction_at DESC NULLS LAST
           LIMIT @limit OFFSET @offset`,
          params,
        ),
        runQuery(
          `SELECT COUNT(*) AS total FROM ${table("pdw", "persons")} WHERE ${where}`,
          { ownerId: params.ownerId, search },
        ),
      ]);
      ok(res, { rows, total: Number(counts[0]?.total || 0) });
    }),
  );

  router.get(
    "/people/:personId",
    wrap(async (req, res) => {
      const params = {
        ownerId: togariConfig.ownerId,
        personId: req.params.personId,
      };
      const people = await runQuery(
        `SELECT ${PERSON_FIELDS}, phone_numbers, linkedin_url, tags
         FROM ${table("pdw", "persons")}
         WHERE owner_id = @ownerId AND person_id = @personId`,
        params,
      );
      if (!people.length) return fail(res, 404, "person_not_found");
      const [interactions, monthly] = await Promise.all([
        runQuery(
          `SELECT interaction_id, channel, direction, interaction_type, subject,
                  summary, sentiment, topics, occurred_at
           FROM ${table("pdw", "interactions")}
           WHERE owner_id = @ownerId AND person_id = @personId
           ORDER BY occurred_at DESC LIMIT 50`,
          params,
        ),
        runQuery(
          `SELECT FORMAT_TIMESTAMP('%Y-%m', occurred_at) AS month, COUNT(*) AS count
           FROM ${table("pdw", "interactions")}
           WHERE owner_id = @ownerId AND person_id = @personId
             AND occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 365 DAY)
           GROUP BY month ORDER BY month`,
          params,
        ),
      ]);
      const byChannel = {};
      let sentimentSum = 0;
      let sentimentCount = 0;
      for (const i of interactions) {
        byChannel[i.channel] = (byChannel[i.channel] || 0) + 1;
        if (typeof i.sentiment === "number") {
          sentimentSum += i.sentiment;
          sentimentCount += 1;
        }
      }
      ok(res, {
        entity: people[0],
        related: { interactions },
        analytics: {
          byChannel,
          monthly: monthly.map((m) => ({
            month: m.month,
            count: Number(m.count),
          })),
          avgSentiment: sentimentCount ? sentimentSum / sentimentCount : null,
        },
      });
    }),
  );
}
