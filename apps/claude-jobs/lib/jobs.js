// Scheduled Claude jobs on the user's own Claude subscription, no API key.
//
// `claude setup-token` makes a long-lived OAuth token for the user's Pro or
// Max plan, the same one Claude's GitHub Action uses. Set it as
// CLAUDE_CODE_OAUTH_TOKEN wherever this runs and every job is Claude Code
// headless (`claude -p`), billed to the plan, not to an API account. Run it on
// Railway and the jobs keep going with the laptop shut.
//
// A job is one markdown file in jobs/: frontmatter says when (Pacific time)
// and which repos it reads, the body is the prompt. Jobs only ever get read
// tools, so nothing scheduled writes, sends, posts or spends.
//
// Ported from calebnewtonusc/joel-os server/jobs.js, which ran the first one.

import { execFile as nodeExecFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const TZ = "America/Los_Angeles";

// What a job may be given. Anything that writes or runs a shell is left out,
// and is also passed to --disallowedTools in case a setting allows it.
export const READ_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"];
// A job that reads private repos gets no web tools unless it names them: a
// planted line in a repo could otherwise WebFetch its contents out in a URL.
export const REPO_DEFAULT_TOOLS = ["Read", "Glob", "Grep"];
export const DENIED_TOOLS = [
  "Bash",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
];

const NAME = /^[a-z0-9-]+$/;
const AT = /^([01]\d|2[0-3]):[0-5]\d$/;
// Owner and name both start alphanumeric, so "../x" or "./x" can never parse.
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// joel-os's first local runs of the morning brief took about a minute, so ten
// is generous; past that it is stuck.
const JOB_TIMEOUT_MS = 10 * 60 * 1000;
// A failed run waits this long before trying again. joel-os first retried
// every minute, and a missing token then failed sixty times an hour.
export const RETRY_AFTER_MS = 30 * 60 * 1000;

function list(v) {
  return String(v || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// One job file to a job, or to { name, error } when it can't be scheduled.
export function parseJob(file, raw) {
  const name = path.basename(file).replace(/\.md$/, "");
  if (!NAME.test(name))
    return {
      name,
      error: "file name must be lowercase letters, digits and dashes",
    };
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { name, error: "no frontmatter" };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    meta[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  const job = {
    name,
    title: meta.title || name,
    role: meta.role || "",
    at: meta.at || "",
    days: meta.days || "daily",
    repos: list(meta.repos),
    tools: meta.tools ? list(meta.tools) : (list(meta.repos).length ? REPO_DEFAULT_TOOLS : READ_TOOLS).slice(),
    prompt: m[2].trim(),
  };
  if (!AT.test(job.at))
    return {
      name,
      error: `at must be HH:MM in 24-hour Pacific time, got "${job.at}"`,
    };
  if (job.days !== "daily") {
    const bad = list(job.days.toLowerCase()).filter((d) => !DAYS.includes(d));
    if (bad.length) return { name, error: `unknown days: ${bad.join(", ")}` };
  }
  const badRepo = job.repos.find((r) => !REPO.test(r));
  if (badRepo)
    return { name, error: `repos must be owner/name, got "${badRepo}"` };
  const badTool = job.tools.find((t) => !READ_TOOLS.includes(t));
  if (badTool)
    return {
      name,
      error: `tool "${badTool}" is not a read tool (allowed: ${READ_TOOLS.join(", ")})`,
    };
  if (!job.prompt) return { name, error: "empty prompt" };
  return job;
}

export function loadJobs(jobsDir) {
  if (!fs.existsSync(jobsDir)) return [];
  return fs
    .readdirSync(jobsDir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort()
    .map((f) => parseJob(f, fs.readFileSync(path.join(jobsDir, f), "utf8")));
}

export function nowParts(date = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const p = Object.fromEntries(
    f.formatToParts(date).map((x) => [x.type, x.value]),
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hm: `${p.hour === "24" ? "00" : p.hour}:${p.minute}`,
    weekday: p.weekday.toLowerCase(),
  };
}

export function isDue(job, now, state, nowMs = Date.now()) {
  if (job.error || state[job.name] === now.date) return false;
  if (nowMs < (state[`${job.name}:retry_after`] || 0)) return false;
  if (
    job.days !== "daily" &&
    !list(job.days.toLowerCase()).includes(now.weekday)
  )
    return false;
  return now.hm >= job.at;
}

// The last lines of what the child said, never execFile's err.message: that
// repeats the whole argv, and in joel-os testing it leaked an MCP secret.
export function failureText(err, stdout, stderr) {
  return [stderr, stdout, `exit ${err.killed ? "timeout" : err.code}`]
    .filter(Boolean)
    .join("\n")
    .split("\n")
    .filter(
      (l) => l.trim() && !/^Permission allow rule|^Warning: no stdin/.test(l),
    )
    .slice(-5)
    .join("\n");
}

// The env a child gets: the runner's own secrets stay with the runner.
function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.GITHUB_TOKEN;
  delete env.JOBS_SECRET;
  return env;
}

// git reads the token from GIT_CONFIG_* env, never argv, so a failed clone
// can't print it.
function gitEnv() {
  const token = process.env.GITHUB_TOKEN;
  const extra = { GIT_TERMINAL_PROMPT: "0" };
  if (token) {
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    Object.assign(extra, {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    });
  }
  return childEnv(extra);
}

function claudeBin(appDir) {
  const local = path.join(appDir, "node_modules", ".bin", "claude");
  return fs.existsSync(local) ? local : "claude";
}

export function createScheduler({
  dataDir,
  jobsDir,
  appDir = path.dirname(jobsDir),
  execFile = nodeExecFile,
  enabled = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN) ||
    process.env.JOBS_USE_LOCAL_LOGIN === "1",
  log = console,
}) {
  const stateFile = path.join(dataDir, "jobs-state.json");
  const runsDir = path.join(dataDir, "runs");
  const reposDir = path.join(dataDir, "repos");
  const running = new Set();
  fs.mkdirSync(dataDir, { recursive: true });
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch (e) {
    // Missing on the first boot is normal. Anything else means a job could
    // run twice today, so say so.
    if (e.code !== "ENOENT")
      log.error(`jobs state unreadable, starting fresh: ${e.message}`);
  }
  const save = () =>
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  const jobs = () => loadJobs(jobsDir);

  function exec(bin, args, opts) {
    return new Promise((resolve) => {
      const child = execFile(
        bin,
        args,
        { maxBuffer: 4 * 1024 * 1024, ...opts },
        (err, stdout, stderr) =>
          resolve({
            err,
            stdout: String(stdout || ""),
            stderr: String(stderr || ""),
          }),
      );
      // Without this claude waits 3 s for stdin and prints a warning.
      child?.stdin?.end();
    });
  }

  async function syncRepo(repo) {
    const dir = path.join(reposDir, repo.replace("/", "__"));
    const opts = { env: gitEnv(), timeout: 2 * 60 * 1000 };
    let r;
    if (fs.existsSync(path.join(dir, ".git"))) {
      // Read-only checkout, so the newest commit simply replaces what is here.
      r = await exec("git", ["-C", dir, "fetch", "--depth", "1", "origin", "HEAD"], opts);
      if (!r.err) r = await exec("git", ["-C", dir, "reset", "--hard", "FETCH_HEAD"], opts);
    } else {
      r = await exec("git", ["clone", "--depth", "1", `https://github.com/${repo}.git`, dir], opts);
    }
    if (r.err)
      throw new Error(
        `could not fetch ${repo}: ${failureText(r.err, r.stdout, r.stderr)}`,
      );
    return dir;
  }

  function fail(job, why) {
    state[`${job.name}:retry_after`] = Date.now() + RETRY_AFTER_MS;
    state[`${job.name}:last_error`] = why;
    try {
      save();
    } catch (e) {
      log.error(`job ${job.name}: could not save state: ${e.code || e.message}`);
    }
    // Only the last line goes to the host's logs. The rest can quote the
    // repos the job read, so it stays in state, behind JOBS_SECRET.
    log.error(`job ${job.name} failed: ${why.split("\n").pop()}`);
    return { ok: false, error: why };
  }

  async function run(job, now = nowParts()) {
    if (job.error) return { ok: false, error: job.error };
    if (running.has(job.name)) return { ok: false, error: "already running" };
    if (!enabled)
      return { ok: false, error: "CLAUDE_CODE_OAUTH_TOKEN is not set" };
    running.add(job.name);
    try {
      return await attempt(job, now);
    } catch (e) {
      // A full or read-only volume must fail the job, not crash the service.
      return fail(job, `runner error: ${e.code || e.message}`);
    } finally {
      running.delete(job.name);
    }
  }

  async function attempt(job, now) {
    {
      let dirs;
      try {
        dirs = [];
        for (const repo of job.repos) dirs.push(await syncRepo(repo));
      } catch (e) {
        return fail(job, e.message);
      }
      const where = dirs.length
        ? `\n\nThese repos are checked out for you to read: ${job.repos.map((r, i) => `${r} at ${dirs[i]}`).join("; ")}.`
        : "";
      const prompt = `Today is ${now.weekday}, ${now.date}, Pacific time.${where}\n\n${job.prompt}`;
      const args = [
        "-p",
        prompt,
        "--output-format",
        "text",
        // No MCP servers at all, whatever the machine has configured.
        "--strict-mcp-config",
        // --allowedTools only pre-approves; on a Mac whose settings say
        // bypassPermissions every other tool would still run. --tools is the
        // whole tool list, and --restricted skips user, project and local
        // settings (their permission mode and hooks) and the code-running tools.
        "--restricted",
        "--tools",
        job.tools.join(","),
        "--permission-mode",
        "default",
        "--allowedTools",
        job.tools.join(","),
        "--disallowedTools",
        DENIED_TOOLS.join(","),
        ...dirs.flatMap((d) => ["--add-dir", d]),
      ];
      const work = path.join(dataDir, "work");
      fs.mkdirSync(work, { recursive: true });
      const r = await exec(claudeBin(appDir), args, {
        cwd: work,
        env: childEnv(),
        timeout: JOB_TIMEOUT_MS,
      });
      if (r.err) return fail(job, failureText(r.err, r.stdout, r.stderr));
      // The output is on disk before the day is marked done, so a failed
      // write retries instead of losing the day.
      fs.mkdirSync(path.join(runsDir, job.name), { recursive: true });
      fs.writeFileSync(
        path.join(runsDir, job.name, `${now.date}.md`),
        r.stdout.trim() + "\n",
      );
      state[job.name] = now.date;
      delete state[`${job.name}:retry_after`];
      delete state[`${job.name}:last_error`];
      save();
      log.log(`job ${job.name} done, ${r.stdout.length} chars`);
      return { ok: true, chars: r.stdout.length };
    }
  }

  // Only a job that exists can be read back, so a name never walks out of runs/.
  function latest(name) {
    if (
      !NAME.test(String(name)) ||
      !jobs().some((j) => j.name === name && !j.error)
    )
      return null;
    const dir = path.join(runsDir, name);
    if (!fs.existsSync(dir)) return null;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    if (!files.length) return null;
    const file = files[files.length - 1];
    return {
      date: file.replace(/\.md$/, ""),
      text: fs.readFileSync(path.join(dir, file), "utf8"),
    };
  }

  function status() {
    return jobs().map((j) => ({
      name: j.name,
      title: j.title,
      role: j.role,
      at: j.at,
      days: j.days,
      repos: j.repos,
      error: j.error || null,
      lastRun: state[j.name] || null,
      retryAfter: state[`${j.name}:retry_after`] || null,
      lastError: state[`${j.name}:last_error`] || null,
      running: running.has(j.name),
    }));
  }

  function tick(date = new Date()) {
    const now = nowParts(date);
    const started = [];
    for (const job of jobs())
      if (isDue(job, now, state, date.getTime()) && !running.has(job.name)) {
        started.push(job.name);
        run(job, now);
      }
    return started;
  }

  return { enabled, jobs, run, latest, status, tick };
}

// Phil Hewinson's "Org Chart.md": one page of roles, each with the jobs it
// runs and when. Rendered from the job files so the chart can't drift.
export function orgChart(jobs) {
  const byRole = new Map();
  for (const j of jobs) {
    if (j.error) continue;
    const role = j.role || "Unassigned";
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(j);
  }
  const lines = [
    "# Org chart",
    "",
    "Every role below is a job the agent runs on its own schedule, Pacific time.",
    "",
  ];
  for (const [role, js] of [...byRole].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## ${role}`, "");
    for (const j of js)
      lines.push(`- ${j.title} (\`${j.name}\`): ${j.days} at ${j.at}`);
    lines.push("");
  }
  return lines.join("\n");
}
