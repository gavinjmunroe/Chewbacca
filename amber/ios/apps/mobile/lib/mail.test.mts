import test from 'node:test';
import assert from 'node:assert/strict';
import { mailSyncMessage } from './mail.ts';
test('no mailbox or partial failure never claims sync success', () => {
  assert.match(mailSyncMessage({ accounts: [] }), /No Gmail mailbox/);
  assert.match(mailSyncMessage({ accounts: [{ accountId: 'a', ok: true }, { accountId: 'b', ok: false }] }), /need attention/);
});
test('incomplete Gmail history asks for another page rather than claiming finished', () => {
  assert.match(mailSyncMessage({ accounts: [{ accountId: 'a', ok: true, more: true }] }), /More history/);
  assert.match(mailSyncMessage({ accounts: [{ accountId: 'a', ok: true }] }), /up to date/);
});
