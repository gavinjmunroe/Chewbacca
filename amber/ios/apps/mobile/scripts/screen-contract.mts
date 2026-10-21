/**
 * WHAT EVERY SCREEN CAN DO, FROZEN, SO A REDESIGN CANNOT QUIETLY DROP IT.
 *
 *   node --experimental-strip-types scripts/screen-contract.mts
 *   node --experimental-strip-types scripts/screen-contract.mts --update
 *
 * THE PROBLEM THIS SOLVES. The behavior of this app lives in a handful of very
 * large screens -- person/[id].tsx is 2,500 lines, circle/[id].tsx is 1,900,
 * onboarding is 1,000 -- and a UI pass rewrites exactly those files. Nothing
 * else in the toolchain notices when a button loses its handler, a screen stops
 * being reachable, a field stops being editable, or a confirm sheet disappears:
 * tsc is happy, lint is happy, the bundle builds, and the first person to find
 * out is whoever taps the thing in TestFlight and gets nothing.
 *
 * So this reads the source and writes down what each file can DO -- not how it
 * looks. Colors, spacing, layout, copy, which component wraps which: none of
 * that is here, on purpose. A redesign is supposed to change all of it. What a
 * redesign is NOT supposed to change is the set of actions the user can take.
 *
 * WHAT IS RECORDED, per file:
 *   handlers     every onPress / onLongPress / onChangeText / onSubmitEditing /
 *                onValueChange / onRefresh / onSelect / onConfirm ... and the
 *                name of the function it calls
 *   navigations  every router.push/replace/navigate target that is a literal
 *   apiCalls     every function imported from lib/ that this file calls
 *   queryKeys    every react-query key, so a screen cannot stop loading its data
 *   labels       accessibilityLabel and testID values -- the names the user (and
 *                a screen reader) can address things by
 *
 * THE RULE. Anything in the baseline must still exist. ADDING is always fine;
 * only removal fails. When a removal is intentional -- a feature really is
 * going away -- rerun with --update and the diff shows up in review as a
 * deliberate line in the baseline rather than as nothing at all.
 *
 * A NOTE ON WHY THIS IS NOT A SNAPSHOT TEST. A snapshot of the rendered tree
 * would fail on every design change, which trains people to press "update" until
 * it stops complaining, at which point it catches nothing. This fails ONLY on
 * lost capability, so an --update is rare enough to be worth reading.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const BASELINE = join(HERE, 'screen-contract.json');
const ROOTS = ['app', 'components'];

/** Props whose value is something the user can trigger. */
const HANDLER_PROPS = new Set([
  'onPress', 'onLongPress', 'onPressIn', 'onPressOut',
  'onChangeText', 'onChange', 'onSubmitEditing', 'onEndEditing',
  'onValueChange', 'onSelect', 'onSelectDay', 'onSelectContact',
  'onConfirm', 'onCancel', 'onClose', 'onDismiss', 'onDelete', 'onRemove',
  'onSave', 'onSend', 'onSubmit', 'onRefresh', 'onRetry', 'onToggle',
  'onScrollEndDrag', 'onMomentumScrollEnd', 'onRequestClose', 'onLayout',
  'onFocus', 'onBlur', 'onDone', 'onAdd', 'onOpen', 'onShare', 'onCopy',
]);

type Contract = {
  handlers: string[];
  navigations: string[];
  apiCalls: string[];
  queryKeys: string[];
  labels: string[];
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx$/.test(e.name) && !/\.test\.[cm]?tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

/** The bare name a handler expression resolves to, or a shape for inline ones. */
function handlerName(node: ts.Node): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.getText().split('(')[0];
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    // An inline arrow is recorded by WHAT IT CALLS, because that is the part
    // that has to survive. `() => setOpen(true)` and `() => { setOpen(true); }`
    // are the same capability written two ways, and a redesign will reformat
    // one into the other constantly.
    const called: string[] = [];
    const walk = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const e = n.expression;
        if (ts.isIdentifier(e)) called.push(e.text);
        else if (ts.isPropertyAccessExpression(e)) called.push(e.getText());
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
    return called.length > 0 ? `inline:${[...new Set(called)].sort().join('+')}` : 'inline:noop';
  }
  if (ts.isConditionalExpression(node)) {
    return `${handlerName(node.whenTrue)}|${handlerName(node.whenFalse)}`;
  }
  if (ts.isBinaryExpression(node)) return handlerName(node.right);
  return 'expression';
}

function extract(file: string): Contract {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const handlers = new Set<string>();
  const navigations = new Set<string>();
  const apiCalls = new Set<string>();
  const queryKeys = new Set<string>();
  const labels = new Set<string>();

  /** Names imported from anywhere under lib/, so a call to one is an app action. */
  const libImports = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    const spec = (st.moduleSpecifier as ts.StringLiteral).text;
    if (!/(^|\/)lib\//.test(spec) && !spec.startsWith('@/lib')) continue;
    const named = st.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) for (const el of named.elements) libImports.add(el.name.text);
    if (st.importClause?.name) libImports.add(st.importClause.name.text);
  }

  const literal = (n: ts.Node | undefined): string | null => {
    if (!n) return null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isTemplateExpression(n)) {
      // `/person/${id}` -> "/person/${}" so the ROUTE survives while the value
      // in it is free to change.
      return (
        n.head.text + n.templateSpans.map((s) => '${}' + s.literal.text).join('')
      );
    }
    return null;
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      const prop = node.name.text;
      const init = node.initializer;
      if (HANDLER_PROPS.has(prop) && init && ts.isJsxExpression(init) && init.expression) {
        handlers.add(`${prop}=${handlerName(init.expression)}`);
      }
      if (prop === 'accessibilityLabel' || prop === 'testID' || prop === 'accessibilityHint') {
        const v = init && ts.isStringLiteral(init) ? init.text : init && ts.isJsxExpression(init) ? literal(init.expression) : null;
        if (v) labels.add(`${prop}=${v}`);
      }
    }

    if (ts.isCallExpression(node)) {
      const e = node.expression;
      if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'router') {
        const target = literal(node.arguments[0]);
        navigations.add(`${e.name.text}:${target ?? '<computed>'}`);
      }
      if (ts.isIdentifier(e) && libImports.has(e.text)) apiCalls.add(e.text);
    }

    // queryKey: [...] — the identity of the data a screen loads.
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      (node.name.text === 'queryKey' || node.name.text === 'mutationKey') &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      const parts = node.initializer.elements.map((el) => literal(el) ?? '<v>');
      queryKeys.add(parts.join('/'));
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  const sorted = (s: Set<string>) => [...s].sort();
  return {
    handlers: sorted(handlers),
    navigations: sorted(navigations),
    apiCalls: sorted(apiCalls),
    queryKeys: sorted(queryKeys),
    labels: sorted(labels),
  };
}

const current: Record<string, Contract> = {};
for (const root of ROOTS) {
  for (const f of sourceFiles(join(APP, root))) {
    const key = relative(APP, f).split('\\').join('/');
    const c = extract(f);
    // Files with no behavior at all (pure presentational wrappers) are not
    // recorded: an empty entry is noise, and if one gains behavior later it
    // simply appears.
    if (c.handlers.length + c.navigations.length + c.apiCalls.length + c.queryKeys.length + c.labels.length > 0) {
      current[key] = c;
    }
  }
}

const update = process.argv.includes('--update');
if (update) {
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
  const n = Object.values(current).reduce(
    (a, c) => a + c.handlers.length + c.navigations.length + c.apiCalls.length + c.queryKeys.length + c.labels.length,
    0,
  );
  console.log(`Baseline written: ${Object.keys(current).length} files, ${n} recorded capabilities.`);
  process.exit(0);
}

let baseline: Record<string, Contract>;
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch {
  console.error(
    'No baseline at scripts/screen-contract.json.\n' +
      'Create it with:  node --experimental-strip-types scripts/screen-contract.mts --update',
  );
  process.exit(1);
}

const losses: string[] = [];
for (const [file, want] of Object.entries(baseline)) {
  const have = current[file];
  if (!have) {
    losses.push(`${file}\n    THE WHOLE FILE IS GONE, and it had ${Object.values(want).flat().length} recorded capabilities.`);
    continue;
  }
  for (const kind of ['handlers', 'navigations', 'apiCalls', 'queryKeys', 'labels'] as const) {
    const missing = want[kind].filter((v) => !have[kind].includes(v));
    if (missing.length > 0) {
      losses.push(`${file}\n    ${kind} no longer present: ${missing.join(', ')}`);
    }
  }
}

if (losses.length === 0) {
  const n = Object.values(current).reduce(
    (a, c) => a + c.handlers.length + c.navigations.length + c.apiCalls.length + c.queryKeys.length + c.labels.length,
    0,
  );
  console.log(`screen-contract: ${Object.keys(current).length} files, ${n} capabilities, none lost.`);
  process.exit(0);
}

console.error('SCREEN CONTRACT BROKEN. Something the app could do, it no longer can:\n');
for (const l of losses) console.error(`  ${l}\n`);
console.error(
  'If this is intentional -- the feature really is going away -- rerun with --update\n' +
    'so the removal lands in scripts/screen-contract.json as a reviewable line.',
);
process.exit(1);
