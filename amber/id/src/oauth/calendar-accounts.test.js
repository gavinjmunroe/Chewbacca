/**
 * ADDING A SECOND CALENDAR ACCOUNT, WHICH CAME DOWN TO ONE WORD IN A URL.
 *
 *   "It should show me Google logins so I can log into multiple calendars...
 *    you should have the option to add another Google account."
 *
 * The server has been able to hold several accounts since migration 046:
 * calendar_accounts is keyed on (owner, provider, account_email), and the
 * Google callback writes a row per address. What stopped a second one from ever
 * arriving was the authorize URL. `prompt=consent` re-consents whoever is
 * already signed in to that provider in the browser and returns the SAME
 * address, so "Add a Google account" reconnected the account the user already
 * had and the list never grew. Nothing errored. Nothing appeared.
 *
 * WHY THESE ASSERT ON A PARAMETER SET RATHER THAN ON A URL. buildAuthorizeUrl
 * writes a pending-oauth row before it builds anything, so asserting on its
 * output needs Cloud SQL and nothing ever asserted on it at all. The query is
 * the entire contract with the provider, so it now comes from a pure function
 * and this is the test that could not previously exist.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { authorizeParams as googleParams } from "./google/init.js";
import { authorizeParams as microsoftParams } from "./microsoft/init.js";

const ARGS = {
  clientId: "test-client-id",
  redirectUri: "https://amber-id.example.com/v1/oauth/google/callback",
  state: "state-token",
};

test("GOOGLE ASKS WHICH ACCOUNT, NOT JUST FOR CONSENT", () => {
  const p = googleParams(ARGS);
  const prompt = p.get("prompt");
  assert.match(
    prompt ?? "",
    /\bselect_account\b/,
    "no account chooser: only one account is reachable",
  );
  // AND consent, which is the half that was already right: Google omits the
  // refresh token when it re-uses a grant without explicit re-consent, and a
  // calendar account with no refresh token stops syncing within the hour.
  assert.match(prompt ?? "", /\bconsent\b/);
  assert.equal(
    p.get("access_type"),
    "offline",
    "no refresh token would be issued",
  );
});

test("Google's prompt is a space separated list, which is what Google accepts", () => {
  // Not a comma, which Google rejects with invalid_request, and not two prompt
  // parameters, which URLSearchParams would happily let somebody write.
  const p = googleParams(ARGS);
  assert.equal(p.getAll("prompt").length, 1);
  assert.deepEqual((p.get("prompt") ?? "").split(" ").sort(), [
    "consent",
    "select_account",
  ]);
});

test("OUTLOOK ASKS WHICH ACCOUNT", () => {
  const p = microsoftParams(ARGS);
  assert.equal(p.get("prompt"), "select_account");
});

test("Microsoft gets ONE prompt value, because it rejects a list", () => {
  /**
   * The difference between the two providers, and the reason these are not the
   * same line of code. Microsoft's identity platform takes exactly one of
   * login, none, consent or select_account: "select_account consent" is an
   * invalid_request there, which would break the connect flow that works today
   * in the name of fixing the one that does not. Its refresh token comes from
   * the offline_access scope instead.
   */
  const p = microsoftParams(ARGS);
  assert.doesNotMatch(
    p.get("prompt") ?? "",
    /\s/,
    "a space separated prompt is refused by Microsoft",
  );
  assert.match(
    p.get("scope") ?? "",
    /\boffline_access\b/,
    "no refresh token without this scope",
  );
});

test("both carry the caller's own client, redirect and state", () => {
  // The parameters that make the round trip land back on the right account. A
  // lifted function that quietly baked in its own values would be worse than
  // the untestable version it replaced.
  for (const build of [googleParams, microsoftParams]) {
    const p = build(ARGS);
    assert.equal(p.get("client_id"), ARGS.clientId);
    assert.equal(p.get("redirect_uri"), ARGS.redirectUri);
    assert.equal(p.get("state"), ARGS.state);
    assert.equal(p.get("response_type"), "code");
  }
});

test("the calendar scope is actually requested, or the account joins nothing", () => {
  // connectCalendarAccount only records a row when the calendar scope family
  // was granted (see oauth/google/callback.js), so an authorize URL that
  // forgot to ask for it would connect an account that never appears in the
  // calendars list.
  assert.match(googleParams(ARGS).get("scope") ?? "", /calendar/i);
  assert.match(microsoftParams(ARGS).get("scope") ?? "", /Calendars\./);
});

test("Calendar-only Google consent does not require Gmail or Drive", () => {
  const scopes = googleParams({ ...ARGS, purpose: "calendar" }).get("scope");
  assert.match(scopes, /auth\/calendar/);
  assert.doesNotMatch(scopes, /gmail|drive/);
});
