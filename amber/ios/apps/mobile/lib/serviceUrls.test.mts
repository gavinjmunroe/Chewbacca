import test from 'node:test';
import assert from 'node:assert/strict';
import { AMBER_ID_ORIGIN, resolveAmberIdOrigin } from './serviceUrls.ts';

test('unconfigured builds use the verified current Amber ID service', () => {
  for (const value of [undefined, '', '  ']) assert.equal(resolveAmberIdOrigin(value), AMBER_ID_ORIGIN);
});
test('installed clients with the retired native manifest reach the current service', () => {
  for (const value of ['https://medha-id-production.up.railway.app', ' https://medha-id-production.up.railway.app/ '])
    assert.equal(resolveAmberIdOrigin(value), AMBER_ID_ORIGIN);
});
test('explicit development and custom deployment overrides remain supported', () => {
  assert.equal(resolveAmberIdOrigin('http://localhost:3000/'), 'http://localhost:3000');
  assert.equal(resolveAmberIdOrigin('https://identity.example.org/api'), 'https://identity.example.org/api');
});
test('similarly named hosts are never treated as the retired deployment', () => {
  const host = 'https://medha-id-production.up.railway.app.example.org';
  assert.equal(resolveAmberIdOrigin(host), host);
});
