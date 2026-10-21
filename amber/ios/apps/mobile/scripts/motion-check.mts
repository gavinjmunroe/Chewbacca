/**
 * NOTHING IN THIS APP SLIDES UP FROM OFF-SCREEN.
 *
 * Run with:  node --experimental-strip-types scripts/motion-check.mts
 *
 * "When you press the filters button there's this gross flash-up that slides up
 *  with this dark screen. It needs to be a smoother fade-in and fade-out.
 *  Throughout the entire app there should never be any gross slide-up
 *  transitions. Everything should be fade-in and fade-out or elegant slides,
 *  nothing else."
 *
 * React Native's animationType="slide" throws the panel up from below the screen
 * at full speed while the dim backdrop appears at full strength in a single
 * frame -- so the background flashes dark and the panel races it from the bottom.
 * Thirteen modals were doing that. "fade" cross-dissolves the whole modal, dim
 * and panel together, which is the transition he asked for.
 *
 * This is a rule about the app rather than about one screen, which is exactly the
 * kind of thing that comes back one component at a time. So it is checked: a
 * grep, but a grep that fails the build.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['components', 'app', 'lib'];
const SKIP = new Set(['node_modules', '.expo', 'ios', 'android', 'dist', 'build']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap((r) => {
  try {
    return walk(join(ROOT, r));
  } catch {
    return [];
  }
});

type Offense = { file: string; line: number; text: string };
const offenses: Offense[] = [];

/**
 * The banned forms. Each is a way of saying "come in from off the bottom edge".
 * `presentation: 'modal'` on an expo-router Screen is NOT here: that is the OS's
 * own sheet, which is a controlled interactive drag rather than a flung panel,
 * and it is the "elegant slide" half of what he allowed.
 */
const BANNED: Array<{ re: RegExp; why: string }> = [
  {
    re: /animationType\s*=\s*["']slide["']/,
    why: 'Modal animationType="slide" — use "fade"',
  },
  {
    re: /animationType\s*=\s*\{\s*["']slide["']\s*\}/,
    why: 'Modal animationType={"slide"} — use "fade"',
  },
  {
    re: /animation:\s*["']slide_from_bottom["']/,
    why: "Stack animation 'slide_from_bottom' — use 'fade' or the OS sheet presentation",
  },
];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  // Do not police this file's own descriptions of what is banned.
  if (file.endsWith('motion-check.mts')) continue;
  src.split('\n').forEach((line, i) => {
    // A line that is plainly commentary about the rule is not a violation of it.
    const stripped = line.trim();
    if (stripped.startsWith('//') || stripped.startsWith('*')) return;
    for (const { re, why } of BANNED) {
      if (re.test(line)) {
        offenses.push({ file: relative(ROOT, file), line: i + 1, text: why });
      }
    }
  });
}

if (offenses.length > 0) {
  console.error('Slide-up transitions found. Everything fades:\n');
  for (const o of offenses) console.error(`  ${o.file}:${o.line}  ${o.text}`);
  console.error(
    `\n${offenses.length} offense${offenses.length === 1 ? '' : 's'}. ` +
      'See the note at the top of scripts/motion-check.mts.',
  );
  process.exit(1);
}

console.log(`No slide-up transitions in ${files.length} files. Everything fades.`);
