/**
 * EVERY IMPORT POINTS AT A FILE THAT EXISTS, ONCE, AT THE TOP.
 *
 * Run with:  node --experimental-strip-types scripts/imports-check.mts
 *
 * WHY THIS IS A SEPARATE SCRIPT. `eslint-plugin-import` owns ten rules in this
 * project's config and all ten are dark in the agent's shell, because the
 * plugin's resolver (unrs-resolver) loads a native binary and the installed one
 * is darwin-arm64 while that shell is Linux. scripts/eslint-core.cjs names the
 * ten it skips every time it runs; this covers the three that actually catch
 * things, using the filesystem instead of a native module:
 *
 *   import/no-unresolved   a relative or `@/` import whose file is not there.
 *                          This is the one that matters, because it is the only
 *                          failure in the whole lint config that is FATAL AT
 *                          LAUNCH rather than cosmetic -- Metro throws
 *                          "Unable to resolve module" and the screen is blank.
 *   import/no-duplicates   two import statements from the same module. Harmless
 *                          to run, but it hid for a while in contactsSummary.ts
 *                          (`useEffect` and `useSyncExternalStore` imported
 *                          from 'react' on consecutive lines) and it is exactly
 *                          the kind of thing that appears when two people edit
 *                          the same header.
 *   import/first           an import below real code. Bundlers hoist it anyway,
 *                          so it reads as a dependency introduced mid-file when
 *                          it is not.
 *
 * The seven it does NOT cover -- no-unresolved for BARE package specifiers, and
 * named/namespace/default/export/no-named-as-default(-member)/order -- need
 * either node_modules resolution semantics or a whole module graph. Those stay
 * with the real eslint run on the Mac, and eslint-core prints their names so the
 * gap is a stated fact rather than something to be rediscovered.
 *
 * WHY THE AST AND NOT A REGEX. `const s = "import x from 'y'"` is a string, a
 * doc comment mentioning an import is prose, and `import('./x')` is a call
 * expression with its own rules. TypeScript's own parser knows the difference.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ROOTS = ['app', 'components', 'lib'];
const SKIP = new Set(['node_modules', '.expo', 'dist', 'build', 'ios', 'android', '_archive', '_to_delete']);

/**
 * What Metro will try when a specifier has no extension. Order matters only for
 * reporting; existence is all we assert.
 */
const EXTENSIONS = [
  '',
  '.ts',
  '.tsx',
  '.mts',
  '.d.ts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.native.ts',
  '.native.tsx',
  '.ios.ts',
  '.ios.tsx',
  '.web.ts',
  '.web.tsx',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

type Offense = { file: string; line: number; rule: string; message: string };

/**
 * Does `spec`, written inside `fromFile`, land on something real?
 *
 * `existsSync` on a directory is not enough -- a folder import needs an
 * index file -- and an asset import (`./logo.png`) has to hit the exact name.
 */
function resolves(fromFile: string, spec: string, exists = existsSync): boolean {
  const base = spec.startsWith('@/') ? join(ROOT, spec.slice(2)) : resolve(dirname(fromFile), spec);
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (ext === '' ) {
      // A bare hit only counts as a file, never as a directory: a directory
      // needs one of the index candidates below.
      if (exists(candidate) && !isDir(candidate, exists)) return true;
      continue;
    }
    if (exists(candidate)) return true;
  }
  for (const ext of EXTENSIONS.slice(1)) {
    if (exists(join(base, `index${ext}`))) return true;
  }
  return false;
}

function isDir(p: string, exists: (s: string) => boolean): boolean {
  if (exists !== existsSync) return false; // injected fs in the self-test: names only
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** A relative or alias specifier, i.e. one we can check without node_modules. */
function isLocal(spec: string): boolean {
  return spec.startsWith('.') || spec.startsWith('@/');
}

function check(
  file: string,
  src: string,
  out: Offense[],
  exists: (p: string) => boolean = existsSync,
): void {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const rel = file.startsWith(ROOT) ? relative(ROOT, file) : file;
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  // import/first — the position of the first statement that is not an import,
  // not a directive prologue ('use strict'), and not an `export … from`.
  let firstNonImport: ts.Statement | null = null;
  // import/no-duplicates — module specifier -> first line we saw it on. Type-only
  // imports are tracked separately, which is what the rule does by default: a
  // `import type` and a value import from the same module are not duplicates.
  const seen = new Map<string, number>();

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const specNode = st.moduleSpecifier;
      if (!ts.isStringLiteral(specNode)) continue;
      const spec = specNode.text;
      const line = lineOf(st.getStart(sf));

      if (firstNonImport) {
        out.push({
          file: rel,
          line,
          rule: 'import/first',
          message: `import of '${spec}' is below code at line ${lineOf(firstNonImport.getStart(sf))}.`,
        });
      }

      const typeOnly = st.importClause?.isTypeOnly === true;
      // A side-effect import (`import './polyfill'`) is not a duplicate of a
      // binding import from the same module; it is doing a different job.
      const sideEffect = st.importClause === undefined;
      if (!sideEffect) {
        const key = `${typeOnly ? 'type:' : 'value:'}${spec}`;
        const prev = seen.get(key);
        if (prev !== undefined) {
          out.push({
            file: rel,
            line,
            rule: 'import/no-duplicates',
            message: `'${spec}' imported again; it is already imported on line ${prev}. Merge the bindings.`,
          });
        } else {
          seen.set(key, line);
        }
      }

      if (isLocal(spec) && !resolves(file, spec, exists)) {
        out.push({
          file: rel,
          line,
          rule: 'import/no-unresolved',
          message: `'${spec}' does not resolve to a file. Metro fails at launch on this.`,
        });
      }
      continue;
    }

    // `export … from './x'` resolves like an import and breaks the same way.
    if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      const spec = st.moduleSpecifier.text;
      if (isLocal(spec) && !resolves(file, spec, exists)) {
        out.push({
          file: rel,
          line: lineOf(st.getStart(sf)),
          rule: 'import/no-unresolved',
          message: `re-export from '${spec}' does not resolve to a file.`,
        });
      }
      continue;
    }

    // A directive prologue is not code.
    if (
      ts.isExpressionStatement(st) &&
      ts.isStringLiteral(st.expression) &&
      firstNonImport === null &&
      out.length === 0
    ) {
      continue;
    }

    if (firstNonImport === null) firstNonImport = st;
  }

  // `require('./x')` and dynamic `import('./x')` resolve too, and a broken one
  // is just as fatal -- later, and harder to find.
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const isDynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const arg = node.arguments[0];
      if ((isRequire || isDynamic) && arg && ts.isStringLiteral(arg) && isLocal(arg.text)) {
        if (!resolves(file, arg.text, exists)) {
          out.push({
            file: rel,
            line: lineOf(node.getStart(sf)),
            rule: 'import/no-unresolved',
            message: `${isRequire ? 'require' : 'import'}('${arg.text}') does not resolve to a file.`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}

// ── self-test ────────────────────────────────────────────────────────────────
// A detector that has gone blind is worse than no detector, because it reads as
// a pass. So it proves it can still see, on every run, before it looks at
// anything real.

const FAKE_FS = new Set([
  '/fake/there.ts',
  '/fake/folder/index.tsx',
  '/fake/logo.png',
  join(ROOT, 'lib/aliased.ts'),
]);
const fakeExists = (p: string) => FAKE_FS.has(p);

const BAD = `
import { a } from './there';
import { b } from './missing';
import { c } from './folder';
import png from './logo.png';
import { d } from '@/lib/aliased';
import { e } from '@/lib/nope';
const x = 1;
import { f } from './there2';
import { g } from './there';
`;

const GOOD = `
import { a } from './there';
import type { T } from './there';
import './there';
import { c } from './folder';
import png from './logo.png';
import { d } from '@/lib/aliased';
import { pkg } from 'expo-router';
const x = 1;
export { x };
`;

const bad: Offense[] = [];
check('/fake/probe.tsx', BAD, bad, fakeExists);
const good: Offense[] = [];
check('/fake/probe.tsx', GOOD, good, fakeExists);

const badByRule = (r: string) => bad.filter((o) => o.rule === r).length;
const expected = { 'import/no-unresolved': 3, 'import/first': 2, 'import/no-duplicates': 1 };
const mismatch =
  good.length !== 0 ||
  Object.entries(expected).some(([r, n]) => badByRule(r) !== n);

if (mismatch) {
  console.error('imports-check is broken: its own self-test failed.');
  console.error(`  good snippet: expected 0 offenses, got ${good.length}`);
  for (const o of good) console.error(`    unexpected: ${o.rule} line ${o.line} — ${o.message}`);
  for (const [r, n] of Object.entries(expected)) {
    if (badByRule(r) !== n) console.error(`  bad snippet: expected ${n} ${r}, got ${badByRule(r)}`);
  }
  for (const o of bad) console.error(`    saw: ${o.rule} line ${o.line} — ${o.message}`);
  process.exit(2);
}

// ── the real run ─────────────────────────────────────────────────────────────

const offenses: Offense[] = [];
const files = ROOTS.flatMap((r) => {
  try {
    return walk(join(ROOT, r));
  } catch {
    return [];
  }
});

for (const f of files) check(f, readFileSync(f, 'utf8'), offenses);

if (offenses.length > 0) {
  console.error('Import problems:\n');
  for (const o of offenses) {
    console.error(`  ${o.file}:${o.line}  ${o.rule}  ${o.message}`);
  }
  console.error(
    `\n${offenses.length} problem${offenses.length === 1 ? '' : 's'}. ` +
      'See the note at the top of scripts/imports-check.mts.',
  );
  process.exit(1);
}

console.log(`Imports resolve, once, at the top, in ${files.length} files.`);
