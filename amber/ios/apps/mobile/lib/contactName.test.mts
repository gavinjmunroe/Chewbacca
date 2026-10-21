import test from 'node:test';
import assert from 'node:assert/strict';
import { contactName } from './contactName.ts';
test('preserve recorded full names and restore structured surnames from older API results', () => {
  assert.equal(contactName({ name: 'Karthik', firstName: 'Karthik', lastName: 'Devarakonda' }), 'Karthik Devarakonda');
  assert.equal(contactName({ name: 'Caleb Example', firstName: 'Caleb' }), 'Caleb Example');
  assert.equal(contactName({ name: 'María del Carmen García' }), 'María del Carmen García');
});
test('never invent a surname or replace a real-world name with a handle', () => {
  assert.equal(contactName({ name: 'Caleb' }), 'Caleb');
  assert.equal(contactName({ name: '   ' }), 'Unnamed contact');
  assert.equal(contactName({ username: 'karthik123' } as any), 'Unnamed contact');
});
