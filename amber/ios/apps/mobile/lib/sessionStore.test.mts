import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSavedAt, pickSession, type SessionCopy } from './sessionStore.ts';

const copy = (token: string | null, savedAt: number | null, refreshToken = token ? `r-${token}` : null): SessionCopy => ({
  token,
  phone: token ? '+15550101234' : null,
  refreshToken,
  savedAt,
});

test('a session from before Kyber has no shared copy yet: the private one wins and is copied across', () => {
  const c = pickSession(copy(null, null), copy('old', null));
  assert.equal(c.source, 'legacy');
  assert.equal(c.copy.token, 'old');
  assert.equal(c.copyToShared, true);
});

test('the keyboard rotated last, so its shared copy is the live refresh token', () => {
  const c = pickSession(copy('kb', 2_000), copy('app', 1_000));
  assert.equal(c.source, 'shared');
  assert.equal(c.copy.refreshToken, 'r-kb');
});

test('the default build was installed over Kyber and kept rotating privately: the stale shared copy loses', () => {
  const c = pickSession(copy('weeks-old', 1_000), copy('current', 9_000));
  assert.equal(c.source, 'legacy');
  assert.equal(c.copy.refreshToken, 'r-current');
  assert.equal(c.copyToShared, true);
});

test('a build without the entitlement reads no shared copy and never tries to write one', () => {
  const c = pickSession(null, copy('app', 5));
  assert.equal(c.source, 'legacy');
  assert.equal(c.copyToShared, false);
});

test('signed out everywhere', () => {
  assert.equal(pickSession(copy(null, null), copy(null, null)).source, 'none');
});

test('equal stamps prefer shared, the copy both sides write', () => {
  assert.equal(pickSession(copy('s', 7), copy('l', 7)).source, 'shared');
});

test('a stamp that is not a number counts as never stamped', () => {
  assert.equal(parseSavedAt('abc'), null);
  assert.equal(parseSavedAt(''), null);
  assert.equal(parseSavedAt('1700000000000'), 1_700_000_000_000);
});
