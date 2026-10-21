/**
 * THE WEB COMPONENT MAY NOT DO ITS OWN GEOMETRY.
 *
 *   node scripts/test.mjs --check scripts/web-render-check.mts
 *   (or via npm run verify)
 *
 * WHY THIS EXISTS. Three times now, a number that lib/connectionsWeb computes
 * has also been computed inside components/ConnectionsWeb, and the two drifted:
 *
 *   THE HUB. The layout clears the innermost ring against hubDiameter (0.42 of
 *   the board). The component had `Math.max(56, Math.min(Math.min(rx, ry) *
 *   0.66, 128))` -- its own copy, left behind when the layout's shrank. On the
 *   profile card that is a drawn hub of radius 43 inside a ring cleared for 28,
 *   so the first ring of people was painted on the edge of your own face. Every
 *   clearance the layout proved, and every test that checked one, was measuring
 *   a circle that was not on screen. "Nothing should be touching the center
 *   circle" was true of the tested drawing and false of the real one.
 *
 *   THE LINES. The layout builds each spoke as a spiral and hands it over on
 *   `Placed.path`, and the no-crossing property is a property of those exact
 *   points. The component threw them away and drew `M x1 y1 L x2 y2` between
 *   ends it computed itself -- so the shape asserted about and the shape
 *   rendered were different shapes, and a test could pass on a build whose
 *   lines crossed everywhere.
 *
 * A UNIT TEST CANNOT CATCH EITHER, which is the point of a separate gate: the
 * tests import the library and are right about it. The mismatch lives in the
 * .tsx, and no assertion about lib/connectionsWeb can reach it.
 *
 * WHAT IT CHECKS. Three rules, all about WHO OWNS A NUMBER rather than about
 * what the number is:
 *
 *   1. the component imports hubDiameter and does not multiply rx or ry by a
 *      hub-shaped constant of its own
 *   2. the spoke renderer reads `path` and does not build a straight two-point
 *      line from `spokeFrom`
 *   3. RING_STRETCH lives in exactly one file
 *
 * Deliberately textual. The alternative is a rendering test, and the thing being
 * defended is not a pixel -- it is the rule that the drawing's arithmetic has
 * one home.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const COMPONENT = join(ROOT, 'components/ConnectionsWeb.tsx');
const LIB = join(ROOT, 'lib/connectionsWeb.ts');

/**
 * Comments stripped, so the notes ABOVE explaining each of these bugs -- which
 * necessarily quote the broken code -- do not themselves trip the check. This
 * is the exact mistake scripts/local-binding-check.mjs made in its first
 * version, in reverse: strip too little and the gate fires on its own
 * documentation, strip too much and it can never fire at all. Comments only,
 * never string literals.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

const problems: string[] = [];
const component = code(readFileSync(COMPONENT, 'utf8'));
const lib = readFileSync(LIB, 'utf8');

// ── 1. the hub is the layout's ────────────────────────────────────────────────
if (!/\bhubDiameter\b/.test(component)) {
  problems.push(
    'components/ConnectionsWeb.tsx does not call hubDiameter. Your own disc is sized\n' +
      '  by lib/connectionsWeb, because the innermost ring is cleared against it.',
  );
}
/**
 * A hub formula looks like `Math.min(rx, ry) * <fraction>` or `rx * <fraction>`.
 * Narrow on purpose: `width / 2`, insets and the stretch ceiling are this file's
 * own business, and a gate that fires on those gets switched off.
 */
const hubShaped = /Math\.min\(\s*rx\s*,\s*ry\s*\)\s*\*\s*0?\.\d+|\br[xy]\s*\*\s*0\.[3-9]\d*/g;
for (const m of component.match(hubShaped) ?? []) {
  problems.push(
    `components/ConnectionsWeb.tsx computes "${m.trim()}" itself.\n` +
      '  Hub and ring geometry belong to lib/connectionsWeb -- this is the 0.66-vs-0.42\n' +
      '  drift that drew people on top of your own face.',
  );
}

// ── 2. the lines are the layout's ─────────────────────────────────────────────
if (!/\.path\b/.test(component)) {
  problems.push(
    'components/ConnectionsWeb.tsx never reads Placed.path. The spokes are spirals the\n' +
      '  layout already built, and the no-crossing guarantee is a property of those points.',
  );
}
/**
 * The straight-line shape, as it was actually written: a template string with an
 * M and an L and nothing between them. A curve is built by mapping over points,
 * so it never produces a single literal with both.
 */
if (/`\s*M\s*\$\{[^`]*\}\s*L\s*\$\{[^`]*\}\s*`/.test(component)) {
  problems.push(
    'components/ConnectionsWeb.tsx builds a straight two-point `M .. L ..` path.\n' +
      '  That discards the curve and, worse, makes the drawn shape differ from the\n' +
      '  tested one. Render Placed.path point by point.',
  );
}

// ── 3. one home for the stretch ───────────────────────────────────────────────
if (/\bRING_STRETCH\b/.test(lib)) {
  problems.push(
    'RING_STRETCH appears in lib/connectionsWeb.ts as well as the component.\n' +
      '  It is a property of the box the drawing is given, so it lives in exactly one\n' +
      '  place -- two copies is how the tests ended up asserting about rx * 1.3 long\n' +
      '  after the component had moved to 1.6.',
  );
}

if (problems.length === 0) {
  console.log('The web component leaves the geometry to the layout.');
  process.exit(0);
}

console.log('The drawing and the layout have drifted apart:\n');
for (const p of problems) console.log(`  ${p}\n`);
process.exitCode = 1;
