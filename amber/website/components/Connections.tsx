"use client";

/**
 * WHERE THIS TEAM'S WORK LIVES.
 *
 * A short list of the places a team keeps re-finding: the repo, the Clay
 * workspace, the shared drive, the CRM. Six rows that stop somebody pasting
 * the same link into chat every week.
 *
 * LINKS, NOT INTEGRATIONS, AND THAT IS THE POINT ON DAY ONE. A row here holds
 * no token, calls no API and syncs nothing, so a team can write down its six
 * places in a minute with no OAuth screen and no admin approval. Pulling data
 * out of those places is a different feature with a different cost, and
 * pretending a bookmark is an integration would make the real one harder to
 * add later rather than easier.
 *
 * THE PROVIDER IS DERIVED FROM THE URL. Asking somebody to pick "GitHub" from
 * a dropdown after they have already pasted github.com is asking them to do
 * the computer's job twice. It drives the dot colour and the chip, and an
 * unrecognized host is simply "Link" and works perfectly.
 */

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Globe, Plus, Trash2 } from "lucide-react";
import { AmberError } from "@/lib/amber";
import {
  PROVIDER_HUE,
  PROVIDER_LABEL,
  addConnection,
  getConnections,
  removeConnection,
  type Connection,
} from "@/lib/workspace";
import { Alert, Badge, Button, Empty, Modal, Spinner, TextField, Field } from "@/components/ui";
import { drop, useCached } from "@/lib/cache";

export default function Connections({
  groupId,
  groupName,
  meId,
  isAdmin,
  hideShared,
  headless,
}: {
  /** null for the company's own links; a group id for that team's. */
  groupId?: string | null;
  groupName?: string | null;
  meId: string | null;
  isAdmin: boolean;
  /**
   * On the Connections page every group is listed under the company's own
   * links, so repeating the company set inside each group would print the
   * same six rows eight times.
   */
  hideShared?: boolean;
  /**
   * The parent already said what this list is.
   *
   * On the Connections page each list sits inside a Section whose header
   * carries the team's name and purpose, so printing "The places Sales works
   * in" directly underneath it was the same sentence twice — a doubled header
   * on every one of eight sections. When the parent owns the heading, this
   * renders the Add button alone.
   */
  headless?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const { data, loading, error: loadError, revalidate } = useCached(
    `connections:${groupId ?? "org"}`,
    () => getConnections(groupId ?? null),
  );
  const load = revalidate;
  const rows = data?.connections ?? [];
  const shownError =
    error ??
    (loadError instanceof AmberError
      ? loadError.message
      : loadError
        ? "Could not load the links."
        : null);

  // Inside a group, the company's own links are shown too but kept apart —
  // they are every team's places, and a team that has to go to another screen
  // for the shared drive will paste the link into chat instead.
  const theirs = rows.filter((r) => (groupId ? r.group_id === groupId : true));
  const shared = groupId && !hideShared ? rows.filter((r) => r.group_id === null) : [];

  return (
    <div className="space-y-4">
      <Alert>{shownError}</Alert>

      <div
        className={`flex items-center gap-3 ${headless ? "justify-end" : "justify-between"}`}
      >
        {headless ? null : (
          <p className="text-[13px] text-[var(--ds-muted)]">
            {groupId
              ? `The places ${groupName ?? "this team"} works in.`
              : "The places the whole company works in. Every team sees these."}
          </p>
        )}
        <Button tone="primary" size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add link
        </Button>
      </div>

      {loading ? (
        <div className="grid place-items-center py-10">
          <Spinner />
        </div>
      ) : theirs.length === 0 && shared.length === 0 ? (
        <Empty
          title="Nothing linked yet"
          note="Add the repo, the drive folder, the CRM view — whatever this team opens every week and currently finds by scrolling back through messages."
          action={
            <Button tone="primary" onClick={() => setAdding(true)}>
              Add the first link
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {theirs.length > 0 ? (
            <Grid rows={theirs} meId={meId} isAdmin={isAdmin} onChanged={load} />
          ) : null}

          {shared.length > 0 ? (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--ds-faint)]">
                <Globe className="h-3 w-3" />
                Company-wide
              </div>
              <Grid rows={shared} meId={meId} isAdmin={isAdmin} onChanged={load} />
            </div>
          ) : null}
        </div>
      )}

      <AddModal
        open={adding}
        groupId={groupId ?? null}
        groupName={groupName ?? null}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          load();
        }}
      />
    </div>
  );
}

function Grid({
  rows,
  meId,
  isAdmin,
  onChanged,
}: {
  rows: Connection[];
  meId: string | null;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.map((c) => (
        <div
          key={c.id}
          className="group relative flex items-start gap-3 rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] p-3 transition-all hover:border-[var(--ds-line-strong)] hover:shadow-[var(--ds-shadow-sm)]"
        >
          <span
            className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] font-bold text-white"
            style={{ background: PROVIDER_HUE[c.provider] ?? PROVIDER_HUE.link }}
          >
            {(PROVIDER_LABEL[c.provider] ?? "L").slice(0, 2).toUpperCase()}
          </span>

          <a
            href={c.url}
            target="_blank"
            rel="noreferrer noopener"
            className="min-w-0 flex-1"
          >
            <span className="flex items-center gap-1 text-[13px] font-medium text-[var(--ds-ink)]">
              <span className="truncate">{c.label}</span>
              <ExternalLink className="h-3 w-3 shrink-0 text-[var(--ds-faint)]" />
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-[var(--ds-dim)]">
              {c.note || c.url.replace(/^https?:\/\//, "")}
            </span>
            <span className="mt-1 inline-flex">
              <Badge>{PROVIDER_LABEL[c.provider] ?? "Link"}</Badge>
            </span>
          </a>

          {isAdmin || String(c.created_by ?? "") === String(meId ?? "") ? (
            <button
              title="Remove"
              onClick={async () => {
                await removeConnection(c.id).catch(() => null);
                drop("connections");
                onChanged();
              }}
              className="absolute right-2 top-2 rounded-md p-1 text-[var(--ds-faint)] opacity-0 transition-opacity hover:bg-[var(--ds-danger-soft)] hover:text-[var(--ds-danger)] group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function AddModal({
  open,
  groupId,
  groupName,
  onClose,
  onAdded,
}: {
  open: boolean;
  groupId: string | null;
  groupName: string | null;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLabel("");
      setUrl("");
      setNote("");
      setError(null);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Add a link"
      note={
        groupId
          ? `Visible to everyone in ${groupName ?? "this group"}.`
          : "Visible to everyone in the company, on every team's page."
      }
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>Cancel</Button>
          <Button
            tone="primary"
            busy={busy}
            disabled={!label.trim() || !url.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await addConnection({
                  label: label.trim(),
                  url: url.trim(),
                  note: note.trim() || null,
                  groupId,
                });
                // Without this the list renders from a cache that predates
                // the link somebody just added, which reads as the button
                // doing nothing.
                drop(`connections:${groupId ?? "org"}`);
                onAdded();
              } catch (e) {
                setError(e instanceof AmberError ? e.message : "Could not add that link.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Add
          </Button>
        </>
      }
    >
      <Alert>{error}</Alert>
      <div className="space-y-4">
        <Field label="What is it" hint="What somebody scanning this list would call it.">
          <TextField
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Pricing model, Q4"
          />
        </Field>
        <Field
          label="Link"
          hint="We work out which product it is from the address, so there is nothing to pick."
        >
          <TextField
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/amberintelligence/amber-id"
          />
        </Field>
        <Field label="Note" hint="Optional. What somebody needs to know before opening it.">
          <TextField
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Read-only. Ask Maya for edit access."
          />
        </Field>
      </div>
    </Modal>
  );
}
