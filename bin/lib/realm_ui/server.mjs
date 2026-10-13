#!/usr/bin/env node
// Serves Realm's desktop renderer (Carlton Aikins, github.com/31Carlton7/realm)
// on 127.0.0.1 for the Chewbacca glass, and pipes its WebSocket to the realm
// engine Kyber already runs.
//
//   node server.mjs --dist <dir> --realm-home <dir> --state <file> [--port N]
//
// Why a pipe and not a direct dial: realm's RPC socket admits a browser only
// from the origins its own windows load from (`file://`, or the Vite dev
// server under `pnpm dev`; apps/server/src/app.ts allowedOrigins). A page on
// http://127.0.0.1:<port> is neither, so it is refused, which is right.
// Realm's Node clients (its main process, its CLI) send no Origin and are
// judged on the token alone, and this server is one of those.
//
// The pipe is the page's only way in, so it holds the same two locks realm
// does, for its own origin:
//   1. Origin must be exactly this server's origin, and Host must be this
//      server's address (a rebinding page sends its own name as Host).
//   2. The page must offer `realm.<token>`, where <token> is minted at every
//      start of this server and written only to the 0600 state file. Nothing
//      here serves it: the HUD reads that file and hands it to its own web
//      view before the page runs (AppPane.swift), so another local account
//      that can reach this port still cannot learn it. The engine's own token
//      (daemon.json) stays here and is never sent to the page.
// After the handshake the bytes are piped untouched: realm's frames, realm's
// permessage-deflate, realm's close. Nothing here parses or acts on them.
//
// Stdlib only, so a fresh Mac needs nothing beyond the node realm already uses.
import { createServer } from "node:http";
import { connect } from "node:net";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { join, resolve, extname, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { glassState, handleGlass } from "./glass_routes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
};

// How long the engine has to answer the forwarded handshake. Realm answers a
// local upgrade in a few milliseconds; 10 s is a guess, never measured, that
// covers an engine still running its startup migrations.
const ENGINE_HANDSHAKE_MS = 10_000;
// The largest handshake response accepted from the engine before the pipe
// gives up. Realm's 101 is under 300 bytes; 16 KiB is a guessed ceiling.
const MAX_RESPONSE_HEAD = 16 * 1024;
// How long a launch code from `realm-ui open` stays good. The code rides in
// the URL `open` hands the default browser, so it must die fast and work once.
// 120 s is a guessed ceiling for a cold browser start on a slow Mac, never
// measured.
export const LAUNCH_CODE_TTL_MS = 120_000;
// Codes alive at once. `open` mints one per call; 16 is a guess that still
// caps what a loop of mints can hold in memory.
const MAX_LAUNCH_CODES = 16;

export function parseArgs(argv) {
  const out = { port: 0 };
  for (let i = 0; i < argv.length; i++) {
    const [k, v] = [argv[i], argv[i + 1]];
    if (k === "--dist") {
      out.dist = v;
      i++;
    } else if (k === "--realm-home") {
      out.realmHome = v;
      i++;
    } else if (k === "--state") {
      out.state = v;
      i++;
    } else if (k === "--files-root") {
      out.filesRoot = v;
      i++;
    } else if (k === "--port") {
      out.port = Number(v);
      i++;
    }
  }
  return out;
}

/** The engine's port and token, read fresh on every dial: realm rewrites
 *  daemon.json when it restarts, and a pipe that cached them would dial a dead
 *  port until it was restarted too. */
export function readDaemon(realmHome) {
  const raw = JSON.parse(readFileSync(join(realmHome, "daemon.json"), "utf8"));
  if (
    !Number.isInteger(raw.port) ||
    typeof raw.token !== "string" ||
    raw.token === ""
  ) {
    throw new Error("daemon.json has no port or token");
  }
  return { port: raw.port, token: raw.token };
}

const same = (a, b) => {
  const x = Buffer.from(String(a)),
    y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The handshake checks, separate from the socket so the tests can drive them. */
export function admit(headers, { origin, host, token }) {
  if (headers.host !== host) return "host";
  if (headers.origin !== origin) return "origin";
  const offered = String(headers["sec-websocket-protocol"] ?? "")
    .split(",")
    .map((p) => p.trim());
  if (!offered.some((p) => same(p, `realm.${token}`))) return "token";
  if (String(headers.upgrade ?? "").toLowerCase() !== "websocket")
    return "upgrade";
  return null;
}

/** The request realm sees: its own token, its own Host, and no Origin, the way
 *  realm's main process and CLI dial it. */
export function engineRequest(headers, enginePort, engineToken) {
  const lines = [
    "GET / HTTP/1.1",
    `Host: ${HOST}:${enginePort}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${headers["sec-websocket-key"]}`,
    `Sec-WebSocket-Version: ${headers["sec-websocket-version"] ?? "13"}`,
    `Sec-WebSocket-Protocol: realm.${engineToken}`,
  ];
  if (headers["sec-websocket-extensions"])
    lines.push(
      `Sec-WebSocket-Extensions: ${headers["sec-websocket-extensions"]}`,
    );
  return lines.join("\r\n") + "\r\n\r\n";
}

/** The engine's 101, with the protocol it chose (its own token) swapped for
 *  the one the page offered. A browser fails a handshake whose answer names a
 *  protocol it never offered, and the engine token must not reach the page. */
export function pageResponse(head, pageToken) {
  return head
    .split("\r\n")
    .map((line) =>
      /^sec-websocket-protocol:/i.test(line)
        ? `Sec-WebSocket-Protocol: realm.${pageToken}`
        : line,
    )
    .join("\r\n");
}

/** One-time launch codes for a page with no Kyber to hand it the token.
 *
 *  The HUD's web view sets window.__realmUiToken before the page runs. A
 *  plain browser tab has nothing like that, so the page came up blank with
 *  "server token not provided to renderer" (stranger test, 10/12). `realm-ui
 *  open` reads the token from the 0600 state file, trades it here for a code
 *  that lives LAUNCH_CODE_TTL_MS and works once, and opens
 *  <origin>/#launch=<code>. The fragment never reaches a server or a log;
 *  bridge.js redeems it from this origin and strips it from the address bar.
 *  The long-lived token itself never rides a command line or a URL. */
export function launchCodes({ ttl = LAUNCH_CODE_TTL_MS, now = Date.now } = {}) {
  const codes = new Map();
  const sweep = () => {
    for (const [code, born] of codes) if (now() - born > ttl) codes.delete(code);
  };
  return {
    mint() {
      sweep();
      while (codes.size >= MAX_LAUNCH_CODES) codes.delete(codes.keys().next().value);
      const code = randomBytes(24).toString("base64url");
      codes.set(code, now());
      return code;
    },
    redeem(code) {
      sweep();
      if (typeof code !== "string" || !codes.has(code)) return false;
      codes.delete(code);
      return true;
    },
  };
}

function readBody(req, limit = 1024) {
  return new Promise((done) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) req.destroy();
    });
    req.on("end", () => done(body));
    req.on("error", () => done(""));
  });
}

/** POST /realm-launch/mint (the CLI, with the token) and
 *  POST /realm-launch/redeem (the page, same origin, with a code). */
function handleLaunch(req, res, { path, token, origin, launch }) {
  if (path !== "/realm-launch/mint" && path !== "/realm-launch/redeem") return false;
  const plain = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
  if (req.method !== "POST") {
    res.writeHead(405, plain).end();
    return true;
  }
  if (path === "/realm-launch/mint") {
    if (!same(req.headers["x-glass-token"] ?? "", token)) {
      res.writeHead(403, plain).end("token");
      return true;
    }
    res.writeHead(200, plain).end(launch.mint());
    return true;
  }
  // A page on another origin cannot redeem: a browser always sends its real
  // Origin on a POST, and a code is single-use either way.
  if (req.headers.origin !== origin) {
    res.writeHead(403, plain).end("origin");
    return true;
  }
  readBody(req).then((body) => {
    if (launch.redeem(body.trim())) res.writeHead(200, plain).end(token);
    else res.writeHead(403, plain).end("code");
  });
  return true;
}

function refuse(socket, status, why) {
  try {
    socket.end(
      `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\nX-Refused: ${why}\r\n\r\n`,
    );
  } catch {
    /* gone */
  }
}

export function start({
  dist,
  realmHome,
  state,
  port = 0,
  token = randomBytes(24).toString("base64url"),
  // Where the stage may read files and put hunks back: $HOME unless a test
  // or a scratch engine names another root.
  filesRoot,
}) {
  const root = resolve(dist);
  const bridgeSource = readFileSync(join(HERE, "bridge.js"), "utf8");
  let origin = "",
    hostHeader = "",
    bridge = "";
  // The glass layer's routes (glass_routes.mjs): voice, focus, the stage's
  // file view and a hunk put back. Same token as the pipe.
  const glass = glassState();
  const launch = launchCodes();

  const server = createServer((req, res) => {
    if (req.headers.host !== hostHeader) {
      res.writeHead(421).end();
      return;
    }
    let path;
    try {
      path = decodeURIComponent(new URL(req.url, origin).pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (handleLaunch(req, res, { path, token, origin, launch })) return;
    if (
      handleGlass(req, res, {
        path,
        url: new URL(req.url, origin),
        token,
        origin,
        state: glass,
        ...(filesRoot ? { home: filesRoot } : {}),
      })
    )
      return;
    if (path === "/realm-bridge.js") {
      res
        .writeHead(200, {
          "Content-Type": TYPES[".js"],
          "Cache-Control": "no-store",
        })
        .end(bridge);
      return;
    }
    let file = resolve(root, "." + path);
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(404).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory())
      file = join(root, "index.html");
    res
      .writeHead(200, {
        "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
        "Cache-Control": file.endsWith("index.html")
          ? "no-store"
          : "max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      })
      .end(readFileSync(file));
  });

  server.on("upgrade", (req, page, head) => {
    const why = admit(req.headers, { origin, host: hostHeader, token });
    if (why) {
      refuse(page, "403 Forbidden", why);
      return;
    }
    let daemon;
    try {
      daemon = readDaemon(realmHome);
    } catch {
      refuse(page, "502 Bad Gateway", "engine");
      return;
    }
    const engine = connect(daemon.port, HOST);
    const timer = setTimeout(() => {
      engine.destroy();
      refuse(page, "504 Gateway Timeout", "engine");
    }, ENGINE_HANDSHAKE_MS);
    let buffered = Buffer.alloc(0);
    const onData = (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf("\r\n\r\n");
      if (end < 0) {
        if (buffered.length > MAX_RESPONSE_HEAD) {
          engine.destroy();
          refuse(page, "502 Bad Gateway", "engine");
        }
        return;
      }
      clearTimeout(timer);
      engine.off("data", onData);
      const headText = buffered.subarray(0, end).toString("latin1");
      if (!/^HTTP\/1\.1 101/.test(headText)) {
        engine.destroy();
        refuse(page, "502 Bad Gateway", "engine");
        return;
      }
      page.write(pageResponse(headText, token) + "\r\n\r\n");
      const rest = buffered.subarray(end + 4);
      if (rest.length) page.write(rest);
      if (head?.length) engine.write(head);
      engine.pipe(page);
      page.pipe(engine);
    };
    engine.on("data", onData);
    engine.on("connect", () =>
      engine.write(engineRequest(req.headers, daemon.port, daemon.token)),
    );
    const close = () => {
      clearTimeout(timer);
      engine.destroy();
      page.destroy();
    };
    engine.on("error", close);
    page.on("error", close);
    engine.on("close", () => page.destroy());
    page.on("close", () => engine.destroy());
  });

  return new Promise((ready, fail) => {
    server.once("error", fail);
    server.listen(port, HOST, () => {
      const bound = server.address().port;
      origin = `http://${HOST}:${bound}`;
      hostHeader = `${HOST}:${bound}`;
      bridge = bridgeSource
        .replaceAll('"__REALM_UI_PORT__"', JSON.stringify(String(bound)))
        .replaceAll('"__REALM_HOME__"', JSON.stringify(realmHome));
      if (state) {
        const tmp = `${state}.tmp${process.pid}`;
        writeFileSync(
          tmp,
          JSON.stringify({
            pid: process.pid,
            port: bound,
            url: `${origin}/`,
            token,
            dist: root,
            started: new Date().toISOString(),
          }) + "\n",
          { mode: 0o600 },
        );
        renameSync(tmp, state);
      }
      ready({ server, port: bound, url: `${origin}/`, token });
    });
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dist || !args.realmHome) {
    console.error(
      "usage: server.mjs --dist <dir> --realm-home <dir> [--state <file>] [--port N]",
    );
    process.exit(2);
  }
  const { server, url } = await start(args);
  console.log(JSON.stringify({ ready: true, url }));
  const stop = () => {
    server.close();
    if (args.state) {
      try {
        if (JSON.parse(readFileSync(args.state, "utf8")).pid === process.pid)
          unlinkSync(args.state);
      } catch {
        /* gone */
      }
    }
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
