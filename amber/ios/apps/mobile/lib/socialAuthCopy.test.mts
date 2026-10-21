/**
 * THE TWO PLACES A SIGN-IN SCREEN LIES TO PEOPLE.
 *
 * Nothing here touches a provider SDK or the network -- those are a browser
 * hand-off and an HTTP call, and neither is a thing a unit test can honestly
 * stand in for. What is pinned is the pair of decisions the screen makes on its
 * own, both of which are invisible when wrong:
 *
 *   calling a cancel a failure
 *   telling somebody their code is wrong when the code was never the problem
 *
 * Each one leaves the user doing the wrong thing repeatedly with no way to work
 * out why.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
// Imported from socialAuthCopy, not socialAuth: the latter pulls in
// expo-apple-authentication and the session store, and a node test of it dies
// on an expo-image export long before it reaches an assertion.
import { isCancellation, linkFailure } from './socialAuthCopy.ts';

/**
 * `expired` is optional on LinkResult, so reading it needs a cast rather than
 * `'expired' in res && res.expired` -- which evaluates to FALSE when the key is
 * absent, not undefined, and made the first version of these assertions compare
 * the wrong two things.
 */
const expiredFlag = (res: ReturnType<typeof linkFailure>): boolean | undefined =>
  (res as { expired?: boolean }).expired;

test('TAPPING CANCEL IS NOT A FAILURE', () => {
  /**
   * The most common thing that happens on this screen is somebody opening the
   * Apple sheet and changing their mind. Showing "sign-in failed" for it is the
   * app calling the user's own decision a bug, and it is the kind of wrongness
   * nobody reports because it looks like the app working.
   *
   * Apple and AuthSession do not agree on how to say it, which is why this
   * checks three shapes rather than one constant.
   */
  assert.equal(isCancellation({ code: 'ERR_REQUEST_CANCELED' }), true, 'Apple');
  assert.equal(isCancellation({ code: 'ERR_CANCELED' }), true, 'AuthSession');
  assert.equal(isCancellation(new Error('The operation was cancelled')), true, 'message only');
  assert.equal(isCancellation({ message: 'User canceled the sign in' }), true, 'US spelling');
});

test('a real failure is not mistaken for a cancel, or it would be swallowed', () => {
  // The inverse matters just as much: a network error read as a cancel shows
  // nothing at all, and the button appears to do nothing when tapped.
  assert.equal(isCancellation(new Error('Network request failed')), false);
  assert.equal(isCancellation({ code: 'ERR_INVALID_RESPONSE' }), false);
  assert.equal(isCancellation(null), false);
  assert.equal(isCancellation(undefined), false);
  assert.equal(isCancellation({}), false);
});

test('AN EXPIRED TICKET IS NOT A WRONG CODE', () => {
  /**
   * The branch that decides whether somebody can recover. A ticket lives ten
   * minutes; past that, the provider identity it carried is gone and no code
   * will ever work. Reported as "that code doesn't match", the user re-reads a
   * six-digit number forever. `expired` is what sends them back to the start.
   */
  const gone = linkFailure('ticket_expired');
  assert.equal(gone.ok, false);
  assert.equal(expiredFlag(gone), true, 'the screen cannot recover from this');
  assert.match(gone.message, /again/i);

  // A tampered or cross-provider ticket is the same dead end for the user.
  assert.equal(expiredFlag(linkFailure('bad_ticket')), true);

  // A WRONG CODE IS RETRYABLE, and must NOT carry `expired` -- that would throw
  // away a perfectly good ticket over one mistyped digit.
  const wrong = linkFailure('mismatch');
  assert.equal(expiredFlag(wrong), undefined);
  assert.match(wrong.message, /match/i);

  const stale = linkFailure('expired');
  assert.equal(expiredFlag(stale), undefined, 'an expired CODE is not an expired TICKET');
  assert.match(stale.message, /new one/i);
});

test('an identity already on another account says so, rather than "try again"', () => {
  // The server refuses on purpose: re-pointing a provider identity would hand
  // one person's account to whoever verified a phone last. "Try again" would
  // invite the user to keep attempting something that can never work.
  for (const code of ['apple_id_already_linked', 'google_id_already_linked']) {
    const res = linkFailure(code);
    assert.match(res.message, /already connected/i, code);
    assert.equal(expiredFlag(res), undefined, code);
  }
});

test('an unknown error still says something a person can act on', () => {
  // A new server error code must not render as blank or as "undefined".
  for (const code of ['', 'something_new', 'internal_error']) {
    const res = linkFailure(code);
    assert.equal(res.ok, false);
    assert.ok(res.message.length > 10, `no usable message for "${code}"`);
    assert.ok(!/undefined|null/.test(res.message), `leaked a value into copy for "${code}"`);
  }
});
