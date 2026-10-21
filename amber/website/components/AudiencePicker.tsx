"use client";

/**
 * WHO CAN SEE THIS.
 *
 * The share sheet, used by the upload dialog, the page editor and the feed
 * composer. Three of them, one component, because three copies of this would
 * be three copies that disagree about what "everyone" means.
 *
 * THE TWO QUESTIONS ARE SEPARATE AND THE UI SAYS SO:
 *
 *   1. Can the whole company read this?        a two-way choice
 *   2. Which groups and people is it for?      a list of chips
 *
 * They look like one question and they are not. A file can be readable by
 * everybody AND filed under the founding team -- that is the ordinary case,
 * not an edge one, and a picker that collapsed them would make it impossible
 * to say. When "Everyone" is on, the chips mean WHERE IT LIVES. When it is
 * off, the same chips mean WHO MAY READ IT, and the sheet says which.
 *
 * NO EMPTY AUDIENCE. Turning off "Everyone" with nothing picked would address
 * the thing to its author alone, which is not what anybody means by pressing
 * the button, so the restricted choice is disabled until something is picked
 * and the server rejects it anyway.
 */

import * as React from "react";
import { Check, Globe, Lock, Users } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { AudienceInput } from "@/lib/knowledge";
import { getGroups, getMembers, tokenNow } from "@/lib/org";

export type PickerGroup = { id: string; name: string };
export type PickerPerson = { id: string; name: string };

export function AudiencePicker({
  value,
  onChange,
  groups,
  people,
  label = "Who can see this",
  compact = false,
}: {
  value: AudienceInput;
  onChange: (next: AudienceInput) => void;
  groups: PickerGroup[];
  people: PickerPerson[];
  label?: string;
  compact?: boolean;
}) {
  const picked = value.groups.length + value.people.length;

  const toggle = (kind: "groups" | "people", id: string) => {
    const list = value[kind];
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    // Removing the last chip while restricted would leave it addressed to
    // nobody, so that removal falls back to the whole company rather than to
    // an invalid state the save button then refuses.
    const stillRestricted =
      !value.everyone && (next.length > 0 || (kind === "groups" ? value.people : value.groups).length > 0);
    onChange({ ...value, [kind]: next, everyone: value.everyone || !stillRestricted });
  };

  return (
    /*
     * Deliberately not the Field component: Field renders a <label>, and a
     * label wrapping a dozen toggle buttons is a label that owns none of them.
     */
    <div>
      <span className="mb-1.5 block text-[12px] font-medium text-[var(--ds-ink)]">{label}</span>
      <div className="space-y-2.5">
        <div className="flex gap-1.5">
          <Choice
            active={value.everyone}
            icon={<Globe className="h-3.5 w-3.5" />}
            title="Everyone"
            hint="Anyone in the company"
            onClick={() => onChange({ ...value, everyone: true })}
          />
          <Choice
            active={!value.everyone}
            icon={<Lock className="h-3.5 w-3.5" />}
            title="Just these"
            hint={picked === 0 ? "Pick a group or person first" : "Only who you pick"}
            disabled={picked === 0}
            onClick={() => onChange({ ...value, everyone: false })}
          />
        </div>

        <p className="text-[11px] leading-snug text-[var(--ds-muted)]">
          {value.everyone
            ? picked === 0
              ? "Everyone in the company can find this."
              : "Everyone can find this, and it shows up in the groups below."
            : "Only the people below — and you — can find this."}
        </p>

        {groups.length > 0 && (
          <ChipRow
            icon={<Users className="h-3 w-3" />}
            title={value.everyone ? "File it under" : "Groups who can see it"}
            items={groups}
            selected={value.groups}
            onToggle={(id) => toggle("groups", id)}
            compact={compact}
          />
        )}

        {people.length > 0 && (
          <ChipRow
            title={value.everyone ? "Also tag" : "People who can see it"}
            items={people}
            selected={value.people}
            onToggle={(id) => toggle("people", id)}
            compact={compact}
          />
        )}
      </div>
    </div>
  );
}

function Choice({
  active,
  icon,
  title,
  hint,
  onClick,
  disabled,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex-1 rounded-lg border px-3 py-2 text-left transition-all disabled:opacity-45",
        active
          ? "border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] shadow-[0_0_0_1px_var(--ds-accent-ring)]"
          : "border-[var(--ds-line)] bg-[var(--ds-card)] hover:border-[var(--ds-line-strong)]",
      )}
    >
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--ds-ink)]">
        {icon}
        {title}
      </span>
      <span className="mt-0.5 block text-[11px] text-[var(--ds-muted)]">{hint}</span>
    </button>
  );
}

function ChipRow({
  icon,
  title,
  items,
  selected,
  onToggle,
  compact,
}: {
  icon?: React.ReactNode;
  title: string;
  items: { id: string; name: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  compact?: boolean;
}) {
  // A long member list in a modal is a scroll inside a scroll, which is worse
  // than a search box for anything past a dozen names.
  const [q, setQ] = React.useState("");
  const searchable = items.length > 12;
  const shown = searchable
    ? items.filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 40)
    : items;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--ds-faint)]">
          {icon}
          {title}
        </span>
        {searchable && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter"
            className="h-6 w-28 rounded-md border border-[var(--ds-line)] bg-[var(--ds-card)] px-2 text-[11px] text-[var(--ds-ink)] outline-none focus:border-[var(--ds-accent)]"
          />
        )}
      </div>
      <div className={cn("flex flex-wrap gap-1", compact ? "max-h-20 overflow-y-auto" : "max-h-32 overflow-y-auto")}>
        {shown.map((item) => {
          const on = selected.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onToggle(item.id)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] transition-all",
                on
                  ? "border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] text-[var(--ds-ink)]"
                  : "border-[var(--ds-line)] bg-[var(--ds-card)] text-[var(--ds-muted)] hover:border-[var(--ds-line-strong)] hover:text-[var(--ds-ink)]",
              )}
            >
              {on && <Check className="h-3 w-3" />}
              {item.name}
            </button>
          );
        })}
        {shown.length === 0 && (
          <span className="text-[11px] text-[var(--ds-faint)]">Nothing matches.</span>
        )}
      </div>
    </div>
  );
}

/**
 * The read-only rendering, for a row in a listing.
 *
 * A restricted thing has to LOOK different at a glance, or somebody will
 * paste it into a channel assuming everybody in it can open the link.
 */
export function AudienceBadge({
  visibility,
  audience,
}: {
  visibility?: "org" | "restricted";
  audience?: { everyone: boolean; groups: { name: string }[]; people: { name: string }[] };
}) {
  const named = [...(audience?.groups ?? []), ...(audience?.people ?? [])];
  const restricted = visibility === "restricted" || audience?.everyone === false;

  if (!restricted) {
    if (named.length === 0) return null;
    return (
      <Badge tone="neutral">
        {named[0].name}
        {named.length > 1 ? ` +${named.length - 1}` : ""}
      </Badge>
    );
  }

  return (
    <Badge tone="accent">
      <Lock className="mr-1 inline h-3 w-3" />
      {named.length === 0
        ? "Only you"
        : `${named[0].name}${named.length > 1 ? ` +${named.length - 1}` : ""}`}
    </Badge>
  );
}

/**
 * The people and groups the picker offers, fetched once per screen.
 *
 * Every surface that shares something needs the same two lists, and the
 * alternative -- threading them down from the page that happens to already
 * have them -- means the one component that was mounted somewhere else has an
 * empty picker and no error to explain it.
 *
 * Failures are swallowed to empty lists on purpose. A share sheet that cannot
 * reach the member list should still let somebody upload a file to the whole
 * company, which is what they were doing.
 */
export function useAudienceOptions(fallbackGroups: PickerGroup[] = []) {
  const [state, setState] = React.useState<Options>(
    () => cache ?? { groups: fallbackGroups, people: [] },
  );

  React.useEffect(() => {
    let live = true;
    loadOptions()
      .then((o) => live && setState(o))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return state;
}

type Options = { groups: PickerGroup[]; people: PickerPerson[] };

/*
 * ONE FETCH FOR THE WHOLE APP, NOT ONE PER MOUNT.
 *
 * This hook is mounted in five places -- the upload dialog, the file editor,
 * the feed composer, and both page editors -- and it used to fire two
 * requests every time any of them mounted. Switching a tab unmounts and
 * remounts the lot, so clicking between Messages, Files and People fired six
 * to ten requests and the UI sat there visibly lagging while they landed.
 *
 * So the result is cached at module scope and every caller shares one
 * in-flight promise. A single short TTL is enough: the roster and the group
 * list change on the order of weeks, and anything that changes them
 * (inviting somebody, making a group) reloads the page it happened on.
 */
let cache: Options | null = null;
let cachedAt = 0;
let inFlight: Promise<Options> | null = null;
const TTL_MS = 60_000;

/** Drop the cache after something that changes the roster or the groups. */
export function forgetAudienceOptions() {
  cache = null;
  cachedAt = 0;
  inFlight = null;
}

async function loadOptions(): Promise<Options> {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  if (inFlight) return inFlight;

  const token = tokenNow();
  if (!token) return { groups: [], people: [] };

  inFlight = (async () => {
    /*
     * Failures fall back to empty lists rather than throwing. A share sheet
     * that cannot reach the roster should still let somebody post to the
     * whole company, which is what they were doing.
     */
    const [members, groups] = await Promise.all([
      getMembers(token).catch(() => ({ members: [] as Awaited<ReturnType<typeof getMembers>>["members"] })),
      getGroups(token).catch(() => ({ groups: [] as Awaited<ReturnType<typeof getGroups>>["groups"] })),
    ]);
    const out: Options = {
      people: members.members
        .filter((m) => m.status === "active")
        .map((m) => ({ id: m.amberId, name: m.fullName || m.email || "Unnamed" })),
      groups: groups.groups.map((g) => ({ id: g.id, name: g.name })),
    };
    cache = out;
    cachedAt = Date.now();
    return out;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}
