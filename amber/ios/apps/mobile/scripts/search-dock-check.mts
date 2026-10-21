/**
 * ONE SEARCH BAR, DEFINED BY WHAT IT DOES.
 *
 * Run with:  node --experimental-strip-types scripts/search-dock-check.mts
 *
 * "The search bar for the You page and the home page should be the same one,
 *  since they have the same functionality. Search bars should be components based
 *  on their functionality, just like everything else in React and just like
 *  everything else in our app. Is that right? Is that what you're doing?"
 *
 * Yes, and this file is what keeps the answer true. Four separate attempts at
 * "make the bars match" failed before the current shape -- they shared a height,
 * then a shell, then a wrapper inset, each closing one gap and leaving the next
 * open -- and the reason each one rotted is that agreement was maintained by
 * hand. So the three properties that make it one bar are checked:
 *
 *   1. ONE SHELL. Only SearchDock renders PeopleBottomBar. AskChat carried a
 *      second complete composer behind a `showComposer` flag that the app's only
 *      mount passed `false` to -- a duplicate of the most important control in
 *      the app, kept in agreement by hand, rendering nowhere.
 *
 *   2. SAME FUNCTIONALITY, ONE DEFINITION. Today and You are the same behavior,
 *      so they must resolve to the same object, not to two identical literals.
 *      They had already drifted once (You said "Search your circles", which
 *      undersold what the field does) and nothing caught it.
 *
 *   3. NO OTHER BOTTOM FIELD. No file outside SearchDock may hold a TextInput
 *      carrying one of the bar's placeholders, which is how a "temporary" second
 *      bar gets written.
 *
 *   4. AND THE PAGES UNDER IT LEAVE ROOM FOR IT.
 *
 *      "The bottom part for the 'What Amber Knows' ... doesn't go all the way
 *       down. It is hidden behind the search bar, so I can't see the words
 *       'Nothing Yet' on Spiritual and the bottom of the card."
 *
 *      The profile padded its scroll with clLayout.tabBarClearance -- 132, and
 *      named for what it clears, which is the TAB PILL. The dock floats above
 *      the pill, so the last card was thirty-odd points short on every phone.
 *      Two plausible constants, one of them describing a different object, and
 *      nothing to tell them apart by reading.
 *
 *      lib/peopleBar.test.mts asserts the geometry, and cannot catch this: the
 *      function was always correct and always available; the page called the
 *      other one. Reverting the page left every test green. So the rule is about
 *      the CALL SITE, which only a check over the source can see.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

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

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const files = ROOTS.flatMap((r) => {
  try {
    return walk(join(ROOT, r));
  } catch {
    return [];
  }
});

/** Code lines only: a comment describing the old duplicate is not the duplicate. */
function codeLines(src: string): string[] {
  return src
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));
}

// ── 1. one shell ────────────────────────────────────────────────────────────
const shellUsers = files.filter((f) => {
  if (/components\/PeopleBottomBar\.tsx$/.test(f)) return false; // it is the shell
  if (/scripts\//.test(f)) return false;
  return codeLines(readFileSync(f, 'utf8')).some((l) => /<PeopleBottomBar\b/.test(l));
});
check(
  'only SearchDock renders the bar shell',
  shellUsers.length === 1 && /components\/SearchDock\.tsx$/.test(shellUsers[0]),
  shellUsers.length === 0
    ? 'nothing renders it at all — that is also wrong'
    : shellUsers.map((f) => relative(ROOT, f)).join(', '),
);

// ── 2. same functionality, one definition ───────────────────────────────────
const MODES_SRC = readFileSync(join(ROOT, 'lib', 'searchModes.ts'), 'utf8');
/** The right-hand side of a mode entry, as written. */
function modeExpr(id: string): string {
  const m = MODES_SRC.match(new RegExp(`^\\s{2}${id}:\\s*(.+?)(?:,)?$`, 'm'));
  if (!m) throw new Error(`mode "${id}" not found in lib/searchModes.ts`);
  return m[1].trim();
}
const todayExpr = modeExpr('today');
const youExpr = modeExpr('you');
check(
  'Today and You are the SAME mode object, not two identical literals',
  todayExpr === youExpr && !todayExpr.startsWith('{'),
  `today: ${todayExpr}   you: ${youExpr}`,
);

// ── 3. no other bottom field ────────────────────────────────────────────────
// Every string the bar has ever said. Kept as a growing list rather than as
// "whatever searchModes holds today": the point is that no OTHER file carries
// one of these, and a retired placeholder turning up in some component is
// exactly the second bar this check exists to prevent.
const PLACEHOLDERS = ['Search', 'Tell Amber, or search', 'Search people'];
const strays = files.filter((f) => {
  if (/components\/SearchDock\.tsx$/.test(f)) return false;
  if (/lib\/searchModes\.ts$/.test(f)) return false; // it is the table
  if (/scripts\//.test(f)) return false;
  /**
   * MATCHED AS A PLACEHOLDER, NOT AS A STRING ANYWHERE IN THE FILE.
   *
   * This used to flag any occurrence of the text. That was fine while the bar
   * said "Tell Amber, or search" -- nobody writes that by accident -- and broke
   * the moment it said "Search", which immediately matched
   * `accessibilityLabel="Search"` on an unrelated icon button. A check that
   * fires on a common English word is a check somebody turns off.
   *
   * So it looks for the word in the PLACEHOLDER POSITION, which is the thing it
   * was always about: a second field, somewhere else, wearing this bar's words.
   */
  const lines = codeLines(readFileSync(f, 'utf8'));
  return lines.some(
    (l) =>
      /placeholder\s*=/.test(l) &&
      PLACEHOLDERS.some((ph) => l.includes(`"${ph}"`) || l.includes(`'${ph}'`)),
  );
});
check(
  "no file outside SearchDock carries the bar's own placeholder",
  strays.length === 0,
  strays.map((f) => relative(ROOT, f)).join(', '),
);

// ── 4. a page that scrolls under the dock clears the dock ───────────────────
//
// Scoped to the pager's pages, which are the ones the dock is drawn over:
// SearchDock is mounted by app/(gated)/home.tsx OUTSIDE the pager, so every page
// inside it is underneath the bar for the whole life of the screen. A pushed
// route has no dock and is right to use the pill's own clearance.
//
// clLayout.fabClearance (196) is allowed: it is larger than the dock's top edge
// on every device, and it is what the pages that also sit under the mic FAB use.
const PAGER_PAGES = ['components/pages/HomePage.tsx', 'components/pages/ProfilePage.tsx'];
const shortPages = PAGER_PAGES.filter((rel) => {
  try {
    return codeLines(readFileSync(join(ROOT, rel), 'utf8')).some((l) =>
      /paddingBottom:\s*clLayout\.tabBarClearance/.test(l),
    );
  } catch {
    return false;
  }
});
check(
  'the pages under the dock pad for the dock, not for the tab pill',
  shortPages.length === 0,
  shortPages.length
    ? `${shortPages.join(', ')} uses clLayout.tabBarClearance (132pt, the PILL). ` +
      `The dock's top edge is peopleBarBottom + PEOPLE_BAR_H, about 166pt with a ` +
      `home indicator, so the last card sits behind the bar. Use ` +
      `peopleBarClearance(insets.bottom) from lib/peopleBar.`
    : '',
);

console.log(
  failures === 0
    ? `\nOne bar, one definition, across ${files.length} files.`
    : `\n${failures} FAILED`,
);
if (failures > 0) process.exitCode = 1;
