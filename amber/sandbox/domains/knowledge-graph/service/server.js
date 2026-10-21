/**
 * KG service — Fastify HTTP surface over the sandbox-owned Pinecone client.
 *
 * Ported from amber-id's Fastify style. Binds PORT (default 8081), exposes:
 *
 *   GET  /healthz   — 200 always, plus service metadata
 *   POST /upsert    — write records into tenant-<did>
 *   POST /query     — top-K read, routes tenant-<did> or share-<did> by scope
 *   POST /clear     — cleared-to-share projection into share-<did>
 *   POST /unshare   — reverse of /clear
 *   POST /forget    — delete from tenant-<did> (+ share-<did>)
 *
 * All /upsert /query /clear /unshare /forget are HMAC-signed (see
 * lib/auth.js). /healthz is public.
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import { verifyHmac } from "./lib/auth.js";
import { EMBEDDING_MODEL, EMBEDDING_DIMS } from "./lib/embed.js";
import { INDEX } from "./lib/pinecone.js";
import { upsertRoute } from "./routes/upsert.js";
import { queryRoute } from "./routes/query.js";
import { clearRoute } from "./routes/clear.js";
import { forgetRoute } from "./routes/forget.js";

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
    bodyLimit: 10 * 1024 * 1024, // 10 MB — biggest realistic batch is ~5 MB
  });

  await app.register(cors, { origin: true });

  // /healthz is public — everything else is HMAC-gated.
  app.get("/healthz", async () => ({
    ok: true,
    service: "amber-knowledge-graph",
    index: INDEX,
    embeddingModel: EMBEDDING_MODEL,
    embeddingDims: EMBEDDING_DIMS,
    authMode: process.env.KG_SERVICE_AUTH_MODE || "hmac",
  }));

  app.addHook("preHandler", (req, reply, done) => {
    if (req.url === "/healthz") return done();
    return verifyHmac(req, reply, done);
  });

  await upsertRoute(app);
  await queryRoute(app);
  await clearRoute(app);
  await forgetRoute(app);

  return app;
}

// Entrypoint — `node service/server.js`.
const isDirect = import.meta.url === `file://${process.argv[1]}`;
if (isDirect) {
  const port = Number(process.env.PORT || 8081);
  const host = process.env.HOST || "0.0.0.0";
  buildServer()
    .then((app) => app.listen({ port, host }))
    .then((addr) => {
      // eslint-disable-next-line no-console
      console.log(`[kg] listening on ${addr}`);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[kg] failed to start:", err);
      process.exit(1);
    });
}
