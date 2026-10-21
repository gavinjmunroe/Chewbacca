import { randomBytes } from "node:crypto";
import { requireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPrivyDid } from "../db/store.js";
import { query, withTransaction } from "../db/sql.js";
import {
  normalizeCard,
  publicCard,
  cardHtml,
  cardVcf,
} from "../lib/amber-card.js";
const base = (
  process.env.AMBER_CARD_BASE_URL ||
  "https://amber-id-production.up.railway.app"
).replace(/\/$/, "");
async function read(owner) {
  const { rows } = await query(
    "SELECT profile_extra->'amberCard' AS card FROM users WHERE amber_id=$1 AND deleted_at IS NULL",
    [owner],
  );
  return rows[0]?.card || null;
}
async function save(owner, input, expected) {
  return withTransaction(async (db) => {
    const { rows } = await db.query(
      "SELECT profile_extra->'amberCard' AS card FROM users WHERE amber_id=$1 AND deleted_at IS NULL FOR UPDATE",
      [owner],
    );
    if (!rows.length) throw Error("account_missing");
    const prior = rows[0].card;
    if ((prior?.updatedAt || null) !== (expected || null))
      throw Error("card_changed");
    const card = {
      ...input,
      token: prior?.token || randomBytes(24).toString("base64url"),
      updatedAt: new Date().toISOString(),
    };
    await db.query(
      "UPDATE users SET profile_extra=jsonb_set(COALESCE(profile_extra,'{}'::jsonb),'{amberCard}',$2::jsonb),updated_at=now() WHERE amber_id=$1 AND deleted_at IS NULL",
      [owner, JSON.stringify(card)],
    );
    return card;
  });
}
async function find(token) {
  const { rows } = await query(
    "SELECT profile_extra->'amberCard' AS card FROM users WHERE profile_extra->'amberCard'->>'token'=$1 AND deleted_at IS NULL",
    [token],
  );
  return publicCard(rows[0]?.card);
}
const envelope = (card) => ({
  card,
  shareUrl: card?.published ? `${base}/card/${card.token}` : null,
});
export function registerAmberCardRoutes(app, deps = {}) {
  const auth = deps.auth || requireAuth,
    resolve = deps.resolve || resolveAmberIdByPrivyDid;
  const options = {
    preHandler: [auth],
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  };
  async function owner(req, reply) {
    const did = req.privyUser?.userId;
    const id = did ? await resolve(did) : null;
    if (!id) reply.code(401).send({ error: "auth_required" });
    return id;
  }
  app.get("/v1/me/amber-card", options, async (req, reply) => {
    const id = await owner(req, reply);
    if (!id) return;
    return envelope(await (deps.read || read)(id));
  });
  app.put(
    "/v1/me/amber-card",
    { ...options, bodyLimit: 40000 },
    async (req, reply) => {
      const id = await owner(req, reply);
      if (!id) return;
      let card;
      try {
        card = normalizeCard(req.body);
      } catch {
        return reply
          .code(400)
          .send({
            error: "invalid_card",
            message:
              "Check your name and links. Use https links, email addresses or phone numbers.",
          });
      }
      try {
        return envelope(
          await (deps.save || save)(id, card, req.body?.expectedUpdatedAt),
        );
      } catch (e) {
        return reply
          .code(e.message === "card_changed" ? 409 : 503)
          .send({
            error:
              e.message === "card_changed" ? "card_changed" : "save_failed",
            message:
              e.message === "card_changed"
                ? "Your card changed on another device. Reopen it before saving."
                : "Could not save your card. Please retry.",
          });
      }
    },
  );
  async function serve(req, reply, format) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(req.params.token))
      return reply.code(404).send({ error: "not_found" });
    const card = await (deps.find || find)(req.params.token);
    if (!card) return reply.code(404).send({ error: "not_found" });
    reply
      .header("Cache-Control", "no-store")
      .header("X-Robots-Tag", "noindex, nofollow")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Content-Type-Options", "nosniff");
    if (format === "json") return card;
    if (format === "vcf")
      return reply
        .type("text/vcard; charset=utf-8")
        .header("Content-Disposition", 'attachment; filename="contact.vcf"')
        .send(cardVcf(card));
    return reply
      .header(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      )
      .type("text/html; charset=utf-8")
      .send(cardHtml(card, req.params.token));
  }
  const publicOptions = {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  };
  app.get("/card/:token", publicOptions, (req, reply) =>
    serve(req, reply, "html"),
  );
  app.get("/card/:token/contact.vcf", publicOptions, (req, reply) =>
    serve(req, reply, "vcf"),
  );
  app.get("/v1/public/amber-card/:token", publicOptions, (req, reply) =>
    serve(req, reply, "json"),
  );
  app.get("/card/:token/data", publicOptions, (req, reply) =>
    serve(req, reply, "json"),
  );
}
