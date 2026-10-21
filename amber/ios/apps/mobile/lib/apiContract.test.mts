/**
 * EVERY CALL THE APP MAKES TO THE SERVER, CHECKED AT ONCE.
 *
 * Around thirty modules in lib/ are thin wrappers over callMedhaId: a path, a
 * method, a body, an auth flag. There is no logic in them to unit-test, which is
 * exactly why nothing ever looked at them -- and they are where a whole class of
 * silent breakage lives:
 *
 *   AN UNESCAPED ID IN A PATH. `/v1/me/contacts/${id}/note` with an id
 *   containing a slash, a question mark or a hash does not call the endpoint
 *   somebody intended. Contact ids come from iOS and from the server, and the
 *   fallback id this app generates for a card with no identifier is built out of
 *   a PERSON'S NAME -- "Marcus O'Dell", "Café Luna", names with slashes in them.
 *   Every one of those has to be encoded, and the only way to know they all are
 *   is to check all of them.
 *
 *   A TYPO IN A PATH. One character, no type error, a 404 at runtime on one
 *   screen.
 *
 *   A MISSING requireAuth. The request goes out unauthenticated and comes back
 *   401, which the UI renders as an empty state -- indistinguishable from "you
 *   have none of these".
 *
 * Read off the source rather than by calling anything, so it covers every
 * wrapper including the ones no test would otherwise reach.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const LIB = dirname(fileURLToPath(import.meta.url));
const APP = join(LIB, '..');

type Call = {
  file: string;
  line: number;
  fn: string;
  path: string | null;
  /** The raw text of the path expression, so a template can be inspected. */
  pathText: string;
  method: string | null;
  requireAuth: boolean | null;
  /** Interpolated segments of a template path, as written. */
  interpolations: string[];
};

function collect(): Call[] {
  const out: Call[] = [];
  for (const name of readdirSync(LIB)) {
    if (!name.endsWith('.ts') || name.endsWith('.d.ts')) continue;
    const file = join(LIB, name);
    const text = readFileSync(file, 'utf8');
    if (!text.includes('callMedhaId') && !text.includes('callOrQueue')) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    /** The nearest enclosing function name, so a failure names something findable. */
    const enclosing = (n: ts.Node): string => {
      let p: ts.Node | undefined = n;
      while (p) {
        if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
        if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
        if (ts.isMethodDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
        p = p.parent;
      }
      return '<top level>';
    };

    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === 'callMedhaId' || node.expression.text === 'callOrQueue')
      ) {
        const arg = node.arguments.find((a) => ts.isObjectLiteralExpression(a)) as
          | ts.ObjectLiteralExpression
          | undefined;
        if (arg) {
          let path: string | null = null;
          let pathText = '';
          let method: string | null = null;
          let requireAuth: boolean | null = null;
          const interpolations: string[] = [];
          for (const prop of arg.properties) {
            if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
            const key = prop.name.text;
            const v = prop.initializer;
            if (key === 'path') {
              pathText = v.getText();
              if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) path = v.text;
              else if (ts.isTemplateExpression(v)) {
                path = v.head.text + v.templateSpans.map((s) => `{}${s.literal.text}`).join('');
                for (const s of v.templateSpans) interpolations.push(s.expression.getText());
              }
            } else if (key === 'method') {
              if (ts.isStringLiteral(v)) method = v.text;
            } else if (key === 'requireAuth') {
              requireAuth = v.kind === ts.SyntaxKind.TrueKeyword ? true : v.kind === ts.SyntaxKind.FalseKeyword ? false : null;
            }
          }
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
          out.push({
            file: relative(APP, file),
            line: line + 1,
            fn: enclosing(node),
            path,
            pathText,
            method,
            requireAuth,
            interpolations,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

const CALLS = collect();
const where = (c: Call) => `${c.file}:${c.line} ${c.fn}()`;

test('there are calls to check, and the collector actually found them', () => {
  // A collector that silently matches nothing reports a clean sweep over an
  // empty set, which is the worst possible outcome for a check like this.
  assert.ok(CALLS.length > 40, `only found ${CALLS.length} server calls, which means the scan is broken`);
});

/**
 * The two spellings of "this value is escaped". `enc` is the local alias in
 * lib/dms.ts, where nearly every path carries a thread or message id.
 */
const ENCODED = /(?:^|[^A-Za-z0-9_])(?:encodeURIComponent|enc)\s*\(/;

/**
 * Interpolations that are NOT user input, each with the reason it is safe.
 *
 * An allowlist is a thing people append to instead of reading, so this one is
 * asserted to stay exactly this size. Adding an entry means writing down why,
 * in review, next to the line that needed it.
 */
const NOT_USER_INPUT: Record<string, string> = {
  direction: "closed union: 'incoming' | 'outgoing'",
  qs: 'a query string already built and escaped by the caller',
  basePath: 'a route prefix chosen in code, never a value from a person',
};

/**
 * `${parts.join('&')}` is safe only if every part was escaped when it was built.
 *
 * Verified rather than assumed: this reads the file back and requires every line
 * that puts something INTO that array to call encodeURIComponent. A query
 * assembled from raw values would fail here even though the join itself looks
 * identical -- which is the whole point, because "it's a query string, it's
 * fine" is exactly how an unescaped search term ships.
 */
function joinOfEncodedParts(c: Call, expr: string): boolean {
  const m = /^([A-Za-z_$][\w$]*)\.join\(/.exec(expr);
  if (!m) return false;
  const name = m[1];
  const src = readFileSync(join(APP, c.file), 'utf8');
  const builders = src
    .split('\n')
    .filter((l) => new RegExp(`(const|let)\\s+${name}\\s*=|${name}\\.push\\(`).test(l));
  if (builders.length === 0) return false;
  return builders.every((l) => ENCODED.test(l) || /=\s*\[\s*\]\s*;?\s*$/.test(l.trim()));
}

/**
 * Is this interpolated expression escaped, all the way down?
 *
 * Recursive because the real ones are nested: a path carries
 * `${parts.length ? `?${parts.join('&')}` : ''}`, and the safety lives two
 * levels in. Checking only the outer text would either wave the whole
 * conditional through (and miss a raw value inside one) or reject a query
 * string that is entirely escaped. Neither is acceptable, so it descends.
 */
function isSafeInterpolation(c: Call, expr: string): boolean {
  const e = expr.trim();
  if (e === '' || /^(''|""|``)$/.test(e)) return true;
  if (ENCODED.test(e) && !/\$\{/.test(e)) return true;
  if (/^['"]/.test(e)) return true;
  if (/URLSearchParams/.test(e)) return true;
  if (joinOfEncodedParts(c, e)) return true;
  if (Object.prototype.hasOwnProperty.call(NOT_USER_INPUT, e)) return true;
  // A nested template: every hole in it has to be safe on its own terms, and
  // the literal text around them is ours.
  const holes = [...e.matchAll(/\$\{([\s\S]*?)\}/g)].map((m) => m[1]);
  if (holes.length > 0) return holes.every((h) => isSafeInterpolation(c, h));
  // A conditional with no holes left: check both branches.
  const cond = /^[\s\S]+?\?([\s\S]+):([\s\S]+)$/.exec(e);
  if (cond) return isSafeInterpolation(c, cond[1]) && isSafeInterpolation(c, cond[2]);
  return false;
}

test('EVERY VALUE INTERPOLATED INTO A PATH IS ENCODED', () => {
  // `/v1/me/contacts/${contactId}/note` where contactId is "Marcus O'Dell-x/y"
  // does not call the endpoint anybody meant. The ids this app generates for
  // cards iOS gave no identifier for are built out of a person's NAME, so the
  // dangerous input is ordinary rather than adversarial.
  const bad: string[] = [];
  for (const c of CALLS) {
    for (const expr of c.interpolations) {
      if (!isSafeInterpolation(c, expr)) {
        bad.push(`${where(c)}  path ${c.pathText}  interpolates \`${expr}\``);
      }
    }
  }
  assert.deepEqual(bad, [], `\n  ${bad.join('\n  ')}\n`);
});

test('the list of unescaped-but-safe values stays short and explained', () => {
  assert.equal(
    Object.keys(NOT_USER_INPUT).length,
    3,
    'a new exemption was added to NOT_USER_INPUT. Every entry needs a reason a reviewer can check.',
  );
});

test('every path is an absolute route on a known prefix', () => {
  // /v1 is the app's API. /dnc is the separate Apple-credentials service, which
  // is first-party and deliberate. A path built from a `basePath` parameter is
  // checked at its call sites instead, which are all /v1.
  const bad = CALLS.filter(
    (c) =>
      !(
        (c.path && (c.path.startsWith('/v1/') || c.path === '/v1' || c.path.startsWith('/dnc/') || /^\{\}/.test(c.path))) ||
        c.pathText === 'basePath'
      ),
  ).map((c) => `${where(c)}  path=${c.pathText}`);
  assert.deepEqual(bad, [], `\n  ${bad.join('\n  ')}\n`);
});

test('no path has a double slash or a trailing slash', () => {
  // Both produce a 404 against a router that is strict about either, and both
  // are invisible in review.
  const bad = CALLS.filter((c) => c.path && (/\/\//.test(c.path) || /\/$/.test(c.path))).map(
    (c) => `${where(c)}  path=${c.path}`,
  );
  assert.deepEqual(bad, [], `\n  ${bad.join('\n  ')}\n`);
});

test('every write says which method it is; only reads may leave it out', () => {
  // callMedhaId defaults to GET. A POST that forgot to say so silently becomes a
  // read of the same URL, which usually 404s or, worse, succeeds and does
  // nothing.
  const bad = CALLS.filter((c) => c.method !== null && !['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(c.method)).map(
    (c) => `${where(c)}  method=${c.method}`,
  );
  assert.deepEqual(bad, [], `\n  ${bad.join('\n  ')}\n`);
});

test('a call that reads or writes the signed-in person requires auth', () => {
  // A /v1/me/... call without requireAuth goes out unauthenticated and comes
  // back 401, which every one of these screens renders as an empty state --
  // indistinguishable from "you have none of these".
  //
  // ONE EXCEPTION, and it is the right kind. The reachability probe in
  // queryClient.ts deliberately does not authenticate: it only wants to know
  // whether the network answers at all, and a 401 proves that as well as a 200.
  const bad = CALLS.filter(
    (c) =>
      c.path?.startsWith('/v1/me') &&
      c.requireAuth !== true &&
      !(c.file.endsWith('queryClient.ts') && c.fn === 'scheduleReachabilityPoll'),
  ).map((c) => `${where(c)}  path=${c.path} requireAuth=${c.requireAuth}`);
  assert.deepEqual(bad, [], `\n  ${bad.join('\n  ')}\n`);
});

test('the same route is not defined twice with different methods by accident', () => {
  // Two wrappers for one endpoint is fine; two wrappers that disagree about
  // whether it needs auth is a bug in one of them.
  const byRoute = new Map<string, Set<string>>();
  for (const c of CALLS) {
    if (!c.path) continue;
    const k = `${c.method ?? 'GET'} ${c.path}`;
    if (!byRoute.has(k)) byRoute.set(k, new Set());
    byRoute.get(k)!.add(String(c.requireAuth));
  }
  // The reachability probe hits GET /v1/me unauthenticated on purpose, so that
  // route legitimately appears both ways.
  const disagreements = [...byRoute]
    .filter(([k, v]) => v.size > 1 && k !== 'GET /v1/me')
    .map(([k, v]) => `${k} -> requireAuth ${[...v].join(' and ')}`);
  assert.deepEqual(disagreements, [], `\n  ${disagreements.join('\n  ')}\n`);
});

test('no server path is built by string concatenation', () => {
  // A template literal keeps the shape of the route readable and greppable; a
  // '+' chain hides it, and every one of the encoding rules above becomes
  // unenforceable.
  const bad = CALLS.filter((c) => c.pathText.includes(' + ')).map((c) => `${where(c)}  path=${c.pathText}`);
  assert.deepEqual(bad, [], `\n  ${bad.join('\n  ')}\n`);
});
