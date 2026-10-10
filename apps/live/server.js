// Chewbacca Live: a client asks a question about their outreach and watches
// the answer build itself from typed blocks, on a page Chewbacca hosts.
// Multi-tenant by design: a customer (BMA) brings its data sources (Togari),
// its clients come from those sources at request time, and a private link
// signs one person in to one client. Read only: nothing here sends, saves or
// changes anything at a source.
import { createServer } from "node:http";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { StatsHub, STATS_MAX_AGE_MS, REFRESH_WAIT_MS } from "./lib/freshness.js";
import { togariSource } from "./lib/sources.js";
import { answer } from "./lib/answer.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const DEV = env.LIVE_DEV === "1";

// Fail closed, same reasoning as apps/team-web: Railway does not set NODE_ENV,
// so a missing secret must stop the boot rather than sign sessions with "".
const SECRET = env.SESSION_SECRET || (DEV ? "local-dev-only-secret-not-for-prod!" : "");
if (SECRET.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 random characters (LIVE_DEV=1 for local runs)");
const KEY = createHash("sha256").update(SECRET).digest();

// A link lasts 30 days, then the person asks for a new one. Guessed: long
// enough that Jonah never meets the sign-in page in a normal month.
const SESSION_DAYS = 30;
// 30 questions in 10 minutes is a person clicking every chip twice; a script
// running up the model bill hits it in seconds. Guessed, never measured.
const ASK_LIMIT = 30;
const ASK_WINDOW_MS = 10 * 60 * 1000;
// The agent long-polls; 25 s stays under Railway's idle proxy timeout.
const POLL_MS = 25 * 1000;
const MAX_BODY = 2 * 1024 * 1024;

// ---------------------------------------------------------------- sessions

export function sign(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + SESSION_DAYS * 86400000 })).toString("base64url");
  const mac = createHmac("sha256", KEY).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verify(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const want = createHmac("sha256", KEY).update(body).digest();
  let got;
  try {
    got = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!data.exp || data.exp < Date.now() || typeof data.c !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * LIVE_ACCESS maps sha256(link token) to who it signs in, as JSON:
 * {"<hex>": {"client": "zeutara", "who": "Jonah"}}. Only hashes live in the
 * environment, so the variable itself opens nothing.
 */
export function accessFor(token, accessJson = env.LIVE_ACCESS) {
  if (typeof token !== "string" || token.length < 24 || token.length > 128) return null;
  let map;
  try {
    map = JSON.parse(accessJson || "{}");
  } catch {
    return null;
  }
  const hit = map[createHash("sha256").update(token).digest("hex")];
  return hit && typeof hit.client === "string" ? { client: hit.client, who: String(hit.who || "") } : null;
}

function bearerOk(req, secret) {
  const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!secret || !got) return false;
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- app

export function createApp({ hub = new StatsHub(), togari, modelKey = env.ANTHROPIC_API_KEY, syncKey = env.LIVE_SYNC_KEY, access = () => env.LIVE_ACCESS, log = console.error } = {}) {
  const asks = new Map();

  async function liveClient(clientId) {
    try {
      return await togari.client(clientId);
    } catch (err) {
      log("togari clients failed", err?.message);
      return null;
    }
  }

  function companiesFor(clientId) {
    const set = new Set();
    for (const w of ["7d", "all"]) for (const r of hub.get(clientId, w)?.rows || []) if (r.company) set.add(r.company);
    return [...set].sort();
  }

  function limited(key) {
    const now = Date.now();
    const list = (asks.get(key) || []).filter((t) => now - t < ASK_WINDOW_MS);
    list.push(now);
    asks.set(key, list);
    return list.length > ASK_LIMIT;
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://live.local");
    const path = url.pathname;
    const session = verify(cookies(req).live);

    if (req.method === "GET" && path === "/health") {
      return json(res, 200, { ok: true, clay_sync_online: hub.agentOnline() });
    }

    // ---- private link sign-in
    const link = path.match(/^\/in\/([A-Za-z0-9_-]{24,128})$/);
    if (req.method === "GET" && link) {
      const who = accessFor(link[1], access());
      if (!who) return page(res, 404, "signin.html");
      const secure = String(req.headers["x-forwarded-proto"] || "").includes("https");
      res.setHeader("Set-Cookie", `live=${sign({ c: who.client, w: who.who })}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`);
      res.writeHead(302, { Location: `/c/${encodeURIComponent(who.client)}` });
      return res.end();
    }

    if (req.method === "GET" && path === "/") {
      if (session) {
        res.writeHead(302, { Location: `/c/${encodeURIComponent(session.c)}` });
        return res.end();
      }
      return page(res, 200, "signin.html");
    }

    const clientPage = path.match(/^\/c\/([a-z0-9_]{1,40})$/);
    if (req.method === "GET" && clientPage) {
      if (!session || session.c !== clientPage[1]) return page(res, 401, "signin.html");
      return page(res, 200, "index.html");
    }

    if (req.method === "GET" && /^\/assets\/(app\.js|app\.css|render\.js)$/.test(path)) {
      const file = path.slice("/assets/".length);
      return send(res, 200, await readFile(join(HERE, "public", file)), file.endsWith(".js") ? "text/javascript" : "text/css", "public, max-age=300");
    }

    // ---- the asking API: the client always comes from the session
    if (path === "/api/me" && req.method === "GET") {
      if (!session) return json(res, 401, { error: "Sign in with your link" });
      const c = await liveClient(session.c);
      if (!c) return json(res, 503, { error: "Togari is not answering right now" });
      return json(res, 200, { client: c.clientId, name: c.displayName, who: session.w, companies: companiesFor(c.clientId), clay_sync_online: hub.agentOnline() });
    }

    if (path === "/api/ask" && req.method === "GET") {
      if (!session) return json(res, 401, { error: "Sign in with your link" });
      const q = String(url.searchParams.get("q") || "").trim().slice(0, 500);
      if (!q) return json(res, 400, { error: "Ask a question" });
      if (limited(session.c + session.w)) return json(res, 429, { error: "That is a lot of questions at once. Give it a minute." });
      const client = await liveClient(session.c);
      if (!client) return json(res, 503, { error: "Togari is not answering right now" });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      let open = true;
      req.on("close", () => (open = false));
      const emit = (event, data) => {
        if (open) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const ping = setInterval(() => open && res.write(": ping\n\n"), 15000);
      try {
        await answer(q, {
          emit,
          hub,
          togari,
          client,
          clientId: client.clientId,
          companies: companiesFor(client.clientId),
          maxAgeMs: STATS_MAX_AGE_MS,
          waitMs: REFRESH_WAIT_MS,
          model: { apiKey: modelKey },
          log,
        });
        emit("done", {});
      } catch (err) {
        log("ask failed", err?.message);
        emit("error", { text: "Something went wrong building that answer. Try asking it another way." });
      } finally {
        clearInterval(ping);
        res.end();
      }
      return;
    }

    // ---- the Clay sync agent
    if (path === "/sync/wanted" && req.method === "GET") {
      if (!bearerOk(req, syncKey)) return json(res, 401, { error: "unauthorized" });
      const w = url.searchParams.has("wait") ? Number(url.searchParams.get("wait")) : NaN;
      const ids = await hub.wanted(Number.isFinite(w) && w >= 0 ? Math.min(w * 1000, POLL_MS) : POLL_MS);
      const all = await togari.clients().catch(() => []);
      return json(res, 200, {
        wanted: all.filter((c) => ids.includes(c.clientId)).map(syncView),
        clients: all.map(syncView),
      });
    }
    if (path === "/sync/stats" && req.method === "POST") {
      if (!bearerOk(req, syncKey)) return json(res, 401, { error: "unauthorized" });
      const body = await readJson(req).catch(() => null);
      if (!body) return json(res, 400, { error: "bad json" });
      const c = await liveClient(String(body.clientId || ""));
      if (!c) return json(res, 404, { error: "no live client by that id" });
      const bad = checkRows(body, c);
      if (bad) return json(res, 422, { error: bad });
      try {
        const snap = hub.put(c.clientId, body.window, { as_of: body.as_of, rows: body.rows.map(cleanRow), workspace: String(body.workspace) });
        return json(res, 200, { ok: true, as_of: snap.as_of, rows: snap.rows.length });
      } catch (err) {
        return json(res, 422, { error: err.message });
      }
    }
    if (path === "/sync/fail" && req.method === "POST") {
      if (!bearerOk(req, syncKey)) return json(res, 401, { error: "unauthorized" });
      const body = await readJson(req).catch(() => null);
      if (!body || typeof body.clientId !== "string") return json(res, 400, { error: "bad json" });
      hub.fail(body.clientId, String(body.message || "refresh failed"));
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: "not found" });
  }

  return {
    hub,
    handle,
    async warm() {
      // A fresh boot has no numbers: ask the agent for every client at once.
      const all = await togari.clients().catch(() => []);
      for (const c of all) hub.request(c.clientId);
    },
  };
}

function syncView(c) {
  return { clientId: c.clientId, clayWorkspaceId: c.clayWorkspaceId, campaignPrefix: c.campaignPrefix };
}

/**
 * A sync post is accepted only for the workspace Togari names for that client,
 * and only rows whose campaign carries that client's prefix: a sync signed in
 * to the wrong workspace, or a campaign of another client, never reaches a page.
 */
export function checkRows(body, client) {
  if (!["7d", "all"].includes(body.window)) return "window must be 7d or all";
  if (String(body.workspace) !== String(client.clayWorkspaceId)) return "workspace does not match this client";
  if (!Array.isArray(body.rows) || body.rows.length > 500) return "rows must be an array of at most 500";
  const prefix = String(client.campaignPrefix || "");
  if (!prefix) return "client has no campaign prefix";
  for (const r of body.rows) {
    if (!r || typeof r.campaign !== "string" || !r.campaign.startsWith(prefix)) return "a row belongs to another client";
    for (const k of ["sent", "replies", "human_replies", "bounces"]) {
      if (!Number.isInteger(r[k]) || r[k] < 0) return `${k} must be a whole number`;
    }
    if (r.leads != null && (!Number.isInteger(r.leads) || r.leads < 0)) return "leads must be a whole number or null";
  }
  return null;
}

function cleanRow(r) {
  const parts = r.campaign.split("|").map((s) => s.trim());
  return {
    campaign_id: String(r.campaign_id || "").slice(0, 60),
    campaign: r.campaign.slice(0, 200),
    company: String(r.company || parts[1] || "").slice(0, 80),
    sequence: String(r.sequence || parts.slice(2).join(", ") || "").slice(0, 120),
    status: String(r.status || "").slice(0, 20),
    leads: r.leads == null ? null : r.leads,
    sent: r.sent,
    replies: r.replies,
    human_replies: r.human_replies,
    bounces: r.bounces,
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

function headers(res) {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function json(res, code, body) {
  headers(res);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function send(res, code, body, type, cache = "no-store") {
  headers(res);
  res.writeHead(code, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": cache });
  res.end(body);
}

async function page(res, code, file) {
  return send(res, code, await readFile(join(HERE, "public", file)), "text/html");
}

export function newLinkToken() {
  return randomBytes(24).toString("base64url");
}

// ---------------------------------------------------------------- boot

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const togari = togariSource({ baseUrl: env.TOGARI_BASE_URL, apiKey: env.TOGARI_API_KEY });
  if (!env.LIVE_SYNC_KEY && !DEV) throw new Error("LIVE_SYNC_KEY must be set");
  const app = createApp({ togari });
  const port = Number(env.PORT) || 3000;
  createServer((req, res) => {
    app.handle(req, res).catch((err) => {
      console.error("request failed", err?.message);
      if (!res.headersSent) json(res, 500, { error: "Something went wrong" });
      else res.end();
    });
  }).listen(port, () => {
    console.log(`live listening on ${port}`);
    app.warm().catch((err) => console.error("warm failed", err?.message));
  });
}
