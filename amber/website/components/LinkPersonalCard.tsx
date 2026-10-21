"use client";

/**
 * "YOU ALSO USE AMBER FOR YOURSELF — WANT BOTH HERE?"
 *
 * Shown once, in the company console, to an account with no personal workspace
 * linked. Somebody who signed in with a work email and skipped the phone field
 * has no other way to discover that the picker exists, and a feature nobody can
 * find is a feature that is not there.
 *
 * It renders nothing once a link exists, and nothing once somebody dismisses
 * it — a prompt that returns every load is an advertisement.
 *
 * The link is what it says and no more: the other workspace becomes reachable
 * from the picker. No contact, note or graph edge crosses between them, which
 * is the sentence on the card because it is the question somebody is actually
 * asking before they type their number into their employer's software.
 */

import { useEffect, useState } from "react";
import { AmberError } from "@/lib/amber";
import { getWorkspaces, startWorkspaceLink, verifyWorkspaceLink } from "@/lib/org";
import { formatUsPhone, isCompleteUsPhone, toE164 } from "@/lib/phone";
import { Btn, Card, Err, Input } from "@/components/Ent";

const DISMISSED = "amber.link.dismissed";

export default function LinkPersonalCard() {
  const [show, setShow] = useState(false);
  const [stage, setStage] = useState<"ask" | "code" | "done">("ask");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(DISMISSED) === "1";
    } catch {
      dismissed = false;
    }
    if (dismissed) return;
    const token = (() => {
      try {
        return sessionStorage.getItem("amber.web.token");
      } catch {
        return null;
      }
    })();
    if (!token) return;
    getWorkspaces(token)
      .then((r) => setShow(r.workspaces.length < 2))
      .catch(() => {});
  }, []);

  if (!show) return null;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const e164 = toE164(phone);
    if (!e164 || !isCompleteUsPhone(phone)) {
      setError("That is not a complete US number yet.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await startWorkspaceLink(e164);
      setStage("code");
    } catch (err) {
      setError(err instanceof AmberError ? err.message : "Could not send a code.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    const e164 = toE164(phone);
    if (!e164) return;
    setBusy(true);
    setError(null);
    try {
      await verifyWorkspaceLink(e164, code.trim());
      setStage("done");
      setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      setError(
        err instanceof AmberError && err.code === "no_account"
          ? "There is no personal Amber on that number."
          : "That code is not right.",
      );
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISSED, "1");
    } catch {
      /* a prompt that cannot remember being dismissed is still dismissible now */
    }
    setShow(false);
  }

  if (stage === "done") {
    return (
      <Card title="Linked">
        <p className="text-sm" style={{ color: "var(--ent-muted)" }}>
          Your personal Amber is in the workspace picker, top right.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Do you also use Amber for yourself?"
      note="Add that number and both workspaces appear in the picker at the top right. They stay separate accounts — no contact, note or connection moves between them."
      action={<Btn tone="quiet" onClick={dismiss}>Not now</Btn>}
    >
      <Err>{error}</Err>
      {stage === "ask" ? (
        <form onSubmit={send} className="flex flex-wrap gap-2">
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(formatUsPhone(e.target.value))}
            placeholder="+1-(555)-000-1111"
            className="min-w-[200px] flex-1"
          />
          <Btn type="submit" disabled={busy || !phone.trim()}>{busy ? "…" : "Send me a code"}</Btn>
        </form>
      ) : (
        <form onSubmit={confirm} className="flex flex-wrap gap-2">
          <Input
            inputMode="numeric"
            autoFocus
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className="min-w-[160px] flex-1 tracking-[0.3em]"
          />
          <Btn type="submit" disabled={busy || !code.trim()}>{busy ? "…" : "Link"}</Btn>
        </form>
      )}
    </Card>
  );
}
