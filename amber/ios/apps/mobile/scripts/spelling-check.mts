/**
 * THE APP IS WRITTEN IN AMERICAN ENGLISH.
 *
 * Run with:  node --experimental-strip-types scripts/spelling-check.mts
 *
 * "Stop using British English for stuff. Use American English."
 *
 * Fair, and it had crept into about 130 files -- color, behavior, gray,
 * centered, recognize, honored, while. Almost all of it in comments, which does
 * not reach a user but does reach anyone reading the codebase, and some of it in
 * prompts that go out to a search API and to the model, where "neighborhood" is
 * simply a worse query against mostly-US content.
 *
 * So it is checked. Not as taste: an app being shown to investors and users
 * should read as one voice, and a spelling convention maintained by remembering
 * is a spelling convention that drifts one file at a time.
 *
 * WHAT IS DELIBERATELY NOT FLAGGED:
 *
 *   `cancelled` -- a local variable name in a dozen cancellation effects, and a
 *   field on expo's own picker result. Renaming a borrowed API is not spelling.
 *
 *   `burnt` -- "burnt orange" is the American name of the color.
 *
 *   Anything inside a string on the server's archived migrations, which record
 *   what was already applied and must not be edited after the fact.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['app', 'components', 'lib', 'scripts'];
const SKIP = new Set(['node_modules', '.expo', 'ios', 'android', 'dist', 'build']);

/** British -> American. The base word catches its own inflections. */
const BRITISH = [
  'colour', 'behaviour', 'flavour', 'honour', 'neighbour', 'favour', 'rumour',
  'humour', 'armour', 'vapour', 'labour', 'endeavour',
  'recognise', 'organise', 'realise', 'apologise', 'emphasise', 'minimise',
  'maximise', 'normalise', 'summarise', 'prioritise', 'initialise', 'serialise',
  'memoise', 'utilise', 'analyse', 'paralyse',
  'defence', 'offence', 'pretence', 'licence',
  'centre', 'metre', 'theatre', 'fibre', 'litre', 'calibre', 'sombre',
  'travelled', 'travelling', 'labelled', 'labelling', 'modelling',
  'signalling', 'fuelled', 'marvellous', 'skilful', 'wilful',
  'instalment', 'enrolment', 'judgement', 'acknowledgement',
  'whilst', 'amongst', 'grey', 'catalogue', 'dialogue', 'programme',
  'kerb', 'plough', 'smoulder', 'moustache', 'aeroplane', 'cheque',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
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

const re = new RegExp(`\\b(${BRITISH.join('|')})[a-z]*`, 'gi');
type Hit = { file: string; line: number; word: string };
const hits: Hit[] = [];

for (const file of files) {
  // This file names every word it is looking for; policing it would be a loop.
  if (file.endsWith('spelling-check.mts')) continue;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        hits.push({ file: relative(ROOT, file), line: i + 1, word: m[0] });
      }
    });
}

if (hits.length > 0) {
  console.error('British spellings found. This app is written in American English:\n');
  for (const h of hits.slice(0, 60)) {
    console.error(`  ${h.file}:${h.line}  ${h.word}`);
  }
  if (hits.length > 60) console.error(`  … and ${hits.length - 60} more`);
  console.error(`\n${hits.length} occurrence${hits.length === 1 ? '' : 's'}.`);
  process.exit(1);
}

console.log(`American English across ${files.length} files.`);
