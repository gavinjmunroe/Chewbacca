/**
 * A `const` READ ABOVE ITS OWN DECLARATION IS A PRODUCTION 500, AND IT BUILDS
 * GREEN.
 *
 *   node scripts/tdz-check.mjs
 *
 * WHAT HAPPENED. The projects branch of /v1/org/memory/import was inserted
 * above `const dryRun = ...` in the same function and passed `dryRun` through.
 * `const` is hoisted but left uninitialized until its declaration runs -- the
 * temporal dead zone -- so every projects upload threw
 *
 *   ReferenceError: Cannot access 'dryRun' before initialization
 *
 * and the dropzone said "Something went wrong on our end." Nothing caught it:
 * the syntax is valid, the module imports, the server boots, every route
 * registers, 2332 tests pass. It only fires when that one branch is taken,
 * which no test took.
 *
 * THIS IS THE SAME SHAPE AS local-binding-check.mjs -- a name that is in scope
 * and still unreadable, failing at call time rather than at load time -- so it
 * sits beside it and runs in the same breath.
 *
 * THE RULE, which is exact rather than heuristic: within one scope, a
 * reference to a `let`/`const`/`class` binding that appears textually before
 * that binding's declaration is a TDZ throw, unless it sits inside a nested
 * function (which runs later, by which time the declaration has run). So the
 * walk flags a reference only when no function boundary separates it from the
 * declaring scope.
 *
 * WHAT IT DELIBERATELY DOES NOT FLAG. `var` and function declarations, which
 * really do hoist. Shadowed names, which resolve to the inner binding. And
 * anything inside a nested function, which is the ordinary mutual-recursion
 * case and not a bug.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const acorn = require("acorn");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const ROOTS = ["src"];

function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

const isFunction = (n) =>
  n.type === "FunctionDeclaration" ||
  n.type === "FunctionExpression" ||
  n.type === "ArrowFunctionExpression";

const opensBlockScope = (n) =>
  n.type === "BlockStatement" ||
  n.type === "Program" ||
  n.type === "ForStatement" ||
  n.type === "ForOfStatement" ||
  n.type === "ForInStatement" ||
  n.type === "SwitchStatement" ||
  n.type === "StaticBlock" ||
  n.type === "ClassBody";

/** Every name a binding pattern introduces. */
function patternNames(node, out = []) {
  if (!node) return out;
  switch (node.type) {
    case "Identifier":
      out.push(node);
      break;
    case "ObjectPattern":
      for (const p of node.properties) {
        if (p.type === "RestElement") patternNames(p.argument, out);
        else patternNames(p.value, out);
      }
      break;
    case "ArrayPattern":
      for (const el of node.elements) patternNames(el, out);
      break;
    case "AssignmentPattern":
      patternNames(node.left, out);
      break;
    case "RestElement":
      patternNames(node.argument, out);
      break;
    default:
      break;
  }
  return out;
}

function childNodes(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const v of value) if (v && typeof v.type === "string") out.push(v);
    } else if (value && typeof value.type === "string") {
      out.push(value);
    }
  }
  return out;
}

/**
 * Collect the let/const/class bindings a scope owns, WITHOUT descending into
 * nested scopes -- a `const` inside an inner block belongs to that block.
 */
function declarationsIn(scopeNode) {
  const found = new Map();
  const visit = (node, top) => {
    if (!top && (isFunction(node) || opensBlockScope(node))) return;
    if (node.type === "VariableDeclaration" && node.kind !== "var") {
      for (const d of node.declarations) {
        for (const id of patternNames(d.id)) {
          if (!found.has(id.name)) found.set(id.name, node.start);
        }
      }
    }
    if (node.type === "ClassDeclaration" && node.id) {
      if (!found.has(node.id.name)) found.set(node.id.name, node.start);
    }
    for (const c of childNodes(node)) visit(c, false);
  };
  visit(scopeNode, true);
  return found;
}

/** Identifiers that name something rather than read it. */
function nonReferenceIds(node) {
  const skip = new Set();
  if ((node.type === "MemberExpression" || node.type === "OptionalMemberExpression") && !node.computed)
    skip.add(node.property);
  if (node.type === "Property" && !node.computed) skip.add(node.key);
  if (node.type === "PropertyDefinition" && !node.computed) skip.add(node.key);
  if (node.type === "MethodDefinition" && !node.computed) skip.add(node.key);
  if (node.type === "VariableDeclarator") for (const id of patternNames(node.id)) skip.add(id);
  if (isFunction(node)) {
    if (node.id) skip.add(node.id);
    for (const p of node.params) for (const id of patternNames(p)) skip.add(id);
  }
  if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    if (node.id) skip.add(node.id);
  }
  if (node.type === "CatchClause" && node.param)
    for (const id of patternNames(node.param)) skip.add(id);
  if (node.type === "ImportSpecifier") skip.add(node.imported);
  if (node.type === "ExportSpecifier") {
    skip.add(node.local);
    skip.add(node.exported);
  }
  if (node.type === "LabeledStatement") skip.add(node.label);
  if (node.type === "BreakStatement" || node.type === "ContinueStatement") {
    if (node.label) skip.add(node.label);
  }
  return skip;
}

function checkFile(file) {
  const src = readFileSync(file, "utf8");
  let ast;
  try {
    ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "module", locations: true });
  } catch (err) {
    return [{ file, line: err.loc?.line ?? 0, name: "(parse)", note: err.message }];
  }

  const hits = [];

  /**
   * scopes: innermost-first. Each is { decls, fnDepth } -- fnDepth counts the
   * function boundaries crossed, so a reference can tell whether it is in the
   * same straight-line run as the declaration or merely closes over it.
   */
  const visit = (node, scopes, fnDepth) => {
    let nextScopes = scopes;
    if (isFunction(node) || opensBlockScope(node)) {
      const owned = declarationsIn(node);
      // Parameters shadow outer bindings for the whole function body.
      const shadowed = new Set();
      if (isFunction(node)) for (const p of node.params) for (const id of patternNames(p)) shadowed.add(id.name);
      nextScopes = [{ decls: owned, shadowed, fnDepth: isFunction(node) ? fnDepth + 1 : fnDepth }, ...scopes];
    }

    const skip = nonReferenceIds(node);

    for (const child of childNodes(node)) {
      if (child.type === "Identifier" && !skip.has(child)) {
        for (const scope of nextScopes) {
          if (scope.shadowed?.has(child.name)) break;
          const at = scope.decls.get(child.name);
          if (at === undefined) continue;
          // Same straight-line run, and textually above the declaration.
          const sameRun = scope.fnDepth === (isFunction(node) ? fnDepth + 1 : fnDepth);
          if (sameRun && child.start < at) {
            hits.push({
              file,
              line: child.loc.start.line,
              name: child.name,
              note: `read before its declaration (line ${src.slice(0, at).split("\n").length})`,
            });
          }
          break;
        }
      }
      visit(child, nextScopes, isFunction(node) ? fnDepth + 1 : fnDepth);
    }
  };

  visit(ast, [], 0);
  return hits;
}

const files = ROOTS.flatMap((r) => walkFiles(join(ROOT, r)));
const all = files.flatMap(checkFile);

if (all.length) {
  for (const h of all) {
    console.error(`${relative(ROOT, h.file)}:${h.line}  ${h.name} — ${h.note}`);
  }
  console.error(`\nTEMPORAL DEAD ZONE: ${all.length} reference(s) above their declaration.`);
  console.error("These throw at call time, not at load time. The module boots clean and the route 500s.");
  process.exit(1);
}

console.log(`no reads above their declaration in ${files.length} files`);
