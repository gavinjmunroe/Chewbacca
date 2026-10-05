// Chewbacca team board. The repo is the database: every task is
// team/tasks/<ID>.md on one branch, and tools/team.py writes the same files
// from the terminal. This server never stores a task; it reads and writes
// GitHub with the signed-in person's own token, so GitHub's permissions are
// the access control and every edit is a commit under that person's name.
import { createServer } from "node:http";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  FIELDS,
  ID_PATTERN,
  PRIORITIES,
  STATUSES,
  clean,
  idNumber,
  oneLine,
  parse,
  parseCommitRefs,
  applyCommit,
  render,
} from "./lib/task.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const REPO = env.TEAM_REPO || "calebnewtonusc/Chewbacca";
const BRANCH = env.TEAM_BRANCH || "main";
const TASK_DIR = "team/tasks";
const PUBLIC_URL = (env.PUBLIC_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const TZ = env.TEAM_TZ || "America/Los_Angeles";
// Fail closed. The first version fell back to sha256("") whenever NODE_ENV was
// not "production", and Railway does not set NODE_ENV, so a deploy missing the
// variable would have signed every session with a key anyone can compute.
// 32 characters is the floor for a random secret; TEAM_DEV=1 is for local runs only.
const SECRET = env.SESSION_SECRET || (env.TEAM_DEV === "1" ? "local-dev-only" : "");
if (SECRET.length < 32 && env.TEAM_DEV !== "1") {
  throw new Error("SESSION_SECRET must be set to at least 32 random characters (TEAM_DEV=1 for local runs)");
}
const KEY = createHash("sha256").update(SECRET).digest();
const SECURE = PUBLIC_URL.startsWith("https://");
// Same reasoning as PUSH_TRIES in tools/team.py: two writers in one second is
// the realistic worst case for a five-person team.
const WRITE_TRIES = 3;
// A task file is a few KB; 64 KB leaves room for long notes and refuses junk.
const MAX_BODY = 64 * 1024;
const LIMITS = {
  title: 200,
  owner: 80,
  done_when: 600,
  proof: 500,
  notes: 8000,
  comment: 2000,
  label: 40,
};


// ---------- sessions: the GitHub token lives only in an encrypted cookie ----------

// A cookie's Max-Age only asks the browser to forget it. The expiry inside the
// sealed payload is what makes a copied cookie stop working (security review
// of 62e59f1: without it, a stolen value decrypted forever). Two weeks means a
// teammate signs in about twice a month.
const SESSION_DAYS = 14;

function seal(data) {
  data = { ...data, exp: Date.now() + SESSION_DAYS * 86400000 };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(data), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

function unseal(value) {
  try {
    const raw = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", KEY, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const data = JSON.parse(
      Buffer.concat([
        decipher.update(raw.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
    return typeof data?.exp === "number" && data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "").split(";").map((c) => {
      const at = c.indexOf("=");
      return at < 0
        ? [c.trim(), ""]
        : [c.slice(0, at).trim(), decodeURIComponent(c.slice(at + 1).trim())];
    }),
  );
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE ? "; Secure" : ""}`;
}

// ---------- GitHub ----------

async function gh(token, path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "chewbacca-team",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s) => Buffer.from(s, "base64").toString("utf8");
// Keyed by blob sha, so an entry never goes stale, only unused. A five-person
// board edits a few dozen times a day; 2,000 entries is weeks of history.
const BLOB_CACHE_MAX = 2000;
const blobCache = new Map();

async function readMembers(token) {
  const members = await readJsonFile(token, "team/members.json", []);
  // A members.json that parses but is not a list would make every request 500.
  return Array.isArray(members) ? members.filter((m) => m && typeof m.name === "string") : [];
}

async function readJsonFile(token, path, fallback) {
  const r = await gh(token, `/repos/${REPO}/contents/${path}?ref=${BRANCH}`);
  if (r.status !== 200) return fallback;
  try {
    return JSON.parse(unb64(r.json.content));
  } catch {
    return fallback;
  }
}

async function listTasks(token) {
  const r = await gh(
    token,
    `/repos/${REPO}/contents/${TASK_DIR}?ref=${BRANCH}`,
  );
  if (r.status === 404) return { tasks: [], version: "empty" };
  if (r.status !== 200)
    throw httpError(502, "GitHub did not return the task list");
  const files = r.json.filter(
    (f) => f.type === "file" && f.name.endsWith(".md"),
  );
  const tasks = await Promise.all(
    files.map(async (f) => {
      if (!blobCache.has(f.sha)) {
        const blob = await gh(token, `/repos/${REPO}/git/blobs/${f.sha}`);
        if (blob.status !== 200) return null;
        try {
          if (blobCache.size >= BLOB_CACHE_MAX) blobCache.clear();
          blobCache.set(f.sha, parse(unb64(blob.json.content)));
        } catch {
          return null;
        }
      }
      const task = blobCache.get(f.sha);
      // The file name is the identity; see Repo.tasks in tools/team.py.
      return task.id === f.name.slice(0, -3) ? task : null;
    }),
  );
  const version = createHash("sha1")
    .update(files.map((f) => f.sha).join(","))
    .digest("hex");
  return {
    tasks: tasks
      .filter(Boolean)
      .sort((a, b) => idNumber(a.id) - idNumber(b.id)),
    version,
  };
}

// ---------- validation ----------

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

function text(value, field, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw httpError(400, `${field} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw httpError(400, `${field} must be text`);
  const v = field === "notes" ? clean(value).trim() : oneLine(value);
  if (required && !v) throw httpError(400, `${field} is required`);
  if (v.length > LIMITS[field]) throw httpError(400, `${field} is too long`);
  return v;
}

function cleanChanges(body, members) {
  const out = {};
  for (const f of ["title", "done_when", "notes"]) {
    const v = text(body[f], f);
    if (v !== undefined) out[f] = v;
  }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw httpError(400, "unknown status");
    out.status = body.status;
  }
  if (body.priority !== undefined) {
    if (!PRIORITIES.includes(body.priority))
      throw httpError(400, "unknown priority");
    out.priority = body.priority;
  }
  if (body.due !== undefined) {
    if (body.due !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(body.due))
      throw httpError(400, "due is YYYY-MM-DD");
    out.due = body.due;
  }
  if (body.owner !== undefined) {
    const owner = text(body.owner, "owner");
    if (owner && members.length && !members.some((m) => m.name === owner))
      throw httpError(400, "owner is not on the team");
    out.owner = owner;
  }
  if (body.proof !== undefined) {
    const proof = text(body.proof, "proof");
    // Rendered as a link on the board, so only web URLs; a javascript: URL here would run on click.
    if (proof && !/^https?:\/\/\S+$/i.test(proof))
      throw httpError(400, "proof must be an http(s) link");
    out.proof = proof;
  }
  if (body.labels !== undefined) {
    if (!Array.isArray(body.labels) || body.labels.length > 10)
      throw httpError(400, "labels must be a list of up to 10");
    out.labels = body.labels.map((l) => text(l, "label")).filter(Boolean);
  }
  return out;
}

function verbFor(changes) {
  if (changes.status) return `moved to ${changes.status.replace("_", " ")}`;
  if ("owner" in changes)
    return changes.owner ? `assigned to ${changes.owner}` : "unassigned";
  return (
    "edited " +
    Object.keys(changes)
      .map((k) => k.replace("_", " "))
      .join(", ")
  );
}

// ---------- writes ----------

async function createTask(session, body, members) {
  const changes = cleanChanges(body, members);
  if (!changes.title) throw httpError(400, "title is required");
  for (let attempt = 0; attempt < WRITE_TRIES; attempt++) {
    const { tasks } = await listTasks(session.token);
    const id = `CHW-${Math.max(0, ...tasks.map((t) => idNumber(t.id))) + 1}`;
    const task = {
      id,
      title: changes.title,
      status: changes.status || "todo",
      owner: changes.owner || "",
      priority: changes.priority || "none",
      due: changes.due || "",
      labels: changes.labels || [],
      done_when: changes.done_when || "",
      proof: changes.proof || "",
      created: today(),
      updated: today(),
      notes: changes.notes || "",
      activity: [`${today()} ${session.member}: created`],
    };
    const r = await gh(
      session.token,
      `/repos/${REPO}/contents/${TASK_DIR}/${id}.md`,
      {
        method: "PUT",
        body: JSON.stringify({
          message: `team: ${id} created: ${task.title}`,
          content: b64(render(task)),
          branch: BRANCH,
        }),
      },
    );
    if (r.status === 201) return task;
    // 422 means the file appeared since the listing: somebody took this id.
    if (r.status !== 422 && r.status !== 409)
      throw httpError(502, "GitHub refused the write");
  }
  throw httpError(409, "could not claim a free task id, try again");
}

async function updateTask(session, id, body, members) {
  if (!ID_PATTERN.test(id)) throw httpError(400, "bad task id");
  const changes = cleanChanges(body, members);
  const comment = text(body.comment, "comment");
  if (!Object.keys(changes).length && !comment)
    throw httpError(400, "nothing to change");
  if (changes.status === "done" && !changes.proof) {
    const current = (await listTasks(session.token)).tasks.find(
      (t) => t.id === id,
    );
    if (!current?.proof)
      throw httpError(400, "done needs proof: a link, video or commit");
  }
  const verb = comment || verbFor(changes);
  const path = `/repos/${REPO}/contents/${TASK_DIR}/${id}.md`;
  for (let attempt = 0; attempt < WRITE_TRIES; attempt++) {
    // Read fresh on every attempt and reapply, so a concurrent edit is kept, not overwritten.
    const cur = await gh(session.token, `${path}?ref=${BRANCH}`);
    if (cur.status === 404) throw httpError(404, `no task ${id}`);
    if (cur.status !== 200)
      throw httpError(502, "GitHub did not return the task");
    const task = parse(unb64(cur.json.content));
    Object.assign(task, changes, { updated: today() });
    task.activity.push(`${today()} ${session.member}: ${verb}`);
    const r = await gh(session.token, path, {
      method: "PUT",
      body: JSON.stringify({
        message: `team: ${id} ${comment ? "comment" : verb}`,
        content: b64(render(task)),
        sha: cur.json.sha,
        branch: BRANCH,
      }),
    });
    if (r.status === 200) return task;
    if (r.status !== 409 && r.status !== 422)
      throw httpError(502, "GitHub refused the write");
  }
  throw httpError(409, "someone else is editing this task, try again");
}

// ---------- commits -> tasks ----------

// Same job as link_commits in tools/team.py, run from the web side so an open
// board keeps tasks in step with pushes even when nobody runs the CLI. GitHub
// Actions would be the natural home, but jobs refuse to start on this account's
// billing (2026-10-04). 30s between syncs: a push shows up on its task within a
// poll or three, for one extra commits-API call per half minute.
const LINK_EVERY_MS = 30000;
let lastLink = 0;

async function linkCommits(session) {
  const r = await gh(session.token, `/repos/${REPO}/commits?sha=${BRANCH}&per_page=100`);
  if (r.status !== 200 || !Array.isArray(r.json)) return 0;
  const byTask = new Map();
  for (const c of [...r.json].reverse()) {
    const [subject, ...rest] = (c.commit?.message || "").split("\n");
    const { refs, closing } = parseCommitRefs(subject, rest.join("\n"));
    for (const id of refs) {
      if (!byTask.has(id)) byTask.set(id, []);
      byTask.get(id).push({ c, subject, closing: closing.has(id) });
    }
  }
  if (!byTask.size) return 0;
  const members = await readMembers(session.token);
  let touched = 0;
  for (const [id, commits] of byTask) {
    const path = `/repos/${REPO}/contents/${TASK_DIR}/${id}.md`;
    for (let attempt = 0; attempt < WRITE_TRIES; attempt++) {
      const cur = await gh(session.token, `${path}?ref=${BRANCH}`);
      if (cur.status !== 200) break;
      const task = parse(unb64(cur.json.content));
      if (task.id !== id) break;
      let changed = false;
      for (const { c, subject, closing } of commits) {
        const login = c.author?.login || "";
        const who = members.find((m) => login && (m.github || "").toLowerCase() === login.toLowerCase())?.name || c.commit.author?.name || login || "someone";
        changed = applyCommit(task, c.sha, who, subject, c.html_url, closing, (c.commit.author?.date || "").slice(0, 10) || today()) || changed;
      }
      if (!changed) break;
      const put = await gh(session.token, path, {
        method: "PUT",
        body: JSON.stringify({ message: `team: ${id} link commits`, content: b64(render(task)), sha: cur.json.sha, branch: BRANCH }),
      });
      if (put.status === 200) { touched++; break; }
      if (put.status !== 409 && put.status !== 422) break;
    }
  }
  return touched;
}

// ---------- http ----------

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, {
    "Content-Type": isJson
      ? "application/json"
      : headers["Content-Type"] || "text/plain",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw httpError(413, "request too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw httpError(400, "body must be JSON");
  }
}

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript"],
  "/app.css": ["app.css", "text/css"],
};
const CSP =
  "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https://avatars.githubusercontent.com data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://github.com";

async function handle(req, res) {
  const url = new URL(req.url, PUBLIC_URL);
  const jar = cookies(req);
  const session = jar.team_session ? unseal(jar.team_session) : null;

  if (req.method === "GET" && STATIC[url.pathname]) {
    const [file, type] = STATIC[url.pathname];
    return send(res, 200, await readFile(join(HERE, "public", file)), {
      "Content-Type": type,
      "Content-Security-Policy": CSP,
      "Cache-Control": "no-cache",
    });
  }
  if (url.pathname === "/healthz") return send(res, 200, { ok: true });

  if (url.pathname === "/auth/login") {
    const state = randomBytes(16).toString("hex");
    const to = new URL("https://github.com/login/oauth/authorize");
    to.searchParams.set("client_id", env.GITHUB_CLIENT_ID || "");
    to.searchParams.set("redirect_uri", `${PUBLIC_URL}/auth/callback`);
    // repo scope is the only OAuth scope that can read a private repository's contents.
    to.searchParams.set("scope", "repo");
    to.searchParams.set("state", state);
    return send(res, 302, "", {
      Location: to.toString(),
      "Set-Cookie": cookie("team_state", state, 600),
    });
  }

  if (url.pathname === "/auth/callback") {
    const state = url.searchParams.get("state") || "";
    const expected = jar.team_state || "";
    if (
      !state ||
      state.length !== expected.length ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(expected))
    ) {
      return send(res, 400, "Sign-in expired. Go back and try again.");
    }
    const tokenRes = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code: url.searchParams.get("code"),
          redirect_uri: `${PUBLIC_URL}/auth/callback`,
        }),
      },
    )
      .then((r) => r.json())
      .catch(() => ({}));
    const token = tokenRes.access_token;
    if (!token)
      return send(res, 401, "GitHub sign-in failed. Go back and try again.");
    const [user, repo, members] = await Promise.all([
      gh(token, "/user"),
      gh(token, `/repos/${REPO}`),
      readMembers(token),
    ]);
    if (repo.status !== 200 || !repo.json?.permissions?.push) {
      return send(
        res,
        403,
        `This board is for people with write access to ${REPO}. Ask Caleb to add your GitHub account.`,
        { "Set-Cookie": cookie("team_state", "", 0) },
      );
    }
    const login = user.json.login;
    // A GitHub profile name is self-chosen, so someone not in members.json
    // could call themselves "Caleb" in the activity log. Only the login, then.
    const member =
      members.find(
        (m) => (m.github || "").toLowerCase() === login.toLowerCase(),
      )?.name || login;
    const sealed = seal({ token, login, member, avatar: user.json.avatar_url });
    return send(res, 302, "", {
      Location: "/",
      "Set-Cookie": [
        cookie("team_session", sealed, SESSION_DAYS * 86400),
        cookie("team_state", "", 0),
      ],
    });
  }

  if (url.pathname === "/auth/logout" && req.method === "POST") {
    // Clearing the cookie leaves the token live on GitHub; revoke it too.
    if (session?.token && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
      const basic = Buffer.from(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`).toString("base64");
      await fetch(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/token`, {
        method: "DELETE",
        headers: { Authorization: `Basic ${basic}`, Accept: "application/vnd.github+json", "User-Agent": "chewbacca-team", "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: session.token }),
      }).catch((err) => console.error(`team-web logout: token revoke failed: ${err.message}`));
    }
    return send(
      res,
      200,
      { ok: true },
      { "Set-Cookie": cookie("team_session", "", 0) },
    );
  }

  if (!url.pathname.startsWith("/api/")) return send(res, 404, "Not found");
  if (!session) return send(res, 401, { error: "signed out" });
  // SameSite=Lax already blocks cross-site POSTs carrying the cookie; this header
  // is the second lock, since a plain HTML form cannot set it.
  if (req.method !== "GET" && req.headers["x-team-request"] !== "1")
    return send(res, 403, { error: "bad request origin" });

  const members = await readMembers(session.token);
  if (url.pathname === "/api/me")
    return send(res, 200, {
      login: session.login,
      member: session.member,
      avatar: session.avatar,
    });
  if (url.pathname === "/api/board" && req.method === "GET") {
    if (Date.now() - lastLink > LINK_EVERY_MS) {
      lastLink = Date.now();
      linkCommits(session).catch((err) => console.error(`team-web commit sync: ${err.message}`));
    }
    const [board, config] = await Promise.all([
      listTasks(session.token),
      readJsonFile(session.token, "team/config.json", {}),
    ]);
    return send(res, 200, {
      ...board,
      members,
      config,
      statuses: STATUSES,
      priorities: PRIORITIES,
      today: today(),
    });
  }
  if (url.pathname === "/api/feed" && req.method === "GET") {
    const r = await gh(
      session.token,
      `/repos/${REPO}/commits?path=${TASK_DIR}&sha=${BRANCH}&per_page=30`,
    );
    if (r.status !== 200)
      throw httpError(502, "GitHub did not return the feed");
    return send(
      res,
      200,
      r.json.map((c) => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split("\n")[0],
        who: c.author?.login || c.commit.author.name,
        avatar: c.author?.avatar_url || "",
        when: c.commit.author.date,
      })),
    );
  }
  if (url.pathname === "/api/tasks" && req.method === "POST") {
    return send(
      res,
      201,
      await createTask(session, await readBody(req), members),
    );
  }
  const m = /^\/api\/tasks\/(CHW-\d+)$/.exec(url.pathname);
  if (m && req.method === "PATCH")
    return send(
      res,
      200,
      await updateTask(session, m[1], await readBody(req), members),
    );
  return send(res, 404, { error: "not found" });
}

export const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err.status || 500;
    if (status >= 500)
      console.error(
        `team-web ${req.method} ${req.url.split("?")[0]}: ${err.message}`,
      );
    send(res, status, {
      error:
        status >= 500 && !err.status
          ? "Something broke on the server. Try again."
          : err.message,
    });
  });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(env.PORT || 3000);
  server.listen(port, () =>
    console.log(`team-web on :${port} for ${REPO}@${BRANCH}`),
  );
}

export { seal, unseal, cleanChanges, FIELDS };
