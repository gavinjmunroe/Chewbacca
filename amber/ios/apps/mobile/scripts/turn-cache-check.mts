/**
 * AN ANSWER THAT RENDERED MUST STILL BE THERE WHEN THE THREAD IS REOPENED.
 *
 * Run with:  node --experimental-strip-types scripts/turn-cache-check.mts
 *
 * The failure this guards: the assistant row failed to write server-side, this
 * app had already dropped its copy, and a 26-second answer was gone for good.
 * These are the cache's RULES -- matching, replacement, capping, eviction --
 * which is where that guarantee actually lives; lib/turnCache.ts is the thin
 * AsyncStorage adapter over them.
 */
import {
  upsertTurn,
  findTurn,
  parseEntries,
  threadsToEvict,
  isStorable,
  normalizeQuery,
  MAX_TURNS,
} from '../lib/turnCacheRules.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

// The answer comes back for the question that produced it.
let thread = upsertTurn([], {
  query: 'who do I know in fintech',
  answer: 'Neel Patel, and two others.',
  metadata: { people: [{ contactId: '1', name: 'Neel Patel' }] },
});
check('the answer comes back for its question', findTurn(thread, 'who do I know in fintech')?.answer === 'Neel Patel, and two others.');
check(
  'with the metadata needed to redraw it',
  Array.isArray((findTurn(thread, 'who do I know in fintech')?.metadata as any)?.people),
);
check(
  'spacing and case are not differences',
  findTurn(thread, '  Who do I know   in FINTECH ')?.answer === 'Neel Patel, and two others.',
);
check('a different question gets nothing', findTurn(thread, 'something else') === null);
check('an empty question gets nothing', findTurn(thread, '   ') === null);

// A retried turn replaces its entry rather than stacking a second copy.
thread = upsertTurn(thread, { query: 'who do I know in FINTECH', answer: 'A better answer.' });
check('a retry replaces the entry', thread.length === 1, `${thread.length} entries`);
check('and the newer answer wins', findTurn(thread, 'who do I know in fintech')?.answer === 'A better answer.');

// Junk is refused rather than stored.
check('no question is not storable', !isStorable({ query: '  ', answer: 'orphan' }));
check('no answer is not storable', !isStorable({ query: 'q', answer: '   ' }));
check(
  'and upsert refuses it too',
  upsertTurn(thread, { query: '', answer: 'orphan' }).length === thread.length,
);

// A thread caps its turns and keeps the newest.
let big: ReturnType<typeof upsertTurn> = [];
for (let i = 0; i < 40; i += 1) big = upsertTurn(big, { query: `q${i}`, answer: `a${i}` });
check('a thread is capped', big.length === MAX_TURNS, `${big.length} entries`);
check('and keeps the newest', big[big.length - 1].answer === 'a39');
check('the oldest are the ones dropped', findTurn(big, 'q0') === null);

// Corrupt storage reads as empty rather than throwing.
check('a corrupt entry reads as empty', parseEntries('{not json').length === 0);
check('a non-array reads as empty', parseEntries('{"a":1}').length === 0);
check('a missing entry reads as empty', parseEntries(null).length === 0);
check(
  'misshapen rows are dropped, good ones kept',
  parseEntries('[{"query":"q","answer":"a"},{"nope":1},null]').length === 1,
);

// Eviction keeps the most recently ANSWERED threads.
const t = (savedAt: number) => JSON.stringify([{ query: 'q', answer: 'a', savedAt }]);
const evicted = threadsToEvict(
  [
    { key: 'old', raw: t(1000) },
    { key: 'newest', raw: t(9000) },
    { key: 'middle', raw: t(5000) },
    { key: 'corrupt', raw: '{' },
  ],
  2,
);
check('eviction keeps the newest two', !evicted.includes('newest') && !evicted.includes('middle'), evicted.join(','));
check('and drops the oldest and the unreadable', evicted.includes('old') && evicted.includes('corrupt'), evicted.join(','));
check('nothing is evicted under the cap', threadsToEvict([{ key: 'a', raw: t(1) }], 5).length === 0);

check('normalizeQuery is stable', normalizeQuery('  A   B ') === 'a b');

console.log(failures === 0 ? '\nall turn-cache checks passed' : `\n${failures} FAILED`);
if (failures > 0) process.exitCode = 1;
