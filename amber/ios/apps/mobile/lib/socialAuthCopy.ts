/**
 * THE PARTS OF SIGN-IN THAT ARE JUST DECISIONS.
 *
 * Split out of socialAuth.ts for one reason: that file imports
 * expo-apple-authentication, expo-auth-session and the session store, so a node
 * test of it dies on `expo-image does not provide an export named Image` long
 * before it reaches an assertion. The two functions here are the ones where
 * being wrong is invisible to everybody except the person stuck on the screen,
 * so they are the two that most need testing -- and neither needs a phone.
 */
import type { LinkResult } from './socialAuth';

export const GENERIC_SIGNIN_ERROR = 'Could not finish signing in. Try again.';

/** Apple and AuthSession both report a cancel; neither does it the same way. */
export function isCancellation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED') return true;
  const message = String((err as { message?: string } | null)?.message ?? '');
  return /cancel/i.test(message);
}

/**
 * WHAT WENT WRONG, IN WORDS THAT POINT AT THE FIX.
 *
 * Extracted so it can be tested: the mapping is the whole user-facing quality of
 * this screen, and every branch is a different next action. The one that matters
 * most is the first. A ticket that ran out is NOT a wrong code -- telling
 * somebody "that code doesn't match" sends them back to squint at a code that
 * was never the problem, and no amount of re-reading it will help, because the
 * identity it was going to attach is gone. `expired` is what tells the screen to
 * drop them back to an ordinary sign-in instead of leaving them typing into a
 * dead flow.
 */
export function linkFailure(error: string): LinkResult {
  if (error === 'ticket_expired' || error === 'bad_ticket') {
    return { ok: false, expired: true, message: 'That took too long. Start signing in again.' };
  }
  if (error === 'apple_id_already_linked' || error === 'google_id_already_linked') {
    // Refusing is deliberate on the server: re-pointing a provider identity
    // would hand one person's account to whoever verified a phone last.
    return { ok: false, message: 'That account is already connected to a different Amber account.' };
  }
  if (error === 'expired') return { ok: false, message: 'That code expired. Ask for a new one.' };
  if (error === 'mismatch') return { ok: false, message: "That code doesn't match. Try again." };
  if (error === 'invalid_phone') return { ok: false, message: "That doesn't look like a phone number." };
  return { ok: false, message: GENERIC_SIGNIN_ERROR };
}
