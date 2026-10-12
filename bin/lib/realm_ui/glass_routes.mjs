// The glass's own routes on the realm-ui server: what our layer on Carlton
// Aikins' Realm renderer (github.com/31Carlton7/realm) needs that his engine
// does not offer, and the one way hud-listen talks to the page.
//
//   GET  /glass/events   the page's stream of voice lines (newline JSON)
//   POST /glass/focus    the page says which agent has the glass, and whether it is shown
//   GET  /glass/focus    hud-listen asks the same
//   POST /glass/voice    hud-listen hands a sentence to the page that has the glass
//   GET  /glass/file     one text file under $HOME, read only, for the stage's file view
//   GET  /glass/tabs     what each tile's Claude Code tab is really doing (tab_truth.mjs)
//   GET  /glass/folders  checkouts a new agent can start in, or one typed path checked (folders.mjs)
//   POST /glass/reject   put one hunk back, on a press: `git apply -R` of exactly that hunk
//
// Every route needs the pipe's own token in `X-Glass-Token` (the one in the
// 0600 server.json, which the HUD hands the page and hud-listen reads), and
// server.mjs has already refused any request whose Host is not this server.
// A request carrying an Origin must carry this server's. Stdlib only.
import { readFileSync, statSync, realpathSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { idsFrom, tabTruth, transcriptFinder } from "./tab_truth.mjs";
import { checkFolder, listFolders } from "./folders.mjs";

// A file the stage will read. The stage shows a window of lines around a
// change, so a file past this is one no person reads on the glass anyway.
// Guessed from the largest source file in this kit (hud-listen, 180 KB).
export const MAX_FILE_BYTES = 512 * 1024;
// The largest request body accepted. A hunk is a few KB; guessed ceiling.
export const MAX_BODY_BYTES = 256 * 1024;
// How old the page's last focus report may be and still take a sentence.
// The page reports on every change and every 20 s while shown; 45 s allows
// one missed beat. Guessed, never measured.
export const FOCUS_FRESH_MS = 45_000;

const same = (a, b) => {
  const x = Buffer.from(String(a ?? "")),
    y = Buffer.from(String(b ?? ""));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Whether `path` is a file under `home` (after symlinks), as an absolute path. */
export function underHome(path, home = homedir()) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0"))
    return null;
  let real;
  try {
    real = realpathSync(path);
  } catch {
    return null;
  }
  const root = realpathSync(home);
  return real === root || real.startsWith(root + sep) ? real : null;
}

// Files the stage never reads even under $HOME: keys, tokens and keychains.
// An agent may well edit a `.env`, but the stage shows a window of lines on a
// glass someone else can see, and a key on screen is worse than a missing view.
const SECRET_PATH = /(^|\/)(\.git|\.ssh|\.gnupg|\.aws|\.netrc|\.config\/gcloud|Library\/Keychains|\.chewbacca\/realm-ui\/server\.json|daemon\.json)(\/|$)|(^|\/)\.env(\.[^/]*)?$|\.(pem|key|p12|keychain-db)$/;

export function secretPath(path) {
  return SECRET_PATH.test(String(path));
}

/** Whether git tracks a place for this file: inside a work tree and not
 *  ignored. The stage shows files an agent is editing in a checkout, so this
 *  is the allowlist; an ignored file (a `.env`, a build output) is never shown. */
export function inCheckout(file, git = "git") {
  const dir = dirname(file);
  // Fails closed: only "true" from rev-parse, and only exit 1 (not ignored)
  // from check-ignore, let a file through. An error from either is a no.
  const inside = spawnSync(git, ["-C", dir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (inside.status !== 0 || String(inside.stdout).trim() !== "true") return false;
  const ignored = spawnSync(git, ["-C", dir, "check-ignore", "-q", file], { stdio: "ignore" });
  return ignored.status === 1;
}

/** A unified diff of one hunk, the way git writes it, for `git apply`. */
export function hunkPatch(path, hunk) {
  if (
    !path ||
    /(^|\/)\.\.(\/|$)/.test(path) ||
    isAbsolute(path) ||
    /[\0\n]/.test(path)
  ) {
    throw new Error("bad path");
  }
  const lines = Array.isArray(hunk?.lines) ? hunk.lines : [];
  const num = (v) => {
    if (!Number.isInteger(v) || v < 0) throw new Error("bad hunk");
    return v;
  };
  const body = lines.map((l) => {
    const text = String(l?.text ?? "");
    if (text.includes("\n")) throw new Error("bad hunk");
    if (l?.kind === "add") return `+${text}`;
    if (l?.kind === "del") return `-${text}`;
    if (l?.kind === "context") return ` ${text}`;
    if (l?.kind === "meta")
      return text.startsWith("\\") ? text : "\\ No newline at end of file";
    throw new Error("bad hunk");
  });
  if (!body.length) throw new Error("bad hunk");
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${num(hunk.oldStart)},${num(hunk.oldLines)} +${num(hunk.newStart)},${num(hunk.newLines)} @@`,
    ...body,
    "",
  ].join("\n");
}

/** Put one hunk back in the working tree. Checks first, so a hunk that no
 *  longer matches the file (the agent wrote again since) changes nothing. */
export function rejectHunk(
  { cwd, path, hunk },
  { home = homedir(), git = "git" } = {},
) {
  const dir = underHome(cwd, home);
  if (!dir || !statSync(dir).isDirectory())
    throw new Error("not a folder under your home");
  const top = execFileSync(git, ["-C", dir, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  const target = normalize(join(top, path));
  if (!target.startsWith(top + sep)) throw new Error("bad path");
  const patch = hunkPatch(path, hunk);
  const run = (args) =>
    execFileSync(git, ["-C", top, "apply", ...args], {
      input: patch,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  try {
    run(["--check", "-R", "-"]);
  } catch {
    throw new Error("that change is no longer in the file");
  }
  run(["-R", "-"]);
  return { ok: true, path };
}

/** The page's voice channel and focus, held in memory for this server's life. */
export function glassState() {
  return { focus: null, listeners: new Set(), find: null };
}

function readBody(req) {
  return new Promise((done, fail) => {
    const parts = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        fail(new Error("too big"));
        req.destroy();
        return;
      }
      parts.push(c);
    });
    req.on("end", () => {
      try {
        done(JSON.parse(Buffer.concat(parts).toString("utf8") || "{}"));
      } catch {
        fail(new Error("not json"));
      }
    });
    req.on("error", fail);
  });
}

const json = (res, status, body) =>
  res
    .writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    })
    .end(JSON.stringify(body));

/** Answer a /glass/ request. Returns false when the path is not ours. */
export function handleGlass(
  req,
  res,
  { path, url, token, origin, state, home = homedir(), now = Date.now },
) {
  if (!path.startsWith("/glass/")) return false;
  if (!same(req.headers["x-glass-token"], token)) {
    json(res, 403, { error: "token" });
    return true;
  }
  if (req.headers.origin !== undefined && req.headers.origin !== origin) {
    json(res, 403, { error: "origin" });
    return true;
  }
  const route = `${req.method} ${path}`;
  if (route === "GET /glass/events") {
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    });
    res.write(`${JSON.stringify({ type: "hello" })}\n`);
    const send = (msg) => res.write(`${JSON.stringify(msg)}\n`);
    state.listeners.add(send);
    req.on("close", () => state.listeners.delete(send));
    return true;
  }
  if (route === "GET /glass/focus") {
    const f = state.focus;
    json(
      res,
      200,
      f
        ? { ...f, age: now() - f.at, listening: state.listeners.size }
        : { shown: false, listening: state.listeners.size },
    );
    return true;
  }
  if (route === "GET /glass/tabs") {
    state.find ??= transcriptFinder(join(home, ".claude", "projects"));
    const at = now();
    const tabs = {};
    for (const id of idsFrom(url.searchParams.get("ids")))
      tabs[id] = tabTruth(id, state.find, { now: at });
    json(res, 200, { tabs });
    return true;
  }
  if (route === "GET /glass/folders") {
    const typed = url.searchParams.get("path");
    if (typed !== null) {
      const folder = checkFolder(typed, { home });
      return folder
        ? json(res, 200, { folder })
        : json(res, 404, { error: "not a git checkout under your home" }),
        true;
    }
    json(res, 200, { folders: listFolders({ home }) });
    return true;
  }
  if (route === "GET /glass/file") {
    const file = underHome(url.searchParams.get("path") ?? "", home);
    if (!file) return json(res, 404, { error: "not found" }), true;
    if (secretPath(file) || !inCheckout(file)) return json(res, 403, { error: "not shown" }), true;
    let st;
    try {
      st = statSync(file);
    } catch {
      return json(res, 404, { error: "not found" }), true;
    }
    if (!st.isFile() || st.size > MAX_FILE_BYTES)
      return json(res, 413, { error: "not shown" }), true;
    const buf = readFileSync(file);
    if (buf.includes(0)) return json(res, 415, { error: "binary" }), true;
    json(res, 200, {
      path: file,
      text: buf.toString("utf8"),
      mtime: st.mtimeMs,
    });
    return true;
  }
  if (req.method !== "POST") {
    json(res, 404, { error: "no route" });
    return true;
  }
  readBody(req).then(
    (body) => {
      if (path === "/glass/focus") {
        state.focus = {
          shown: Boolean(body.shown),
          sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
          title: typeof body.title === "string" ? body.title.slice(0, 200) : "",
          mode: body.mode === "work" ? "work" : "tiles",
          at: now(),
        };
        return json(res, 200, { ok: true });
      }
      if (path === "/glass/voice") {
        const text =
          typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
        const f = state.focus;
        if (!text) return json(res, 400, { error: "no text" });
        if (
          !f ||
          !f.shown ||
          now() - f.at > FOCUS_FRESH_MS ||
          state.listeners.size === 0
        ) {
          return json(res, 409, { error: "the agents glass isn't up" });
        }
        for (const send of state.listeners) send({ type: "voice", text });
        return json(res, 200, {
          ok: true,
          to: f.title,
          sessionId: f.sessionId,
          mode: f.mode,
        });
      }
      if (path === "/glass/reject") {
        try {
          return json(res, 200, rejectHunk(body, { home }));
        } catch (err) {
          return json(res, 409, { error: String(err?.message ?? err) });
        }
      }
      return json(res, 404, { error: "no route" });
    },
    (err) => json(res, 400, { error: String(err?.message ?? err) }),
  );
  return true;
}

