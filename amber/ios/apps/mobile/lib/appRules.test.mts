/**
 * THE SMALL RULES THAT NOTHING ELSE GUARDS.
 *
 * Each of these modules is short enough to look obviously correct, which is why
 * none of them had a test. They are also each one edit away from a visible
 * regression: a color key deleted orphans every circle that used it, a search
 * mode split in two makes the same bar say two different things, and the push
 * latch decides whether a second person signing in on the same phone ever gets
 * a notification.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { NAMED_COLORS, ON_COLOR } from './circleColors.ts';
import { isPlaceholderCompany, isPlaceholderTitle, realRole } from './placeholders.ts';
import { SEARCH_MODES, modeForTab } from './searchModes.ts';
import { claimPushRegistration, resetPushRegistrationLatch } from './pushLatch.ts';
import { PEOPLE_BAR_GAP, PEOPLE_BAR_H, peopleBarBottom } from './peopleBar.ts';

// ── circle colors ───────────────────────────────────────────────────────────

test('THE ORIGINAL EIGHT COLOR KEYS EXIST FOREVER', () => {
  // Circles persist their color BY KEY NAME, not as a hex value. Deleting a key
  // orphans the color of every circle already created with it -- and there is
  // nothing on screen to explain why a circle went gray.
  for (const key of ['purple', 'blue', 'green', 'orange', 'pink', 'yellow', 'red', 'teal']) {
    assert.ok(key in NAMED_COLORS, `the "${key}" key was removed; every circle using it loses its color`);
  }
});

test('every swatch is a real hex color and no two are the same', () => {
  const seen = new Map<string, string>();
  for (const [key, hex] of Object.entries(NAMED_COLORS)) {
    assert.match(hex, /^#[0-9A-Fa-f]{6}$/, `${key} = ${hex}`);
    const prior = seen.get(hex.toLowerCase());
    assert.equal(prior, undefined, `${key} and ${prior} are the same color, so the picker shows a duplicate swatch`);
    seen.set(hex.toLowerCase(), key);
  }
  assert.match(ON_COLOR, /^#[0-9A-Fa-f]{6}$/);
});

test('the palette fills whole rows of eight, because key order is the grid', () => {
  // Object.keys() drives the picker, eight per row. A count that is not a
  // multiple of eight leaves a ragged last row.
  const n = Object.keys(NAMED_COLORS).length;
  assert.equal(n % 8, 0, `${n} swatches does not fill rows of eight`);
});

test('the checkmark never gets harder to see than it already is', () => {
  // ON_COLOR is drawn on top of each swatch, so a swatch that drifts toward it
  // makes the selected state invisible on that one color -- which nobody
  // notices until they pick it.
  //
  // A RATCHET, NOT A STANDARD. The weakest swatch today is "amber" (#E0A45C) at
  // 1.99:1, which is genuinely low for an icon: WCAG asks 3:1 for a graphical
  // element. Raising the palette to meet that is a design decision and not one
  // to make inside a test, so this pins the floor where it actually is. Nothing
  // may get worse; whether 1.99 is good enough is a question for the design
  // pass, and this line is where the answer goes when it comes.
  const FLOOR = 1.95;
  const lum = (hex: string) => {
    const v = (i: number) => {
      const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * v(0) + 0.7152 * v(1) + 0.0722 * v(2);
  };
  const onLum = lum(ON_COLOR);
  for (const [key, hex] of Object.entries(NAMED_COLORS)) {
    const a = Math.max(onLum, lum(hex)) + 0.05;
    const b = Math.min(onLum, lum(hex)) + 0.05;
    assert.ok(a / b >= FLOOR, `the checkmark on "${key}" (${hex}) dropped to ${(a / b).toFixed(2)}:1 contrast`);
  }
  // And the known-weakest one is named, so raising the floor is a one-line edit
  // rather than an investigation.
  const amberRatio = (Math.max(onLum, lum(NAMED_COLORS.amber)) + 0.05) / (Math.min(onLum, lum(NAMED_COLORS.amber)) + 0.05);
  assert.ok(amberRatio < 3, 'the amber swatch now clears 3:1 -- raise FLOOR to match');
});

// ── placeholder enrichment ──────────────────────────────────────────────────

test('the invented company and title are never shown', () => {
  // The enrichment stub backfilled everybody with "Product Manager · Globex", so
  // the contacts list rendered page after page of the same fabricated line
  // against real people's names.
  assert.equal(isPlaceholderCompany('Globex'), true);
  assert.equal(isPlaceholderCompany('  globex  '), true);
  assert.equal(isPlaceholderTitle('Product Manager'), true);
  assert.equal(isPlaceholderTitle('product manager'), true);
  assert.equal(realRole('Product Manager', 'Globex'), '');
});

test('a real value beside a placeholder one survives on its own', () => {
  assert.equal(realRole('Product Manager', 'Stripe'), 'Stripe');
  assert.equal(realRole('Cardiologist', 'Globex'), 'Cardiologist');
  assert.equal(realRole('Cardiologist', 'Mount Sinai'), 'Cardiologist · Mount Sinai');
  assert.equal(realRole(undefined, undefined), '');
  assert.equal(realRole('  ', '  '), '');
});

test('the placeholder list stays narrow, and does not eat real companies', () => {
  // Blanket-blocking plausible names hides genuine data, which is the opposite
  // and worse failure.
  for (const real of ['Acme', 'Initech', 'Globex Corporation', 'Global', 'Ramp', 'Product Management']) {
    assert.equal(isPlaceholderCompany(real), false, real);
    assert.equal(isPlaceholderTitle(real), false, real);
  }
});

// ── the one search bar ──────────────────────────────────────────────────────

test('every tab index maps to a mode, including out-of-range ones', () => {
  // TWO TABS: 0 Home, 1 You. The People tab is gone -- its address book is the
  // ALL CONTACTS half of the Messages panel, which carries its own field beside
  // the list it filters, so the app's one bar no longer has a keyword mode to be
  // in. Both tabs ask Amber.
  assert.equal(modeForTab(0), 'today');
  assert.equal(modeForTab(1), 'you');
  // AN OVERSCROLLED PAGER MUST NOT LAND ON NO MODE. Rubber-banding past either
  // end reports a fractional position outside 0..1, and the bar reading
  // undefined out of the mode table is a crash in the one control that is on
  // every screen.
  assert.equal(modeForTab(-1), 'today');
  assert.equal(modeForTab(99), 'you');
});

test('Today and You are the SAME bar, not two that look alike', () => {
  // They were two separate literals with identical fields once, and had already
  // drifted by a word.
  assert.equal(SEARCH_MODES.today, SEARCH_MODES.you, 'today and you are no longer one definition');
});

test('an open note asks about the note, and behaves like the rest', () => {
  assert.notEqual(SEARCH_MODES.ask.placeholder, SEARCH_MODES.today.placeholder);
  for (const field of ['kind', 'submitsWhileTyping'] as const) {
    assert.deepEqual(SEARCH_MODES.ask[field], SEARCH_MODES.today[field], field);
  }
  assert.deepEqual(SEARCH_MODES.ask.trailing, SEARCH_MODES.today.trailing);
});

test('every mode is complete and self-consistent', () => {
  for (const [id, mode] of Object.entries(SEARCH_MODES)) {
    assert.equal(mode.id, id === 'you' ? 'today' : id, `${id}: id does not match its key (today and you share one object)`);
    assert.ok(mode.placeholder.length > 0, `${id}: no placeholder`);
    assert.ok(mode.label.length > 3, `${id}: no screen-reader label`);
    assert.ok(Array.isArray(mode.trailing), `${id}: no trailing controls`);
    // Filtering a list you can already see updates as you type; a request that
    // costs a round trip does not.
    assert.equal(
      mode.submitsWhileTyping,
      mode.kind === 'keyword',
      `${id}: a ${mode.kind} bar that submits ${mode.submitsWhileTyping ? 'per keystroke' : 'only on send'} is the wrong way round`,
    );
  }
});

// ── push registration ───────────────────────────────────────────────────────

test('push registers once a session, and again for the next person to sign in', () => {
  // This was a module-level flag inside a route file, which made it
  // launch-scoped: signing out and in as somebody else in the same process
  // never registered the second account, and that person got no notifications
  // at all while the server logged "no registered devices" forever.
  resetPushRegistrationLatch();
  assert.equal(claimPushRegistration(), true);
  assert.equal(claimPushRegistration(), false);
  assert.equal(claimPushRegistration(), false);
  resetPushRegistrationLatch();
  assert.equal(claimPushRegistration(), true, 'the second account never registered its token');
  resetPushRegistrationLatch();
});

// ── the bottom bar geometry ─────────────────────────────────────────────────

test('the bar clears the home indicator on every device, notch or not', () => {
  // The floor matters: a device with no bottom inset would otherwise put the bar
  // flush against the edge.
  const noNotch = peopleBarBottom(0);
  const notch = peopleBarBottom(34);
  assert.ok(noNotch >= 12 + PEOPLE_BAR_GAP, 'the bar sits too close to the bottom edge on a device with no inset');
  assert.ok(notch > noNotch, 'a larger safe-area inset did not push the bar up');
  assert.ok(PEOPLE_BAR_H >= 44, 'the primary control of the app is below the minimum tap target');
});

test('the bar position is a pure function of the inset', () => {
  for (const inset of [0, 12, 20, 34, 48]) {
    assert.equal(peopleBarBottom(inset), peopleBarBottom(inset), `inset ${inset}`);
    assert.ok(Number.isFinite(peopleBarBottom(inset)));
  }
});
