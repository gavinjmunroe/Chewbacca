/**
 * THE TWO KINDS OF CALENDAR, AND WHAT THE ROW SAYS ABOUT ITSELF.
 *
 * Nothing here touches the network: the calls are four lines of callMedhaId and
 * the failure modes worth pinning are in the parsing and the status line. Both
 * have a specific failure this codebase would otherwise ship: a row shape that
 * silently empties the screen, and a dead connection that reads as a quiet week.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { accountStatusLine, PROVIDER_LABEL } from './calendarAccounts.ts';

const NOW = new Date('2026-09-12T12:00:00Z');
const ago = (mins: number) => new Date(NOW.getTime() - mins * 60000).toISOString();

test('A DEAD CONNECTION SAYS SO INSTEAD OF LOOKING LIKE A QUIET WEEK', () => {
  /**
   * The failure this line exists for. A revoked grant keeps its row and stops
   * returning events, so a screen that printed only "synced 3 hours ago" would
   * be reassuring somebody whose calendar stopped working days ago. The error
   * outranks the timestamp even when the timestamp is recent.
   */
  assert.match(
    accountStatusLine({ syncedAt: ago(2), lastError: 'invalid_grant' }, NOW),
    /Needs attention/,
  );
});

test('an account that has never synced does not claim to have', () => {
  assert.match(
    accountStatusLine({ syncedAt: null, lastError: null }, NOW),
    /First sync has not finished/,
  );
});

test('the age reads in the largest honest unit', () => {
  assert.equal(accountStatusLine({ syncedAt: ago(1), lastError: null }, NOW), 'Synced just now.');
  assert.equal(accountStatusLine({ syncedAt: ago(40), lastError: null }, NOW), 'Synced 40 minutes ago.');
  assert.equal(accountStatusLine({ syncedAt: ago(60), lastError: null }, NOW), 'Synced 1 hour ago.');
  assert.equal(accountStatusLine({ syncedAt: ago(60 * 5), lastError: null }, NOW), 'Synced 5 hours ago.');
  assert.equal(accountStatusLine({ syncedAt: ago(60 * 24), lastError: null }, NOW), 'Synced 1 day ago.');
  assert.equal(accountStatusLine({ syncedAt: ago(60 * 24 * 9), lastError: null }, NOW), 'Synced 9 days ago.');
});

test('a timestamp that is not a timestamp does not print Invalid Date', () => {
  assert.equal(accountStatusLine({ syncedAt: 'never', lastError: null }, NOW), 'Connected.');
});

test('Microsoft is called Outlook, because that is what it says on the app', () => {
  // The provider column is 'microsoft'; nobody calls their calendar that.
  assert.equal(PROVIDER_LABEL.microsoft, 'Outlook');
  assert.equal(PROVIDER_LABEL.google, 'Google');
});
