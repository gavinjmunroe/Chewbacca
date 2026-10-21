import test from 'node:test';
import assert from 'node:assert/strict';
import { yearProgress } from './yearProgress.ts';
import { isVoiceDrop } from './voiceDrop.ts';
test('year divider handles leap years and the last day', () => {
  assert.equal(yearProgress(new Date(2028, 0, 1)).remaining, 365);
  assert.equal(yearProgress(new Date(2028, 1, 29)).elapsed, 60);
  assert.equal(yearProgress(new Date(2026, 11, 31)).remaining, 0);
  assert.equal(yearProgress(new Date(2026, 11, 31)).fraction, 1);
  assert.equal(yearProgress(new Date(2026, 9, 2)).remaining, 90);
});
test('voice drag accepts only a deliberate upward release', () => {
  assert.equal(isVoiceDrop(0, -85), true);
  for (const [x, y] of [
    [0, 0],
    [0, -60],
    [0, 80],
    [100, -90],
    [NaN, -90],
  ])
    assert.equal(isVoiceDrop(x, y), false);
});
