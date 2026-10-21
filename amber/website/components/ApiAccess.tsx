"use client";

/**
 * GETTING DATA IN, AND GETTING IT BACK OUT.
 *
 * A company evaluating this asks two questions in this order: how does what we
 * already have get in here, and if this goes badly, how does it come back out.
 * A product that answers neither gets typed into by hand once and then
 * abandoned, and people can smell that before they commit a quarter to it.
 *
 * So the export command is on this page, in full, next to the key that runs
 * it — not buried in documentation, not behind a support request. One curl
 * returns everything. That is a deliberate statement about who owns the work
 * in here, and it costs nothing to honour because it was never ours.
 *
 * THE SECRET IS SHOWN ONCE AND THE PAGE SAYS SO BEFORE IT IS MINTED, not
 * after. Being told a value is gone forever at the moment it disappears is
 * how somebody loses an afternoon.
 *
 * SCOPES ARE DESCRIBED BY BLAST RADIUS rather than by name, because "write"
 * tells somebody nothing about whether it can remove a colleague. A row that
 * says what the worst case is gets the right choice picked.
 */

import { useState } from "react";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { AmberError } from "@/lib/amber";
import { drop, useCached } from "@/lib/cache";
import { createApiKey, getApiKeys, revokeApiKey, type OrgApiKey } from "@/lib/connectors";
import {
  Alert,
  Badge,
  Button,
  Empty,
  Field,
  List,
  ListRow,
  Modal,
  Spinner,
  TextField,
} from "@/components/ui";

const SCOPES: { id: "read" | "write" | "admin"; title: string; worst: string }[] = [
  {
    id: "read",
    title: "Read",
    worst: "Can read everything the company has made company-wide. Never anything addressed to a group or a person.",
  },
  {
    id: "write",
    title: "Write",
    worst: "Everything read can do, plus posting to the feed. Posts are attributed to the key, not to a person.",
  },
  {
    id: "admin",
    title: "Admin",
    worst: "Can invite people into the company. Give this to a key only if the thing holding it is one you would make an admin.",
  },
];

export default function ApiAccess({
  isAdmin,
  apiBase,
}: {
  isAdmin: boolean;
  apiBase: string;
}) {
  const { data, loading } = useCached("api-keys", getApiKeys, { maxAgeMs: 15_000 });
  const [minting, setMinting] = useState(false);
  const [fresh, setFresh] = useState<{ key: OrgApiKey; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<OrgApiKey | null>(null);

  const keys = data?.keys ?? [];
  const live = keys.filter((k) => !k.revoked_at);

  if (!isAdmin) {
    return (
      <Empty
        title="Keys are an admin thing"
        note="A company key reads company-wide work and can outlive whoever made it, so minting one is kept with the people who answer for the company."
      />
    );
  }

  return (
    <div className="space-y-5">
      <Alert>{error}</Alert>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[60ch] text-[13px] text-[var(--ds-muted)]">
          A key is the company’s, not yours — it keeps working after you leave, and it
          only ever sees work that has been made company-wide.
        </p>
        <Button tone="primary" size="sm" onClick={() => setMinting(true)}>
          <Plus className="h-3.5 w-3.5" />
          New key
        </Button>
      </div>

      {loading ? (
        <Spinner />
      ) : keys.length === 0 ? (
        <Empty
          icon={<KeyRound className="h-4 w-4" />}
          title="No keys yet"
          note="Mint one to pull this workspace into a script, a warehouse job, Claude, Copilot, or anything else that speaks HTTP."
          action={
            <Button tone="primary" onClick={() => setMinting(true)}>
              Mint the first key
            </Button>
          }
        />
      ) : (
        <List>
          {keys.map((k) => (
            <ListRow key={k.id}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-[var(--ds-ink)]">
                  {k.name}
                </span>
                <span className="block truncate font-mono text-[11px] text-[var(--ds-dim)]">
                  {k.key_prefix}…{k.last4}
                </span>
              </span>
              <span className="hidden gap-1 sm:flex">
                {k.scopes.map((s) => (
                  <Badge key={s} tone={s === "admin" ? "danger" : "accent"}>
                    {s}
                  </Badge>
                ))}
              </span>
              <span className="hidden text-[11px] text-[var(--ds-faint)] md:block">
                {k.revoked_at
                  ? "revoked"
                  : k.last_used_at
                    ? `used ${new Date(k.last_used_at).toLocaleDateString()}`
                    : "never used"}
              </span>
              {k.revoked_at ? (
                <Badge>Revoked</Badge>
              ) : (
                <Button tone="ghost" size="sm" onClick={() => setConfirm(k)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </ListRow>
          ))}
        </List>
      )}

      <Recipes apiBase={apiBase} hasKey={live.length > 0} />

      <MintModal
        open={minting}
        onClose={() => setMinting(false)}
        onMinted={(k, secret) => {
          setMinting(false);
          setFresh({ key: k, secret });
          drop("api-keys");
        }}
        onError={setError}
      />

      <SecretModal
        value={fresh}
        apiBase={apiBase}
        onClose={() => setFresh(null)}
      />

      <Modal
        open={!!confirm}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={`Revoke ${confirm?.name ?? "this key"}?`}
        note="Anything using it stops working immediately. The row stays, marked revoked, so an incident review can still see when it was live — but the key itself can never authenticate again."
        footer={
          <>
            <Button tone="ghost" onClick={() => setConfirm(null)}>
              Keep it
            </Button>
            <Button
              tone="danger"
              onClick={async () => {
                const k = confirm;
                setConfirm(null);
                if (!k) return;
                try {
                  await revokeApiKey(k.id);
                  drop("api-keys");
                } catch (e) {
                  setError(e instanceof AmberError ? e.message : "Could not revoke that key.");
                }
              }}
            >
              Revoke
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-[var(--ds-muted)]">
          {confirm?.last_used_at
            ? `Last used ${new Date(confirm.last_used_at).toLocaleString()}.`
            : "It has never been used, so nothing is relying on it."}
        </p>
      </Modal>
    </div>
  );
}

function MintModal({
  open,
  onClose,
  onMinted,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onMinted: (k: OrgApiKey, secret: string) => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="New company key"
      /* Said BEFORE, not after. Being told a value is gone forever at the
         moment it vanishes is how somebody loses an afternoon. */
      note="The key itself is shown once, on the next screen, and is never recoverable. Have somewhere to paste it."
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="primary"
            busy={busy}
            disabled={!name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await createApiKey({ name: name.trim(), scopes });
                onMinted(r.key, r.secret);
                setName("");
                setScopes(["read"]);
              } catch (e) {
                onError(e instanceof AmberError ? e.message : "Could not mint that key.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Mint key
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="What is it for" hint="The thing holding it, so a list of four keys means something.">
          <TextField
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nightly CRM sync"
          />
        </Field>

        <div className="space-y-1.5">
          <span className="text-[12px] font-medium text-[var(--ds-ink)]">What it may do</span>
          {SCOPES.map((s) => {
            const on = scopes.includes(s.id);
            return (
              <button
                key={s.id}
                onClick={() =>
                  setScopes((prev) =>
                    on ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                  )
                }
                className={`flex w-full gap-3 rounded-lg border p-2.5 text-left transition-colors ${
                  on
                    ? "border-[var(--ds-accent)] bg-[var(--ds-accent-soft)]"
                    : "border-[var(--ds-line)] hover:border-[var(--ds-line-strong)]"
                }`}
              >
                <span
                  className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${
                    on
                      ? "border-[var(--ds-accent)] bg-[var(--ds-accent)] text-white"
                      : "border-[var(--ds-line-strong)]"
                  }`}
                >
                  {on ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-[var(--ds-ink)]">
                    {s.title}
                  </span>
                  {/* The worst case, not the name. "Write" tells nobody
                      whether it can remove a colleague. */}
                  <span className="block text-[12px] leading-snug text-[var(--ds-dim)]">
                    {s.worst}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

function SecretModal({
  value,
  apiBase,
  onClose,
}: {
  value: { key: OrgApiKey; secret: string } | null;
  apiBase: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal
      open={!!value}
      onOpenChange={(v) => !v && onClose()}
      title="Copy this now"
      note="This is the only time this value exists outside your machine. We store a hash of it and nothing else, so it cannot be shown again — a lost key is replaced, not recovered."
      footer={
        <Button tone="primary" onClick={onClose}>
          I have copied it
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-stretch gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-[var(--ds-line)] bg-[var(--ds-sunk)] px-3 py-2 font-mono text-[12px] text-[var(--ds-ink)]">
            {value?.secret}
          </code>
          <Button
            tone="quiet"
            onClick={async () => {
              if (!value) return;
              await navigator.clipboard.writeText(value.secret).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <p className="text-[12px] text-[var(--ds-dim)]">
          Try it:
        </p>
        <pre className="overflow-x-auto rounded-lg border border-[var(--ds-line)] bg-[var(--ds-sunk)] p-3 font-mono text-[11px] leading-relaxed text-[var(--ds-muted)]">
{`curl -H "Authorization: Bearer ${value?.secret ?? "…"}" \\
  ${apiBase}/v1/api/whoami`}
        </pre>
      </div>
    </Modal>
  );
}

/**
 * The four commands worth having on the page.
 *
 * Not a link to documentation. Somebody deciding whether this workspace can
 * take their company's work is deciding in the next ninety seconds, and a
 * link is a decision they defer rather than make.
 */
function Recipes({ apiBase, hasKey }: { apiBase: string; hasKey: boolean }) {
  const k = hasKey ? "$AMBER_KEY" : "amberorg_live_…";
  const items: { title: string; note: string; cmd: string }[] = [
    {
      title: "Everything, as one file",
      note: "The backup, and the answer to “can we get our work back out”. Run it today and keep the output.",
      cmd: `curl -H "Authorization: Bearer ${k}" \\\n  ${apiBase}/v1/api/export > amber-export.json`,
    },
    {
      title: "The roster",
      note: "Who is in the company, with roles. The usual first join in a warehouse.",
      cmd: `curl -H "Authorization: Bearer ${k}" \\\n  ${apiBase}/v1/api/people`,
    },
    {
      title: "Post from a script",
      note: "Deploys, nightly numbers, anything a machine should announce. It is attributed to the key, never to a person.",
      cmd: `curl -X POST -H "Authorization: Bearer ${k}" \\\n  -H "content-type: application/json" \\\n  -d '{"title":"Nightly sync","body":"412 accounts updated."}' \\\n  ${apiBase}/v1/api/posts`,
    },
    {
      title: "Point an assistant at it",
      note: "Claude, Copilot and GPT all take a bearer token. They see exactly what the key sees and nothing more.",
      cmd: `${apiBase}/v1/api/export\nAuthorization: Bearer ${k}`,
    },
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--ds-faint)]">
        Start here
      </h3>
      <div className="grid gap-2 lg:grid-cols-2">
        {items.map((r) => (
          <div
            key={r.title}
            className="rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] p-3"
          >
            <p className="text-[13px] font-medium text-[var(--ds-ink)]">{r.title}</p>
            <p className="mt-0.5 text-[12px] leading-snug text-[var(--ds-dim)]">{r.note}</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--ds-sunk)] p-2.5 font-mono text-[11px] leading-relaxed text-[var(--ds-muted)]">
              {r.cmd}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
