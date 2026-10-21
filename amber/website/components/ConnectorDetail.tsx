"use client";

/**
 * WHAT "ADDED" ACTUALLY MEANS, SAID OUT LOUD.
 *
 * Clicking the plus flipped a tile to "Added" and nothing else happened. That
 * is not a small polish problem — it is the product making a claim it does
 * not keep. Somebody adds Google Calendar, sees "Added", goes looking for
 * their calendar, finds nothing, and correctly concludes the feature is
 * broken. The tile was never lying about the database; it was lying about
 * what a row in that table does.
 *
 * A row means: this company has said it uses this product. That is genuinely
 * useful — it is how a new hire learns the stack on day one, and it is what
 * the directory is FOR — and it is not a sync. The gap between those two is
 * the thing this panel exists to close, per connector, in words.
 *
 * SO EVERY CONNECTOR ANSWERS THREE QUESTIONS, in this order:
 *
 *   What happens now that it is added?
 *   What does it still need before data moves?
 *   What do I do next, exactly?
 *
 * For most of the catalog the honest answer to the first is "it is written
 * down and that is all", and saying so costs nothing compared to a company
 * discovering it during a client demo. For the ones that genuinely do
 * something — the API, Copilot, Claude, calendars — the next step is a
 * button or a copyable value rather than a sentence pointing at one.
 *
 * WHY NOT JUST HIDE THE ONES THAT DO NOTHING. Because "which products does
 * this company use" is a real question with a real answer, and a directory
 * that only lists what we have built integrations for cannot answer it. The
 * honest version is more useful than the impressive one.
 */

import { useState } from "react";
import { CalendarPlus, Check, Copy, ExternalLink, KeyRound, Link2, X } from "lucide-react";
import { AmberError } from "@/lib/amber";
import { startCalendarConnect } from "@/lib/workspace";
import type { CatalogEntry } from "@/lib/connector-catalog";
import { Badge, Button, Modal } from "@/components/ui";

/** The connectors that do something today, and what the next step is. */
type Step = {
  title: string;
  detail: string;
  /** A step that can be DONE here rather than described. */
  action?: { label: string; connect?: "google" | "microsoft" };
};

function stepsFor(entry: CatalogEntry, apiBase: string): { live: string | null; steps: Step[] } {
  const base = apiBase || "https://your-api-host";

  switch (entry.id) {
    case "microsoft-copilot":
      return {
        live: "Copilot can read this workspace and post back into it, through a connector you build once in your own Microsoft tenant.",
        steps: [
          {
            title: "Mint a company key",
            detail: "On the API tab. Give it read, and write too if Copilot should be able to post here.",
          },
          {
            title: "Import the OpenAPI document into Copilot Studio",
            detail: `${base}/v1/api/openapi.json — Tools → New tool → Custom connector → create from an OpenAPI URL.`,
          },
          {
            title: "Set security to API Key, header Authorization, prefix Bearer",
            detail: "Copilot Studio calls a bearer token an “API Key”. The header name is what matters.",
          },
          {
            title: "Add it to an agent and call whoami",
            detail: "It returns your company name. If that works, every other operation will.",
          },
        ],
      };

    case "claude":
    case "openai":
      return {
        live: `${entry.name} can read this workspace through the same company key the REST API uses.`,
        steps: [
          { title: "Mint a key on the API tab", detail: "Read is enough unless you want it posting here." },
          {
            title: "Point it at the export endpoint",
            detail: `GET ${base}/v1/api/export with Authorization: Bearer <key>. One document, everything the key may read.`,
          },
          {
            title: "Know what it cannot see",
            detail: "A key has no identity here, so anything addressed to a group or a person is out of reach. That is not a setting.",
          },
        ],
      };

    case "rest":
    case "webhook":
    case "zapier":
    case "make":
      return {
        live: "The API is live. Everything this console does, a script can do.",
        steps: [
          { title: "Mint a key on the API tab", detail: "Scoped to read, write, or both." },
          {
            title: "Start with whoami",
            detail: `curl -H "Authorization: Bearer <key>" ${base}/v1/api/whoami`,
          },
          {
            title: "Read the whole workspace",
            detail: `GET ${base}/v1/api/export — also the cheapest backup there is.`,
          },
        ],
      };

    case "google-calendar":
    case "outlook":
      return {
        live: "You can connect your own calendar right here. Each person connects their own, then chooses which teams see it.",
        steps: [
          {
            title: "Connect your account",
            detail:
              "A calendar belongs to a person, not to a company — your account, your tokens — so this connects yours. Everybody else connects their own.",
            // The button, rather than directions to a button somewhere else.
            action: { label: "Connect", connect: entry.id === "outlook" ? "microsoft" : "google" },
          },
          {
            title: "Choose which teams see it",
            detail:
              "Open a group → Calendar → switch it on. Nothing is copied, so unsharing removes those events from the team's week immediately.",
          },
          {
            title: "Add as many as you like",
            detail:
              "Work and personal, or one per client. Each is its own switch, so the team sees only what you put in front of them.",
          },
        ],
      };

    case "google-drive":
    case "onedrive":
    case "notion":
    case "slack":
    case "github":
      return {
        live: null,
        steps: [
          {
            title: "Nothing syncs yet",
            detail: `We have not built the ${entry.name} sync. Adding it records that this company uses it, which is what the directory is for.`,
          },
          {
            title: "What you can do today",
            detail: "Put the links your team keeps re-finding on the Links tab, and move data through the REST API, which reaches everything this console can.",
          },
        ],
      };

    default:
      return {
        live: null,
        steps: [
          {
            title: "Written down, not wired up",
            detail: `This records that your company uses ${entry.name}. There is no sync behind it yet, and the tile says "Link only" for that reason.`,
          },
          {
            title: "Move the data anyway",
            detail: "The REST API under “Build your own” reads and writes everything this console can, so an integration you write yourself is not blocked on us.",
          },
        ],
      };
  }
}

export default function ConnectorDetail({
  entry,
  added,
  apiBase,
  onClose,
  onAdd,
  onRemove,
  onGoToApi,
}: {
  entry: CatalogEntry | null;
  added: boolean;
  apiBase: string;
  onClose: () => void;
  onAdd: () => void;
  onRemove: () => void;
  onGoToApi: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  async function connect(provider: "google" | "microsoft") {
    setConnecting(provider);
    setConnectError(null);
    try {
      const returnTo = typeof window === "undefined" ? "/org" : window.location.pathname;
      const r = await startCalendarConnect(provider, returnTo);
      window.location.href = r.authorize_url;
    } catch (e) {
      const msg = e instanceof AmberError ? e.message : "";
      /*
       * A server with no OAuth client for the provider says so, in words an
       * admin can act on. The alternative -- a button that fails silently --
       * is what made the whole connector directory feel decorative.
       */
      setConnectError(
        /not_configured/i.test(String(msg))
          ? /*
             * The variable names exactly as the API reads them. Microsoft's
             * are MS_OAUTH_*, not MICROSOFT_OAUTH_* -- an error message that
             * names a variable which does not exist sends somebody to set
             * the wrong thing and then wonder why it still fails.
             */
            `${provider === "google" ? "Google" : "Microsoft"} calendar sync is not set up on this server yet. An admin needs to set ${
              provider === "google" ? "GOOGLE_OAUTH_CLIENT_ID" : "MS_OAUTH_CLIENT_ID"
            }, ${
              provider === "google" ? "GOOGLE_OAUTH_CLIENT_SECRET" : "MS_OAUTH_CLIENT_SECRET"
            } and AMBER_API_BASE_URL on the API.`
          : "Could not start that connection.",
      );
      setConnecting(null);
    }
  }

  if (!entry) return null;

  const { live, steps } = stepsFor(entry, apiBase);
  const docUrl = `${apiBase || "https://your-api-host"}/v1/api/openapi.json`;

  return (
    <Modal
      open={!!entry}
      onOpenChange={(v) => !v && onClose()}
      title={entry.name}
      note={entry.blurb}
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>Close</Button>
          {added ? (
            <Button tone="danger" onClick={onRemove}>
              <X className="h-3.5 w-3.5" />
              Remove
            </Button>
          ) : (
            <Button tone="primary" onClick={onAdd}>
              Add to this company
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>{entry.category}</Badge>
          {entry.capabilities.length === 0 ? (
            <Badge>Link only</Badge>
          ) : (
            <Badge tone="accent">
              {entry.capabilities.includes("read") && entry.capabilities.includes("write")
                ? "Read and write"
                : entry.capabilities.includes("read")
                  ? "Read"
                  : "Write"}
            </Badge>
          )}
          {added ? <Badge tone="accent">Added</Badge> : null}
        </div>

        {/*
          THE HONEST LINE. Either it does something, or it is a record that
          this company uses the thing — and the second is said in the same
          plain voice as the first rather than buried.
        */}
        <p
          className={`rounded-lg border p-2.5 text-[12.5px] leading-relaxed ${
            live
              ? "border-[var(--ds-accent-ring)] bg-[var(--ds-accent-soft)] text-[var(--ds-ink)]"
              : "border-[var(--ds-line)] bg-[var(--ds-sunk)] text-[var(--ds-muted)]"
          }`}
        >
          {live ??
            "Adding this records that your company uses it. No data moves on its own — the steps below are what is actually available today."}
        </p>

        <ol className="space-y-2.5">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-2.5">
              <span className="tnum mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--ds-hover)] text-[11px] font-semibold text-[var(--ds-muted)]">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-[var(--ds-ink)]">
                  {s.title}
                </span>
                <span className="block text-[12px] leading-snug text-[var(--ds-dim)]">
                  {s.detail}
                </span>
                {s.action?.connect ? (
                  <span className="mt-1.5 block">
                    <Button
                      tone="primary"
                      size="sm"
                      busy={connecting === s.action.connect}
                      onClick={() => void connect(s.action!.connect!)}
                    >
                      <CalendarPlus className="h-3.5 w-3.5" />
                      {s.action.label}
                    </Button>
                    {connectError ? (
                      <span className="mt-1 block text-[11px] leading-snug text-[var(--ds-danger)]">
                        {connectError}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>

        {/* The two things somebody will want to copy, where the steps mention them. */}
        {entry.capabilities.length > 0 ? (
          <div className="space-y-1.5">
            <CopyLine
              label="OpenAPI document"
              value={docUrl}
              copied={copied === "doc"}
              onCopy={() => {
                void navigator.clipboard.writeText(docUrl).catch(() => {});
                setCopied("doc");
                setTimeout(() => setCopied(null), 1500);
              }}
            />
            <Button tone="quiet" size="sm" onClick={onGoToApi}>
              <KeyRound className="h-3.5 w-3.5" />
              Mint a key
            </Button>
          </div>
        ) : (
          <Button tone="quiet" size="sm" onClick={onGoToApi}>
            <Link2 className="h-3.5 w-3.5" />
            Open the API tab
          </Button>
        )}

        {entry.docs ? (
          <a
            href={entry.docs}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ds-accent)] hover:underline"
          >
            Documentation
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
    </Modal>
  );
}

function CopyLine({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--ds-faint)]">
        {label}
      </p>
      <div className="flex items-stretch gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-[var(--ds-line)] bg-[var(--ds-sunk)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--ds-ink)]">
          {value}
        </code>
        <Button tone="quiet" size="sm" onClick={onCopy}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}
