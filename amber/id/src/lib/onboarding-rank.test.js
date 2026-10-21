import test from 'node:test';
import assert from 'node:assert/strict';
import { onboardingBoost } from './onboarding-rank.js';
const now = Date.parse('2026-10-07T12:00:00Z');
const entry = (age = 0) => ({ contactIds: ['chosen'], savedAt: new Date(now-age*86400000).toISOString() });
test('only explicitly selected contacts receive a bounded, decaying onboarding boost', () => {
  const context = { family: entry(), nearby: entry(), priorities: entry() };
  assert.equal(onboardingBoost('other', context, now).boost, 0);
  assert.equal(onboardingBoost('chosen', context, now).boost, .25);
  assert.equal(onboardingBoost('chosen', {family:entry(15)}, now).boost, .05);
  assert.equal(onboardingBoost('chosen', {family:entry(31)}, now).boost, 0);
});
test('missing, malformed and future context does not break ranking', () => {
  for (const context of [null, {}, {family:entry(-1)}, {family:{...entry(),contactIds:{}}}, {family:{...entry(),savedAt:'bad'}}])
    assert.equal(onboardingBoost('chosen', context, now).boost, 0);
});
