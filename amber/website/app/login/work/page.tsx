"use client";

/**
 * THE COMPANY DOOR, AND IT IS TWO DOORS WEARING ONE URL.
 *
 *   /login/work            sign in to an account that exists
 *   /login/work?mode=new   create the account that will own a company
 *
 * THEY USED TO BE THE SAME SCREEN doing the same thing: both mailed a link to
 * a work address, so the fourth sign-in and the very first visit produced an
 * identical inbox — and when the mail provider was not verified, neither
 * worked at all and there was nothing else to try. Creating an account now
 * happens here, in one request, with a password; no inbox is involved.
 *
 * WHAT EACH BUTTON MEANS IS WRITTEN ON IT. "Continue with Google" carries an
 * intent the server signs into the OAuth state: on this screen in `new` mode
 * it may create an account, and on the sign-in screen it may not. From
 * Google's side the two journeys look the same, so the difference has to be
 * decided before the browser leaves and proved when it comes back.
 *
 * THE PHONE FIELD IS OPTIONAL AND IS NOT A SECOND IDENTITY. Giving a number
 * says "I also have a personal Amber on this number, show me both". It buys
 * the workspace picker and nothing else: no contact, note or graph edge moves
 * between the two accounts.
 */

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AmberError } from "@/lib/amber";
import {
  registerWork,
  signInWithPassword,
  startOrgSignup,
  startWorkspaceLink,
  verifyWorkspaceLink,
} from "@/lib/org";
import { formatUsPhone, isCompleteUsPhone, toE164 } from "@/lib/phone";
import { Btn, Card, Err, Input } from "@/components/Ent";
import GoogleButton, { SSO_MESSAGE } from "@/components/GoogleButton";

type Stage = "credentials" | "code";
type Mode = "password" | "link";

export default function WorkPage() {
  return (
    <Suspense fallback={<Shell><Card title="Loading…">{null}</Card></Shell>}>
      <WorkSignInPage />
    </Suspense>
  );
}

function WorkSignInPage() {
  const router = useRouter();
  const params = useSearchParams();
  const creating = params.get("mode") === "new";

  const [stage, setStage] = useState<Stage>("credentials");
  const [mode, setMode] = useState<Mode>("password");

  /*
   * WHY GOOGLE SENT THEM BACK. The callback cannot render anything — it is a
   * redirect — so it puts a reason on the query string and this turns it into
   * a sentence. Without it a failed Google sign-in silently returns somebody
   * to the form they started on, which reads as the button doing nothing.
   */
  const why = params.get("sso");
  const ssoError = why ? (SSO_MESSAGE[why] ?? "That sign-in did not complete.") : null;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");

  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const e164 = toE164(phone);
  const wantsLink = phone.trim().length > 0;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await registerWork({
        email: email.trim(),
        password,
        fullName: name.trim() || null,
      });
      // A brand-new account owns no company yet, so this is where it goes.
      router.replace("/org/new");
    } catch (err) {
      setError(
        err instanceof AmberError && err.code === "already_registered"
          ? "That address already has an account. Sign in instead."
          : err instanceof AmberError
            ? err.message
            : "Could not create that account. Try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "link") {
        await startOrgSignup(email.trim());
        setSent(true);
        return;
      }

      await signInWithPassword(email.trim(), password);

      if (!wantsLink) {
        router.replace("/org");
        return;
      }
      if (!isCompleteUsPhone(phone) || !e164) {
        setNote("Signed in. That phone number was not complete, so nothing was linked.");
        router.replace("/org");
        return;
      }
      await startWorkspaceLink(e164);
      setStage("code");
    } catch (err) {
      if (err instanceof AmberError && err.code === "email_unavailable") {
        setError("Email sign-in is not configured here. Use a password.");
        setMode("password");
      } else {
        setError(
          err instanceof AmberError
            ? err.message
            : "Could not sign you in. Check the address and try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!e164) return;
    setBusy(true);
    setError(null);
    try {
      await verifyWorkspaceLink(e164, code.trim());
      router.replace("/org");
    } catch (err) {
      setError(
        err instanceof AmberError && err.code === "no_account"
          ? "There is no personal Amber on that number yet. You are signed in to your company — skip this and link it later."
          : "That code is not right.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Shell>
        <Card title="Check your inbox" note={`We sent a link to ${email}. It works once and expires in 15 minutes.`}>
          <Btn tone="quiet" onClick={() => setSent(false)} className="w-full">Back</Btn>
        </Card>
      </Shell>
    );
  }

  if (stage === "code") {
    return (
      <Shell>
        <Card
          title="Confirm it is your number"
          note={`You are signed in to your company. We sent a code to ${phone} — entering it links your personal Amber so you can switch between the two.`}
        >
          <form onSubmit={confirm} className="space-y-3">
            <Err>{error}</Err>
            <Input
              inputMode="numeric"
              autoFocus
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="w-full tracking-[0.3em]"
            />
            <Btn type="submit" disabled={busy || !code.trim()} className="w-full">
              {busy ? "…" : "Link my personal Amber"}
            </Btn>
          </form>
          <button
            onClick={() => router.replace("/org")}
            className="mt-5 block w-full text-center text-sm"
            style={{ color: "var(--ent-dim)" }}
          >
            Skip — I will do this later
          </button>
        </Card>
      </Shell>
    );
  }

  /* ─────────────────────────────────────────────────── create an account */

  if (creating) {
    return (
      <Shell>
        <Card
          title="Set up your organization"
          note="This creates the account that will own the company. Next you will name it, set its email domain, and invite your team."
        >
          <GoogleButton
            intent="register"
            email={email.includes("@") ? email : undefined}
            label="Sign up with Google"
            className="w-full"
          />
          <Divider />

          <form onSubmit={create} className="space-y-3">
            <Err>{error ?? ssoError}</Err>
            <Input
              autoFocus
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full"
            />
            <Input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full"
            />
            <Input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Choose a password"
              className="w-full"
            />
            <Btn type="submit" disabled={busy || !email.trim() || !password} className="w-full">
              {busy ? "…" : "Create account"}
            </Btn>
            <p className="text-xs leading-relaxed" style={{ color: "var(--ent-dim)" }}>
              Use your work address. Whatever domain it is on becomes the default for the company,
              and you can restrict joining to that domain on the next screen.
            </p>
          </form>

          <Foot
            prompt="Already have an account?"
            action="Sign in"
            onClick={() => router.push("/login/work")}
          />
          <Back onClick={() => router.push("/login")} />
        </Card>
      </Shell>
    );
  }

  /* ───────────────────────────────────────────────────────────── sign in */

  return (
    <Shell>
      <Card
        title="Sign in to your organization"
        note="Your work email or username. Separate from any personal Amber you keep."
      >
        {/*
          GOOGLE FIRST, because for somebody already signed into their work
          Google account it is one click and no password to remember. The
          button draws itself only when the server says the flow is configured.
        */}
        <GoogleButton email={email.includes("@") ? email : undefined} className="w-full" />
        <Divider />

        <form onSubmit={submit} className="space-y-3">
          <Err>{error ?? ssoError}</Err>
          {note ? <p className="text-sm" style={{ color: "var(--ent-muted)" }}>{note}</p> : null}
          <Input
            type={mode === "password" ? "text" : "email"}
            autoFocus
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com or your username"
            className="w-full"
          />
          {mode === "password" ? (
            <>
              <Input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full"
              />
              <div className="pt-1">
                <Input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(formatUsPhone(e.target.value))}
                  placeholder="Phone number (optional)"
                  className="w-full"
                />
                <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--ent-dim)" }}>
                  If you also use Amber for yourself, add that number and we will link the two so
                  you can switch between them. They stay separate accounts — nothing moves across.
                </p>
              </div>
            </>
          ) : null}
          <Btn type="submit" disabled={busy || !email.trim()} className="w-full">
            {busy ? "…" : mode === "password" ? (wantsLink ? "Sign in and link" : "Sign in") : "Email me a link"}
          </Btn>
        </form>

        <button
          onClick={() => { setMode(mode === "password" ? "link" : "password"); setError(null); }}
          className="mt-5 block w-full text-center text-sm"
          style={{ color: "var(--ent-dim)" }}
        >
          {mode === "password" ? "Email me a sign-in link instead" : "Use a password instead"}
        </button>

        <Foot
          prompt="New here?"
          action="Set up your organization"
          onClick={() => router.push("/login/work?mode=new")}
        />
        <Back onClick={() => router.push("/login")} />
      </Card>
    </Shell>
  );
}

function Divider() {
  return (
    <div className="my-4 flex items-center gap-3">
      <span className="h-px flex-1" style={{ background: "var(--ds-line)" }} />
      <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--ds-dim)" }}>
        or
      </span>
      <span className="h-px flex-1" style={{ background: "var(--ds-line)" }} />
    </div>
  );
}

/** The other door, always visible, never a guess about which one they wanted. */
function Foot({ prompt, action, onClick }: { prompt: string; action: string; onClick: () => void }) {
  return (
    <p className="mt-5 text-center text-sm" style={{ color: "var(--ent-dim)" }}>
      {prompt}{" "}
      <button
        onClick={onClick}
        className="font-medium underline underline-offset-4"
        style={{ color: "var(--ds-accent-ink)" }}
      >
        {action}
      </button>
    </p>
  );
}

function Back({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mt-3 block w-full text-center text-sm"
      style={{ color: "var(--ent-dim)" }}
    >
      Back
    </button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main data-surface="enterprise" className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
