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
  const key = createHash("sha256").update(token).digest("hex");
  const hit = map[key];
  return hit && typeof hit.client === "string" ? { client: hit.client, who: String(hit.who || ""), key } : null;
}

/**
 * A session is only as good as the link that made it. Removing a line from
 * LIVE_ACCESS has to end the sessions it signed in, not just stop new
 * sign-ins: before this check a cut link kept working for up to 30 days in
 * any browser that had already opened it.
 */
export function stillGranted(session, accessJson = env.LIVE_ACCESS) {
  if (!session || typeof session.k !== "string") return null;
  let map;
  try {
    map = JSON.parse(accessJson || "{}");
  } catch {
    return null;
  }
  const hit = map[session.k];
  return hit && hit.client === session.c ? session : null;
}

function bearerOk(req, secret) {
  const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!secret || !got) return false;
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- app

export function createApp({ hub = new StatsHub(), togari, modelKey = env.ANTHROPIC_API_KEY, modelFetch = fetch, syncKey = env.LIVE_SYNC_KEY, access = () => env.LIVE_ACCESS, log = console.error } = {}) {
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
    // One entry per signed-in person; drop the idle ones so the map cannot grow
    // without end on a long-running instance.
    if (asks.size > 1000) for (const [k, v] of asks) if (!v.some((t) => now - t < ASK_WINDOW_MS)) asks.delete(k);
    return list.length > ASK_LIMIT;
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://live.local");
    const path = url.pathname;
    const session = stillGranted(verify(cookies(req).live), access());

    if (req.method === "GET" && path === "/health") {
      return json(res, 200, { ok: true, clay_sync_online: hub.agentOnline() });
    }

    // ---- private link sign-in
    const link = path.match(/^\/in\/([A-Za-z0-9_-]{24,128})$/);
    if (req.method === "GET" && link) {
      const who = accessFor(link[1], access());
      if (!who) return page(res, 404, "signin.html");
      const secure = String(req.headers["x-forwarded-proto"] || "").includes("https");
      res.setHeader("Set-Cookie", `live=${sign({ c: who.client, w: who.who, k: who.key })}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`);
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
      // The page reads this as an event stream, which shows nothing for a
      // plain 401 or 429, so every refusal arrives as an error event the page
      // can show (independent review, 2026-10-10: a blank answer).
      if (!session) return sseError(res, 401, "Your link has expired or was replaced. Open the newest link you were sent.");
      const q = String(url.searchParams.get("q") || "").trim().slice(0, 500);
      if (!q) return sseError(res, 400, "Ask a question first.");
      if (limited(session.c + session.w)) return sseError(res, 429, "That is a lot of questions at once. Give it a minute.");
      const client = await liveClient(session.c);
      if (!client) return sseError(res, 503, "Togari is not answering right now. Try again in a minute.");
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      let open = true;
      // The browser leaving ends the work too: no more model rounds billed for
      // an answer nobody will read.
      const left = new AbortController();
      res.on("close", () => {
        open = false;
        left.abort();
      });
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
          model: { apiKey: modelKey, fetchImpl: modelFetch },
          signal: left.signal,
          log,
        });
        emit("done", {});
      } catch (err) {
        if (!left.signal.aborted) log("ask failed", err?.message);
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
      // A refused push also ends the refresh request: left open, the client
      // stays "wanted" and the agent re-reads Clay on every poll, forever
      // (independent review, 2026-10-10).
      const bad = checkRows(body, c);
      if (bad) {
        hub.fail(c.clientId, `the numbers were refused: ${bad}`);
        return json(res, 422, { error: bad });
      }
      try {
        const snap = hub.put(c.clientId, body.window, {
          as_of: body.as_of,
          rows: body.rows.map(cleanRow),
          threads: Array.isArray(body.threads) ? body.threads.map(cleanThread) : null,
          workspace: String(body.workspace),
        });
        return json(res, 200, { ok: true, as_of: snap.as_of, rows: snap.rows.length });
      } catch (err) {
        hub.fail(c.clientId, `the numbers were refused: ${err.message}`);
        return json(res, 422, { error: err.message });
      }
    }
    if (path === "/sync/fail" && req.method === "POST") {
      if (!bearerOk(req, syncKey)) return json(res, 401, { error: "unauthorized" });
      const body = await readJson(req).catch(() => null);
      if (!body || typeof body.clientId !== "string") return json(res, 400, { error: "bad json" });
      const c = await liveClient(body.clientId);
      if (!c) return json(res, 404, { error: "no live client by that id" });
      hub.fail(c.clientId, String(body.message || "refresh failed"));
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
  if (body.threads !== undefined) {
    if (body.window !== "7d") return "threads come only with the 7d window";
    if (!Array.isArray(body.threads) || body.threads.length > 5000) return "threads must be an array of at most 5000";
    for (const t of body.threads) {
      if (!t || typeof t.campaign !== "string" || !t.campaign.startsWith(prefix)) return "a thread belongs to another client";
      if (typeof t.who !== "string" || !/^[0-9a-f]{64}$/.test(t.who)) return "who must be a sha256 hex digest";
      if (t.category != null && (typeof t.category !== "string" || t.category.length > 60)) return "category must be a short string or null";
      if (Number.isNaN(Date.parse(t.at))) return "at must be a timestamp";
    }
  }
  return null;
}

function cleanThread(t) {
  return { campaign: t.campaign.slice(0, 200), who: t.who, category: t.category == null ? null : t.category, at: t.at };
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

// EventSource drops a non-200 stream without reading its body, so a refusal
// is a 200 stream holding one error event; the reason travels as `code`.
function sseError(res, code, text) {
  headers(res);
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
  res.end(`event: error\ndata: ${JSON.stringify({ code, text })}\n\n`);
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
