"use client";

/**
 * SIGNING IN WITH A PHONE NUMBER, which is also signing up.
 *
 * A number that has never been seen here gets an account on the way through --
 * the behavior the iOS app has always had, and the right one for a product
 * whose premise is that your identity is the number people already text you on.
 * The copy says so, because a screen headed "Sign in" with no register link
 * reads as a door that is closed to you.
 *
 * `intent` says which card on /login sent them here and decides only where they
 * land afterwards. It is not a privilege and the server never sees it: an
 * account that is already in a company goes to its console whatever this says,
 * and an account that is not cannot be put in one by a query parameter.
 *
 * The one difference from the app is invisible here and matters on the server:
 * this sends `client: "web"`, which asks for a token scoped to what a browser
 * needs. Everything else refuses it.
 */

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { requestCode, verifyCode, getMe, AmberError } from "@/lib/amber";
import { getOrgContext } from "@/lib/org";
import { formatUsPhone, toE164, isCompleteUsPhone } from "@/lib/phone";

export default function PhoneLoginPage() {
  return (
    <Suspense fallback={<main data-surface="enterprise" className="px-6 py-16" style={{ color: "var(--ds-muted)" }}>Loading…</main>}>
      <PhoneLogin />
    </Suspense>
  );
}

function PhoneLogin() {
  const router = useRouter();
  /*
   * A PHONE NUMBER ALWAYS MAKES A PERSONAL ACCOUNT.
   *
   * `intent=org` used to send somebody here from the company card and then on
   * to company setup afterwards, which is how a personal Amber ended up being
   * enrolled as a company. The parameter survives only to decide whether to
   * explain the two-workspace model at the end; it cannot make this account
   * anything other than personal, because nothing can.
   */
  const cameForWork = useSearchParams().get("intent") === "org";

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // THE FIELD HOLDS THE PRETTY FORM, THE API GETS E.164. Those are different
  // strings and only one of them is a phone number as far as the server is
  // concerned, so the conversion happens here rather than being left to
  // whatever the user happened to type.
  const e164 = toE164(phone);
  const ready = isCompleteUsPhone(phone);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (step === "phone" && !e164) {
      setError("That is not a complete US number yet.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (step === "phone") {
        await requestCode(e164!);
        setStep("code");
      } else {
        const session = await verifyCode(e164!, code.trim());
        /*
         * WHERE THEY LAND. Asked of the server, never assumed: the token was
         * minted a moment ago and only the server knows whether this account is
         * in a company. An account already in one goes to its console whatever
         * card they came from -- the fork was decided when they joined.
         *
         * A failed lookup falls through rather than blocking a sign-in that
         * already succeeded.
         */
        const [ctx, me] = await Promise.all([
          getOrgContext(session.token).catch(() => null),
          getMe(session.token).catch(() => null),
        ]);
        if (ctx?.kind === "org") {
          router.push("/org");
          return;
        }
        /*
         * A BRAND-NEW ACCOUNT HAS NO NAME, and a roster or a shared note from
         * somebody called "Unnamed" is what you get when the only place to set
         * one is an iOS flow they never ran. Asked once, here, and skippable.
         */
        const profile = me?.profile ?? me;
        const named = Boolean(profile?.displayName || profile?.fullName);
        if (!named) router.push(`/welcome?next=${cameForWork ? "org" : "personal"}`);
        else router.push(cameForWork ? "/org/new" : "/network");
      }
    } catch (err) {
      setError(
        err instanceof AmberError
          ? err.message
          : "Could not reach Amber. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main data-surface="enterprise" className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm">
        <h1 className="mb-1 text-3xl" style={{ color: "var(--ds-ink)" }}>
          {cameForWork ? "Your personal Amber" : "Amber"}
        </h1>
        <p className="mb-8 text-sm" style={{ color: "var(--ds-muted)" }}>
          {step === "code"
            ? `We sent a code to ${phone}.`
            : cameForWork
              ? "A phone number creates a personal Amber. A company is a separate workspace made from a work email — we will show you how once you are in."
              : "Your phone number is your account. If it is new here, this creates one."}
        </p>

        {step === "phone" ? (
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            autoFocus
            required
            value={phone}
            // Formatted on every keystroke from the digits alone, so the field
            // can never hold punctuation that disagrees with what was typed.
            onChange={(e) => setPhone(formatUsPhone(e.target.value))}
            placeholder="+1-(555)-000-1111"
            className="mb-4 w-full rounded-xl border bg-transparent px-4 py-3 outline-none"
            style={{ borderColor: "var(--ds-line)", color: "var(--ds-ink)" }}
          />
        ) : (
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className="mb-4 w-full rounded-xl border bg-transparent px-4 py-3 tracking-[0.3em] outline-none"
            style={{ borderColor: "var(--ds-line)", color: "var(--ds-ink)" }}
          />
        )}

        {error ? (
          <p className="mb-4 text-sm" style={{ color: "var(--amber-300)" }}>
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || (step === "phone" && !ready)}
          className="w-full rounded-xl px-4 py-3 font-medium disabled:opacity-50"
          style={{ background: "var(--ds-accent-ink)", color: "#ffffff" }}
        >
          {busy ? "…" : step === "phone" ? "Send code" : "Sign in"}
        </button>

        <button
          type="button"
          onClick={() => (step === "code" ? setStep("phone") : router.push("/login"))}
          className="mt-6 block w-full text-center text-sm"
          style={{ color: "var(--ds-muted)" }}
        >
          {step === "code" ? "Use a different number" : "Back"}
        </button>
      </form>
    </main>
  );
}
