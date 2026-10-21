/**
 * ONE LAUNCH MARK, NOT TWO.
 *
 *   node --experimental-strip-types scripts/splash-check.mts
 *   (or via npm run verify)
 *
 * WHAT WENT WRONG.
 *
 *   "It still shows the old logo if you clear the app and open it up again. It
 *    still shows the old initial logo before it shows the new one that says
 *    Amber under it. It should only show the new logo."
 *
 * Two launch screens, each correct by itself. expo-splash-screen drew the bare
 * ember at imageWidth 200 while the native side booted; then AuthGate's
 * BrandedSplash drew the ember at 84pt with the wordmark under it while the
 * session resolved. The app appeared to change its mind about its own logo
 * halfway through opening.
 *
 * The fix was to make the native splash BE the branded one: one PNG containing
 * that exact stack, handed to expo-splash-screen at the stack's own width on the
 * stack's own background. Which means the same three numbers now live in two
 * files -- app.json and components/AuthGate.tsx -- and that is the shape of bug
 * this codebase has now shipped four times:
 *
 *   - the hub drawn at 0.66 by the component and cleared at 0.42 by the layout
 *   - the web's lines drawn straight and tested curved
 *   - labels resolved against stand-in spokes that were not the real path
 *   - and this: a splash image sized for a stack that has since moved
 *
 * Every one of them was a number computed in two places, and not one of them was
 * caught by a test, because each place was individually right. So: a check.
 *
 * WHAT IT ASSERTS. That app.json's splash imageWidth equals styles.brandIcon's
 * width, that the two backgrounds are the same color, and that the composited
 * PNG still has the aspect ratio the icon/gap/wordmark stack implies. If any of
 * the three moves, the handoff becomes visible again -- the logo jumps size, or
 * the ground changes shade under it -- and that is precisely the bug.
 *
 * WHEN THE STACK LEGITIMATELY CHANGES, this fails, and it is supposed to: the
 * PNG has to be rebuilt. The recipe is in the failure text.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/** displayLg, from lib/tokens.ts -- the wordmark's line box. */
const WORDMARK_LINE_HEIGHT = 28;

const problems: string[] = [];

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** The intrinsic size of a PNG, from the IHDR chunk. No image library needed. */
function pngSize(rel: string): { width: number; height: number } {
  const buf = readFileSync(join(ROOT, rel));
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) {
    throw new Error(`${rel} is not a PNG (no IHDR where one belongs)`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const app = JSON.parse(read('app.json')) as {
  expo: { icon: string; plugins: unknown[] };
};

// ── the splash plugin's configuration ─────────────────────────────────────────
const splashPlugin = app.expo.plugins.find(
  (p): p is [string, Record<string, unknown>] =>
    Array.isArray(p) && p[0] === 'expo-splash-screen',
);

if (!splashPlugin) {
  problems.push(
    'app.json has no expo-splash-screen plugin entry, so the native launch screen\n' +
      '  falls back to a blank canvas and the first thing the user sees is nothing.',
  );
}

const splash = splashPlugin?.[1] ?? {};
const splashImage = typeof splash.image === 'string' ? splash.image : '';
const splashWidth = typeof splash.imageWidth === 'number' ? splash.imageWidth : NaN;
const splashBg = typeof splash.backgroundColor === 'string' ? splash.backgroundColor : '';

// ── the in-app stack, read out of the stylesheet ──────────────────────────────
const gate = read('components/AuthGate.tsx');

function styleNumber(block: string, prop: string): number {
  const b = new RegExp(`${block}:\\s*\\{([^}]*)\\}`).exec(gate);
  if (!b) return NaN;
  const m = new RegExp(`\\b${prop}:\\s*([0-9.]+)`).exec(b[1]);
  return m ? Number(m[1]) : NaN;
}

const iconPt = styleNumber('brandIcon', 'width');
const gapToken = /brandStack:\s*\{[^}]*gap:\s*spacing\.(\w+)/.exec(gate)?.[1] ?? '';
const spacing = read('lib/tokens.ts');
const gapPt = Number(
  new RegExp(`\\b${gapToken}:\\s*(\\d+)`).exec(
    /export const spacing = \{([\s\S]*?)\} as const;/.exec(spacing)?.[1] ?? '',
  )?.[1] ?? NaN,
);

// ── 1. the native image is the branded one ───────────────────────────────────
//
// The specific regression: splash-icon.png is the BARE ember, and it is still on
// disk. Pointing back at it is the original bug verbatim.
if (/splash-icon\.png/.test(splashImage)) {
  problems.push(
    `app.json's splash image is ${splashImage}, the bare ember with no wordmark.\n` +
      '  That is the old logo, and showing it before the branded one is the exact\n' +
      '  complaint this check exists for: "it should only show the new logo".',
  );
}

// ── 2. same width in both places ──────────────────────────────────────────────
if (Number.isFinite(iconPt) && Number.isFinite(splashWidth) && splashWidth !== iconPt) {
  problems.push(
    `The launch mark changes size at the handoff: expo-splash-screen draws it at\n` +
      `  imageWidth ${splashWidth}pt and AuthGate's styles.brandIcon is ${iconPt}pt.\n` +
      '  They are the same mark on the same screen a few hundred milliseconds apart,\n' +
      '  so any difference is visible as the logo resizing itself while the app opens.',
  );
}

// ── 3. same ground ────────────────────────────────────────────────────────────
//
// styles.fill paints colors.canvas. A splash on #ffffff handing over to a screen
// on #FFFDFA is a seam you can see -- faint, and it reads as a flicker.
const canvas = /canvas:\s*LIGHT\.surface,\s*\/\/\s*(#[0-9A-Fa-f]{6})/.exec(spacing)?.[1] ?? '';
if (canvas && splashBg && canvas.toLowerCase() !== splashBg.toLowerCase()) {
  problems.push(
    `The ground changes shade at the handoff: the splash is ${splashBg} and\n` +
      `  colors.canvas -- which styles.fill paints -- is ${canvas}. Two near-whites\n` +
      '  swapping reads as a flicker rather than as a color, which is worse.',
  );
}

// ── 4. the PNG still matches the stack it was composited from ────────────────
//
// THE ONE THAT ACTUALLY CATCHES FUTURE DRIFT. The three rules above compare
// numbers to numbers; this compares them to the image on disk, which is the only
// thing the user sees.
if (splashImage) {
  const rel = splashImage.replace(/^\.\//, '');
  try {
    const { width, height } = pngSize(rel);
    const expected = (iconPt + gapPt + WORDMARK_LINE_HEIGHT) / iconPt;
    const actual = height / width;
    if (Math.abs(actual - expected) > 0.02) {
      problems.push(
        `${rel} is no longer the shape of the stack it stands in for.\n` +
          `  Its aspect is ${actual.toFixed(3)}; the icon (${iconPt}) + gap (${gapPt}) +\n` +
          `  wordmark line (${WORDMARK_LINE_HEIGHT}) over the icon width is ${expected.toFixed(3)}.\n` +
          '  resizeMode contain scales to imageWidth, so a taller or shorter image puts\n' +
          '  the wordmark somewhere the in-app splash will not have it, and the text\n' +
          '  jumps at the handoff.\n' +
          '  Rebuild it: composite assets/images/icon.png at the icon width, then the\n' +
          '  wordmark set in displayLg centered in a line box of its lineHeight, with\n' +
          '  spacing.' +
          gapToken +
          ' between them, at 4x, on transparency.',
      );
    }
  } catch (err) {
    problems.push(`${rel}: ${(err as Error).message}`);
  }
}

// ── 5. the iOS app icon is opaque ─────────────────────────────────────────────
//
// "I want the app itself to not be a black icon with the logo in the middle. I
//  want it to be a white icon."
//
// It was never styled black. assets/images/icon.png is the ember on
// TRANSPARENCY, iOS app icons cannot have an alpha channel, and the compositor
// fills what is left with black. Nothing in the config said "black" -- which is
// why reading the config could not find it. The icon app.json points at must
// therefore be a flattened one, and icon.png must stay transparent because
// AuthGate renders it over the canvas.
if (/images\/icon\.png/.test(app.expo.icon)) {
  problems.push(
    `app.json's icon is ${app.expo.icon}, which is the ember on transparency.\n` +
      '  iOS app icons have no alpha channel: the transparent ground is composited\n' +
      '  onto BLACK, which is why the home screen icon was a black tile with the logo\n' +
      '  in the middle. Point this at the flattened icon-ios.png and leave icon.png\n' +
      '  alone -- AuthGate draws it over the canvas and needs it transparent.',
  );
}

if (problems.length === 0) {
  console.log(
    `One launch mark: ${iconPt}pt on ${splashBg}, native and in-app, ${splashImage.replace(/^\.\//, '')}.`,
  );
  process.exit(0);
}

console.log('The app changes its mind about its logo while it opens:\n');
for (const p of problems) console.log(`  ${p}\n`);
process.exitCode = 1;
