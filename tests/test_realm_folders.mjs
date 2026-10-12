// "Choose folder" on the glass: the folders a new agent can start in.
//
// On 2026-10-11 the morning rehearsal pressed Choose folder in Realm's new
// space sheet on the glass and nothing happened: the bridge answered null, so
// a new agent could only start in the empty folder Realm allocates, never in
// a repo. bin/lib/realm_ui/folders.mjs lists the checkouts his tabs worked in
// and checks a typed path; these pin what it offers and what it refuses.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  realpathSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import {
  checkFolder,
  listFolders,
  MAX_FOLDERS,
} from "../bin/lib/realm_ui/folders.mjs";
import { handleGlass, glassState } from "../bin/lib/realm_ui/glass_routes.mjs";

const repo = (dir) => {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", dir]);
  return realpathSync(dir);
};

const transcript = (home, slug, id, cwd, mtime) => {
  const dir = join(home, ".claude", "projects", slug);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `${id}.jsonl`);
  writeFileSync(
    f,
    `${JSON.stringify({ type: "user", cwd, message: { content: "hi" } })}\n`,
  );
  utimesSync(f, mtime, mtime);
};

test("a typed path is accepted only as a git checkout under home", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "folders-")));
  const r = repo(join(home, "code", "app"));
  mkdirSync(join(home, "plain"));
  assert.equal(checkFolder(r, { home }), r);
  assert.equal(checkFolder("~/code/app", { home }), r);
  assert.equal(checkFolder(`  ${r}  `, { home }), r);
  assert.equal(
    checkFolder(join(home, "plain"), { home }),
    null,
    "not a checkout",
  );
  assert.equal(checkFolder(home, { home }), null, "home itself");
  assert.equal(checkFolder("/tmp", { home }), null, "outside home");
  assert.equal(checkFolder("code/app", { home }), null, "relative");
  assert.equal(checkFolder(join(home, "nope"), { home }), null, "missing");
  assert.equal(checkFolder(null, { home }), null);
  const ssh = repo(join(home, ".ssh", "keys"));
  assert.equal(
    checkFolder(ssh, { home }),
    null,
    "a key folder, even as a checkout",
  );
  const engine = repo(join(home, ".chewbacca", "realm", "x"));
  assert.equal(checkFolder(engine, { home }), null, "the engine's own state");
  const rehearsal = repo(
    join(home, ".chewbacca", "overnight", "rehearsal-repo"),
  );
  assert.equal(
    checkFolder(rehearsal, { home }),
    rehearsal,
    "a scratch repo under ~/.chewbacca is fine",
  );
});

test("the list is recent tab folders first, then ~/code checkouts, each once", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "folders-")));
  const a = repo(join(home, "code", "alpha"));
  const b = repo(join(home, "code", "beta"));
  const silo = repo(join(home, "code", "work", "silo"));
  repo(join(home, "code", "vendor", "theirs"));
  const chew = repo(join(home, "code", "chewbacca"));
  mkdirSync(join(home, "code", "notrepo"));
  const now = Date.now() / 1000;
  transcript(home, "-x-chew", "1", chew, now);
  transcript(home, "-x-chew", "2", chew, now - 10);
  transcript(home, "-x-beta", "3", b, now - 20);
  transcript(home, "-tmp", "4", "/private/tmp/some-scratch", now - 5);
  transcript(home, "-gone", "5", join(home, "deleted"), now - 3);
  utimesSync(a, now - 100, now - 100);
  utimesSync(silo, now - 50, now - 50);
  const got = listFolders({ home });
  // Tabs first (newest transcript first), then ~/code by last touched, one
  // level into group folders like ~/code/work, never ~/code/vendor.
  assert.deepEqual(
    got.map((f) => f.name),
    ["chewbacca", "beta", "silo", "alpha"],
  );
  assert.equal(got[0].path, chew);
  assert.equal(got[3].path, a);
});

test("the list stops at MAX_FOLDERS", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "folders-")));
  for (let i = 0; i < MAX_FOLDERS + 5; i++)
    repo(join(home, "code", `r${String(i).padStart(2, "0")}`));
  assert.equal(listFolders({ home }).length, MAX_FOLDERS);
});

test("GET /glass/folders lists, checks a typed path, and needs the token", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "folders-")));
  const r = repo(join(home, "code", "app"));
  const token = "t".repeat(32);
  const state = glassState();
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (
      !handleGlass(req, res, {
        path: url.pathname,
        url,
        token,
        origin: "x",
        state,
        home,
      })
    ) {
      res.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, t = token) =>
    fetch(`${base}${p}`, { headers: { "X-Glass-Token": t } });
  try {
    assert.equal((await get("/glass/folders", "wrong")).status, 403);
    const list = await (await get("/glass/folders")).json();
    assert.deepEqual(list.folders, [{ path: r, name: "app" }]);
    const ok = await get(
      `/glass/folders?path=${encodeURIComponent("~/code/app")}`,
    );
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { folder: r });
    const no = await get(`/glass/folders?path=${encodeURIComponent("/etc")}`);
    assert.equal(no.status, 404);
  } finally {
    server.close();
  }
});
