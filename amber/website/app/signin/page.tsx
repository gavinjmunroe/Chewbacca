"use client";

/**
 * SIGNING IN WITH A WORK EMAIL — the path for an account that has no phone.
 *
 * Two states in one screen: with a `?token=` it spends the link and signs in;
 * without one it asks for an address and says the same thing either way.
 *
 * THE ANSWER IS IDENTICAL WHETHER OR NOT THE ADDRESS HAS AN ACCOUNT. Anything
 * else turns this box into a way to ask which people at a company use Amber,
 * which is a question a competitor or a recruiter would also like answered.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AmberError } from "@/lib/amber";
import { requestEmailLink, verifyEmailLink } from "@/lib/org";
import { Button, Field, Notice } from "@/components/OrgUi";

export default function SignInPage() {
  return (
    <Suspense fallback={<main data-surface="enterprise" className="px-6 py-16" style={{ color: "var(--ds-muted)" }}>Loading…</main>}>
      <SignIn />
    </Suspense>
  );
}

function SignIn() {
  const router = useRouter();
  const linkToken = useSearchParams().get("token") ?? "";

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!linkToken) return;
    setBusy(true);
    /*
     * WHERE A CONSUMED LINK LANDS. /org sends an account with no company on to
     * /org/new, and an account with one into its console, so this one
     * destination is right for both an invited member and an admin who just
     * signed up to create a company.
     */
    verifyEmailLink(linkToken)
      .then(() => router.replace("/org"))
      .catch((e) =>
        setError(
          e instanceof AmberError ? e.message : "That sign-in link has expired or has already been used.",
        ),
      )
      .finally(() => setBusy(false));
  }, [linkToken, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestEmailLink(email.trim());
      setSent(true);
    } catch (err) {
      /*
       * TWO FAILURES THAT LOOK THE SAME AND ARE NOT.
       *
       * email_unavailable is a fact about the SERVER -- no mail provider is
       * configured -- and the honest thing is to say so and point at the door
       * that does work, rather than leave somebody refreshing an inbox nothing
       * was ever sent to. Every other failure is deliberately vague, because a
       * specific one would turn this box into a way to ask which addresses at a
       * company have accounts.
       */
      setError(
        err instanceof AmberError && err.code === "email_unavailable"
          ? "unavailable"
          : "Could not send that link. Try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (linkToken && !error) {
    return (
      <main data-surface="enterprise" className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
        <p style={{ color: "var(--ds-muted)" }}>Signing you in…</p>
      </main>
    );
  }

  return (
    <main data-surface="enterprise" className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-1 text-3xl" style={{ color: "var(--ds-ink)" }}>Amber</h1>
      <p className="mb-8 text-sm" style={{ color: "var(--ds-muted)" }}>
        {sent ? "Check your inbox. The link works once and expires in 15 minutes." : "Sign in with your work email."}
      </p>

      {error === "unavailable" ? (
        <div className="mb-6 rounded-xl border p-4" style={{ borderColor: "var(--ds-line)" }}>
          <p className="mb-3 text-sm" style={{ color: "var(--ds-ink)" }}>
            Email sign-in is not configured on this deployment yet.
          </p>
          <p className="mb-4 text-sm" style={{ color: "var(--ds-muted)" }}>
            If you were invited to a team, open the link in your invitation — that signs you in
            directly. Otherwise use your phone number.
          </p>
          <Button onClick={() => router.push("/login/phone")} className="w-full">
            Continue with phone
          </Button>
        </div>
      ) : null}

      {!sent && error !== "unavailable" ? (
        <form onSubmit={submit}>
          <Notice kind="error">{error}</Notice>
          <Field
            type="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            className="mb-4 w-full"
          />
          <Button type="submit" disabled={busy || !email.trim()} className="w-full">
            {busy ? "…" : "Send me a link"}
          </Button>
        </form>
      ) : null}

      <button
        onClick={() => router.push("/login")}
        className="mt-6 text-sm"
        style={{ color: "var(--ds-muted)" }}
      >
        Back
      </button>
    </main>
  );
}
