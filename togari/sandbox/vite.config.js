import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { OAuth2Client } from "google-auth-library";
import { matchFixture } from "./dev/togariFixtures.js";

const LOCAL_WIKI_FILE = resolve(".netlify/wiki-pages.json");

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function readLocalPages() {
  try {
    return JSON.parse(await readFile(LOCAL_WIKI_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeLocalPages(pages) {
  await mkdir(dirname(LOCAL_WIKI_FILE), { recursive: true });
  await writeFile(LOCAL_WIKI_FILE, JSON.stringify(pages, null, 2));
}

// Dev-server-only auth bypass (TOGARI_DEV_BYPASS_AUTH=1). `apply: "serve"`
// keeps it out of builds entirely; the flag keeps it off by default in dev.
const DEV_BYPASS_USER = {
  email: "dev@bluemodernadvisory.com",
  name: "Dev Preview",
  initials: "DP",
};

function devAuthBypassPlugin(env) {
  const enabled =
    (env.TOGARI_DEV_BYPASS_AUTH || process.env.TOGARI_DEV_BYPASS_AUTH) === "1";
  return {
    name: "togari-dev-auth-bypass",
    apply: "serve",
    transformIndexHtml(html) {
      if (!enabled) return html;
      const seed = `<script>
        if (!localStorage.getItem("bma_google_session")) {
          localStorage.setItem("bma_google_session", ${JSON.stringify(JSON.stringify(DEV_BYPASS_USER))});
          localStorage.setItem("bma_google_cred", "dev-bypass");
        }
      </script>`;
      return html.replace("<head>", `<head>${seed}`);
    },
  };
}

function localFunctionsPlugin(env) {
  const clientId = env.GOOGLE_CLIENT_ID || env.VITE_GOOGLE_CLIENT_ID;
  const allowedDomain = env.ALLOWED_DOMAIN || "bluemodernadvisory.com";
  const googleClient = new OAuth2Client(clientId);
  const bypassAuth =
    (env.TOGARI_DEV_BYPASS_AUTH || process.env.TOGARI_DEV_BYPASS_AUTH) === "1";

  async function verifyToken(token) {
    if (bypassAuth) return DEV_BYPASS_USER;
    if (!token || !clientId) return null;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: token,
        audience: clientId,
      });
      const payload = ticket.getPayload();
      const email = (payload.email || "").toLowerCase();
      if (
        !payload.email_verified ||
        (payload.hd !== allowedDomain && !email.endsWith(`@${allowedDomain}`))
      ) {
        return null;
      }
      return { email, name: payload.name || email, picture: payload.picture };
    } catch {
      return null;
    }
  }

  return {
    name: "bma-local-functions",
    configureServer(server) {
      // Dev-only Togari demo fixtures. Registered ahead of the auth/wiki
      // mocks so `vite dev` serves every /api/togari endpoint without a
      // live BigQuery or MCP backend. Never runs in the production build.
      server.middlewares.use("/api/togari", async (req, res) => {
        try {
          const fullPath = "/api/togari" + (req.url || "/");
          const method = (req.method || "GET").toUpperCase();
          const body =
            method === "POST" || method === "PATCH"
              ? await readJsonBody(req)
              : {};
          const match = matchFixture(method, fullPath, body);
          if (!match)
            return sendJson(res, 404, { success: false, error: "not_found" });
          return sendJson(res, match.status, match.body);
        } catch (error) {
          return sendJson(res, 500, {
            success: false,
            error: error.message || "internal_error",
          });
        }
      });

      server.middlewares.use("/api/auth", async (req, res) => {
        if (req.method !== "POST")
          return sendJson(res, 405, { error: "Method not allowed" });
        try {
          const { token } = await readJsonBody(req);
          const user = await verifyToken(token);
          if (!user)
            return sendJson(res, 401, {
              error: `Choose a verified @${allowedDomain} Google account.`,
            });
          return sendJson(res, 200, { ok: true, user });
        } catch (error) {
          return sendJson(res, 500, {
            error: error.message || "Authentication failed",
          });
        }
      });

      server.middlewares.use("/api/wiki-pages", async (req, res) => {
        const token = String(req.headers.authorization || "").replace(
          /^Bearer\s+/i,
          "",
        );
        const user = await verifyToken(token);
        if (!user)
          return sendJson(res, 401, {
            error: "Your session expired. Sign in again.",
          });

        try {
          const pages = await readLocalPages();
          const url = new URL(req.url || "/", "http://localhost");

          if (req.method === "GET") {
            return sendJson(res, 200, {
              pages: Object.entries(pages)
                .map(([slug, page]) => ({ slug, ...page }))
                .sort((a, b) => a.title.localeCompare(b.title)),
            });
          }

          if (req.method === "POST") {
            const {
              slug,
              title,
              body = "",
              attachments = [],
            } = await readJsonBody(req);
            if (!title?.trim())
              return sendJson(res, 400, { error: "Page title is required." });
            const cleanSlug = (slug || title)
              .toLowerCase()
              .replace(/[^a-z0-9\s-]/g, "")
              .trim()
              .replace(/\s+/g, "-")
              .replace(/-+/g, "-")
              .slice(0, 80);
            if (!cleanSlug)
              return sendJson(res, 400, { error: "Invalid page title." });

            const existing = pages[cleanSlug];
            const page = {
              title: title.trim(),
              body,
              attachments: Array.isArray(attachments)
                ? attachments.slice(0, 12)
                : [],
              createdBy: existing?.createdBy || user.email,
              createdAt: existing?.createdAt || new Date().toISOString(),
              updatedBy: user.email,
              updatedAt: new Date().toISOString(),
            };
            pages[cleanSlug] = page;
            await writeLocalPages(pages);
            return sendJson(res, 200, { slug: cleanSlug, page });
          }

          if (req.method === "DELETE") {
            const slug = url.searchParams.get("slug");
            if (!slug)
              return sendJson(res, 400, { error: "Page slug is required." });
            delete pages[slug];
            await writeLocalPages(pages);
            return sendJson(res, 200, { ok: true });
          }

          return sendJson(res, 405, { error: "Method not allowed" });
        } catch (error) {
          return sendJson(res, 500, {
            error: error.message || "Wiki operation failed",
          });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), devAuthBypassPlugin(env), localFunctionsPlugin(env)],
  };
});
