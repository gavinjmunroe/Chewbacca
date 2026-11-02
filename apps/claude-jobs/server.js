// The always-on half of claude-jobs: ticks every minute, runs what is due, and
// serves the results to the owner. See README.md.
//
//   GET  /health            {ok}, for Railway's health check. Says nothing else.
//   GET  /jobs              every job, its schedule, last run and last error
//   GET  /runs/<name>       the latest output of one job, as text
//   POST /run/<name>        run one job now
//
// Everything but /health needs `Authorization: Bearer $JOBS_SECRET`.

import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createScheduler } from "./lib/jobs.js";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));

export function authorized(header, secret) {
  if (!secret) return false;
  const got = Buffer.from(String(header || "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export function createServer(scheduler, secret = process.env.JOBS_SECRET) {
  return http.createServer(async (req, res) => {
    const send = (code, body, type = "application/json") => {
      res.writeHead(code, {
        "content-type": type,
        "cache-control": "no-store",
      });
      res.end(type === "application/json" ? JSON.stringify(body) : body);
    };
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/health") return send(200, { ok: true });
    if (!secret) return send(503, { error: "JOBS_SECRET is not set" });
    if (!authorized(req.headers.authorization, secret))
      return send(401, { error: "unauthorized" });

    if (req.method === "GET" && url.pathname === "/jobs")
      return send(200, {
        enabled: scheduler.enabled,
        jobs: scheduler.status(),
      });
    const m = url.pathname.match(/^\/(runs|run)\/([^/]+)$/);
    if (!m) return send(404, { error: "not found" });
    const job = scheduler.jobs().find((j) => j.name === m[2] && !j.error);
    if (!job) return send(404, { error: "no such job" });
    if (req.method === "GET" && m[1] === "runs") {
      const last = scheduler.latest(job.name);
      return last
        ? send(
            200,
            `# ${job.title}, ${last.date}\n\n${last.text}`,
            "text/markdown; charset=utf-8",
          )
        : send(404, { error: "no runs yet" });
    }
    // A run takes about a minute, longer than a proxy holds a request open,
    // so start it and let the caller read /jobs or /runs after.
    if (req.method === "POST" && m[1] === "run") {
      if (scheduler.status().some((s) => s.name === job.name && s.running))
        return send(409, { error: "already running" });
      scheduler.run(job);
      return send(202, { started: job.name });
    }
    return send(405, { error: "method not allowed" });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const scheduler = createScheduler({
    dataDir: process.env.DATA_DIR || path.join(APP_DIR, ".data"),
    jobsDir: process.env.JOBS_DIR || path.join(APP_DIR, "jobs"),
    appDir: APP_DIR,
  });
  if (scheduler.enabled) setInterval(() => scheduler.tick(), 60 * 1000);
  else
    console.error(
      "CLAUDE_CODE_OAUTH_TOKEN is not set: serving, but no job will run",
    );
  const port = Number(process.env.PORT || 8787);
  createServer(scheduler).listen(port, () =>
    console.log(`claude-jobs on :${port}, ${scheduler.jobs().length} jobs`),
  );
}
