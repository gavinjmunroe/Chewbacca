"use client";

/**
 * SIGNING IN, THE SAME WAY THE APP DOES: a phone number and a code.
 *
 * The one difference is invisible here and important on the server: this sends
 * `client: "web"`, which asks for a token scoped to the network graph and the
 * contact cards. Everything else in the API refuses it. That is deliberate --
 * a credential that lives in a browser should be worth less than one that lives
 * on a phone somebody is holding.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestCode, verifyCode, AmberError } from "@/lib/amber";
import { formatUsPhone, toE164, isCompleteUsPhone } from "@/lib/phone";

export default function LoginPage() {
  const router = useRouter();
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
        await verifyCode(e164!, code.trim());
        router.push("/network");
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
    <main className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm">
        <h1 className="mb-1 text-3xl" style={{ color: "var(--ink)" }}>
          Amber
        </h1>
        <p className="mb-8 text-sm" style={{ color: "var(--muted)" }}>
          {step === "phone"
            ? "Sign in with the number you use in the app."
            : `We sent a code to ${phone}.`}
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
            style={{ borderColor: "var(--hair)", color: "var(--ink)" }}
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
            style={{ borderColor: "var(--hair)", color: "var(--ink)" }}
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
          style={{ background: "var(--accent)", color: "var(--amber-950)" }}
        >
          {busy ? "…" : step === "phone" ? "Send code" : "Sign in"}
        </button>

        {step === "code" ? (
          <button
            type="button"
            onClick={() => {
              setStep("phone");
              setCode("");
              setError(null);
            }}
            className="mt-4 w-full text-sm underline"
            style={{ color: "var(--muted)" }}
          >
            Use a different number
          </button>
        ) : null}
      </form>
    </main>
  );
}
