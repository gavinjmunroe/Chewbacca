import { runQuery, table } from "./bigquery.js";
import { togariConfig } from "./config.js";
import { ok, fail, wrap } from "./routes.js";

export function registerChannelRoutes(router) {
  router.get(
    "/channels",
    wrap(async (req, res) => {
      const rows = await runQuery(
        `SELECT channel, COUNT(*) AS interactions,
                COUNT(DISTINCT person_id) AS people,
                COUNTIF(direction = 'inbound') AS inbound,
                FORMAT_TIMESTAMP('%FT%TZ', MAX(occurred_at)) AS last_activity
         FROM ${table("pdw", "interactions")}
         WHERE owner_id = @ownerId
         GROUP BY channel`,
        { ownerId: togariConfig.ownerId },
      );
      const byRaw = Object.fromEntries(rows.map((r) => [r.channel, r]));
      const channels = togariConfig.channels.map((c) => {
        const members = c.interactionChannels
          .map((k) => byRaw[k])
          .filter(Boolean);
        return {
          key: c.key,
          label: c.label,
          interactions: members.reduce((s, m) => s + Number(m.interactions), 0),
          people: members.reduce((s, m) => s + Number(m.people), 0),
          inbound: members.reduce((s, m) => s + Number(m.inbound), 0),
          lastActivity:
            members
              .map((m) => m.last_activity)
              .sort()
              .pop() || null,
        };
      });
      ok(res, { channels });
    }),
  );

  router.get(
    "/channels/:key",
    wrap(async (req, res) => {
      const config = togariConfig.channels.find(
        (c) => c.key === req.params.key,
      );
      if (!config) return fail(res, 404, "channel_not_found");
      const params = {
        ownerId: togariConfig.ownerId,
        channels: config.interactionChannels,
      };
      const [weekly, topPeople] = await Promise.all([
        runQuery(
          `SELECT FORMAT_DATE('%F', DATE_TRUNC(DATE(occurred_at), WEEK(MONDAY))) AS week,
                  COUNT(*) AS count, COUNTIF(direction = 'inbound') AS inbound
           FROM ${table("pdw", "interactions")}
           WHERE owner_id = @ownerId AND channel IN UNNEST(@channels)
             AND occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 84 DAY)
           GROUP BY week ORDER BY week`,
          params,
        ),
        runQuery(
          `SELECT p.person_id, p.full_name, p.company,
                  COUNT(*) AS total, COUNTIF(i.direction = 'inbound') AS inbound
           FROM ${table("pdw", "interactions")} i
           JOIN ${table("pdw", "persons")} p
             ON p.person_id = i.person_id AND p.owner_id = i.owner_id
           WHERE i.owner_id = @ownerId AND i.channel IN UNNEST(@channels)
             AND i.occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 84 DAY)
           GROUP BY 1, 2, 3
           ORDER BY inbound DESC, total DESC
           LIMIT 25`,
          params,
        ),
      ]);
      const totals = {
        count: weekly.reduce((s, w) => s + Number(w.count), 0),
        inbound: weekly.reduce((s, w) => s + Number(w.inbound), 0),
      };
      ok(res, {
        entity: { key: config.key, label: config.label },
        related: {
          topPeople: topPeople.map((p) => ({
            ...p,
            total: Number(p.total),
            inbound: Number(p.inbound),
          })),
        },
        analytics: {
          weekly: weekly.map((w) => ({
            week: w.week,
            count: Number(w.count),
            inbound: Number(w.inbound),
          })),
          totals,
        },
      });
    }),
  );
}
