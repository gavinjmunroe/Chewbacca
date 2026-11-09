import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const {
  parseJob,
  loadJobs,
  isDue,
  nowParts,
  createScheduler,
  orgChart,
  failureText,
  RETRY_AFTER_MS,
} = await import("../lib/jobs.js");
const { createServer, authorized } = await import("../server.js");

const APP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const job = (body) =>
  `---\ntitle: T\nat: "08:00"\n${body}---\n\nDo the thing.\n`;
const quiet = { log() {}, error() {} };

function sandbox(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-jobs-"));
  const jobsDir = path.join(root, "jobs");
  fs.mkdirSync(jobsDir);
  for (const [name, raw] of Object.entries(files))
    fs.writeFileSync(path.join(jobsDir, name), raw);
  return { root, jobsDir, dataDir: path.join(root, "data") };
}

// A stand-in for child_process.execFile that records each call and answers
// with what the test hands it.
function fakeExec(answer) {
  const calls = [];
  const exec = (bin, args, opts, cb) => {
    const child = {
      stdin: {
        ended: false,
        end() {
          this.ended = true;
        },
      },
    };
    calls.push({ bin, args, opts, child });
    setImmediate(() => {
      const [err, stdout, stderr] = answer(bin, args, opts);
      cb(err, stdout, stderr);
    });
    return child;
  };
  return { exec, calls };
}

test("the shipped jobs all parse and the morning brief is scheduled", () => {
  const jobs = loadJobs(path.join(APP, "jobs"));
  assert.ok(jobs.length >= 1);
  for (const j of jobs)
    assert.equal(j.error, undefined, `${j.name}: ${j.error}`);
  const brief = jobs.find((j) => j.name === "morning-brief");
  assert.equal(brief.at, "07:30");
  assert.deepEqual(brief.repos, ["calebnewtonusc/second-brain"]);
});

test("bad schedules, repos, names and write tools are refused, not run", () => {
  assert.match(
    parseJob("x.md", job("").replace('"08:00"', '"8am"')).error,
    /HH:MM/,
  );
  assert.match(parseJob("x.md", job("days: funday\n")).error, /unknown days/);
  assert.match(parseJob("x.md", job("repos: ../etc\n")).error, /owner\/name/);
  assert.match(
    parseJob("x.md", job("tools: Read, Bash\n")).error,
    /Bash.*not a read tool/,
  );
  assert.match(parseJob("Bad_Name.md", job("")).error, /lowercase/);
  assert.match(parseJob("x.md", "no frontmatter").error, /frontmatter/);
  assert.equal(
    parseJob("x.md", job("tools: Read, Grep\n")).tools.join(","),
    "Read,Grep",
  );
});

test("a job is due once a day, after its time, on its days, and not inside a retry wait", () => {
  const j = parseJob("brief.md", job("days: mon, wed\n"));
  const mon = { date: "2026-11-02", hm: "08:05", weekday: "mon" };
  assert.equal(isDue(j, { ...mon, hm: "07:59" }, {}), false);
  assert.equal(isDue(j, mon, {}), true);
  assert.equal(isDue(j, { ...mon, weekday: "tue" }, {}), false);
  assert.equal(isDue(j, mon, { brief: "2026-11-02" }), false);
  assert.equal(isDue(j, mon, { "brief:retry_after": 2000 }, 1000), false);
  assert.equal(isDue(j, mon, { "brief:retry_after": 2000 }, 3000), true);
});

test("nowParts reads Pacific time, not the server's", () => {
  // 16:30 UTC on Nov 2 2026 is 08:30 PST.
  assert.deepEqual(nowParts(new Date("2026-11-02T16:30:00Z")), {
    date: "2026-11-02",
    hm: "08:30",
    weekday: "mon",
  });
});

test("a run calls claude headless with read tools only, closes stdin, and saves the output", async () => {
  const s = sandbox({ "brief.md": job("repos: someone/notes\n") });
  const { exec, calls } = fakeExec((bin) =>
    bin === "git" ? [null, "", ""] : [null, "The brief.\n", ""],
  );
  const sched = createScheduler({
    ...s,
    appDir: s.root,
    execFile: exec,
    enabled: true,
    log: quiet,
  });
  const now = { date: "2026-11-02", hm: "08:00", weekday: "mon" };
  const r = await sched.run(sched.jobs()[0], now);
  assert.deepEqual(r, { ok: true, chars: 11 });

  const [clone, claude] = calls;
  assert.equal(clone.bin, "git");
  assert.ok(clone.args.includes("https://github.com/someone/notes.git"));
  assert.ok(
    !JSON.stringify(clone.args).includes("AUTHORIZATION"),
    "the token header rides in env, never argv",
  );

  const a = claude.args;
  assert.equal(a[0], "-p");
  assert.match(a[1], /Today is mon, 2026-11-02/);
  assert.ok(a.includes("--strict-mcp-config"));
  assert.equal(
    a[a.indexOf("--allowedTools") + 1],
    "Read,Glob,Grep",
    "a job reading a repo gets no web tools by default",
  );
  assert.equal(a[a.indexOf("--tools") + 1], "Read,Glob,Grep", "--tools is the whole list, not a pre-approval");
  assert.ok(a.includes("--restricted"), "local settings (bypassPermissions, hooks) never apply");
  assert.equal(a[a.indexOf("--permission-mode") + 1], "default");
  assert.match(a[a.indexOf("--disallowedTools") + 1], /Bash/);
  assert.ok(a[a.indexOf("--add-dir") + 1].endsWith("someone__notes"));
  assert.equal(claude.child.stdin.ended, true);

  assert.equal(sched.latest("brief").text, "The brief.\n");
  assert.equal(sched.latest("../brief"), null);
  assert.equal(sched.latest("nope"), null);
  assert.equal(sched.status()[0].lastRun, "2026-11-02");
});

test("the GitHub token reaches git in env only and never reaches claude", async () => {
  const s = sandbox({ "brief.md": job("repos: someone/notes\n") });
  const { exec, calls } = fakeExec(() => [null, "ok", ""]);
  process.env.GITHUB_TOKEN = "ghp_fixture"; // secret-scan: allow, a fixture, not a credential
  process.env.JOBS_SECRET = "s3cret-fixture"; // secret-scan: allow, a fixture, not a credential
  try {
    const sched = createScheduler({
      ...s,
      appDir: s.root,
      execFile: exec,
      enabled: true,
      log: quiet,
    });
    await sched.run(sched.jobs()[0]);
  } finally {
    delete process.env.GITHUB_TOKEN;
    delete process.env.JOBS_SECRET;
  }
  const [git, claude] = calls;
  assert.match(git.opts.env.GIT_CONFIG_VALUE_0, /^AUTHORIZATION: basic /);
  assert.equal(git.opts.env.GITHUB_TOKEN, undefined);
  assert.equal(claude.opts.env.GITHUB_TOKEN, undefined);
  assert.equal(claude.opts.env.JOBS_SECRET, undefined);
  assert.equal(claude.opts.env.GIT_CONFIG_VALUE_0, undefined);
});

test("a failure reports claude's own words, never the argv, and waits 30 minutes", async () => {
  const s = sandbox({ "brief.md": job("") });
  const err = Object.assign(
    new Error("Command failed: claude -p SECRET-IN-ARGV"),
    { code: 1 },
  );
  const { exec } = fakeExec(() => [
    err,
    "",
    "Warning: no stdin\nOAuth session expired\n",
  ]);
  const sched = createScheduler({
    ...s,
    appDir: s.root,
    execFile: exec,
    enabled: true,
    log: quiet,
  });
  const before = Date.now();
  const r = await sched.run(sched.jobs()[0]);
  assert.equal(r.ok, false);
  assert.equal(r.error, "OAuth session expired\nexit 1");
  assert.ok(!r.error.includes("SECRET-IN-ARGV"));
  const st = sched.status()[0];
  assert.ok(st.retryAfter >= before + RETRY_AFTER_MS);
  assert.equal(st.lastError, r.error);
  assert.equal(failureText({ killed: true }, "", ""), "exit timeout");
  // And the next minute's tick leaves it alone.
  assert.deepEqual(sched.tick(new Date("2026-11-02T17:00:00Z")), []);
});

test("without a token nothing runs and tick starts nothing", async () => {
  const s = sandbox({ "brief.md": job("") });
  const { exec, calls } = fakeExec(() => [null, "", ""]);
  const sched = createScheduler({
    ...s,
    appDir: s.root,
    execFile: exec,
    enabled: false,
    log: quiet,
  });
  assert.match(
    (await sched.run(sched.jobs()[0])).error,
    /CLAUDE_CODE_OAUTH_TOKEN/,
  );
  assert.equal(calls.length, 0);
});

test("tick starts a due job once even when two ticks land together", async () => {
  const s = sandbox({ "brief.md": job("") });
  let release;
  const gate = new Promise((r) => (release = r));
  const calls = [];
  const exec = (bin, args, opts, cb) => {
    calls.push(bin);
    gate.then(() => cb(null, "done", ""));
    return { stdin: { end() {} } };
  };
  const sched = createScheduler({
    ...s,
    appDir: s.root,
    execFile: exec,
    enabled: true,
    log: quiet,
  });
  const at = new Date("2026-11-02T16:30:00Z");
  assert.deepEqual(sched.tick(at), ["brief"]);
  assert.deepEqual(sched.tick(at), []);
  release();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.length, 1);
  assert.deepEqual(sched.tick(at), [], "done for today");
});

test("the org chart groups jobs by role from the same files", () => {
  const chart = orgChart([
    parseJob("a.md", job("role: Chief of staff\n")),
    parseJob("b.md", job("role: Researcher\ndays: fri\n")),
    parseJob("c.md", "broken"),
  ]);
  assert.match(chart, /## Chief of staff\n\n- T \(`a`\): daily at 08:00/);
  assert.match(chart, /## Researcher\n\n- T \(`b`\): fri at 08:00/);
  assert.ok(!chart.includes("`c`"));
});

test("the server hides everything but /health behind the secret", async () => {
  const s = sandbox({ "brief.md": job("") });
  const { exec } = fakeExec(() => [null, "hello", ""]);
  const sched = createScheduler({
    ...s,
    appDir: s.root,
    execFile: exec,
    enabled: true,
    log: quiet,
  });
  await sched.run(sched.jobs()[0], {
    date: "2026-11-02",
    hm: "08:00",
    weekday: "mon",
  });
  const server = createServer(sched, "right-secret").listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, auth, method = "GET") =>
    fetch(base + p, {
      method,
      headers: auth ? { authorization: `Bearer ${auth}` } : {},
    });
  try {
    assert.deepEqual(await (await get("/health")).json(), { ok: true });
    assert.equal((await get("/jobs")).status, 401);
    assert.equal((await get("/runs/brief", "wrong-secret")).status, 401);
    assert.equal((await get("/runs/brief", "right-secret")).status, 200);
    assert.match(
      await (await get("/runs/brief", "right-secret")).text(),
      /# T, 2026-11-02\n\nhello/,
    );
    assert.equal((await get("/runs/..%2Fetc", "right-secret")).status, 404);
    assert.equal((await get("/run/brief", "right-secret", "POST")).status, 202);
    assert.equal((await get("/jobs", "right-secret")).status, 200);
  } finally {
    server.close();
  }
  assert.equal(authorized("Bearer x", ""), false);
});

test("web tools are the default only for jobs that read no repos, unless a job names them", () => {
  assert.deepEqual(parseJob("x.md", job("")).tools, ["Read", "Glob", "Grep", "WebSearch", "WebFetch"]);
  assert.deepEqual(parseJob("x.md", job("repos: a/b\n")).tools, ["Read", "Glob", "Grep"]);
  assert.deepEqual(parseJob("x.md", job("repos: a/b\ntools: Read, WebSearch\n")).tools, ["Read", "WebSearch"]);
});

test("a full disk fails the job and retries, never crashes or marks the day done", async () => {
  const s = sandbox({ "brief.md": job("") });
  const { exec } = fakeExec(() => [null, "The brief.", ""]);
  const lines = [];
  const sched = createScheduler({
    ...s, appDir: s.root, execFile: exec, enabled: true,
    log: { log() {}, error: (l) => lines.push(l) },
  });
  // A file where runs/ should be makes every mkdir under it throw.
  fs.writeFileSync(path.join(s.dataDir, "runs"), "");
  const r = await sched.run(sched.jobs()[0], { date: "2026-11-02", hm: "08:00", weekday: "mon" });
  assert.equal(r.ok, false);
  assert.match(r.error, /runner error: (ENOTDIR|EEXIST)/);
  const st = sched.status()[0];
  assert.equal(st.lastRun, null, "the day is not marked done without its output");
  assert.ok(st.retryAfter);
  assert.equal(st.running, false);
});

test("only the last line of a failure reaches the host log", async () => {
  const s = sandbox({ "brief.md": job("") });
  const err = Object.assign(new Error("x"), { code: 1 });
  const { exec } = fakeExec(() => [err, "", "private line from a repo\nOAuth session expired"]);
  const lines = [];
  const sched = createScheduler({
    ...s, appDir: s.root, execFile: exec, enabled: true,
    log: { log() {}, error: (l) => lines.push(l) },
  });
  const r = await sched.run(sched.jobs()[0]);
  assert.match(r.error, /private line/);
  assert.deepEqual(lines, ["job brief failed: exit 1"]);
});
