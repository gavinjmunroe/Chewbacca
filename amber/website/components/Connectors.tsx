"use client";

/**
 * THE DIRECTORY.
 *
 * A grid of every product this workspace knows about, searchable, grouped by
 * what they are for, with the ones this company has turned on marked. The
 * shape is deliberately the one everybody already knows from every other
 * connector directory: tile, name, one line, a plus. Nobody should have to
 * learn a new idiom to add Google Drive.
 *
 * THE TILE IS A MONOGRAM, NOT A LOGO, and that is a choice rather than a
 * shortcut. Shipping thirty-odd vendor logos means thirty-odd trademark
 * questions, thirty-odd files to keep current when somebody rebrands, and a
 * grid that looks like a sponsor wall. Two letters on the product's own hue
 * is recognizable at a glance -- which is the entire job of an icon in a
 * grid -- and it is ours to ship.
 *
 * THE HONEST BADGE. Several entries can do nothing yet beyond being written
 * down, and they say so: "Link only". The temptation is to let a tile imply a
 * sync it does not perform, and the cost of that is a company planning around
 * an integration that was never there. A directory people trust is worth more
 * than a directory that looks complete.
 *
 * WHY ADDING IS ONE CLICK WITH NO MODAL. Adding records an intention; it moves
 * no data and grants no access. The expensive, consequential step is
 * authorizing, which is its own screen with its own consent. Putting a
 * confirmation in front of the free step and none in front of the costly one
 * is exactly backwards, and common.
 */

import { useMemo, useState } from "react";
import { Check, Loader2, Plus, Search, ShieldCheck, Trash2 } from "lucide-react";
import { AmberError } from "@/lib/amber";
import { useCached } from "@/lib/cache";
import {
  addConnector,
  getConnectors,
  removeConnector,
  type AddedConnector,
} from "@/lib/connectors";
import { CONNECTOR_CATALOG, type CatalogEntry } from "@/lib/connector-catalog";
import { Alert, Badge, Button, Empty, TextField } from "@/components/ui";
import ConnectorDetail from "@/components/ConnectorDetail";

/** Two letters that read as the product. "Microsoft Copilot" → "MC". */
function monogram(name: string) {
  const words = name.replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function Connectors({
  isAdmin,
  apiBase,
  onGoToApi,
}: {
  isAdmin: boolean;
  apiBase: string;
  onGoToApi: () => void;
}) {
  const { data, refreshing, error, revalidate } = useCached("connectors", getConnectors);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /*
   * Opening a tile explains what adding it does. Clicking the plus still adds
   * it directly, because adding is free and reversible -- but the tile itself
   * now leads somewhere, which is the thing that was missing: "Added" with
   * nowhere to go reads as a product that quietly failed.
   */
  const [detail, setDetail] = useState<CatalogEntry | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /*
   * THE GRID IS STATIC DATA AND RENDERS WITH NO ROUND TRIP.
   *
   * This read the catalogue from the API, so a workspace whose API had not
   * caught up showed a red error over an empty grid — "could not load the
   * connector directory" — when the directory itself is a constant we ship.
   * The server is asked only which of these the company has already turned
   * on, which is the part that genuinely varies, and when that half fails the
   * page is still a working directory with no Added badges rather than
   * nothing at all.
   */
  const catalog = CONNECTOR_CATALOG;
  const added = data?.added ?? [];

  /** provider id → the row, so a tile knows its own state without a scan. */
  const addedBy = useMemo(() => {
    const m = new Map<string, AddedConnector>();
    for (const a of added) if (!a.group_id) m.set(a.provider, a);
    return m;
  }, [added]);

  const categories = useMemo(
    () => [...new Set(catalog.map((c) => c.category))],
    [catalog],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return catalog.filter((c) => {
      if (category && c.category !== category) return false;
      if (!needle) return true;
      // Vendor matters: somebody types "microsoft" expecting all seven.
      return (
        c.name.toLowerCase().includes(needle) ||
        c.vendor.toLowerCase().includes(needle) ||
        c.blurb.toLowerCase().includes(needle)
      );
    });
  }, [catalog, q, category]);

  const grouped = useMemo(() => {
    const m = new Map<string, CatalogEntry[]>();
    for (const c of shown) {
      if (!m.has(c.category)) m.set(c.category, []);
      m.get(c.category)!.push(c);
    }
    return [...m.entries()];
  }, [shown]);

  async function toggle(entry: CatalogEntry) {
    if (!isAdmin) return;
    setBusy(entry.id);
    setActionError(null);
    try {
      const existing = addedBy.get(entry.id);
      if (existing) await removeConnector(existing.id);
      else await addConnector({ provider: entry.id });
      // The cache is this screen's only copy of the list, so re-reading it IS
      // the update — there is no second array to keep in step and therefore
      // no way for the two to disagree. `revalidate` refetches without a
      // spinner, so the grid does not blank out between click and result.
      await revalidate();
    } catch (e) {
      setActionError(e instanceof AmberError ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <Alert tone={actionError ? "danger" : "info"}>
        {actionError ??
          (error
            ? "The directory below is complete and searchable. What is missing is which of these your company has already added \u2014 that comes from the API, which has not answered. Usually it is running a build older than this page; adding a connector will not stick until it catches up."
            : null)}
      </Alert>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ds-faint)]" />
          <TextField
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search connectors"
            className="pl-9"
          />
        </div>
        {refreshing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ds-faint)]" />
        ) : null}
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        <Chip on={category === null} onClick={() => setCategory(null)}>
          All
        </Chip>
        {categories.map((c) => (
          <Chip key={c} on={category === c} onClick={() => setCategory(c)}>
            {c}
          </Chip>
        ))}
      </div>

      {grouped.length === 0 ? (
        <Empty
          title="Nothing matches that"
          note="Every product here is one we can genuinely do something with. If what you need is missing, the REST API under “Build your own” reaches all of it."
        />
      ) : (
        grouped.map(([name, entries]) => (
          <section key={name} className="space-y-2">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--ds-faint)]">
              {name}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {entries.map((c) => (
                <Tile
                  key={c.id}
                  entry={c}
                  added={addedBy.get(c.id) ?? null}
                  busy={busy === c.id}
                  canEdit={isAdmin}
                  onToggle={() => toggle(c)}
                  onOpen={() => setDetail(c)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      <ConnectorDetail
        entry={detail}
        added={!!(detail && addedBy.has(detail.id))}
        apiBase={apiBase}
        onClose={() => setDetail(null)}
        onAdd={() => {
          if (detail) void toggle(detail);
          setDetail(null);
        }}
        onRemove={() => {
          if (detail) void toggle(detail);
          setDetail(null);
        }}
        onGoToApi={() => {
          setDetail(null);
          onGoToApi();
        }}
      />
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1 text-[12px] transition-colors ${
        on
          ? "border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] text-[var(--ds-accent-ink)]"
          : "border-[var(--ds-line)] bg-[var(--ds-card)] text-[var(--ds-muted)] hover:border-[var(--ds-line-strong)]"
      }`}
    >
      {children}
    </button>
  );
}

function Tile({
  entry,
  added,
  busy,
  canEdit,
  onToggle,
  onOpen,
}: {
  entry: CatalogEntry;
  added: AddedConnector | null;
  busy: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const can = entry.capabilities;
  return (
    <div className="group relative flex gap-3 rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] p-3 transition-all hover:border-[var(--ds-line-strong)] hover:shadow-[var(--ds-shadow-sm)]">
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[12px] font-bold tracking-tight text-white"
        style={{ background: entry.hue }}
        aria-hidden
      >
        {monogram(entry.name)}
      </span>

      <button
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
        title={`What ${entry.name} does here`}
      >
        <div className="flex items-center gap-1">
          <span className="truncate text-[13px] font-medium text-[var(--ds-ink)]">
            {entry.name}
          </span>
          {entry.firstParty ? (
            <ShieldCheck
              className="h-3.5 w-3.5 shrink-0 text-[var(--ds-accent)]"
              /* We wrote and maintain this one. On a directory that will
                 eventually hold third-party entries, that distinction is the
                 difference between "we support this" and "somebody does". */
              aria-label="Built and maintained here"
            />
          ) : null}
        </div>

        <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-[var(--ds-dim)]">
          {entry.blurb}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-[var(--ds-faint)]">
            Connector · by {entry.vendor}
          </span>
          {can.length === 0 ? (
            /* Said plainly. A tile that implies a sync it does not perform is
               a company planning around an integration that is not there. */
            <Badge>Link only</Badge>
          ) : (
            <Badge tone="accent">
              {can.includes("read") && can.includes("write")
                ? "Read and write"
                : can.includes("read")
                  ? "Read"
                  : "Write"}
            </Badge>
          )}
          {added ? <Badge tone="accent">Added</Badge> : null}
        </div>
      </button>

      {canEdit ? (
        <button
          onClick={onToggle}
          disabled={busy}
          title={added ? `Remove ${entry.name}` : `Add ${entry.name}`}
          className={`absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg border transition-all ${
            added
              ? "border-[var(--ds-line)] text-[var(--ds-accent)] opacity-100 hover:border-[var(--ds-danger)] hover:text-[var(--ds-danger)]"
              : "border-[var(--ds-line)] text-[var(--ds-muted)] opacity-0 hover:border-[var(--ds-accent)] hover:text-[var(--ds-accent)] group-hover:opacity-100 focus:opacity-100"
          } disabled:opacity-40`}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : added ? (
            <>
              <Check className="h-3.5 w-3.5 group-hover:hidden" />
              <Trash2 className="hidden h-3.5 w-3.5 group-hover:block" />
            </>
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
        </button>
      ) : added ? (
        <Check className="absolute right-3 top-3 h-3.5 w-3.5 text-[var(--ds-accent)]" />
      ) : null}
    </div>
  );
}
