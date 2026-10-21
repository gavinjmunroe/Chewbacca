import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDisplay, isLikelyValid, normalizePhone } from './phone.ts';

test('the shapes a person actually types all normalize to one E.164 number', () => {
  for (const typed of [
    '5550101234',
    '555 010 1234',
    '(555) 010-1234',
    '555-010-1234',
    '+1 (555) 010-1234',
    '+15550101234',
    '15550101234',
    '1 555 010 1234',
    '  555.010.1234  ',
  ]) {
    assert.equal(normalizePhone(typed), '+15550101234', `typed as ${JSON.stringify(typed)}`);
  }
});

test('an international number keeps its own country code', () => {
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalizePhone('+91 98765 43210'), '+919876543210');
  assert.equal(normalizePhone('+81 3-1234-5678'), '+81312345678');
});

test('nothing in, nothing out', () => {
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone('   '), '');
  assert.equal(normalizePhone('call me'), '');
  assert.equal(normalizePhone('---'), '');
});

test('a plus sign with no number is not a phone number', () => {
  // normalizePhone kept the bare "+" it was handed, so a card with a stray plus
  // in the number field produced "+" and every consumer had to know that "+"
  // means empty. It means empty; say so.
  assert.equal(normalizePhone('+'), '');
  assert.equal(normalizePhone('++'), '');
  assert.equal(normalizePhone(' + '), '');
});

test('a plus that is not at the front is not part of the number', () => {
  // "+1+555..." came back verbatim, plus signs included, and no dialer accepts
  // that. Contacts imported from other apps carry this shape more often than
  // you would think.
  assert.equal(normalizePhone('++15550101234'), '+15550101234');
  assert.equal(normalizePhone('+1+555+010+1234'), '+15550101234');
  assert.equal(normalizePhone('1+5550101234'), '+15550101234');
});

test('isLikelyValid holds the E.164 length range and nothing outside it', () => {
  assert.equal(isLikelyValid('5550101234'), true);
  assert.equal(isLikelyValid('+442079460958'), true);
  assert.equal(isLikelyValid('123456'), false, 'six digits is too short for E.164');
  assert.equal(isLikelyValid('+1234567890123456'), false, 'sixteen digits is past the limit');
  assert.equal(isLikelyValid(''), false);
  assert.equal(isLikelyValid('+'), false);
  assert.equal(isLikelyValid('not a phone'), false);
});

test('formatDisplay only prettifies what it can prove is US, and never loses digits', () => {
  assert.equal(formatDisplay('5550101234'), '+1 (555) 010-1234');
  assert.equal(formatDisplay('+15550101234'), '+1 (555) 010-1234');
  // Not US: shown as-is rather than forced into a US frame.
  assert.equal(formatDisplay('+442079460958'), '+442079460958');
  assert.equal(formatDisplay(''), '');
  // WHATEVER COMES BACK MUST CONTAIN EVERY DIGIT THAT WENT IN. A formatter that
  // drops one produces a number that dials somebody else.
  for (const raw of ['5550101234', '+442079460958', '+81 3-1234-5678', '(555) 010-1234']) {
    const digitsIn = raw.replace(/\D/g, '');
    const digitsOut = formatDisplay(raw).replace(/\D/g, '');
    assert.ok(digitsOut.endsWith(digitsIn) || digitsIn.endsWith(digitsOut), `${raw} -> ${formatDisplay(raw)}`);
  }
});

test('normalize is idempotent', () => {
  // Numbers get normalized on entry, on sync and on display. Applying it twice
  // must not change the answer, or a round trip through storage rewrites the
  // number.
  for (const raw of ['5550101234', '+442079460958', '1 555 010 1234', '', '+1+555+010+1234']) {
    const once = normalizePhone(raw);
    assert.equal(normalizePhone(once), once, `${JSON.stringify(raw)} -> ${JSON.stringify(once)}`);
  }
});
