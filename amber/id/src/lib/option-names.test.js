/**
 * A MISSPELLED OPTION KEY IS SILENT, AND THE DEFAULT IS WHAT SHIPS.
 *
 * THE BUG THIS FOUND, already in main: dms.js asked signGcsUrl for an upload
 * URL with `expiresInSeconds: UPLOAD_TTL_SECONDS`. The parameter is
 * `expiresSeconds`. So the key landed in a rest-less destructure, went
 * nowhere, and every voice-message upload got the 300-second default instead
 * of the 600 the constant two lines above it specifies.
 *
 * NOTHING ANYWHERE SAYS SO. No error, no warning, no type. The upload works,
 * because 300 seconds is enough most of the time. It fails on a slow
 * connection, intermittently, in a way that looks like a network problem --
 * and the constant says 600, so the one place anybody would look to check the
 * window says the window is fine.
 *
 * That is the whole class. JavaScript destructuring turns a typo into a
 * default, and a default is a plausible value, so the failure is always
 * subtle and always somewhere else. The same shape cost two runs of the
 * pressure script in one evening: ownerAmberId for createdBy, which
 * createOrganization refused with the same message it gives for no argument
 * at all.
 *
 * SO THIS READS EVERY CALL and compares the keys passed against the keys the
 * function destructures. It is deliberately narrow -- same-repo imports,
 * object-literal arguments, top-level keys -- because the value of a check
 * like this is entirely in its false-positive rate. One noisy run and it
 * joins the list of tests people skip.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));

/** Blank comments without moving any line, so reported lines are real. */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".js") && !e.name.endsWith(".test.js")) out.push(full);
  }
  return out;
}

const cache = new Map();
function read(path) {
  if (!cache.has(path)) {
    try {
      cache.set(path, strip(readFileSync(path, "utf8")));
    } catch {
      cache.set(path, "");
    }
  }
  return cache.get(path);
}

/**
 * The option names a function accepts, or null when this check should not
 * have an opinion.
 *
 * THE KEY, NOT THE LOCAL. `function f({ value: incomingValue })` accepts
 * `value`; the caller never writes `incomingValue`. The first version of this
 * collected locals and reported two correct call sites in source-trust.js as
 * wrong -- which is exactly the noise that gets a check deleted, so it is
 * worth the extra branch.
 */
function optionNames(text, fn) {
  const m = text.match(
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${fn}\\s*\\(([\\s\\S]{0,800}?)\\)\\s*\\{`),
  );
  if (!m) return null;
  const decl = m[1].trim();

  /*
   * TWO SHAPES, because the one that cost two runs of the pressure script is
   * the second. `createOrganization(opts = {})` destructures in its BODY --
   * `const { name, createdBy } = opts;` -- so a check that only reads the
   * parameter list skips it entirely and the typo sails through. That is the
   * worse shape to miss: a function written this way is usually one with
   * enough options to be worth naming, which is the same reason it is easy
   * to get one wrong.
   */
  let first;
  if (decl.startsWith("{")) {
    if (/\.\.\./.test(decl)) return null;
    first = balanced(decl, 0);
  } else {
    const param = decl.match(/^(\w+)\s*(?:=\s*\{\s*\})?\s*$/);
    if (!param) return null;
    const body = text.slice(m.index + m[0].length);
    const end = body.search(/\nexport\s|\n\}/);
    const inner = (end < 0 ? body : body.slice(0, end)).match(
      new RegExp(`(?:const|let|var)\\s*(\\{[\\s\\S]{0,800}?\\})\\s*=\\s*${param[1]}\\b`),
    );
    if (!inner) return null;
    if (/\.\.\./.test(inner[1])) return null;
    first = inner[1];
  }
  const names = new Set();
  let depth = 0;
  for (let i = 0; i < first.length; i += 1) {
    const c = first[i];
    if ("({[".includes(c)) depth += 1;
    else if (")}]".includes(c)) depth -= 1;
    if (depth !== 1) continue;
    const k = first.slice(i).match(/^[{,]\s*(\w+)/);
    if (k) names.add(k[1]);
  }
  return names.size > 0 ? names : null;
}

/** From `from` to the matching close bracket. */
function balanced(s, from) {
  let d = 0;
  for (let i = from; i < s.length; i += 1) {
    const c = s[i];
    if ("({[".includes(c)) d += 1;
    else if (")}]".includes(c)) {
      d -= 1;
      if (d === 0) return s.slice(from, i + 1);
    }
  }
  return "";
}

/** Top-level keys of an object literal. */
function keysOf(obj) {
  const keys = [];
  let depth = 0;
  for (let i = 0; i < obj.length; i += 1) {
    const c = obj[i];
    if ("({[".includes(c)) depth += 1;
    else if (")}]".includes(c)) depth -= 1;
    if (depth !== 1) continue;
    const k = obj.slice(i).match(/^[{,]\s*(\w+)\s*[:,}]/);
    if (k) keys.push(k[1]);
  }
  return [...new Set(keys)];
}

test("every option passed by name is an option the function accepts", () => {
  const findings = [];

  for (const file of walk(join(ROOT, "src")).concat(walk(join(ROOT, "scripts")))) {
    const src = read(file);

    /*
     * Only same-repo relative imports. A package's signature is not in this
     * tree, and guessing at one is how a check starts being wrong about
     * correct code.
     */
    const origin = new Map();
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(\.[^"]+)"/g)) {
      for (const raw of m[1].split(",")) {
        const name = raw.trim().split(/\s+as\s+/).pop();
        if (name) origin.set(name, resolve(dirname(file), m[2]));
      }
    }

    for (const [fn, modPath] of origin) {
      let text = "";
      for (const candidate of [modPath, `${modPath}.js`, join(modPath, "index.js")]) {
        try {
          if (statSync(candidate).isFile()) {
            text = read(candidate);
            break;
          }
        } catch {
          /* try the next spelling */
        }
      }
      if (!text) continue;

      const accepts = optionNames(text, fn);
      if (!accepts) continue;

      for (const m of src.matchAll(new RegExp(`(?<![.\\w])${fn}\\s*\\(\\s*\\{`, "g"))) {
        const open = src.indexOf("{", m.index + m[0].length - 1);
        const line = src.slice(0, m.index).split("\n").length;
        for (const key of keysOf(balanced(src, open))) {
          if (!accepts.has(key)) {
            findings.push(
              `${file.slice(ROOT.length + 1)}:${line} ${fn}() has no option "${key}" ` +
                `— it is being dropped and the default used instead (accepts: ${[...accepts].join(", ")})`,
            );
          }
        }
      }
    }
  }

  assert.deepEqual(
    findings,
    [],
    "a key that does not match a parameter is silently discarded:\n  " + findings.join("\n  "),
  );
});
