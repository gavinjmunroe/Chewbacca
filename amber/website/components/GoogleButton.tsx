"use client";

/**
 * CONTINUE WITH GOOGLE.
 *
 * It renders only when the server says the flow is configured, because a
 * button that leads to "Google sign-in is not set up on this server" is worse
 * than no button at all: it reads as the product being broken rather than
 * unconfigured, and the person it fails for cannot tell the difference.
 *
 * A plain navigation, not a fetch. This is an OAuth redirect and the point is
 * that the browser visits Google carrying its own cookies -- which is also
 * what makes it one click for somebody already signed into their work Google
 * account, which is the entire reason to offer it.
 */

import { useEffect, useState } from "react";
import { getAuthMethods, googleSignInUrl } from "@/lib/org";
import { Button } from "@/components/ui";

export default function GoogleButton({
  email,
  className,
  /**
   * "register" on the create-an-account screen, "signin" everywhere else.
   *
   * It changes what the server does when the Google address has no account
   * and no invitation: make one, or refuse. The button has to say which,
   * because from Google's side the two journeys are identical.
   */
  intent = "signin",
  label,
}: {
  email?: string;
  className?: string;
  intent?: "signin" | "register";
  label?: string;
}) {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAuthMethods()
      .then((m) => setAvailable(m.google))
      .catch(() => setAvailable(false));
  }, []);

  if (!available) return null;

  return (
    <Button
      tone="quiet"
      size="lg"
      className={className}
      busy={busy}
      onClick={async () => {
        setBusy(true);
        window.location.href = await googleSignInUrl(email, intent);
      }}
    >
      <GoogleMark />
      {label ?? "Continue with Google"}
    </Button>
  );
}

/** Google's own mark, inline. Their brand guidelines want these exact colors. */
function GoogleMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z"
      />
      <path
        fill="#34A853"
        d="M24 46c6 0 11-2 14.6-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.1H4.3v5.7C7.9 41 15.4 46 24 46z"
      />
      <path fill="#FBBC05" d="M11.6 28.1c-.4-1.3-.7-2.7-.7-4.1s.2-2.8.7-4.1V14H4.3A22 22 0 0 0 2 24c0 3.6.9 6.9 2.3 10l7.3-5.9z" />
      <path
        fill="#EA4335"
        d="M24 9.5c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 2.9 30 1 24 1 15.4 1 7.9 6 4.3 14l7.3 5.9c1.7-5.2 6.6-9.4 12.4-9.4z"
      />
    </svg>
  );
}

/** What the server said went wrong, in words, when Google sends somebody back. */
export const SSO_MESSAGE: Record<string, string> = {
  declined: "You cancelled that. Nothing happened.",
  no_account:
    "That Google account has no Amber workspace, and there is no invitation waiting for it. Ask an admin to invite that address.",
  email_unverified:
    "Google has not verified that address, so it cannot be used to sign in. Verify it with Google, or use a password.",
  not_configured: "Google sign-in is not set up on this server yet.",
  bad_state: "That sign-in attempt expired. Try again.",
  bad_token: "Google's response could not be verified. Try again.",
  exchange_failed: "Google did not complete the sign-in. Try again.",
  invite_failed: "That invitation is no longer valid. Ask for a new one.",
  register_failed: "That account could not be created. Try again in a moment.",
  rate_limited: "Too many sign-in attempts. Wait a minute and try again.",
};
