// The page half of the native bridges for Realm on the glass: bridge.js asks
// Kyber (hud/Sources/KyberKit/RealmBridges.swift) for the open panel and
// notifications, matches a dropped File to the paths Kyber handed it, and the
// realm-ui server describes what was picked. Before this a press on his
// composer's attach did nothing and a drop arrived with no path (morning
// rehearsal, 2026-10-11).
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import {
  describeFiles,
  MAX_DESCRIBE,
} from "../bin/lib/realm_ui/glass_routes.mjs";

const BRIDGE = readFileSync(
  new URL("../bin/lib/realm_ui/bridge.js", import.meta.url),
  "utf8",
);

/** bridge.js run in a page with `native` as Kyber's ask channel (or none). */
function page(native) {
  const window = {
    addEventListener() {},
    webkit: native ? { messageHandlers: { realmGlassAsk: native } } : undefined,
  };
  vm.runInNewContext(BRIDGE, { window, document: {} });
  return window;
}

test("describe keeps what he picked under his home and leaves out keys, strays and the gone", () => {
  const home = mkdtempSync(join(tmpdir(), "bridges-home-"));
  const away = mkdtempSync(join(tmpdir(), "bridges-away-"));
  try {
    writeFileSync(join(home, "notes.pdf"), "12345");
    mkdirSync(join(home, "repo"));
    writeFileSync(join(home, ".env"), "KEY=x");
    mkdirSync(join(home, ".ssh"));
    writeFileSync(join(home, ".ssh", "id_ed25519"), "k");
    writeFileSync(join(away, "outside.txt"), "x");
    symlinkSync(join(away, "outside.txt"), join(home, "link.txt"));
    const got = describeFiles(
      [
        join(home, "notes.pdf"),
        join(home, "repo"),
        join(home, ".env"),
        join(home, ".ssh", "id_ed25519"),
        join(away, "outside.txt"),
        join(home, "link.txt"),
        join(home, "gone.txt"),
        "relative.txt",
        42,
      ],
      { home },
    );
    assert.deepEqual(
      got.map((f) => [f.name, f.size, f.dir]),
      [
        ["notes.pdf", 5, false],
        ["repo", 0, true],
      ],
    );
    assert.deepEqual(describeFiles("not a list", { home }), []);
    const many = Array.from({ length: MAX_DESCRIBE + 10 }, () =>
      join(home, "notes.pdf"),
    );
    assert.equal(describeFiles(many, { home }).length, MAX_DESCRIBE);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(away, { recursive: true, force: true });
  }
});

test("outside the glass nothing is picked and no notification claims to be shown", async () => {
  const w = page(null);
  assert.equal(JSON.stringify(await w.realm.pickFiles()), "[]");
  assert.equal(
    await w.realm.notify.show({ id: "n1", title: "Done", body: null }),
    false,
  );
  assert.equal(w.realm.pathForFile({ name: "a.txt", size: 1 }), "");
});

test("attach asks Kyber's open panel, then describes exactly what came back", async () => {
  const asked = [];
  const w = page({
    postMessage: (msg) => {
      asked.push(msg);
      return Promise.resolve(
        msg.ask === "pickFiles" ? ["/Users/x/a.pdf"] : true,
      );
    },
  });
  const described = [];
  w.__realmGlassDescribe = (paths) => {
    described.push(paths);
    return Promise.resolve([
      { path: paths[0], name: "a.pdf", mime: "application/pdf", size: 3 },
    ]);
  };
  const files = await w.realm.pickFiles();
  assert.deepEqual(JSON.parse(JSON.stringify(asked)), [{ ask: "pickFiles" }]);
  assert.deepEqual(JSON.parse(JSON.stringify(described)), [["/Users/x/a.pdf"]]);
  assert.equal(files[0].mime, "application/pdf");
});

test("a cancelled panel attaches nothing and never asks to describe", async () => {
  const w = page({ postMessage: () => Promise.resolve([]) });
  let called = false;
  w.__realmGlassDescribe = () => ((called = true), Promise.resolve([]));
  assert.equal(JSON.stringify(await w.realm.pickFiles()), "[]");
  assert.equal(called, false);
});

test("a dropped File gets its path from Kyber's drop, by name and size", () => {
  const w = page({ postMessage: () => Promise.resolve(true) });
  w.__realmGlassDrop = [
    { path: "/Users/x/repo", name: "repo", size: -1 },
    { path: "/Users/x/a.txt", name: "a.txt", size: 5 },
  ];
  assert.equal(
    w.realm.pathForFile({ name: "repo", size: 96 }),
    "/Users/x/repo",
  );
  assert.equal(
    w.realm.pathForFile({ name: "a.txt", size: 5 }),
    "/Users/x/a.txt",
  );
  assert.equal(
    w.realm.pathForFile({ name: "a.txt", size: 6 }),
    "",
    "a different file with the same name",
  );
  assert.equal(w.realm.pathForFile({ name: "b.txt", size: 5 }), "");
});

test("a notification goes to Kyber as plain title and body, shown only when Kyber says so", async () => {
  const sent = [];
  let answer = true;
  const w = page({
    postMessage: (msg) => (sent.push(msg), Promise.resolve(answer)),
  });
  assert.equal(
    await w.realm.notify.show({
      id: "n1",
      title: "Claude finished",
      body: null,
    }),
    true,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [
    { ask: "notify", title: "Claude finished", body: "" },
  ]);
  answer = false;
  assert.equal(
    await w.realm.notify.show({ id: "n2", title: "x", body: "y" }),
    false,
  );
  const broken = page({ postMessage: () => Promise.reject(new Error("gone")) });
  assert.equal(await broken.realm.notify.show({ id: "n3", title: "x" }), false);
});

// 10/12, once his rail was on the glass: Settings from his You menu blanked
// the whole page ("evaluating 'l.kind'"), and Settings > Permissions did the
// same ("e.cli.searched.join"). His Settings reads a shape from these, so
// "not here" has to be said in his shape (env.d.ts), never null or [].
test("the bridge answers his Settings page in his own shapes", async () => {
  const realm = page(null).realm;
  for (const key of ["status", "check", "download", "install"]) {
    const st = await realm.updates[key]();
    assert.equal(st.state.kind, "disabled", `updates.${key}`);
    assert.equal(typeof st.version, "string");
  }
  assert.equal(typeof realm.updates.onChanged(() => {}), "function");
  const mac = await realm.macAccess.status();
  assert.equal(mac.cli.present, false);
  assert.ok(Array.isArray(mac.cli.searched), "cli.searched is joined by his tab");
  assert.ok(Array.isArray(mac.rows));
  assert.equal(typeof mac.host.bundlePath, "string");
  assert.ok(Array.isArray(await realm.permissions.probe()));
});

test("the bridge leaves his window chrome on (frameless off)", () => {
  assert.equal(page(null).realm.frameless, false);
});

test("v2.1.0's Add folder and vault unlock answer on the glass instead of throwing", async () => {
  const w = page(null);
  // Arrays come from the vm's realm, so they're compared as JSON.
  // His live-api calls these unguarded (state/live-api.ts at 445437d2).
  assert.equal(typeof w.realm.pickFolders, "function");
  assert.equal(typeof w.realm.credentials.unlockPolicy, "function");
  assert.equal(typeof w.realm.credentials.setUnlockPolicy, "function");
  assert.deepEqual(JSON.parse(JSON.stringify(await w.realm.pickFolders())), [], "no chooser mounted: nothing picked");
  let asked = 0;
  w.__realmGlassPickFolder = () => { asked += 1; return Promise.resolve("/Users/x/code/repo"); };
  w.__realmGlassDescribe = (paths) => Promise.resolve(paths.map((p) => ({ path: p, name: "repo", size: 0, mime: "inode/directory" })));
  assert.deepEqual(JSON.parse(JSON.stringify(await w.realm.pickFolders())), [{ path: "/Users/x/code/repo", name: "repo", size: 0, mime: "inode/directory" }]);
  w.__realmGlassPickFolder = () => Promise.resolve(null);
  assert.deepEqual(JSON.parse(JSON.stringify(await w.realm.pickFolders())), [], "a cancelled chooser attaches nothing");
  assert.equal(asked, 1);
});

test("his browser pane's More menu gets his empty menu shape, never null", async () => {
  const w = page(null);
  const menu = JSON.parse(JSON.stringify(await w.realm.browser.menuState("b1")));
  // BrowserPane.tsx spreads it; a null threw on every press of More (10/13).
  assert.deepEqual(menu, { zoom: 1, canZoomIn: false, canZoomOut: false, back: [], forward: [], blocked: [], saved: [], shareTargets: [] });
  assert.equal(typeof w.realm.browser.create, "function");
});
