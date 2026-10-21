"use client";

/**
 * ONE BUTTON, AND IT HAS TO ACTUALLY WORK.
 *
 * THE VERSION THIS REPLACES 404'd IN PRODUCTION. It pointed the browser
 * straight at the API with window.location.href. A top-level navigation
 * carries no Authorization header, so the request arrived anonymous, the
 * server could not tell which company was connecting, and the route did not
 * exist to receive it anyway. The press did nothing but show JSON.
 *
 * The fix is small and the shape matters: the page is already authenticated,
 * so it ASKS for the consent URL with its token and then sends the browser
 * there. Still one press, and the server knows who pressed it.
 *
 * WHY ADMIN CONSENT AND NOT A SETUP GUIDE. Amber is one multi-tenant
 * application, registered once, by us. A customer's administrator registers
 * nothing, mints no secret and pastes no identifiers. They approve one
 * read-only permission for their tenant, which is the pattern every other
 * vendor in their stack already uses.
 *
 * WHAT STAYS SAID OUT LOUD. Which permission, what it reads, that it is
 * read-only, and that Copilot Studio agents are excluded by Microsoft.
 * Collapsing nine steps into one must not collapse the disclosure -- an
 * administrator who approved something they did not understand is a renewal
 * conversation nobody wants.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Badge, Button, Panel } from "@/components/ui";
import { copilotConsentUrl, copilotStatus, type CopilotStatus } from "@/lib/memory";

export default function CopilotSetup({
  apiBase,
  onMintKey,
  /** The key the outbound half needs, if one has already been minted. */
  apiKeyHint = null,
  /** Told when the connection state changes, so a parent can reveal the ask bar. */
  onConnectedChange,
}: {
  apiBase: string;
  onMintKey?: () => void;
  apiKeyHint?: string | null;
  onConnectedChange?: (connected: boolean) => void;
}) {
  const base = apiBase || "https://your-api-host";
  const [copied, setCopied] = useState<string | null>(null);
  const [status, setStatus] = useState<CopilotStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await copilotStatus();
      setStatus(s);
      onConnectedChange?.(s.connected);
    } catch {
      // A status that cannot be read is not an error worth a red box on a
      // setup screen; the buttons below still explain themselves.
      setStatus(null);
    }
  }, [onConnectedChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
   * THE ANSWER FROM MICROSOFT COMES BACK AS A QUERY PARAMETER, because the
   * administrator returns through a full page load rather than a fetch. It is
   * read once and then removed from the URL -- leaving ?copilot=connected in
   * the address bar means a refresh three days later says "just connected".
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const said = params.get("copilot");
    if (!said) return;

    if (said === "connected") void refresh();
    else if (said === "declined") setError("The approval was declined in Microsoft.");
    else if (said === "bad_state") setError("That approval link had expired. Press Connect again.");
    else if (said === "store_failed") setError("Microsoft approved it but we could not save it. Try once more.");
    else if (said === "start") setError(null);

    params.delete("copilot");
    const rest = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));
  }, [refresh]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await copilotConsentUrl(
        typeof window === "undefined" ? "/org" : window.location.pathname,
      );
      window.location.href = url;
    } catch (e) {
      /*
       * THE TWO FAILURES A PERSON CAN ACT ON, told apart. "You are not an
       * administrator" is answered by forwarding the link; "this deployment
       * has no Microsoft application" is answered by nobody in the customer's
       * building. One message for both would send half of them to the wrong
       * place.
       */
      const err = e as { status?: number; code?: string; message?: string };
      if (err?.status === 403) {
        setError("Only an administrator of this workspace can approve this. Send them the link below.");
      } else if (err?.code === "not_configured") {
        setError(err.message ?? "Microsoft sign-in is not set up on this deployment yet.");
      } else {
        setError(err?.message ?? "Could not start the approval.");
      }
      setBusy(false);
    }
  };

  const copy = (what: string, value: string) => {
    void navigator.clipboard.writeText(value).catch(() => {});
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  const connected = status?.connected === true;
  const unavailable = status?.configured === false;

  return (
    <div className="space-y-3">
      {/*
        WHAT IT IS LIKE AFTERWARDS, first. Somebody deciding whether to put an
        approval request in front of their Microsoft admin is weighing an
        outcome, not reading a manual.
      */}
      <Panel className="border-[var(--ds-accent-ring)] bg-[var(--ds-accent-soft)] p-4">
        <p className="text-[13.5px] font-semibold text-[var(--ds-ink)]">
          One approval, and Copilot and Amber are one thing
        </p>
        <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-[var(--ds-muted)]">
          <li>
            Every Copilot conversation your team has had lands on the person or firm it was about,
            beside the meetings and the email. Nobody searches Copilot history again.
          </li>
          <li>
            An ask bar appears across Amber: ask Copilot a question with your relationships as
            context, and what it helped you prepare is logged without anybody logging it.
          </li>
          <li>
            All of it private to the person it belongs to. Colleagues see that a relationship
            exists and how warm, never what was said, until somebody publishes one item.
          </li>
        </ul>
      </Panel>

      {/* ------------------------------------------------------------ inbound */}
      <Panel className="p-4">
        <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-[var(--ds-ink)]">
          <span className="grid h-6 w-6 place-items-center rounded-lg bg-[var(--ds-hover)] text-[var(--ds-muted)]">
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </span>
          Bring Copilot in
          <Badge tone={connected ? "accent" : undefined}>
            {connected ? "Connected" : unavailable ? "Unavailable here" : "One approval"}
          </Badge>
        </p>

        <p className="mt-1 max-w-prose text-[12.5px] leading-relaxed text-[var(--ds-muted)]">
          {connected
            ? `Your Microsoft tenant approved Amber${
                status?.consentedAt ? ` on ${new Date(status.consentedAt).toLocaleDateString()}` : ""
              }. Conversations are flowing in and landing on the people they concerned.`
            : unavailable
              ? "This deployment has no Microsoft application registered yet, so there is nothing for an administrator to approve. That is ours to fix, not yours."
              : "Press this and Microsoft asks your administrator to approve one read-only permission for your tenant. There is nothing to register and nothing to paste — if you are not the administrator, send them the same link."}
        </p>

        {/*
          THE DISCLOSURE SURVIVES THE SHORTCUT. Microsoft's consent screen
          names the permission, and so do we, before they get there.
        */}
        <div className="mt-3 rounded-lg border border-[var(--ds-line)] bg-[var(--ds-sunk)] p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ds-faint)]">
            <ShieldCheck className="h-3 w-3" />
            What you are approving
          </p>
          <code className="mt-1.5 block font-mono text-[11.5px] text-[var(--ds-ink)]">
            {status?.scope ?? "AiEnterpriseInteraction.Read.All"}
          </code>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--ds-muted)]">
            Read-only, tenant-wide. It returns Copilot prompts and responses and the meetings and
            files Copilot opened to answer. Amber never writes to Copilot through it, and asks for
            no other permission.
          </p>
        </div>

        {error ? (
          <p className="mt-3 rounded-lg border border-[var(--ds-danger-ring,var(--ds-line))] bg-[var(--ds-sunk)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--ds-ink)]">
            {error}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button tone={connected ? "quiet" : "primary"} onClick={connect} disabled={busy || unavailable}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {connected ? "Re-approve" : "Connect Copilot"}
          </Button>
          <Button
            tone="quiet"
            size="sm"
            onClick={() => copy("consent", `${base}/v1/oauth/microsoft/admin-consent`)}
          >
            {copied === "consent" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            Copy link for your admin
          </Button>
        </div>

        <p className="mt-2.5 text-[12px] leading-relaxed text-[var(--ds-dim)]">
          Needs a Microsoft 365 Copilot licence on the tenant. Without one the approval succeeds
          and nothing arrives, so Amber checks and tells you rather than leaving you with an empty
          history that looks like a bug.
        </p>
      </Panel>

      {/* ----------------------------------------------------------- outbound */}
      <Panel className="p-4">
        <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-[var(--ds-ink)]">
          <span className="grid h-6 w-6 place-items-center rounded-lg bg-[var(--ds-hover)] text-[var(--ds-muted)]">
            <ArrowUpFromLine className="h-3.5 w-3.5" />
          </span>
          Give Copilot Amber
          <Badge>No admin needed</Badge>
        </p>

        <p className="mt-1 max-w-prose text-[12.5px] leading-relaxed text-[var(--ds-muted)]">
          One button mints the key and prepares the connector. The single thing left is pasting it
          into Copilot Studio, which happens inside Microsoft&apos;s product and is the one step
          nobody outside Microsoft can remove.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button tone="primary" onClick={onMintKey}>
            Create the connector
          </Button>
          <a
            href="https://copilotstudio.microsoft.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--ds-accent)] hover:underline"
          >
            Open Copilot Studio
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {apiKeyHint ? (
          <div className="mt-3 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ds-faint)]">
              Paste these two in Copilot Studio → Tools → New tool → Custom connector
            </p>
            <div className="flex items-stretch gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-[var(--ds-line)] bg-[var(--ds-sunk)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--ds-ink)]">
                {base}/v1/api/openapi.json
              </code>
              <Button tone="quiet" size="sm" onClick={() => copy("doc", `${base}/v1/api/openapi.json`)}>
                {copied === "doc" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <div className="flex items-stretch gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-[var(--ds-line)] bg-[var(--ds-sunk)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--ds-ink)]">
                Authorization: Bearer {apiKeyHint}
              </code>
              <Button tone="quiet" size="sm" onClick={() => copy("key", `Bearer ${apiKeyHint}`)}>
                {copied === "key" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <p className="text-[12px] leading-relaxed text-[var(--ds-dim)]">
              Authentication type API Key, parameter label Authorization, location Header. Copilot
              Studio calls a bearer token an API Key; the header name is what matters.
            </p>
          </div>
        ) : null}
      </Panel>

      <p className="rounded-lg border border-[var(--ds-line)] bg-[var(--ds-sunk)] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--ds-muted)]">
        One limit, worth knowing before you ask your admin: Microsoft excludes agents built in
        Copilot Studio from the export API. Conversations in Microsoft 365 Chat, Teams, Word and
        Outlook arrive; work done inside a Studio agent does not, and posts to Amber directly
        through the same API instead.
      </p>
    </div>
  );
}
