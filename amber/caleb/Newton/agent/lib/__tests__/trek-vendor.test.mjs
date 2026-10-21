// Smoke validation for the vendored Trek tree under Newton/trek.
//
// The standalone amber-organization/trek repo was imported into this
// monorepo so it could be archived/deleted upstream. Trek is not wired
// into the amber-agent runtime — the native travel implementation
// in Newton/agent/lib/tools/travel.js handles that.
//
// This test only verifies that the vendored tree still has its
// expected entry points and config files. It does not run Trek.
//
// If this test fails, somebody removed something from Newton/trek
// that we said we'd preserve. Either restore the file or update the
// expected list (and AMBER-HANDOFF.md) intentionally.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const trekRoot = path.resolve(__dirname, "../../../trek");

const expectedFiles = [
  "AMBER-HANDOFF.md",
  "README.md",
  "MCP.md",
  "LICENSE",
  "Dockerfile",
  "docker-compose.yml",
  "server/package.json",
  "server/tsconfig.json",
  "server/src/index.ts",
  "server/src/app.ts",
  "server/src/config.ts",
  "server/src/scheduler.ts",
  "server/src/websocket.ts",
  "server/src/mcp/index.ts",
  "server/src/mcp/tools.ts",
  "server/assets/airports.json",
  "client/package.json",
  "client/tsconfig.json",
  "client/vite.config.js",
  "client/index.html",
];

const expectedDirs = [
  "server/src/routes",
  "server/src/services",
  "server/src/mcp/tools",
  "server/src/db",
  "server/tests",
  "client/src",
  "client/tests",
  "wiki",
  "scripts",
  "charts",
];

test("Newton/trek tree exists", () => {
  assert.ok(
    fs.existsSync(trekRoot),
    `expected vendored Trek at ${trekRoot}`,
  );
});

test("Newton/trek expected files are preserved", () => {
  for (const rel of expectedFiles) {
    const full = path.join(trekRoot, rel);
    assert.ok(
      fs.existsSync(full) && fs.statSync(full).isFile(),
      `expected file Newton/trek/${rel}`,
    );
  }
});

test("Newton/trek expected directories are preserved", () => {
  for (const rel of expectedDirs) {
    const full = path.join(trekRoot, rel);
    assert.ok(
      fs.existsSync(full) && fs.statSync(full).isDirectory(),
      `expected directory Newton/trek/${rel}`,
    );
  }
});

test("Newton/trek server has its MCP tool definitions", () => {
  const toolsDir = path.join(trekRoot, "server/src/mcp/tools");
  const entries = fs.readdirSync(toolsDir).filter((f) => f.endsWith(".ts"));
  // Sanity floor — Trek ships ~18 tool modules; if we drop below 10
  // something has gone wrong with the vendor copy.
  assert.ok(
    entries.length >= 10,
    `expected at least 10 MCP tool files, found ${entries.length}`,
  );
});

test("Newton/trek package.jsons declare the right names", () => {
  const server = JSON.parse(
    fs.readFileSync(path.join(trekRoot, "server/package.json"), "utf8"),
  );
  const client = JSON.parse(
    fs.readFileSync(path.join(trekRoot, "client/package.json"), "utf8"),
  );
  assert.equal(server.name, "trek-server");
  assert.equal(client.name, "trek-client");
});

test("Newton/trek is not imported by amber-agent runtime", () => {
  // Tighten the boundary: nothing under Newton/agent should require
  // anything from Newton/trek. We grep agent source for the path.
  const agentRoot = path.resolve(__dirname, "../..");
  const offenders = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "__tests__") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && /\.(m?js|cjs|ts)$/.test(e.name)) {
        const txt = fs.readFileSync(full, "utf8");
        if (/Newton\/trek\//.test(txt) || /\.\.\/trek\//.test(txt)) {
          offenders.push(path.relative(agentRoot, full));
        }
      }
    }
  }
  walk(agentRoot);
  assert.deepEqual(
    offenders,
    [],
    `unexpected imports from Newton/trek in agent code: ${offenders.join(", ")}`,
  );
});
