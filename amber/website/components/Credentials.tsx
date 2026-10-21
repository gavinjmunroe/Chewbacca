"use client";

/**
 * HOW THIS ACCOUNT GETS BACK IN ON MONDAY.
 *
 * Every door into this product used to be something somebody RECEIVES: a code
 * to a phone, a link to an inbox. Good as a default, bad as the only option.
 * It makes signing in depend on a mail provider being configured and on the
 * person being next to one particular device -- and an invited member could
 * accept, land in the workspace, and have no way back in that did not involve
 * an inbox. signInWithPassword had shipped with nothing anywhere that could
 * populate the column it reads.
 *
 * THE CURRENT PASSWORD IS ASKED FOR WHEN ONE EXISTS and not when it does not.
 * A session lives in a browser for eight hours; without that check, anybody
 * holding a stolen one could set a password and keep the account after the
 * token expired. For somebody who has never set one there is nothing to prove,
 * and demanding it would lock them out of the feature entirely.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, KeyRound, AtSign } from "lucide-react";
import { AmberError, tokenNow } from "@/lib/amber";
import { getCredentials, setPassword, setUsername } from "@/lib/org";
import { Alert, Badge, Button, Field, Section, TextField } from "@/components/ui";

export default function Credentials({ compact }: { compact?: boolean }) {
  const [creds, setCreds] = useState<Awaited<ReturnType<typeof getCredentials>> | null>(null);

  const [username, setU] = useState("");
  const [uBusy, setUBusy] = useState(false);
  const [uError, setUError] = useState<string | null>(null);
  const [uSaved, setUSaved] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pBusy, setPBusy] = useState(false);
  const [pError, setPError] = useState<string | null>(null);
  const [pSaved, setPSaved] = useState(false);

  const load = useCallback(() => {
    const token = tokenNow();
    if (!token) return;
    getCredentials(token)
      .then((c) => {
        setCreds(c);
        setU(c.username ?? "");
      })
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  async function saveUsername() {
    const token = tokenNow();
    if (!token) return;
    setUBusy(true);
    setUError(null);
    try {
      await setUsername(token, username.trim().toLowerCase());
      setUSaved(true);
      load();
    } catch (e) {
      setUError(e instanceof AmberError ? e.message : "Could not set that username.");
    } finally {
      setUBusy(false);
    }
  }

  async function savePassword() {
    const token = tokenNow();
    if (!token) return;
    setPBusy(true);
    setPError(null);
    try {
      await setPassword(token, next, creds?.hasPassword ? current : null);
      setPSaved(true);
      setCurrent("");
      setNext("");
      load();
    } catch (e) {
      setPError(e instanceof AmberError ? e.message : "Could not set that password.");
    } finally {
      setPBusy(false);
    }
  }

  return (
    <Section
      title="Signing in"
      note={
        compact
          ? undefined
          : "Set a username and a password so you can sign in from any browser without waiting for a code or a link."
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--ds-dim)]">
          {creds?.email ? <Badge>{creds.email}</Badge> : null}
          {creds?.phone ? <Badge>{creds.phone}</Badge> : null}
          {creds?.username ? <Badge tone="accent">@{creds.username}</Badge> : null}
          {creds?.hasPassword ? (
            <Badge tone="accent">
              <Check className="h-3 w-3" /> password set
            </Badge>
          ) : (
            <Badge>no password yet</Badge>
          )}
        </div>

        <div>
          <Alert>{uError}</Alert>
          <Field
            label="Username"
            hint="Lowercase letters, digits, dots, underscores or hyphens. You can sign in with this or with your email."
          >
            <div className="flex gap-2">
              <div className="relative flex-1">
                <AtSign className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ds-dim)]" />
                <TextField
                  value={username}
                  onChange={(e) => {
                    setUSaved(false);
                    setU(e.target.value.toLowerCase());
                  }}
                  placeholder="karthik"
                  className="pl-8"
                />
              </div>
              <Button
                busy={uBusy}
                disabled={!username.trim() || username.trim() === creds?.username}
                onClick={saveUsername}
              >
                {uSaved && username.trim() === creds?.username ? "Saved" : "Save"}
              </Button>
            </div>
          </Field>
        </div>

        <div className="border-t border-[var(--ds-line)] pt-5">
          <Alert>{pError}</Alert>
          {pSaved ? <Alert tone="info">Password saved. You can sign in with it now.</Alert> : null}
          <div className="space-y-3">
            {creds?.hasPassword ? (
              <Field label="Current password">
                <TextField
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => {
                    setPSaved(false);
                    setCurrent(e.target.value);
                  }}
                />
              </Field>
            ) : null}
            <Field label={creds?.hasPassword ? "New password" : "Password"} hint="At least 10 characters.">
              <TextField
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => {
                  setPSaved(false);
                  setNext(e.target.value);
                }}
              />
            </Field>
            <Button
              tone="primary"
              busy={pBusy}
              disabled={next.length < 10 || (creds?.hasPassword === true && !current)}
              onClick={savePassword}
            >
              <KeyRound className="h-3.5 w-3.5" />
              {creds?.hasPassword ? "Change password" : "Set a password"}
            </Button>
          </div>
        </div>
      </div>
    </Section>
  );
}
