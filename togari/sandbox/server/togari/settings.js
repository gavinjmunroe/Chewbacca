import crypto from "node:crypto";
import { ok, fail, wrap } from "./routes.js";
import {
  togariConfig,
  isBigQueryConfigured,
  isMcpConfigured,
} from "./config.js";
import { listApiKeys, insertApiKey, revokeApiKey } from "../db.js";

export const hashKey = (key) =>
  crypto.createHash("sha256").update(key).digest("hex");

export function registerSettingsRoutes(router) {
  router.get(
    "/settings",
    wrap(async (req, res) => {
      let keys = [];
      let wikiDb = true;
      try {
        keys = await listApiKeys(req.user.email);
      } catch {
        wikiDb = false;
      }
      ok(res, {
        brand: togariConfig.brand,
        bigquery: isBigQueryConfigured(),
        mcp: isMcpConfigured(),
        wikiDb,
        channels: togariConfig.channels.map((c) => c.key),
        user: { email: req.user.email, name: req.user.name },
        keys,
      });
    }),
  );

  router.post(
    "/settings/keys",
    wrap(async (req, res) => {
      const label = String(req.body?.label || "").trim();
      if (!label) return fail(res, 400, "A key label is required.");
      const key = "tbk_" + crypto.randomBytes(16).toString("hex");
      const prefix = key.slice(0, 12);
      let created;
      try {
        created = await insertApiKey({
          email: req.user.email,
          label: label.slice(0, 60),
          hash: hashKey(key),
          prefix,
        });
      } catch {
        return fail(
          res,
          503,
          "API keys need the wiki database, which is not connected.",
        );
      }
      ok(res, { ...created, key });
    }),
  );

  router.delete(
    "/settings/keys/:id",
    wrap(async (req, res) => {
      let revoked = false;
      try {
        revoked = await revokeApiKey({
          email: req.user.email,
          id: req.params.id,
        });
      } catch {
        return fail(
          res,
          503,
          "API keys need the wiki database, which is not connected.",
        );
      }
      if (!revoked) return fail(res, 404, "Key not found.");
      ok(res, { revoked: true });
    }),
  );
}
