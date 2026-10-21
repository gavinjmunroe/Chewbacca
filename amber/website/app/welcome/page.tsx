"use client";

/**
 * THE ONE THING A NEW ACCOUNT HAS TO SAY.
 *
 * A roster full of "Unnamed" is what you get when the only place a person can
 * set their name is an iOS onboarding flow they never ran. Somebody who signs
 * up on the web is a whole account, so this is where they become a person with
 * a name rather than a uuid.
 *
 * IT ASKS FOR THREE THINGS AND MEANS IT. Name, city, what they do. Not a
 * fifteen-field profile wizard -- every field past the ones that change how
 * somebody appears to a colleague is a field somebody abandons the flow in.
 * The rest of a profile is editable later and most of it fills itself in.
 *
 * `next` carries where they were going before this interrupted them, so a
 * person who came in through the organization card still lands on the company
 * setup afterwards.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AmberError, getMe, readSession, updateMe } from "@/lib/amber";
import { Button, Field, Notice } from "@/components/OrgUi";

export default function WelcomePage() {
  return (
    <Suspense fallback={<main className="px-6 py-16" style={{ color: "var(--muted)" }}>Loading…</main>}>
      <Welcome />
    </Suspense>
  );
}

function Welcome() {
  const router = useRouter();
  const next = useSearchParams().get("next") === "org" ? "/org/new" : "/network";

  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = readSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setToken(s.token);
    // Prefill rather than blank over whatever is already there — somebody who
    // onboarded on the phone and signed in here should not be asked again.
    getMe(s.token)
      .then((me) => {
        const p = me.profile ?? me;
        setName(p.displayName ?? p.fullName ?? "");
        setCity(p.currentCity ?? "");
        setRole(p.occupation ?? "");
      })
      .catch(() => {});
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await updateMe(token, {
        displayName: name.trim(),
        currentCity: city.trim() || undefined,
        occupation: role.trim() || undefined,
      });
      router.replace(next);
    } catch (err) {
      setError(err instanceof AmberError ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-1 text-3xl" style={{ color: "var(--ink)" }}>What should people call you?</h1>
      <p className="mb-8 text-sm" style={{ color: "var(--muted)" }}>
        This is how you appear to anyone you share with. Everything else fills itself in.
      </p>
      <form onSubmit={submit}>
        <Notice kind="error">{error}</Notice>
        <Field
          autoFocus
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="mb-3 w-full"
        />
        <Field
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="What you do, optional"
          className="mb-3 w-full"
        />
        <Field
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="City, optional"
          className="mb-6 w-full"
        />
        <Button type="submit" disabled={busy || !name.trim()} className="w-full">
          {busy ? "…" : "Continue"}
        </Button>
      </form>
      <button
        onClick={() => router.replace(next)}
        className="mt-6 text-sm"
        style={{ color: "var(--muted)" }}
      >
        Skip
      </button>
    </main>
  );
}
