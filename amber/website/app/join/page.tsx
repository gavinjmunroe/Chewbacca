"use client";

/**
 * ACCEPTING AN INVITE. The screen somebody lands on from an email.
 *
 * It shows what the invite is for BEFORE spending it -- preview is read-only,
 * accept is the write -- so a link forwarded to the wrong person tells them who
 * it was meant for rather than quietly enrolling them.
 *
 * Every invalid link gets the same sentence, whether it expired, was revoked,
 * was already used or never existed. Telling the difference would tell a
 * stranger holding a token something about the company behind it.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AmberError, readSession } from "@/lib/amber";
import { acceptInvite, previewInvite, type InvitePreview } from "@/lib/org";
import {
  getCredentials,
  setPassword as savePassword,
  setUsername as saveUsername,
} from "@/lib/org";
import { Alert, Button, Field, Panel, TextField } from "@/components/ui";
import { AmberMark, OrgMark } from "@/components/Marks";

export default function JoinPage() {
  return (
    <Suspense fallback={<main data-surface="enterprise" className="px-6 py-16" style={{ color: "var(--ds-muted)" }}>Loading…</main>}>
      <Join />
    </Suspense>
  );
}

function Join() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * ACCEPTING IS NOT THE END OF THE JOURNEY.
   *
   * It used to be: accept, land in the console, and on Monday have no way back
   * in that did not involve an inbox -- which, on a deployment with no mail
   * provider configured, is no way back in at all. So accepting moves to a
   * second step that sets the two things this account will actually sign in
   * with. It is skippable, because somebody who arrived via a phone number
   * already has a door.
   */
  const [stage, setStage] = useState<"invite" | "credentials">("invite");
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [saving, setSaving] = useState(false);
  /*
   * WHETHER THIS ACCOUNT ALREADY HAS A WAY BACK IN.
   *
   * It decides whether the password step can be skipped, and that is not a
   * style question. An invited person who skips has no password, and the only
   * other door is an emailed link -- which depends on a mail provider being
   * configured and is exactly the thing that was failing when they were
   * invited. Skipping would hand somebody a workspace they cannot reopen.
   *
   * Somebody invited at an address that already had an Amber account keeps
   * whatever they already sign in with, so for them the step is genuinely
   * optional and the button says so.
   */
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);

  useEffect(() => {
    if (!token) {
      setError("That invitation link is incomplete.");
      return;
    }
    previewInvite(token)
      .then(setPreview)
      .catch((e) => setError(e instanceof AmberError ? e.message : "That invitation is no longer valid."));
  }, [token]);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      // An existing session means "put this account in the company" rather than
      // making a second one for the invited address.
      const existing = readSession()?.token;
      const session = await acceptInvite(token, existing);
      // Asked after accepting, because until then there is no session to ask
      // with and no account for the answer to be about.
      const creds = await getCredentials(session.token).catch(() => null);
      setHasPassword(creds?.hasPassword ?? false);
      if (creds?.username) setU(creds.username);
      setStage("credentials");
    } catch (e) {
      setError(
        e instanceof AmberError && e.code === "already_in_org"
          ? "This account already belongs to an organization. Sign out first, or accept from a different account."
          : "That invitation is no longer valid.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    const session = readSession()?.token;
    if (!session) {
      router.replace("/org");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Both are optional and both are attempted. A username that is taken
      // should not stop a password from being set, so the failures are
      // reported separately rather than as one "could not save".
      if (username.trim()) {
        await saveUsername(session, username.trim().toLowerCase()).catch((e) => {
          throw e instanceof AmberError ? e : new Error("That username is not available.");
        });
      }
      if (password) await savePassword(session, password, null);
      router.replace("/org");
    } catch (e) {
      setError(e instanceof AmberError ? e.message : (e as Error).message);
      setSaving(false);
    }
  }

  return (
    <main
      data-surface="enterprise"
      className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16"
    >
      {stage === "credentials" ? (
        <Panel className="px-6 py-6">
          <div className="mb-5 flex items-center gap-3">
            <AmberMark size={30} />
            <div>
              <h1 className="text-[19px] font-semibold text-[var(--ds-ink)]">
                You are in{preview ? ` ${preview.org.name}` : ""}
              </h1>
              <p className="text-[13px] text-[var(--ds-muted)]">
                Set how you will sign in to this workspace next time.
              </p>
            </div>
          </div>

          <Alert>{error}</Alert>

          <div className="space-y-4">
            <Field label="Username" hint="Optional. You can also sign in with your work email.">
              <TextField
                autoFocus
                value={username}
                onChange={(e) => setU(e.target.value.toLowerCase())}
                placeholder="firstname"
              />
            </Field>
            <Field
              label={hasPassword ? "New password (optional)" : "Password"}
              hint={
                hasPassword
                  ? "You already have a way to sign in. Setting one here replaces it."
                  : "At least 10 characters. This is what gets you back into this workspace from any browser, and it is the only way in until email is set up."
              }
            >
              <TextField
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setP(e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-5 flex gap-2">
            <Button
              tone="primary"
              busy={saving}
              disabled={hasPassword === false ? password.length < 10 : !!password && password.length < 10}
              onClick={finish}
              className="flex-1"
            >
              Save and open the workspace
            </Button>
            {/*
              SKIPPING IS OFFERED ONLY TO SOMEBODY WHO ALREADY HAS A DOOR.
              For everybody else it would hand them a workspace they cannot
              reopen, since the alternative way in is an emailed link and a
              mail provider that may well be the reason they were sent a link
              by hand in the first place.
            */}
            {hasPassword ? (
              <Button tone="ghost" onClick={() => router.replace("/org")}>
                Skip
              </Button>
            ) : null}
          </div>
        </Panel>
      ) : preview ? (
        <Panel className="px-6 py-6">
          <div className="mb-5 flex items-center gap-3">
            <OrgMark size={44} />
            <div>
              <h1 className="text-[19px] font-semibold text-[var(--ds-ink)]">
                Join {preview.org.name}
              </h1>
              <p className="text-[13px] text-[var(--ds-muted)]">
                Invited as {preview.email} · {preview.role}
              </p>
            </div>
          </div>
          <Alert>{error}</Alert>
          <Button tone="primary" busy={busy} onClick={accept} className="w-full">
            Accept and sign in
          </Button>
          <p className="mt-3 text-[12px] text-[var(--ds-dim)]">
            This link works once. It creates an account for {preview.email} on{" "}
            {preview.org.name}&rsquo;s roster. Any personal Amber you keep is a different account
            with its own contacts and its own sign-in, and nothing crosses between them.
          </p>
        </Panel>
      ) : (
        <Panel className="px-6 py-6">
          <div className="mb-4 flex items-center gap-3">
            <AmberMark size={30} />
            <h1 className="text-[19px] font-semibold text-[var(--ds-ink)]">Amber</h1>
          </div>
          <Alert>{error}</Alert>
          {!error ? (
            <p className="text-[13px] text-[var(--ds-muted)]">Checking that invitation…</p>
          ) : null}
        </Panel>
      )}
    </main>
  );
}
