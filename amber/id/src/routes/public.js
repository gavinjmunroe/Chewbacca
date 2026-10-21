/**
 * Public (unauthenticated) read routes.
 *
 * GET /public/caleb-context
 *   Returns the canonical public Caleb context as markdown.
 *   Source: knowledge/caleb-public.md in this repo.
 *   Consumer: calebnewton.me CalebGPT (and any future public read surface).
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const CALEB_CONTEXT_PATH = resolve(here, "../../knowledge/caleb-public.md");

let cachedContext = null;
let cachedMtimeMs = 0;

async function loadCalebContext() {
  const { stat } = await import("node:fs/promises");
  const info = await stat(CALEB_CONTEXT_PATH);
  if (cachedContext && info.mtimeMs === cachedMtimeMs) {
    return cachedContext;
  }
  const body = await readFile(CALEB_CONTEXT_PATH, "utf8");
  cachedContext = body;
  cachedMtimeMs = info.mtimeMs;
  return body;
}

export function registerPublicRoutes(app) {
  app.get("/public/caleb-context", async (_request, reply) => {
    try {
      const body = await loadCalebContext();
      reply
        .header("content-type", "text/markdown; charset=utf-8")
        .header("cache-control", "public, max-age=60, s-maxage=60")
        .send(body);
    } catch (err) {
      app.log.error({ err }, "failed to load caleb-public.md");
      reply.code(500).send({ error: "context_unavailable" });
    }
  });
}
