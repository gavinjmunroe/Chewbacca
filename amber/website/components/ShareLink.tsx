"use client";

/**
 * A URL FOR SOMEBODY WHO DOES NOT WORK HERE.
 *
 * WHAT IT SAYS, AND WHY IT SAYS IT BEFORE RATHER THAN AFTER. Anybody holding
 * the link can open it. That is what a link IS, and a product that implies
 * otherwise -- "anyone at the company with the link" -- is promising
 * something a URL cannot enforce. So the sentence is above the button, not
 * in a tooltip under it, and turning the link off is one press and immediate.
 *
 * THE VIEW COUNT IS THE POINT OF THE SECOND VISIT. "Is anybody using this"
 * is what somebody actually wants to know before they decide to revoke, and
 * a list of links with no evidence of use is a list nobody ever prunes.
 *
 * NOTHING IS COPIED. The link points at the page, so the shared thing
 * changes when the page changes and revoking is sufficient.
 */

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Globe, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { createPageLink, getPageLinks, revokePageLink, type PageLink } from "@/lib/knowledge";
import { apiBase } from "@/lib/amber";

export default function ShareLink({ pageId }: { pageId: string }) {
  const [links, setLinks] = useState<PageLink[] | null>(null);
  const [base, setBase] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    apiBase().then(setBase).catch(() => {});
    getPageLinks(pageId)
      .then((r) => setLinks(r.links))
      .catch(() => setLinks([]));
  }, [pageId]);

  const url = (l: PageLink) => `${base}/p/${l.token}`;

  const make = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const r = await createPageLink(pageId);
      setLinks([r.link]);
      try {
        await navigator.clipboard.writeText(`${base}/p/${r.link.token}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        /* a browser that refuses the clipboard is not worth a dialog */
      }
    } catch (e) {
      setFailed((e as { message?: string })?.message ?? "Could not make a link.");
    } finally {
      setBusy(false);
    }
  };

  const drop = async (id: string) => {
    setBusy(true);
    try {
      await revokePageLink(id);
      setLinks((cur) => (cur ?? []).filter((l) => l.id !== id));
    } catch (e) {
      setFailed((e as { message?: string })?.message ?? "Could not turn that off.");
    } finally {
      setBusy(false);
    }
  };

  const live = links?.[0] ?? null;

  return (
    <div className="rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] p-3">
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--ds-ink)]">
        <Globe className="h-3.5 w-3.5 text-[var(--ds-accent)]" />
        Share it outside
      </p>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--ds-muted)]">
        Anybody with the link can open it, signed in or not. It runs as itself, with no access to
        anything here. Turn it off and it stops working immediately.
      </p>

      {failed ? <p className="mt-1.5 text-[11.5px] text-[var(--ds-ink)]">{failed}</p> : null}

      {links === null ? (
        <p className="mt-2 flex items-center gap-2 text-[12px] text-[var(--ds-muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking…
        </p>
      ) : live ? (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1.5 rounded-lg border border-[var(--ds-line)] px-2 py-1.5">
            <input
              readOnly
              value={url(live)}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--ds-muted)] outline-none"
            />
            <button
              type="button"
              aria-label="Copy"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url(live));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  /* nothing useful to say */
                }
              }}
              className="shrink-0 rounded-md p-1 text-[var(--ds-faint)] transition hover:text-[var(--ds-ink)]"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <a
              href={url(live)}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Open"
              className="shrink-0 rounded-md p-1 text-[var(--ds-faint)] transition hover:text-[var(--ds-ink)]"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[11px] text-[var(--ds-faint)]">
              {live.views > 0
                ? `Opened ${live.views} ${live.views === 1 ? "time" : "times"}`
                : "Not opened yet"}
            </span>
            <Button tone="ghost" busy={busy} onClick={() => drop(live.id)}>
              <Trash2 className="h-3.5 w-3.5" />
              Turn it off
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <Button tone="primary" busy={busy} onClick={make}>
            Make a link
          </Button>
        </div>
      )}
    </div>
  );
}
