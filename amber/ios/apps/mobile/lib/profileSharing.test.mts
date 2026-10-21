import test from 'node:test';
import assert from 'node:assert/strict';
import { profileShareText, connectProfileUrl } from './profileSharing.ts';
const card = { name: 'Maya', subtitle: 'Designer', emails: ['maya@example.com'], phones: ['+12025550123'], notes: 'Private health context', facts: ['Private relationship information'] };
test('default profile share reveals only the name, even when private data is present', () => {
  assert.equal(profileShareText(card, { details: false, emails: false, phones: false }), 'Maya');
});
test('email opt-in does not opt in phone, biography, or private facts', () => {
  assert.equal(profileShareText(card, { details: false, emails: true, phones: false }), 'Maya\nmaya@example.com');
});
test('all share switches still exclude private notes and source-derived facts', () => {
  assert.equal(profileShareText(card, { details: true, emails: true, phones: true }), 'Maya\nDesigner\nmaya@example.com\n+12025550123');
});

test('own contact card uses Main’s per-user connect link and never a bare API root', () => {
  assert.equal(connectProfileUrl('https://amber.example/', null), undefined);
  assert.equal(connectProfileUrl('https://amber.example/', ' @sagar '), 'https://amber.example/u/@sagar');
  const profileUrl = connectProfileUrl('https://amber.example', 'sagar');
  assert.equal(profileShareText({ ...card, profileUrl }, { details: false, emails: false, phones: false }), 'Maya\nhttps://amber.example/u/@sagar');
  assert.equal(profileShareText({ ...card, profileUrl, sample: true }, { details: false, emails: false, phones: false }), 'Maya\n(Amber design preview)');
});
