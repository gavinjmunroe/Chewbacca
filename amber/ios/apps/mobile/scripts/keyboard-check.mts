/**
 * ONE KEYBOARD OBSERVER. THE FAILURE MODE IS SILENT, SO THIS HAS TO BE A GATE.
 *
 *   node --experimental-strip-types scripts/keyboard-check.mts
 *   (or via npm run verify)
 *
 * WHAT WENT WRONG, OVER THREE SCREEN RECORDINGS.
 *
 * Reanimated does not support `useAnimatedKeyboard` in more than one component
 * at a time, and it was mounted three times -- twice inside SearchDock alone,
 * sixty lines apart. Nothing warns: no error, no red box, no console line. The
 * height just stops arriving.
 *
 * Fixing that to a single observer HELPED AND DID NOT SOLVE IT, which is the
 * part worth recording. Measured frame by frame at 60fps on the next recording:
 * the bar moved for exactly two frames, stopped for twenty-two while the
 * keyboard climbed over and swallowed it, and snapped to its destination seven
 * frames after the keyboard had already arrived. Even correctly mounted, the
 * hook delivered a handful of samples per keyboard rather than one per frame.
 *
 * Four separate versions of the lift formula were written against that input,
 * each one carefully argued, each one interpolating between two samples. The
 * formula was never the problem.
 *
 * AND A NOTIFICATION-DRIVEN VERSION WAS ALSO WRONG, which is the part that took
 * an outside eye: "they should be linked as the same object". Driving a
 * withTiming from `keyboardWillShow` with iOS's own duration and curve is still
 * an imitation -- two objects agreeing -- and it starts a frame or two late and
 * cannot follow an interactive drag at all.
 *
 * So the keyboard is tracked NATIVELY. react-native-keyboard-controller hooks
 * the system animation and publishes its real position as a Reanimated shared
 * value every frame. lib/useKeyboardLift is the only file allowed to read it.
 *
 * A COMMENT WAS NOT ENOUGH. lib/useKeyboardLift already explained at length that
 * the value had to be live, and it was still mounted twice in the file that
 * cared most. So: a check.
 *
 * THE RULES.
 *
 *   1. NOTHING calls Reanimated's `useAnimatedKeyboard`. Not once, not anywhere.
 *   2. `useReanimatedKeyboardAnimation` is read in exactly ONE file, the owner.
 *      Everything else goes through useKeyboardLift.
 *   3. `useKeyboardObserver` is invoked in exactly ONE place: KeyboardProbe.
 *   4. KeyboardProbe is mounted in exactly ONE file, and `KeyboardProvider` in
 *      exactly one -- without the provider the shared value never moves and
 *      every bar sits still, silently, which is this bug all over again.
 *   5. And the owner really does read the native value, so rules 1-4 cannot all
 *      be satisfied by a hook that does nothing.
 *
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ROOTS = ['app', 'components', 'lib'];

/** The one file that owns keyboard tracking for the whole app. */
const OWNER = 'lib/useKeyboardLift.ts';
/** The one file allowed to call useKeyboardObserver. */
const PROBE = 'components/KeyboardProbe.tsx';
/** The bar that must be attached to the keyboard rather than animated at it. */
const DOCK = 'components/SearchDock.tsx';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts)$/.test(entry) && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

/**
 * Comments stripped, so the notes in this file and in useKeyboardLift -- which
 * necessarily name the very calls being counted -- do not trip the check. The
 * exact mistake scripts/local-binding-check.mjs made in its first version, and
 * the reason string literals are deliberately left alone: strip too much and a
 * gate can stop being able to fail at all.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

/** Files that CALL a name, as opposed to defining or documenting it. */
function callers(files: string[], name: string, allow: string): string[] {
  const re = new RegExp(`(?<!function\\s)\\b${name}\\s*\\(`);
  const hits: string[] = [];
  for (const f of files) {
    const rel = relative(ROOT, f);
    if (rel === allow) continue;
    if (re.test(code(readFileSync(f, 'utf8')))) hits.push(rel);
  }
  return hits;
}

const files = ROOTS.flatMap((r) => {
  try {
    return walk(join(ROOT, r));
  } catch {
    return [];
  }
});

const problems: string[] = [];

// ── Kyber and the app must call the same Amber ID service ────────────────────
//
// This is easy to miss because the keyboard has its own native networking
// client. A stale host returns a real 404 even while the app's requests work.
try {
  const appConfig = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'));
  const configuredHost = appConfig?.expo?.extra?.amberIdBaseUrl;
  const sessionSource = readFileSync(join(ROOT, 'targets/kyber/KyberSession.swift'), 'utf8');
  const nativeHost = sessionSource.match(/nonisolated\s+let\s+base\s*=\s*URL\(string:\s*"([^"]+)"\)/)?.[1];
  if (typeof configuredHost !== 'string' || !nativeHost) {
    problems.push('Could not read the Amber ID host from app.json and KyberSession.swift.');
  } else if (new URL(configuredHost).origin !== new URL(nativeHost).origin) {
    problems.push(
      `Kyber calls ${new URL(nativeHost).origin}, but app.json configures ${new URL(configuredHost).origin}.\n` +
        '  Keep the extension on the same production Amber ID host as the app.',
    );
  }
} catch (error) {
  problems.push(`Could not validate Kyber's Amber ID host: ${String(error)}`);
}

// ── 1. useAnimatedKeyboard is banned outright ─────────────────────────────────
//
// Not "allowed in one place" any more. It was the source of the whole problem:
// mounted more than once it fails silently, and even mounted exactly once it
// delivered two or three samples per keyboard instead of one per frame. The
// height is driven from the system notification now -- see lib/useKeyboardLift.
for (const stray of callers(files, 'useAnimatedKeyboard', '')) {
  problems.push(
    `${stray} calls useAnimatedKeyboard.\n` +
      `  Nothing may. Measured over three screen recordings it reports a handful of\n` +
      `  samples per keyboard and then goes quiet, so anything interpolating on it\n` +
      `  moves for two frames and then jumps. ${OWNER} drives the height from\n` +
      `  keyboardWillShow instead; read it with useKeyboardLift().`,
  );
}

// ── 2. the native hook is read in one file ────────────────────────────────────
for (const stray of callers(files, 'useReanimatedKeyboardAnimation', OWNER)) {
  problems.push(
    `${stray} calls useReanimatedKeyboardAnimation.\n` +
      `  ${OWNER} owns the keyboard position and publishes it as a module shared\n` +
      '  value; read it with useKeyboardLift(). One reader means the sign flip, the\n' +
      '  learned full height and the resting geometry cannot drift between callers.',
  );
}

// ── 3. the observer is invoked once ───────────────────────────────────────────
const observers = callers(files, 'useKeyboardObserver', PROBE);
for (const stray of observers) {
  problems.push(
    `${stray} calls useKeyboardObserver.\n` +
      `  That is the app's single keyboard observer and ${PROBE} already mounts it.\n` +
      `  A second one silently stops the live height from arriving -- no error, and\n` +
      `  every keyboard animation degrades to one jump at the end.`,
  );
}

// ── 3. and the probe is mounted once ──────────────────────────────────────────
const mounts = files.filter(
  (f) => relative(ROOT, f) !== PROBE && /<KeyboardProbe\b/.test(code(readFileSync(f, 'utf8'))),
);
if (mounts.length === 0) {
  problems.push(
    'Nothing mounts <KeyboardProbe />. Without it no keyboard height is ever\n' +
      '  observed, so every bar that rides the keyboard sits still. Mount it once in\n' +
      "  app/(gated)/_layout.tsx.",
  );
} else if (mounts.length > 1) {
  problems.push(
    `<KeyboardProbe /> is mounted in ${mounts.length} files:\n` +
      mounts.map((f) => `    ${relative(ROOT, f)}`).join('\n') +
      '\n  It must be mounted exactly once, above every screen.',
  );
}

// ── 4a. the dock is ATTACHED to the keyboard, not animated toward it ─────────
//
// The whole point, and the thing that survived four rewrites of the formula and
// a switch to native tracking without being noticed:
//
//   "I told you they should be one object that comes up together... Make them
//    one object. The keyboard and the search bar are one object."
//
// A view that computes its own translateY from the keyboard height is animating
// ALONGSIDE the keyboard, however live the height. KeyboardStickyView reads the
// keyboard's own frame. If the dock stops using it, it has gone back to being a
// second object.
try {
  const dock = code(readFileSync(join(ROOT, DOCK), 'utf8'));
  if (!/<KeyboardStickyView\b/.test(dock)) {
    problems.push(
      `${DOCK} does not use KeyboardStickyView.\n` +
        '  The bar must be attached to the keyboard, not animated to match it. Every\n' +
        '  version that computed its own lift -- five of them -- was a second object\n' +
        '  agreeing to move the same way, and every one of them read as lag.',
    );
  }
  if (/\btranslateY\b/.test(dock)) {
    problems.push(
      `${DOCK} sets translateY itself.\n` +
        '  Its vertical position belongs to the keyboard. The one number it may choose\n' +
        '  is the gap, passed as KeyboardStickyView\'s offset.',
    );
  }
} catch {
  problems.push(`${DOCK} is missing; this check cannot run.`);
}

// ── 4b. the provider is mounted, exactly once ─────────────────────────────────
//
// Without it the shared value never moves. No error, no warning -- every bar
// that rides the keyboard simply sits still, which is the exact shape of the bug
// this whole check exists for.
const providers = files.filter((f) => /<KeyboardProvider\b/.test(code(readFileSync(f, 'utf8'))));
if (providers.length === 0) {
  problems.push(
    'Nothing renders <KeyboardProvider />. react-native-keyboard-controller\n' +
      '  publishes nothing without it, so the keyboard height stays at zero forever\n' +
      '  and every bar sits still. Mount it once at the root, in app/_layout.tsx.',
  );
} else if (providers.length > 1) {
  problems.push(
    `<KeyboardProvider /> is rendered in ${providers.length} files:\n` +
      providers.map((f) => `    ${relative(ROOT, f)}`).join('\n') +
      '\n  It belongs at the root, once.',
  );
}

// ── 5. and the owner really does read the native value ────────────────────────
//
// WITHOUT THIS THE WHOLE CHECK PASSES BY COUNTING TO ZERO. Strip the observer's
// body and every rule above is satisfied: nothing calls the banned hook, nothing
// reads the native one twice, the probe is mounted once and the provider is
// mounted once -- around a hook that does nothing at all.
try {
  const owner = code(readFileSync(join(ROOT, OWNER), 'utf8'));
  if (!/\buseReanimatedKeyboardAnimation\s*\(/.test(owner)) {
    problems.push(
      `${OWNER} no longer reads the native keyboard position, so nothing tracks\n` +
        '  the keyboard at all and every bar that rides it sits still.',
    );
  }
  if (!/-\s*height\.value/.test(owner)) {
    problems.push(
      `${OWNER} is not negating the library's height. It reports the keyboard as a\n` +
        '  NEGATIVE number so it can be fed straight to translateY; everything here\n' +
        '  expects a positive height. Unflipped, the bar moves DOWN behind the\n' +
        '  keyboard instead of up in front of it.',
    );
  }
} catch {
  problems.push(`${OWNER} is missing; this check cannot run.`);
}

if (problems.length === 0) {
  console.log(`One keyboard observer, mounted once, across ${files.length} files.`);
  process.exit(0);
}

console.log('The keyboard is being observed more than once:\n');
for (const p of problems) console.log(`  ${p}\n`);
process.exitCode = 1;
