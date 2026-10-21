/**
 * NO SYNCHRONOUS CALLBACK READS A VALUE THAT DOES NOT EXIST YET.
 *
 * Run with:  node --experimental-strip-types scripts/tdz-check.mts
 *
 * THE BUG THIS EXISTS FOR TOOK THE WHOLE APP DOWN. `peopleHeaderStyle`'s
 * useAnimatedStyle worklet in app/(gated)/home.tsx multiplied the header's
 * opacity by a shared value declared thirty-five lines further down the same
 * component. useAnimatedStyle runs its worklet ONCE, synchronously, to produce
 * the first frame's style -- so the read happened during render, inside the
 * temporal dead zone, and threw:
 *
 *     ReferenceError: Cannot access 'chrome' before initialization
 *
 * That throw was in the gated layout, which is every screen, so the route error
 * boundary drew "This screen hit a snag" on every launch and the app could not
 * be opened.
 *
 * NEITHER EXISTING GATE COULD SEE IT.
 *
 *   `tsc --noEmit` was clean, and correctly so: TypeScript has no way to know
 *   when a callback runs, so a closure over a later `const` is legal to it.
 *
 *   `expo lint` exits silently without running in this environment (its
 *   resolver has an unbuilt native dependency), which is worse than not having
 *   it -- "no output" reads exactly like "no problems".
 *
 * So this walks the real TypeScript AST. It is deliberately narrow: it flags a
 * reference to a block-scoped binding that appears BEFORE that binding's
 * declaration, and only when the reference is somewhere that actually runs
 * during render --
 *
 *   directly in the function body (no intervening function at all), or
 *   inside a callback passed to one of the SYNCHRONOUS hooks below.
 *
 * A read inside useEffect, an event handler, a setTimeout or a .then is NOT
 * flagged: those run after render, by which time the binding exists, and
 * flagging them would produce noise that gets the whole check switched off.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['app', 'components', 'lib'];
const SKIP = new Set(['node_modules', '.expo', 'ios', 'android', 'dist', 'build']);

/**
 * Callbacks these invoke immediately, during render. useAnimatedStyle is the one
 * that bit; the rest are the same shape and would bite identically.
 */
const SYNCHRONOUS_CALLERS = new Set([
  'useAnimatedStyle',
  'useAnimatedProps',
  'useDerivedValue',
  'useAnimatedReaction',
  'useMemo',
  'useSyncExternalStore',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

type Offense = { file: string; line: number; name: string; declLine: number; where: string };
const offenses: Offense[] = [];

/** A scope: one function body or block, and the const/let it declares. */
type Scope = {
  decls: Map<string, number>; // name -> declaration start position
  /** How many function boundaries lie between this scope and the reference. */
  isFunction: boolean;
};

function check(file: string, source?: string, into: Offense[] = offenses): void {
  const src = source ?? readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);

  /**
   * Two passes per scope is not needed: a single walk that records declarations
   * as it meets them and checks references against scopes ALREADY populated
   * naturally reports only the before-declaration case, because a declaration
   * later in the same scope has not been recorded yet when the reference is
   * visited. But it would then miss the whole point -- so declarations are
   * collected for a scope up front, and references checked against positions.
   */
  const visit = (node: ts.Node, scopes: Scope[], syncDepth: number, fnDepth: number): void => {
    let nextScopes = scopes;
    let nextSync = syncDepth;
    let nextFn = fnDepth;

    const isFunctionLike =
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node);

    if (isFunctionLike || ts.isBlock(node) || ts.isSourceFile(node)) {
      const scope: Scope = { decls: new Map(), isFunction: isFunctionLike };
      // Collect the block-scoped declarations of THIS scope, without descending
      // into nested scopes (those get their own).
      const collect = (n: ts.Node): void => {
        if (n !== node && (ts.isBlock(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) ||
            ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n))) {
          return;
        }
        if (ts.isVariableStatement(n)) {
          const isBlockScoped =
            (n.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) !== 0;
          if (isBlockScoped) {
            for (const d of n.declarationList.declarations) {
              const bind = (name: ts.BindingName): void => {
                if (ts.isIdentifier(name)) scope.decls.set(name.text, d.getStart(sf));
                else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
                  for (const el of name.elements) {
                    if (ts.isBindingElement(el)) bind(el.name);
                  }
                }
              };
              bind(d.name);
            }
          }
        }
        n.forEachChild(collect);
      };
      node.forEachChild(collect);
      nextScopes = [...scopes, scope];
    }

    // Am I inside a callback that runs during render?
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : '';
      if (SYNCHRONOUS_CALLERS.has(callee)) nextSync = syncDepth + 1;
    }
    if (isFunctionLike) nextFn = fnDepth + 1;

    // A reference. Not a declaration name, not a property name, not a JSX attribute name.
    if (ts.isIdentifier(node) && isReference(node)) {
      // Walk outward for the nearest scope that declares it.
      for (let i = nextScopes.length - 1; i >= 0; i -= 1) {
        const declPos = nextScopes[i].decls.get(node.text);
        if (declPos === undefined) continue;
        if (node.getStart(sf) < declPos) {
          // WOULD IT ACTUALLY RUN DURING RENDER? Either the reference sits
          // directly in the declaring function's body (no function between it
          // and the declaration), or it sits inside a synchronous-hook callback.
          const functionsBetween = countFunctionsBetween(nextScopes, i, nextFn);
          const runsNow = functionsBetween === 0 || nextSync > 0;
          if (runsNow) {
            into.push({
              file: relative(ROOT, file),
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              name: node.text,
              declLine: sf.getLineAndCharacterOfPosition(declPos).line + 1,
              where: nextSync > 0 ? 'a callback that runs during render' : 'the function body',
            });
          }
        }
        break;
      }
    }

    node.forEachChild((child) => visit(child, nextScopes, nextSync, nextFn));
  };

  /**
   * How many function boundaries separate the reference from the scope that
   * declares the binding. Scope entries carry `isFunction`, so this is the count
   * of function scopes strictly inside the declaring one.
   */
  function countFunctionsBetween(scopes: Scope[], declIndex: number, _fnDepth: number): number {
    let n = 0;
    for (let i = declIndex + 1; i < scopes.length; i += 1) {
      if (scopes[i].isFunction) n += 1;
    }
    return n;
  }

  function isReference(id: ts.Identifier): boolean {
    const p = id.parent;
    if (!p) return false;
    if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
    if (ts.isPropertyAssignment(p) && p.name === id) return false;
    if (ts.isBindingElement(p) && p.propertyName === id) return false;
    if (ts.isVariableDeclaration(p) && p.name === id) return false;
    if (ts.isParameter(p) && p.name === id) return false;
    if (ts.isFunctionDeclaration(p) && p.name === id) return false;
    if (ts.isJsxAttribute(p) && p.name === id) return false;
    if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return false;
    if (ts.isTypeReferenceNode(p) || ts.isQualifiedName(p)) return false;
    if (ts.isMethodSignature(p) || ts.isPropertySignature(p)) return false;
    if (ts.isTypeParameterDeclaration(p)) return false;
    return true;
  }

  visit(sf, [], 0, 0);
}

// ── THE CHECKER CHECKS ITSELF FIRST ─────────────────────────────────────────
//
// A detector that has gone blind is worse than no detector, because it reports
// success. So before it says anything about the codebase it runs on two snippets
// whose answers are known: the exact shape of the crash, which must be caught,
// and the same read inside a useEffect, which must NOT be -- that is the false
// positive that would get this whole check switched off.

const BAD = `
import { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
export function Probe() {
  const style = useAnimatedStyle(() => ({ opacity: chrome.value }));
  const chrome = useSharedValue(1);
  return style;
}
`;

const GOOD = `
import { useEffect } from 'react';
import { useSharedValue, withTiming } from 'react-native-reanimated';
export function Probe() {
  useEffect(() => {
    chrome.value = withTiming(0);
  }, []);
  const chrome = useSharedValue(1);
  return null;
}
`;

const selfBad: Offense[] = [];
check('<self-test:bad>', BAD, selfBad);
const selfGood: Offense[] = [];
check('<self-test:good>', GOOD, selfGood);

if (selfBad.length !== 1 || selfGood.length !== 0) {
  console.error(
    'tdz-check is broken: its own self-test failed ' +
      `(expected 1 offense in the bad snippet and 0 in the good one, got ` +
      `${selfBad.length} and ${selfGood.length}).`,
  );
  process.exit(2);
}

const files = ROOTS.flatMap((r) => {
  try {
    return walk(join(ROOT, r));
  } catch {
    return [];
  }
});

for (const f of files) check(f);

if (offenses.length > 0) {
  console.error('Values read before they are declared, where the read happens during render:\n');
  for (const o of offenses) {
    console.error(
      `  ${o.file}:${o.line}  "${o.name}" is read in ${o.where}, ` +
        `but declared at line ${o.declLine}`,
    );
  }
  console.error(
    `\n${offenses.length} offense${offenses.length === 1 ? '' : 's'}. ` +
      'This throws "Cannot access X before initialization" at render time. ' +
      'See the note at the top of scripts/tdz-check.mts.',
  );
  process.exit(1);
}

console.log(`No render-time use-before-declaration in ${files.length} files.`);
