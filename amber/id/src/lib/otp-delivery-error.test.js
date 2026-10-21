import test from 'node:test';
import assert from 'node:assert/strict';
import { restrictedOtpDelivery } from './otp-delivery-error.js';

test('production Photon policy rejection is an operator failure without upstream leakage', () => {
  const result = restrictedOtpDelivery('[spectrum-imessage] Target not allowed for this project');
  assert.equal(result.error, 'delivery_restricted');
  assert.ok(result.message.includes('contact Amber support'));
  assert.ok(!result.message.includes('spectrum'));
});

test('other failures retain their existing handling', () => {
  for (const detail of [null, '', 'Invalid contact phone number', '{"code":520}', 'network error']) {
    assert.equal(restrictedOtpDelivery(detail), null);
  }
});
