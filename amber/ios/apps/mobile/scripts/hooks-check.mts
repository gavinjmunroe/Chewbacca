/**
 * HOOKS RUN IN THE SAME ORDER EVERY RENDER, OR THE SCREEN DIES.
 *
 * Run with:  node --experimental-strip-types scripts/hooks-check.mts
 *
 * The companion to tdz-check, and it exists for the same reason: `expo lint`
 * cannot run from the agent's side of this repo -- eslint's module resolver
 * loads a darwin-arm64 native binary and the agent's shell is a Linux VM with
 * the Mac's disk mounted -- so react-hooks/rules-of-hooks has never actually
 * been enforced on any change made from there. That rule catches the second of
 * the two classic ways to white-screen a React Native app:
 *
 *     Rendered fewer hooks than expected
 *     Rendered more hooks than during the previous render
 *
 * which React throws as an error, which a route error boundary renders as a
 * dead screen. Same visible outcome as the temporal-dead-zone crash: the app
 * cannot be opened.
 *
 * Two shapes are flagged, and they are the two that actually happen:
 *
 *   A HOOK INSIDE A CONDITION -- an `if`, a `? :`, an `&&`, a loop, a try. It
 *   runs on some renders and not others, so the order changes underneath React.
 *
 *   A HOOK AFTER AN EARLY RETURN -- `if (!data) return null;` followed by more
 *   hooks. The commonest version by far, because it looks like a guard clause
 *   and reads perfectly.
 *
 * Only inside components (a capitalised function) and custom hooks (a name
 * starting with `use`), because those are the only places the rule applies. A
 * hook in a plain nested callback is also invalid, but detecting it produces
 * enough noise about legitimate render-prop patterns to get a check switched
 * off, and it is not what breaks apps.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['app', 'components', 'lib'];
const SKIP = new Set(['node_modules', '.expo', 'ios', 'android', 'dist', 'build']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

type Offense = { file: string; line: number; hook: string; why: string };

const HOOK_RE = /^use[A-Z0-9]/;

function isHookCall(node: ts.Node): string | null {
  if (!ts.isCallExpression(node)) return null;
  const e = node.expression;
  const name = ts.isIdentifier(e)
    ? e.text
    : ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)
      ? e.name.text
      : '';
  return HOOK_RE.test(name) ? name : null;
}

/** A component (capitalised) or a custom hook (use…). Nothing else has the rule. */
function subjectName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    node.parent &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return node.parent.name.text;
  }
  // export default function () {…} — the route components in app/.
  if (ts.isFunctionDeclaration(node) && !node.name) return 'default';
  return null;
}

function appliesTo(name: string): boolean {
  return HOOK_RE.test(name) || /^[A-Z]/.test(name) || name === 'default';
}

function check(file: string, source?: string, into: Offense[] = []): Offense[] {
  const src = source ?? readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const visitFunction = (fn: ts.FunctionLikeDeclaration): void => {
    const body = fn.body;
    if (!body || !ts.isBlock(body)) return;

    // ── 1. hooks inside a condition, and hooks after an early return ─────────
    let returnedAtLine: number | null = null;

    const scan = (node: ts.Node, conditional: string | null): void => {
      // A nested function has its own hook rules; do not attribute its calls here.
      if (
        node !== fn &&
        (ts.isArrowFunction(node) ||
          ts.isFunctionExpression(node) ||
          ts.isFunctionDeclaration(node) ||
          ts.isMethodDeclaration(node))
      ) {
        return;
      }

      let nextConditional = conditional;
      if (ts.isIfStatement(node)) nextConditional = nextConditional ?? 'an if';
      else if (ts.isConditionalExpression(node)) nextConditional = nextConditional ?? 'a ternary';
      else if (
        ts.isBinaryExpression(node) &&
        (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
      ) {
        nextConditional = nextConditional ?? 'a short-circuit';
      } else if (
        ts.isForStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isWhileStatement(node) ||
        ts.isDoStatement(node)
      ) {
        nextConditional = nextConditional ?? 'a loop';
      } else if (ts.isTryStatement(node) || ts.isCatchClause(node)) {
        nextConditional = nextConditional ?? 'a try/catch';
      } else if (ts.isSwitchStatement(node)) {
        nextConditional = nextConditional ?? 'a switch';
      }

      const hook = isHookCall(node);
      if (hook) {
        if (nextConditional) {
          into.push({
            file: relative(ROOT, file),
            line: at(node),
            hook,
            why: `called inside ${nextConditional}, so it runs on some renders and not others`,
          });
        } else if (returnedAtLine !== null && at(node) > returnedAtLine) {
          into.push({
            file: relative(ROOT, file),
            line: at(node),
            hook,
            why: `called after the early return on line ${returnedAtLine}`,
          });
        }
      }

      node.forEachChild((c) => scan(c, nextConditional));
    };

    // The early returns that matter are the ones at the TOP level of the body:
    // a return inside a nested callback does not skip anything.
    for (const stmt of body.statements) {
      if (ts.isIfStatement(stmt)) {
        const hasReturn = (n: ts.Node): boolean => {
          if (ts.isReturnStatement(n)) return true;
          if (
            ts.isArrowFunction(n) ||
            ts.isFunctionExpression(n) ||
            ts.isFunctionDeclaration(n)
          ) {
            return false;
          }
          let found = false;
          n.forEachChild((c) => {
            if (hasReturn(c)) found = true;
          });
          return found;
        };
        if (hasReturn(stmt) && returnedAtLine === null) returnedAtLine = at(stmt);
      }
    }

    scan(body, null);
  };

  const visit = (node: ts.Node): void => {
    const name = subjectName(node);
    if (name && appliesTo(name) && ts.isFunctionLike(node)) {
      visitFunction(node as ts.FunctionLikeDeclaration);
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return into;
}

// ── SELF-TEST, for the same reason tdz-check has one ─────────────────────────
const BAD_CONDITIONAL = `
export function Screen({ ready }) {
  if (ready) {
    const v = useSharedValue(0);
  }
  return null;
}
`;
const BAD_AFTER_RETURN = `
export function Screen({ data }) {
  if (!data) return null;
  const [x, setX] = useState(0);
  return x;
}
`;
const GOOD = `
export function Screen({ data }) {
  const [x, setX] = useState(0);
  useEffect(() => {
    if (!data) return;
    setX(1);
  }, [data]);
  if (!data) return null;
  return x;
}
`;

const a = check('<self:conditional>', BAD_CONDITIONAL, []);
const b = check('<self:after-return>', BAD_AFTER_RETURN, []);
const c = check('<self:good>', GOOD, []);
if (a.length !== 1 || b.length !== 1 || c.length !== 0) {
  console.error(
    'hooks-check is broken: its own self-test failed ' +
      `(expected 1 / 1 / 0, got ${a.length} / ${b.length} / ${c.length}).`,
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

const offenses: Offense[] = [];
for (const f of files) check(f, undefined, offenses);

if (offenses.length > 0) {
  console.error('Hooks that do not run in the same order every render:\n');
  for (const o of offenses) {
    console.error(`  ${o.file}:${o.line}  ${o.hook}() ${o.why}`);
  }
  console.error(
    `\n${offenses.length} offense${offenses.length === 1 ? '' : 's'}. ` +
      'React throws "Rendered fewer hooks than expected" on these and the screen dies. ' +
      'See the note at the top of scripts/hooks-check.mts.',
  );
  process.exit(1);
}

console.log(`Hooks are unconditional and in fixed order in ${files.length} files.`);
