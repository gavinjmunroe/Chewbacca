import test from 'node:test';
import assert from 'node:assert/strict';
import { textingAvailability } from './imessage-link.js';
test('linking alone does not claim beta enrollment or a configured transport', () => {
  const row = { phone: '+14155550100' };
  const env = { PHOTON_PROJECT_ID: 'test', PHOTON_PROJECT_SECRET: 'test', PHOTON_WEBHOOK_SECRET: 'test' };
  const options = { amberNumber: '+14155550101', env };
  assert.equal(textingAvailability(row, options).unavailableReason, 'beta_not_enabled');
  assert.equal(textingAvailability(row, { ...options, env: {} }).unavailableReason, 'service_unconfigured');
  assert.equal(textingAvailability(row, { ...options, env: { ...env, ALLOWED_TEST_NUMBERS: row.phone } }).available, true);
  assert.equal(textingAvailability(row, { ...options, env: { ...env, DM_ENROLLMENT_OPEN: 'true' } }).available, true);
});
