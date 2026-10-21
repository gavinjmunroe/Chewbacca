/**
 * THE TEST RUNNER. Every *.test.mts under app/, components/, lib/ and scripts/.
 *
 *   npm test                 # from apps/mobile
 *   npm test -- lib/phone    # only files whose path contains "lib/phone"
 *
 * WHY THIS EXISTS. This app had ZERO tests. Not few -- zero. What guarded it was
 * ten static checks (palette, hooks, motion, imports, tdz, spelling...) plus
 * `tsc --noEmit`, and those catch a broken import or an off-palette color. None
 * of them would notice if a redesign quietly dropped a button, or if the people
 * search stopped matching a name with an accent in it.
 *
 * That is the exact risk of a UI pass: the behavior lives in screens of two and
 * a half thousand lines, and a redesign rewrites those screens. A missing
 * handler is invisible until somebody taps it in TestFlight.
 *
 * WHY node:test AND NOT JEST. Nothing to install and nothing to configure, so
 * the suite cannot rot into "the tests don't run on my machine". Node 22 strips
 * the types itself (--experimental-strip-types), so a .test.mts imports a .ts
 * module directly with no build step and no transform config. Tests of anything
 * that mounts a React Native tree need a renderer and belong in a second tier;
 * everything here is logic, contracts and source analysis, which is where the
 * defects this suite has already found actually lived.
 *
 * WHAT IT REFUSES TO DO. It does not skip a file it cannot load. A test file
 * that throws on import is a FAILURE, loudly, because a suite that quietly drops
 * a file is worse than no suite at all -- it reports green over a hole.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const ROOTS = ['lib', 'components', 'app', 'scripts'];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.expo' || e.name === 'dist') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.test\.mts$/.test(e.name)) out.push(full);
  }
  return out;
}

const filter = process.argv.slice(2).filter((a) => !a.startsWith('-'));
let files = ROOTS.flatMap((r) => walk(join(APP, r))).sort();
if (filter.length > 0) {
  files = files.filter((f) => filter.some((n) => f.includes(n)));
}

if (files.length === 0) {
  console.error(
    filter.length > 0
      ? `No test files matched ${JSON.stringify(filter)}.`
      : 'No test files found. That is a failure, not a pass: this suite exists precisely so\n' +
          'that an empty one is never mistaken for a clean one.',
  );
  process.exit(1);
}

const res = spawnSync(
  process.execPath,
  [
    '--experimental-strip-types',
    // The stub loader (scripts/test-loader.mjs) maps react-native, expo-* and
    // the rest of the native surface to scripts/test-stubs/, so the suite runs
    // with no node_modules, no Metro and no simulator. See that file for why.
    '--import',
    './scripts/test-loader.mjs',
    // The .ts modules under test have no "type" field in package.json (adding
    // one would change how Metro reads it), so every import prints a reparse
    // warning. The warning is about this file's loader, not about the code.
    '--no-warnings=MODULE_TYPELESS_PACKAGE_JSON',
    '--test',
    ...(process.argv.includes('--watch') ? ['--watch'] : []),
    ...files.map((f) => relative(APP, f)),
  ],
  { cwd: APP, stdio: 'inherit', env: { ...process.env, AMBER_TEST: '1' } },
);

if (res.error) {
  console.error(`Could not start the test runner: ${res.error.message}`);
  process.exit(1);
}
process.exit(res.status ?? 1);
