#!/usr/bin/env node
// Inventory every ts-rest contract in Clay's public frontend bundle and write
// library/clay-api/contracts.json, marking which ones `chewbacca clay` already
// calls. The bundle is parsed with acorn and never executed.
//
//   node tools/clay_contracts.mjs <dir with the downloaded chunks> [clay_version]
//
// Fetch the chunks first: GET https://app.clay.com/, take every assets/*.js the
// page names, save them into one empty directory. On 2026-10-16 the contracts
// lived in store-*.js and app-*.js (the same 1,787 objects in each).
//
// REA's analyze_javascript_application parsed store-Dl8q1Mai.js on 2026-10-16
// (3.97M AST nodes, no parse failure) but timed out at 300 s under load 29 and
// its request extraction covers fetch and WebSocket, not ts-rest contract
// objects, so the contracts come from this walk instead.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(ROOT, "library", "clay-api");
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function str(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string")
    return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0].value.cooked;
  return null;
}

function keyName(prop) {
  if (prop.type !== "Property" || prop.computed) return null;
  return prop.key.type === "Identifier" ? prop.key.name : str(prop.key);
}

function propMap(obj) {
  const m = {};
  for (const p of obj.properties) {
    const k = keyName(p);
    if (k) m[k] = p.value;
  }
  return m;
}

// The keys of a zod object call like P({workspaceId:Vg,tableId:I()}).
function zodKeys(node) {
  if (
    node &&
    node.type === "CallExpression" &&
    node.arguments[0]?.type === "ObjectExpression"
  ) {
    return node.arguments[0].properties.map(keyName).filter(Boolean);
  }
  return null;
}

function symbol(node, src) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  const text = src.slice(node.start, node.end);
  return text.length > 120 ? text.slice(0, 117) + "..." : text;
}

function walk(node, visit, parent) {
  if (!node || typeof node.type !== "string") return;
  visit(node, parent);
  for (const key in node) {
    if (key === "type" || key === "start" || key === "end") continue;
    const v = node[key];
    if (Array.isArray(v)) for (const c of v) walk(c, visit, node);
    else if (v && typeof v.type === "string") walk(v, visit, node);
  }
}

function contractsOf(file, src) {
  const ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "module" });
  // acorn counts UTF-16 units; offsets are written as code points so a Python
  // reader indexes the same character (app-3TgCQQBH.js drifts by 4 to 5 by
  // offset 2,000,000 from emoji earlier in the file).
  const highs = [];
  for (let i = 0; i < src.length; i++) {
    const u = src.charCodeAt(i);
    if (u >= 0xd800 && u <= 0xdbff) highs.push(i);
  }
  const codePoint = (at) => {
    let lo = 0;
    let hi = highs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (highs[mid] < at) lo = mid + 1;
      else hi = mid;
    }
    return at - lo;
  };
  const found = new Map(); // ObjectExpression node -> record
  const byVar = new Map(); // variable name -> record
  const inits = new Map(); // variable name -> initializer, null when declared twice
  walk(ast, (node, parent) => {
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier") {
      inits.set(node.id.name, inits.has(node.id.name) ? null : node.init);
    }
    if (node.type !== "ObjectExpression") return;
    const m = propMap(node);
    const method = str(m.method);
    const path = str(m.path);
    if (
      !method ||
      !METHODS.has(method) ||
      path === null ||
      !path.startsWith("/")
    )
      return;
    const rec = {
      names: new Set(),
      variable:
        parent?.type === "VariableDeclarator" && parent.id.type === "Identifier"
          ? parent.id.name
          : null,
      method,
      path,
      summary: str(m.summary),
      path_params: zodKeys(m.pathParams),
      query: m.query ? (zodKeys(m.query) ?? symbol(m.query, src)) : null,
      body: m.body ? symbol(m.body, src) : null,
      team:
        m.metadata?.type === "ObjectExpression"
          ? symbol(propMap(m.metadata).team, src)
          : null,
      file,
      offset: codePoint(node.start),
    };
    rec.query_node = m.query;
    rec.body_node = m.body;
    found.set(node, rec);
    if (rec.variable) byVar.set(rec.variable, rec);
  });
  // A query or body named by a variable: the keys of the zod object it holds,
  // when it is declared once and is a plain P({...}) call.
  // Follows aliases (xXt=GA) and .extend({...}) a few hops, since the bundle
  // reuses one schema under several names: getRecentRealtimeCreditUsageByRun's
  // query is xXt=GA=M({days}) in app-3TgCQQBH.js.
  const keysOf = (n, hops = 0) => {
    if (!n || hops > 6) return null;
    if (n.type === "Identifier") return keysOf(inits.get(n.name), hops + 1);
    const direct = zodKeys(n);
    if (direct) return direct;
    const callee = n.type === "CallExpression" ? n.callee : null;
    if (callee?.type === "MemberExpression" && !callee.computed) {
      const method = callee.property.name;
      if (method === "extend") {
        const base = keysOf(callee.object, hops + 1);
        const more =
          n.arguments[0]?.type === "ObjectExpression"
            ? n.arguments[0].properties.map(keyName).filter(Boolean)
            : null;
        return base && more ? [...base, ...more] : null;
      }
      if (
        [
          "optional",
          "partial",
          "strict",
          "passthrough",
          "nullable",
          "default",
        ].includes(method)
      ) {
        return keysOf(callee.object, hops + 1);
      }
    }
    return null;
  };
  for (const rec of found.values()) {
    if (!Array.isArray(rec.query) && rec.query_node)
      rec.query_keys = keysOf(rec.query_node);
    if (rec.body_node) rec.body_keys = keysOf(rec.body_node);
    delete rec.query_node;
    delete rec.body_node;
  }
  // Name each contract by the router key that points at it, inline or by variable.
  walk(ast, (node) => {
    if (node.type !== "Property") return;
    const k = keyName(node);
    if (!k) return;
    const v = node.value;
    if (found.has(v)) found.get(v).names.add(k);
    else if (v.type === "Identifier" && byVar.has(v.name))
      byVar.get(v.name).names.add(k);
  });
  return [...found.values()];
}

// A spec request URL path matches a contract path when every literal segment
// is equal and every :param segment is present.
export function matches(template, path) {
  const t = template.replace(/\/+$/, "").split("/");
  const p = path.replace(/\/+$/, "").split("/");
  return (
    t.length === p.length &&
    t.every((seg, i) => (seg.startsWith(":") ? p[i] !== "" : seg === p[i]))
  );
}

function coverage(contracts) {
  const reg = JSON.parse(readFileSync(join(LIB, "registry.json"), "utf8"));
  const spec = JSON.parse(readFileSync(join(LIB, "clay.json"), "utf8"));
  const specOps = Object.fromEntries(spec.operations.map((o) => [o.name, o]));
  const cover = new Map(contracts.map((c) => [c, new Set()]));
  const add = (c, opName) => cover.get(c).add(opName);
  for (const op of reg.ops) {
    for (const s of op.surfaces) {
      if (s.type !== "api-anything" || !specOps[s.op]) continue;
      const req = specOps[s.op].request;
      const url = new URL(req.url);
      const path = url.pathname.replace(/^\/v3/, "");
      const hits = contracts.filter(
        (c) => c.method === req.method && matches(c.path, path),
      );
      // More literal segments wins: /tables/:tableId/count over /tables/:tableId/:x.
      const lit = (c) =>
        c.path.split("/").filter((x) => x && !x.startsWith(":")).length;
      const best = Math.max(-1, ...hits.map(lit));
      for (const c of hits.filter((h) => lit(h) === best)) add(c, op.name);
    }
    const named = op.evidence?.contract;
    if (named)
      for (const c of contracts) if (c.names.includes(named)) add(c, op.name);
  }
  return cover;
}

function main() {
  const dir = process.argv[2];
  const version = process.argv[3] ?? null;
  if (!dir) {
    process.stderr.write(
      "usage: node tools/clay_contracts.mjs <bundle dir> [clay_version]\n",
    );
    process.exit(2);
  }
  const files = [];
  const merged = new Map();
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".js"))
    .sort()) {
    const buf = readFileSync(join(dir, f));
    const src = buf.toString("utf8");
    if (!/method:[`"'](GET|POST|PUT|PATCH|DELETE)[`"'],path:/.test(src))
      continue;
    const found = contractsOf(f, src);
    files.push({
      file: f,
      sha256: createHash("sha256").update(buf).digest("hex"),
      contracts: found.length,
    });
    for (const c of found) {
      const names = [...c.names].sort();
      const key = `${c.method} ${c.path} ${names.join(",") || c.variable}`;
      if (merged.has(key)) merged.get(key).seen_in.push(f);
      else merged.set(key, { ...c, names, seen_in: [f] });
    }
  }
  const contracts = [...merged.values()].sort(
    (a, b) =>
      (a.names[0] ?? "~").localeCompare(b.names[0] ?? "~") ||
      a.path.localeCompare(b.path) ||
      a.method.localeCompare(b.method),
  );
  const cover = coverage(contracts);
  const out = {
    schema: "clay-contracts/1",
    clay_version: version,
    read_at: new Date().toISOString().slice(0, 10),
    base: "https://api.clay.com/v3",
    how: "node tools/clay_contracts.mjs <dir>: acorn parse of each chunk, every object literal with a method and a /path, named by the router key that holds it. covered_by lists the registry ops whose api-anything request matches the method and path, or whose evidence names the contract.",
    files,
    counts: {
      contracts: contracts.length,
      named: contracts.filter((c) => c.names.length).length,
      get: contracts.filter((c) => c.method === "GET").length,
      covered: contracts.filter((c) => cover.get(c).size).length,
    },
    contracts: contracts.map((c) => ({
      name: c.names[0] ?? null,
      ...(c.names.length > 1 ? { aliases: c.names.slice(1) } : {}),
      method: c.method,
      path: c.path,
      summary: c.summary,
      path_params: c.path_params,
      query: c.query,
      ...(c.query_keys ? { query_keys: c.query_keys } : {}),
      body: c.body,
      ...(c.body_keys ? { body_keys: c.body_keys } : {}),
      team: c.team,
      file: c.seen_in[0],
      offset: c.file === c.seen_in[0] ? c.offset : null,
      covered_by: [...cover.get(c)].sort(),
    })),
  };
  // One contract per line, so a Clay deploy diffs as the contracts it changed.
  const { contracts: rows, ...head } = out;
  const text = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  const body = rows.map((r) => "  " + JSON.stringify(r)).join(",\n");
  writeFileSync(
    join(LIB, "contracts.json"),
    `${text},\n "contracts": [\n${body}\n ]\n}\n`,
  );
  process.stdout.write(
    JSON.stringify({ ok: true, files, counts: out.counts }) + "\n",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
