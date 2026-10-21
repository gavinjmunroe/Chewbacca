/**
 * WHICH OF THE THREE THINGS A CARD IS, AND WHAT COLOR THAT MAKES IT.
 *
 * Small, and worth pinning for one reason: the split between a reminder that
 * goes on the day and a reminder that goes in this list is the difference
 * between "pick up the prescription at four" appearing on the calendar and
 * disappearing into a note. It rests on one nullable column, and a change that
 * made every reminder look scheduled would empty the list without erroring.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JOURNAL_KIND,
  JOURNAL_KINDS,
  byProminence,
  isScheduled,
  kindOfNote,
  type JournalKind,
} from './journalKinds.ts';

test('a note filed to somebody is a network note; one that is not is a journal', () => {
  assert.equal(kindOfNote({ people: [{ contactId: 'c1' }] }), 'network');
  assert.equal(kindOfNote({ people: [] }), 'journal');
  assert.equal(kindOfNote({ people: null }), 'journal');
  assert.equal(kindOfNote({}), 'journal');
});

test('A NAME AMBER COULD NOT PLACE IS NOT A NETWORK NOTE', () => {
  // The mention resolved to nobody, so there is no card to open. Painting it
  // orange promises a person the tap cannot deliver.
  assert.equal(kindOfNote({ people: [{ contactId: null }] }), 'journal');
  assert.equal(kindOfNote({ people: [null] }), 'journal');
  assert.equal(kindOfNote({ people: [{ contactId: undefined }] }), 'journal');
  // One resolved person among unresolved ones is enough.
  assert.equal(kindOfNote({ people: [{ contactId: null }, { contactId: 'c2' }] }), 'network');
});

test('THE SPLIT: a time puts a reminder on the day, no time keeps it in the list', () => {
  assert.equal(isScheduled({ dueAt: '2026-09-08T16:00:00Z' }), true);
  assert.equal(isScheduled({ remindAt: '2026-09-08T16:00:00Z' }), true);
  // "Remind me to eventually start studying for the LSAT."
  assert.equal(isScheduled({ dueAt: null }), false);
  assert.equal(isScheduled({}), false);
  assert.equal(isScheduled(null), false);
  assert.equal(isScheduled(undefined), false);
  // An unparseable time is not a time. Treating it as scheduled would put the
  // reminder on a day nobody can find.
  assert.equal(isScheduled({ dueAt: 'soon' }), false);
  assert.equal(isScheduled({ dueAt: '   ' }), false);
});

test('every kind has a label and a color, and the three are distinct', () => {
  assert.deepEqual(JOURNAL_KINDS, ['network', 'journal', 'reminder']);
  const inks = new Set<string>();
  for (const k of JOURNAL_KINDS) {
    const t = JOURNAL_KIND[k];
    assert.ok(t, `${k} has no presentation`);
    assert.ok(t.label.length > 0, `${k} has no label`);
    for (const c of [t.ink, t.tint, t.dot]) {
      assert.ok(/^(#[0-9a-f]{6}|rgba\()/i.test(c), `${k} has a malformed color: ${c}`);
    }
    inks.add(t.ink);
  }
  assert.equal(inks.size, 3, 'two kinds share an ink color, so they cannot be told apart');
  // The words the user chose.
  assert.equal(JOURNAL_KIND.network.label, 'NETWORK NOTE');
  assert.equal(JOURNAL_KIND.journal.label, 'JOURNAL');
  assert.equal(JOURNAL_KIND.reminder.label, 'REMINDER');
});

test('the colors are the ones asked for: orange, green, purple', () => {
  // Checked by hue rather than by exact value, so a shade can be tuned without
  // breaking the test, but swapping green for blue cannot pass.
  const hue = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return 0;
    const d = max - min;
    const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return h * 60;
  };
  const h = (k: JournalKind) => hue(JOURNAL_KIND[k].ink);
  assert.ok(h('network') >= 10 && h('network') <= 45, `network note is not orange (hue ${h('network')})`);
  assert.ok(h('journal') >= 90 && h('journal') <= 170, `journal is not green (hue ${h('journal')})`);
  assert.ok(h('reminder') >= 240 && h('reminder') <= 300, `reminder is not purple (hue ${h('reminder')})`);
});

test('prominence: notes about people, then about yourself, then reminders', () => {
  const mk = (kind: JournalKind, at: number) => ({ kind, at });
  const sorted = [
    mk('reminder', 300),
    mk('journal', 200),
    mk('network', 100),
  ].sort(byProminence);
  assert.deepEqual(sorted.map((s) => s.kind), ['network', 'journal', 'reminder']);
});

test('within a kind, the newest is first', () => {
  const mk = (kind: JournalKind, at: number) => ({ kind, at });
  const sorted = [mk('journal', 100), mk('journal', 300), mk('journal', 200)].sort(byProminence);
  assert.deepEqual(sorted.map((s) => s.at), [300, 200, 100]);
});

test('the sort is stable enough that equal items do not swap', () => {
  const a = { kind: 'journal' as const, at: 100 };
  const b = { kind: 'journal' as const, at: 100 };
  assert.equal(byProminence(a, b), 0);
});
