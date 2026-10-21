/**
 * THE REPORT REQUEST BODY.
 *
 * Nothing here throws when it is wrong. Every mistake in this file produces a
 * request the server accepts and a report a reviewer then reads incorrectly, or
 * a 400 the user sees as "we could not send that report" and does not retry.
 *
 * The transport half is not tested here for the same reason lib/socialAuthCopy
 * exists: importing lib/medhaId pulls the React Native module graph into a plain
 * node test runner and it does not load. What is worth testing is pure, so it is
 * pure.
 *
 * Run with:  npm test -- lib/reports
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { REPORT_DETAIL_MAX, REPORT_REASONS, reportBody } from './reports';

test('A THREAD REPORT NAMES THE THREAD, and nothing else', () => {
  // The server attaches evidence only when it is given a thread. Dropping the
  // thread id turns a harassment report with a transcript into an accusation
  // with nothing behind it, and the request still succeeds.
  assert.deepEqual(reportBody({ threadId: '12', reason: 'harassment' }), {
    reason: 'harassment',
    threadId: '12',
  });
});

test('a profile report names the person, because some abuse never sends a message', () => {
  assert.deepEqual(reportBody({ amberId: 'abc', reason: 'impersonation' }), {
    reason: 'impersonation',
    amberId: 'abc',
  });
});

test('BLOCK IS SENT ONLY TO OPT OUT', () => {
  /**
   * Two mistakes are possible and they fail in opposite directions. Sending
   * `block: true` always makes this client the thing deciding the default, so a
   * later server-side change would not reach it. Sending nothing when the user
   * unticked the box silently blocks somebody who asked not to.
   */
  assert.equal('block' in reportBody({ amberId: 'a', reason: 'spam' }), false);
  assert.equal('block' in reportBody({ amberId: 'a', reason: 'spam', block: true }), false);
  assert.equal(reportBody({ amberId: 'a', reason: 'spam', block: false }).block, false);
});

test('AN EMPTY DETAIL IS ABSENT, NOT AN EMPTY STRING', () => {
  // A row whose detail is "" reads in a review queue as "they opened the box,
  // typed nothing, and sent it", which is a different claim from "they did not
  // write anything".
  for (const detail of [undefined, '', '   ', '\n\t ']) {
    assert.equal(
      'detail' in reportBody({ amberId: 'a', reason: 'spam', detail }),
      false,
      JSON.stringify(detail),
    );
  }
  assert.equal(reportBody({ amberId: 'a', reason: 'spam', detail: '  hi  ' }).detail, 'hi');
});

test('A PASTED WALL OF TEXT IS TRIMMED, NOT REJECTED', () => {
  /**
   * The server's schema caps detail at the same number and answers 400 above
   * it. A 400 here is shown as "we could not send that report", so somebody
   * pasting a long message thread into the box would be told their report
   * failed -- and the longer the explanation, the more likely that is.
   */
  const body = reportBody({ amberId: 'a', reason: 'harassment', detail: 'z'.repeat(9000) });
  assert.equal(String(body.detail).length, REPORT_DETAIL_MAX);
});

test('the reasons are the ones the server and the database both accept', () => {
  // REPORT_REASONS here, REPORT_REASONS in src/db/reports-store.js, and the
  // CHECK in migration 054 are three copies of one list. A reason in this one
  // that is missing from the others is a 400 nobody sees until a real user
  // picks that row.
  assert.deepEqual(
    REPORT_REASONS.map((r) => r.key).sort(),
    ['harassment', 'impersonation', 'other', 'sexual', 'spam', 'threat'],
  );
  for (const r of REPORT_REASONS) {
    assert.ok(r.label.trim().length > 3, `${r.key} has no readable label`);
  }
});

test('a thread id is stringified, because a number would be dropped by the schema', () => {
  // The server's body schema types threadId as a string with a maxLength. A
  // numeric one is stripped by Fastify's removeAdditional-adjacent coercion
  // rules rather than rejected, and the report silently loses its evidence.
  const body = reportBody({ threadId: 12 as unknown as string, reason: 'spam' });
  assert.equal(body.threadId, '12');
  assert.equal(typeof body.threadId, 'string');
});

test('an absent target is left absent rather than sent as null', () => {
  // `threadId: null` in the JSON fails the schema's type check and 400s. The
  // sheet passes null for whichever half it does not have, every single time.
  assert.deepEqual(reportBody({ threadId: null, amberId: null, reason: 'other' }), {
    reason: 'other',
  });
});
