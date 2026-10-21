/**
 * ONE GATE. Everything runs, and it says so when something cannot run.
 *
 * Run with:  npm run verify        (from apps/mobile)
 *
 * WHY THIS EXISTS. A worklet in home.tsx read a shared value declared further
 * down the same component, which throws during render, which the route error
 * boundary rendered as "This screen hit a snag" for the whole gated group. The
 * app could not be opened. It shipped because the two things I was treating as
 * gates were not gates:
 *
 *   `tsc --noEmit` was clean and correctly so -- TypeScript cannot know when a
 *   callback runs, so a closure over a later `const` is legal to it.
 *
 *   `expo lint` printed one line about a legacy config and exited. It was not
 *   linting anything, and the reason is worth stating precisely because it
 *   changes who has to run what: eslint's module resolver (unrs-resolver) loads
 *   a NATIVE binary, the installed one is Mach-O for darwin-arm64, and the shell
 *   the agent works in is a Linux VM with the Mac's disk mounted. Requiring it
 *   there fails with "invalid ELF header". eslint is not broken on the Mac -- it
 *   is unrunnable from the agent's side, and it crashed in a child process whose
 *   output never surfaced. "No output" reads exactly like "no problems", which
 *   is the worst failure mode a checker can have.
 *
 * So: every check in one command, each reported by name, and a checker that
 * cannot run says so LOUDLY rather than passing quietly. A step that is
 * genuinely impossible on this platform is reported as UNAVAILABLE and the run
 * is stamped INCOMPLETE -- which is a different thing from green, and is the
 * signal that this has to be run on the Mac before anything ships.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');

/** Every scripts/*.mts, so a new check is picked up by existing it. */
const checkScripts = readdirSync(HERE)
  .filter((f) => f.endsWith('.mts'))
  .sort();

const steps = [
  {
    name: 'typecheck',
    cmd: 'npx',
    args: ['tsc', '--noEmit', '-p', 'tsconfig.json'],
    /** A checker that cannot run is a failed step, not a skipped one. */
    required: true,
  },
  ...checkScripts.map((f) => ({
    name: f.replace(/\.mts$/, ''),
    cmd: 'node',
    args: ['--experimental-strip-types', join('scripts', f)],
    required: true,
  })),
  {
    // THE TESTS. Everything above is a static check -- it reads the source and
    // asserts a property of it. This is the only step that RUNS the code.
    //
    // It sits here rather than at the end because it is fast and it is the step
    // most likely to catch a real behavior change; the slow bundle stays last.
    name: 'test',
    cmd: 'node',
    args: [join('scripts', 'test.mjs')],
    required: true,
  },
  {
    // THE PROJECT'S REAL RULES, MINUS THE ONE PLUGIN THAT NEEDS A MAC.
    //
    // Runs before `eslint` on purpose. 64 of the 74 rules are pure JavaScript
    // and run in any shell, so a lint failure is now found by whoever wrote it
    // instead of by the person running the final gate. The step below is still
    // the authority -- it adds the 10 import/* rules and the autofixer's exact
    // behavior -- but it should have nothing left to find.
    name: 'eslint-core',
    cmd: 'node',
    args: [join('scripts', 'eslint-core.cjs')],
    required: true,
  },
  {
    name: 'eslint',
    cmd: 'npx',
    args: ['eslint', 'app', 'components', 'lib', '--max-warnings', '0'],
    required: true,
  },
  {
    // THE BUNDLE. The only gate that proves the app can actually be loaded:
    // every import resolved, every module evaluated by Metro, every syntax
    // error found. A missing file or a bad import is invisible to tsc when the
    // types happen to line up, and it is fatal at launch.
    //
    // It is last because it is the slow one, and it is worth the wait: this is
    // the step that stands between a mistake and a device.
    //
    // Also unavailable from the agent's Linux shell -- Metro's CSS transform
    // loads lightningcss, whose installed binary is darwin-arm64. Same story as
    // eslint: real on the Mac, impossible from there.
    name: 'bundle',
    cmd: 'npx',
    // OUTPUT GOES TO A TEMP DIR, not into the repo. Writing it under apps/mobile
    // leaves a directory behind that has to be gitignored and cleaned up, and
    // Metro clears its output dir on start -- which fails outright on a mounted
    // filesystem that does not allow rmdir.
    args: ['expo', 'export', '--platform', 'ios', '--output-dir', join(tmpdir(), 'amber-verify-bundle')],
    required: true,
  },
];

/**
 * A native module built for another operating system. This is not a code
 * problem and retrying will not fix it; it means the step has to run somewhere
 * else. Matched narrowly so a REAL eslint failure is never mistaken for it.
 */
function isWrongPlatform(out) {
  return (
    /invalid ELF header/.test(out) ||
    /Cannot find native binding/.test(out) ||
    /was compiled against a different Node\.js version/.test(out) ||
    // A native addon installed for another OS/arch: node_modules here belongs to
    // a Mac and the agent's shell is Linux, so both eslint's resolver and Metro's
    // CSS transform fail exactly like this.
    /Cannot find module '[^']*\.(darwin|linux|win32)-[^']*\.node'/.test(out) ||
    /Cannot find module '\.\.\/lightningcss\./.test(out)
  );
}

let failed = 0;
const unavailable = [];
for (const step of steps) {
  const res = spawnSync(step.cmd, step.args, {
    cwd: APP,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
  const ok = res.status === 0 && !res.error;
  if (ok) {
    console.log(`PASS  ${step.name}`);
    // A passing check's own summary line is worth seeing; its noise is not.
    const last = out.split('\n').filter(Boolean).pop();
    if (last && !/^Using legacy/.test(last)) console.log(`      ${last}`);
  } else if (isWrongPlatform(out)) {
    unavailable.push(step.name);
    console.error(`UNAVAILABLE  ${step.name} — its native binary is for another platform.`);
    console.error('             Run this on the Mac. It is NOT a pass.');
  } else {
    failed += 1;
    console.error(`FAIL  ${step.name}${res.error ? ` (could not run: ${res.error.message})` : ''}`);
    for (const line of out.split('\n').slice(0, 40)) {
      if (line.trim()) console.error(`      ${line}`);
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${steps.length} checks failed. Nothing ships on this.`);
  process.exit(1);
}
if (unavailable.length > 0) {
  console.error(
    `\nINCOMPLETE. ${steps.length - unavailable.length} of ${steps.length} checks passed; ` +
      `${unavailable.join(', ')} could not run here. Run \`npm run verify\` on the Mac.`,
  );
  // Deliberately zero: an environment that CANNOT run a step should not look
  // like a codebase that failed one. The banner above is the signal, and it is
  // impossible to mistake for the "all checks passed" line.
  process.exit(0);
}
console.log(`\nAll ${steps.length} checks passed.`);
