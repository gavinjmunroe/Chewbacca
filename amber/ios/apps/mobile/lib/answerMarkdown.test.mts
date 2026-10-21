/**
 * THE ANSWER PARSER. Everything Amber says is rendered through this.
 *
 * Its input is whatever a language model streams -- markdown that is sometimes
 * malformed, sometimes half-arrived, and never validated. When it gets something
 * wrong the user does not see a parser error, they see literal hash marks in a
 * heading, a numbered list silently renumbered from 1, or a table whose columns
 * have sheared. Those all shipped at some point; the comments in the module name
 * them.
 *
 * The module's own header says it was split out of RichAnswer.tsx precisely so
 * it "can actually be exercised", because there was no test runner. Now there is.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAFE_URL,
  isDivider,
  parseAnswer,
  plainLength,
  splitRow,
  tokenizeInline,
} from './answerMarkdown.ts';

const kinds = (s: string) => tokenizeInline(s).map((t) => `${t.kind}:${'text' in t ? t.text : (t as any).n}`);

// ── inline ──────────────────────────────────────────────────────────────────

test('bold, italic, links and citations are recognized', () => {
  assert.deepEqual(kinds('plain'), ['text:plain']);
  assert.deepEqual(kinds('**Priya** is here'), ['bold:Priya', 'text: is here']);
  assert.deepEqual(kinds('an *emphasis* here'), ['text:an ', 'italic:emphasis', 'text: here']);
  assert.deepEqual(tokenizeInline('see [the page](https://example.com/x)'), [
    { kind: 'text', text: 'see ' },
    { kind: 'link', text: 'the page', url: 'https://example.com/x' },
  ]);
  assert.deepEqual(kinds('as reported [3]'), ['text:as reported ', 'cite:3']);
});

test('ONLY http and https ever become a tappable link', () => {
  // The renderer hands a link's url to Linking.openURL. A javascript: or file:
  // url reaching that is the one genuinely dangerous thing this parser could do.
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<script>', 'amber://x']) {
    const toks = tokenizeInline(`[tap me](${bad})`);
    assert.ok(!toks.some((t) => t.kind === 'link'), `${bad} became a link`);
    assert.equal(SAFE_URL.test(bad), false, bad);
  }
  assert.equal(SAFE_URL.test('https://example.com'), true);
  assert.equal(SAFE_URL.test('HTTP://EXAMPLE.COM'), true);
});

test('unclosed and empty markers are left as text rather than eaten', () => {
  // A streamed answer is mid-sentence constantly: "**Pri" arrives before the
  // closing stars do. Swallowing it makes text vanish and reappear as it types.
  assert.deepEqual(kinds('**unclosed'), ['text:**unclosed']);
  assert.deepEqual(kinds('****'), ['text:****']);
  assert.deepEqual(kinds('* *'), ['text:* *']);
  assert.deepEqual(kinds(''), []);
  assert.deepEqual(kinds('2 * 3 * 4'), ['text:2 * 3 * 4'], 'arithmetic rendered as italics');
});

test('NO CHARACTER IS EVER LOST BETWEEN THE ANSWER AND THE TOKENS', () => {
  // The strongest thing that can be said about a tokenizer that feeds a screen:
  // put the pieces back together and you have the sentence, markers included
  // where they were left as text and stripped where they were understood.
  const cases = [
    'plain words',
    '**Priya** and *Marcus* went to [the place](https://example.com) [4]',
    'unclosed ** and * and [broken](notaurl) and [999]',
    '2 * 3 * 4 = 24',
    '',
    'a **b** c *d* e',
  ];
  for (const input of cases) {
    const rebuilt = tokenizeInline(input)
      .map((t) =>
        t.kind === 'bold' ? `**${t.text}**`
        : t.kind === 'italic' ? `*${t.text}*`
        : t.kind === 'link' ? `[${t.text}](${t.url})`
        : t.kind === 'cite' ? `[${t.n}]`
        : t.text,
      )
      .join('');
    assert.equal(rebuilt, input, `tokens do not reassemble: ${JSON.stringify(input)}`);
  }
});

test('a citation number is at most two digits, so a year is not a citation', () => {
  assert.deepEqual(kinds('[12]'), ['cite:12']);
  assert.deepEqual(kinds('[2026]'), ['text:[2026]']);
});

// ── tables ──────────────────────────────────────────────────────────────────

test('a table is recognized by its divider, not by containing a pipe', () => {
  // "the ratio is 3|4 in most cases" is a sentence, not a header row.
  assert.deepEqual(parseAnswer('the ratio is 3|4 in most cases'), [
    { type: 'p', text: 'the ratio is 3|4 in most cases' },
  ]);
  assert.equal(isDivider('|---|---|'), true);
  assert.equal(isDivider('| :--- | ---: |'), true);
  assert.equal(isDivider('| a | b |'), false);
  assert.equal(isDivider('|   |   |'), false, 'a row of blanks is not a divider');
});

test('a malformed row cannot shear the columns of the whole table', () => {
  const [block] = parseAnswer(
    ['| Name | City | Role |', '|---|---|---|', '| Ana | Denver | Nurse |', '| Sam |', '| A | B | C | D |'].join('\n'),
  ) as any[];
  assert.equal(block.type, 'table');
  assert.deepEqual(block.head, ['Name', 'City', 'Role']);
  for (const row of block.rows) {
    assert.equal(row.length, block.head.length, `row ${JSON.stringify(row)} is not the header width`);
  }
  assert.deepEqual(block.rows[1], ['Sam', '', '']);
  assert.deepEqual(block.rows[2], ['A', 'B', 'C']);
});

test('splitRow trims and does not invent empty edge cells', () => {
  assert.deepEqual(splitRow('| a | b |'), ['a', 'b']);
  assert.deepEqual(splitRow('a | b'), ['a', 'b']);
  assert.deepEqual(splitRow('|  spaced  |x|'), ['spaced', 'x']);
});

test('plainLength measures what is on screen, not what is in the markdown', () => {
  assert.equal(plainLength('**bold**'), 4);
  assert.equal(plainLength('[label](https://example.com/very/long)'), 5);
  assert.equal(plainLength('plain'), 5);
});

// ── blocks ──────────────────────────────────────────────────────────────────

test('headings are parsed rather than shown with their hashes', () => {
  assert.deepEqual(parseAnswer('## Errands\n### Later'), [
    { type: 'h', text: 'Errands', level: 2 },
    { type: 'h', text: 'Later', level: 3 },
  ]);
  assert.deepEqual(parseAnswer('#### deep'), [{ type: 'h', text: 'deep', level: 3 }]);
  assert.deepEqual(parseAnswer('#no space'), [{ type: 'p', text: '#no space' }]);
  // A bare "###" with no text after it is NOT a heading -- the syntax requires a
  // space and something to say -- so it stays the literal characters the model
  // emitted. Pinned as the actual behavior rather than as a wish: dropping it
  // silently would mean a line the model wrote disappearing with nothing to show
  // for it, and that is the harder failure to notice of the two.
  assert.deepEqual(parseAnswer('###'), [{ type: 'p', text: '###' }]);
});

test('a rule is a rule, and three dashes under a table row are a divider', () => {
  assert.deepEqual(parseAnswer('---'), [{ type: 'hr' }]);
  assert.deepEqual(parseAnswer('***'), [{ type: 'hr' }]);
  const blocks = parseAnswer('| a | b |\n|---|---|\n| 1 | 2 |');
  assert.equal(blocks[0].type, 'table', 'the dashes were read as a horizontal rule instead of a table divider');
});

test('CONSECUTIVE BULLETS ARE ONE LIST, NOT ONE LIST PER LINE', () => {
  // Flushing the bullet list on every bullet emits a separate one-item list per
  // line, which renders as a column of lonely dots with a gap between each.
  assert.deepEqual(parseAnswer('- one\n- two\n- three'), [{ type: 'ul', items: ['one', 'two', 'three'] }]);
  assert.deepEqual(parseAnswer('* a\n+ b\n- c'), [{ type: 'ul', items: ['a', 'b', 'c'] }]);
});

test('a numbered list that starts at three still starts at three', () => {
  // The renderer used to count from 1 regardless, so a model continuing
  // "3. 4. 5." after a paragraph had its numbers rewritten -- worse than no
  // numbers, because the prose around them refers to them.
  assert.deepEqual(parseAnswer('3. third\n4. fourth'), [
    { type: 'ol', items: ['third', 'fourth'], start: 3 },
  ]);
  assert.deepEqual(parseAnswer('1. one'), [{ type: 'ol', items: ['one'], start: 1 }]);
  assert.deepEqual(parseAnswer('1) one\n2) two'), [{ type: 'ol', items: ['one', 'two'], start: 1 }]);
});

test('a checklist keeps its boxes instead of printing them', () => {
  assert.deepEqual(parseAnswer('- [ ] call Ana\n- [x] book the room\n- [X] pay'), [
    {
      type: 'todo',
      items: [
        { text: 'call Ana', done: false },
        { text: 'book the room', done: true },
        { text: 'pay', done: true },
      ],
    },
  ]);
});

test('a checklist and a plain bullet list do not merge into each other', () => {
  const blocks = parseAnswer('- [ ] a task\n- just a bullet');
  assert.deepEqual(blocks.map((b) => b.type), ['todo', 'ul']);
});

test('a blank line ends a block; a paragraph joins its lines with a space', () => {
  assert.deepEqual(parseAnswer('one\ntwo\n\nthree'), [
    { type: 'p', text: 'one two' },
    { type: 'p', text: 'three' },
  ]);
});

test('a list followed by prose closes the list', () => {
  assert.deepEqual(parseAnswer('- a\n- b\nand then some prose'), [
    { type: 'ul', items: ['a', 'b'] },
    { type: 'p', text: 'and then some prose' },
  ]);
});

test('nothing in, nothing out, and never a crash', () => {
  for (const input of ['', '   ', '\n\n\n', null, undefined, 12345]) {
    assert.doesNotThrow(() => parseAnswer(input as any), JSON.stringify(input));
  }
  assert.deepEqual(parseAnswer(''), []);
  assert.deepEqual(parseAnswer('\n\n'), []);
});

test('A HALF-ARRIVED ANSWER NEVER LOSES TEXT', () => {
  // The answer streams in. Every prefix of it gets parsed and rendered, so the
  // invariant that matters most is that no prefix drops content the reader
  // already saw: what is on screen must only ever grow.
  const full = [
    '## Who to see',
    '',
    'Two people stand out, **Priya Raghunathan** and Marcus.',
    '',
    '| Name | City |',
    '|---|---|',
    '| Priya | New York |',
    '',
    '- [ ] text Priya',
    '- [x] already texted Marcus',
    '',
    '3. third thing',
    '4. fourth thing',
    '',
    'See [the note](https://example.com/n) for more [2].',
  ].join('\n');
  const rendered = (blocks: any[]) =>
    blocks
      .map((b) =>
        b.type === 'table'
          ? [...b.head, ...b.rows.flat()].join(' ')
          : b.type === 'todo'
            ? b.items.map((i: any) => i.text).join(' ')
            : b.type === 'ul' || b.type === 'ol'
              ? b.items.join(' ')
              : b.type === 'hr'
                ? ''
                : b.text,
      )
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

  for (let n = 1; n <= full.length; n += 1) {
    assert.doesNotThrow(() => parseAnswer(full.slice(0, n)), `prefix of length ${n} threw`);
  }
  const whole = rendered(parseAnswer(full));
  assert.ok(whole.includes('Priya Raghunathan'));
  assert.ok(whole.includes('text Priya'));
  assert.ok(whole.includes('third thing'));
  assert.ok(!whole.includes('|---|'), 'the table divider leaked into the visible text');
  assert.ok(!whole.includes('##'), 'a heading rendered with its hashes');
  assert.ok(!whole.includes('[ ]'), 'a checkbox rendered as literal brackets');
});
