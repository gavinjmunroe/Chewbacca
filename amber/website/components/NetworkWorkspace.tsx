"use client";

/**
 * THE NETWORK, AS A PLACE TO WORK RATHER THAN A PICTURE TO LOOK AT.
 *
 * WHAT WAS WRONG WITH THE OLD SCREEN. A search bar that asked a model a
 * question, a graph that showed everybody regardless of what you typed, firm
 * chips under the graph that dimmed dots in the graph only, and two long
 * lists below it that were always there whether or not anybody wanted them.
 * Four controls, none of which moved the others: typing did nothing to the
 * picture, and the picture could not be turned into a list.
 *
 * ONE SET, THREE WAYS TO SEE IT, AND EVERYTHING FILTERS IT.
 *
 * The roster is loaded once and held here. Typing filters it as you type --
 * the graph rearranges on the keystroke, because a search that needs
 * Enter is a search that nobody believes is live. The pills filter it. The
 * view switch only changes how the SAME filtered set is drawn:
 *
 *   NETWORK  position is warmth, angle is the firm. For "who do we have".
 *   KANBAN   columns by how long since you spoke, or by firm. For "who is
 *            slipping", which is a column you can read and a graph cannot.
 *   TABLE    sortable, dense, everything at once. For "sort by touches".
 *
 * THE CHAT IS BESIDE THE RESULTS AND KNOWS WHAT IS IN THEM. Filter to
 * eleven people and ask "which of these should I chase" and "these" means
 * those eleven, because their ids go with the question. A chat that cannot
 * see the screen it sits on is a search box with extra steps.
 *
 * AND NOTHING IS SHOWN BELOW UNTIL SOMEBODY ASKS. The lists are gone.
 * Clicking anybody -- a dot, a card, a row -- opens their page, which is the
 * company's own wiki entry for that person: who has the relationship, what
 * we have written that mentions them, which rooms they are in. That is the
 * thing the lists were a poor substitute for.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Columns3,
  Loader2,
  Network as NetworkIcon,
  Search,
  Sparkles,
  Table as TableIcon,
  X,
} from "lucide-react";
import { Button, Empty, Panel } from "@/components/ui";
import AskBar from "@/components/AskBar";
import RelationshipOrbit from "@/components/RelationshipOrbit";
import PersonProfile from "@/components/PersonProfile";
import {
  addLink,
  ago,
  listLinks,
  listPeople,
  type PersonLink,
  type PersonRow,
} from "@/lib/memory";

type View = "network" | "kanban" | "table";
type Group = "warmth" | "firm";

/** Days since, or a big number when never -- which sorts as coldest. */
function days(iso: string | null | undefined) {
  if (!iso) return 99999;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return Number.isFinite(d) ? d : 99999;
}

/**
 * THE COLUMNS, AND WHY THESE ONES.
 *
 * Not "lead / qualified / won", which is a sales pipeline and a thing
 * somebody has to maintain by hand. These are computed from the last time
 * you actually spoke, so the board is correct without anybody dragging a
 * card -- and a card that moves on its own is the only kind that stays true.
 */
const BANDS = [
  { key: "week", label: "This week", test: (d: number) => d <= 7 },
  { key: "month", label: "This month", test: (d: number) => d <= 31 },
  { key: "quarter", label: "This quarter", test: (d: number) => d <= 92 },
  { key: "cold", label: "Gone quiet", test: () => true },
] as const;

export default function NetworkWorkspace({ meId }: { meId: string }) {
  const [people, setPeople] = useState<PersonRow[] | null>(null);
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("network");
  const [group, setGroup] = useState<Group>("warmth");
  const [firms, setFirms] = useState<Set<string>>(new Set());
  const [side, setSide] = useState<"all" | "internal" | "external">("all");
  const [quietOnly, setQuietOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  /* Claimed connections between two people, drawn as dotted ties. */
  const [links, setLinks] = useState<PersonLink[]>([]);
  /* Two people picked on the canvas, waiting for somebody to say why. */
  const [connecting, setConnecting] = useState<{ from: string; to: string } | null>(null);
  const [naming, setNaming] = useState(false);
  const [named, setNamed] = useState<string | null>(null);

  /* One loader, so a rename on the card refreshes the roster behind it. */
  const reload = useCallback(() => {
    Promise.all([
      listPeople({ scope: "external" }).catch(() => [] as PersonRow[]),
      listPeople({ scope: "internal" }).catch(() => [] as PersonRow[]),
    ])
      .then(([ext, int]) => {
        const seen = new Set<string>();
        setPeople(
          [...int, ...ext].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true))),
        );
      })
      .catch(() => setPeople([]));
  }, []);

  const reloadLinks = useCallback(() => {
    listLinks()
      .then(setLinks)
      .catch(() => setLinks([]));
  }, []);

  useEffect(reload, [reload]);
  useEffect(reloadLinks, [reloadLinks]);

  /** Every firm present, biggest first: the pill row is the key and the filter. */
  const allFirms = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of people ?? []) {
      /*
       * YOUR OWN COMPANY IS NOT A FIRM PILL. It is "One of us", which is
       * already a filter one row up -- so a pill for it is the same set
       * under a second name, and clicking the wrong one of the two looks
       * like a bug.
       */
      if (p.internal === true) continue;
      const f = (p.account_name ?? p.company ?? "").trim();
      if (!f) continue;
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [people]);

  /*
   * THE FILTER, APPLIED ONCE, FOR ALL THREE VIEWS.
   *
   * Matching on name, firm, title AND address, because before enrichment
   * runs the address IS what somebody is called here -- typing "paychex"
   * should find the people whose only identifier is @paychex.com.
   */
  /*
   * CLICKING THE SELECTED NODE AGAIN LETS IT GO.
   *
   * The only way out used to be an X at the bottom of a panel, which is a
   * long way from the thing you clicked and nowhere near where your hand
   * already is. Selecting is a toggle everywhere else in software; it should
   * be one here.
   */
  const toggleOpen = useCallback(
    (id: string) => setOpen((cur) => (cur === id ? null : id)),
    [],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (people ?? []).filter((p) => {
      const firm = (p.account_name ?? p.company ?? "").trim();
      if (firms.size > 0 && !firms.has(firm)) return false;
      if (side === "internal" && p.internal !== true) return false;
      if (side === "external" && p.internal === true) return false;
      if (quietOnly && days(p.last_at) <= 60) return false;
      if (!needle) return true;
      /*
       * EVERY ADDRESS, NOT THE FIRST ONE.
       *
       * Sagar has four. Typing the one you happen to have for him --
       * sagar@bluemodernadvisory.com -- found nothing, because the row
       * carried only whichever address was seen first. A person IS the set
       * of their addresses; that is what merging them was for.
       */
      return [
        p.display_name,
        firm,
        p.title,
        p.note,
        p.email,
        ...(p.emails ?? []),
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [people, q, firms, side, quietOnly]);

  /* Anybody whose name is still an address or a single unsplit word. */
  const unnamed = (people ?? []).filter((p) => {
    const n = String(p.display_name ?? "").trim();
    return !n || n.includes("@") || !n.includes(" ");
  }).length;

  const toggleFirm = useCallback((f: string) => {
    setFirms((cur) => {
      const next = new Set(cur);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }, []);

  const clear = () => {
    setQ("");
    setFirms(new Set());
    setSide("all");
    setQuietOnly(false);
  };

  const filtered =
    q.trim().length > 0 || firms.size > 0 || side !== "all" || quietOnly;

  if (people === null) {
    return (
      <Panel className="grid h-[60vh] place-items-center">
        <span className="flex items-center gap-2 text-[13px] text-[var(--ds-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading your network…
        </span>
      </Panel>
    );
  }

  if (people.length === 0) {
    return (
      <Empty
        icon={<NetworkIcon className="h-5 w-5" />}
        title="Nothing to show yet"
        note="Connect a calendar and this fills with everybody you have met. Nobody types anything in."
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------------ the search */}
      {/*
        IT FILTERS AS YOU TYPE. No button, no Enter. The question somebody
        has when they start typing is "is X in here", and the answer should
        appear while they are still typing it.

        AND IT STAYS AT THE TOP WHILE YOU SCROLL, together with the pills,
        because they are one control: narrowing a long table means reading
        the bottom of it and then changing the filter, and a filter you have
        to scroll back up to reach is one people stop using after the second
        trip. The backdrop is opaque enough that rows passing underneath do
        not show through the text.
      */}
      {/* Below the page title, not over it: see the note in app/org/page.tsx. */}
      {/*
        THE GLASS STAYS. IT WAS NEVER THE PROBLEM.
        
        The controls floating over the pill row were not bleeding through the
        blur -- they were PAINTING ON TOP OF IT. The header and the graph's
        own control strip were both z-10, and at equal z-index the later
        element in the document wins, so a strip that lives inside the graph
        panel drew over a header that is supposed to cover it. The header
        now sits above everything it scrolls over; the controls sit below it.
      */}
      <div className="sticky top-[78px] z-30 -mx-6 space-y-2 bg-[var(--ds-bg)]/95 px-6 pb-2 pt-3 backdrop-blur-md lg:-mx-8 lg:px-8">
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--ds-line)] bg-[var(--ds-card)] px-4 py-3 shadow-[var(--ds-shadow-sm)] transition focus-within:border-[var(--ds-accent)] focus-within:shadow-[0_0_0_4px_var(--ds-accent-soft)]">
        <Search className="h-4 w-4 shrink-0 text-[var(--ds-faint)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          spellCheck={false}
          data-gramm="false"
          data-gramm_editor="false"
          data-enable-grammarly="false"
          placeholder="Filter by name, firm, title or address"
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[14.5px] text-[var(--ds-ink)] outline-none placeholder:text-[var(--ds-faint)]"
        />
        <span className="shrink-0 text-[12px] text-[var(--ds-faint)]">
          {shown.length} of {people.length}
        </span>
        {filtered ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear"
            className="rounded-md p-1 text-[var(--ds-faint)] transition hover:text-[var(--ds-ink)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {/* ------------------------------------------------------- the pills */}
      {/*
        THE PILLS MOVED UP AND BECAME REAL FILTERS. Under the graph they
        dimmed dots in the graph; here they narrow the SET, so the kanban
        and the table follow and the chat beside them is asked about the
        same people.
      */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill on={side === "all" && !quietOnly && firms.size === 0} onClick={clear}>
          Everyone · {people.length}
        </Pill>
        <Pill on={side === "internal"} onClick={() => setSide(side === "internal" ? "all" : "internal")}>
          One of us
        </Pill>
        <Pill on={side === "external"} onClick={() => setSide(side === "external" ? "all" : "external")}>
          Outside
        </Pill>
        <Pill on={quietOnly} onClick={() => setQuietOnly((v) => !v)}>
          Gone quiet
        </Pill>

        <span className="mx-1 h-4 w-px bg-[var(--ds-line)]" />

        {allFirms.slice(0, 18).map(([f, n]) => (
          <Pill key={f} on={firms.has(f)} onClick={() => toggleFirm(f)}>
            {f} · {n}
          </Pill>
        ))}

        {/*
          NO BUTTON HERE, ON PURPOSE.
          
          There used to be one reading "Name 11 still showing as addresses",
          which is the product admitting in the interface that it knows the
          job is half done and is waiting to be asked. Naming now happens
          where the people are created and again on every sync: a mail header
          carries the name, it is kept beside the address, and anybody still
          wearing an address gets their name the moment any source supplies
          one. A person should never be asked to press a button to make the
          software finish.
        */}

        <span className="ml-auto flex items-center gap-1">
          <ViewButton on={view === "network"} onClick={() => setView("network")} label="Network">
            <NetworkIcon className="h-3.5 w-3.5" />
          </ViewButton>
          <ViewButton on={view === "kanban"} onClick={() => setView("kanban")} label="Board">
            <Columns3 className="h-3.5 w-3.5" />
          </ViewButton>
          <ViewButton on={view === "table"} onClick={() => setView("table")} label="Table">
            <TableIcon className="h-3.5 w-3.5" />
          </ViewButton>
        </span>
      </div>
      </div>

      {/* ------------------------------------------- the view and the chat */}
      <div className="flex gap-3">
        <div className="min-w-0 flex-1 space-y-3">
          {shown.length === 0 ? (
            <Panel className="grid h-[40vh] place-items-center">
              <p className="text-[13px] text-[var(--ds-muted)]">
                Nobody matches that. {filtered ? "Clear the filters to see everyone." : ""}
              </p>
            </Panel>
          ) : view === "network" ? (
            <RelationshipOrbit
              people={shown}
              onOpen={toggleOpen}
              selectedId={open}
              links={links}
              onConnect={(from, to) => setConnecting({ from, to })}
            />
          ) : view === "kanban" ? (
            <Board
              people={shown}
              group={group}
              onGroup={setGroup}
              onOpen={toggleOpen}
              openId={open}
            />
          ) : (
            <TableView people={shown} onOpen={toggleOpen} openId={open} />
          )}

          {connecting ? (
            <ConnectTwo
              from={(people ?? []).find((p) => p.id === connecting.from) ?? null}
              to={(people ?? []).find((p) => p.id === connecting.to) ?? null}
              onClose={() => setConnecting(null)}
              onSaved={() => {
                setConnecting(null);
                reloadLinks();
                reload();
              }}
            />
          ) : null}

          {/*
            NOTHING UNTIL SOMEBODY ASKS. The two long lists that used to sit
            here were always on, answering a question nobody had. A person's
            page opens where you clicked and closes when you are done.
          */}
          {open ? (
            <PersonProfile
              personId={open}
              onClose={() => setOpen(null)}
              onSaved={() => {
                reload();
                reloadLinks();
              }}
              people={people ?? []}
              links={links}
            />
          ) : null}
        </div>

        {/* ------------------------------------------------------ the chat */}
        <div className="hidden w-[360px] shrink-0 xl:block">
          <div className="sticky top-4 space-y-2">
            <p className="px-1 text-[11.5px] uppercase tracking-wide text-[var(--ds-faint)]">
              Ask about these {shown.length}
            </p>
            <AskBar
              compact
              focus={shown.slice(0, 60).map((p) => p.id)}
              placeholder={
                filtered
                  ? "Ask about the people on screen"
                  : "Who should I follow up with this week?"
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- controls */

function Pill({
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
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[12px] transition ${
        on
          ? "border-[var(--ds-accent)] bg-[var(--ds-accent-soft,rgba(232,162,79,.14))] text-[var(--ds-ink)]"
          : "border-[var(--ds-line)] text-[var(--ds-muted)] hover:text-[var(--ds-ink)]"
      }`}
    >
      {children}
    </button>
  );
}

function ViewButton({
  on,
  onClick,
  label,
  children,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] transition ${
        on
          ? "border-[var(--ds-accent)] text-[var(--ds-ink)]"
          : "border-[var(--ds-line)] text-[var(--ds-muted)] hover:text-[var(--ds-ink)]"
      }`}
    >
      {children}
      {label}
    </button>
  );
}

/* ---------------------------------------------------------------- board */

function Board({
  people,
  group,
  onGroup,
  onOpen,
  openId,
}: {
  people: PersonRow[];
  group: Group;
  onGroup: (g: Group) => void;
  onOpen: (id: string) => void;
  openId: string | null;
}) {
  const columns = useMemo(() => {
    if (group === "firm") {
      const by = new Map<string, PersonRow[]>();
      for (const p of people) {
        const f = (p.account_name ?? p.company ?? "").trim() || "No firm on record";
        by.set(f, [...(by.get(f) ?? []), p]);
      }
      return [...by.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([label, rows]) => ({ key: label, label, rows }));
    }
    const buckets = BANDS.map((b) => ({ key: b.key, label: b.label, rows: [] as PersonRow[] }));
    for (const p of people) {
      const d = days(p.last_at);
      const i = BANDS.findIndex((b) => b.test(d));
      buckets[i === -1 ? BANDS.length - 1 : i].rows.push(p);
    }
    for (const b of buckets) b.rows.sort((x, y) => days(x.last_at) - days(y.last_at));
    return buckets;
  }, [people, group]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[11.5px] uppercase tracking-wide text-[var(--ds-faint)]">
          Columns
        </span>
        <Pill on={group === "warmth"} onClick={() => onGroup("warmth")}>
          How long since you spoke
        </Pill>
        <Pill on={group === "firm"} onClick={() => onGroup("firm")}>
          Firm
        </Pill>
      </div>

      <div className="flex gap-2.5 overflow-x-auto pb-2">
        {columns.map((c) => (
          <div
            key={c.key}
            className="flex w-[260px] shrink-0 flex-col rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)]"
          >
            <div className="flex items-baseline justify-between border-b border-[var(--ds-line)] px-3 py-2">
              <p className="truncate text-[12.5px] font-semibold text-[var(--ds-ink)]">{c.label}</p>
              <span className="text-[11.5px] text-[var(--ds-faint)]">{c.rows.length}</span>
            </div>
            <div className="max-h-[58vh] min-h-[80px] space-y-1.5 overflow-y-auto p-2">
              {c.rows.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onOpen(p.id)}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
                    openId === p.id
                      ? "border-[var(--ds-accent)] bg-[var(--ds-accent-soft,rgba(232,162,79,.12))]"
                      : "border-[var(--ds-line)] hover:border-[var(--ds-accent)]"
                  }`}
                >
                  <p className="truncate text-[13px] font-medium text-[var(--ds-ink)]">
                    {p.display_name}
                  </p>
                  <p className="truncate text-[11.5px] text-[var(--ds-muted)]">
                    {(p.account_name ?? p.company ?? "").trim() || "No firm on record"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--ds-faint)]">
                    {Number(p.interactions ?? 0)}{" "}
                    {Number(p.interactions ?? 0) === 1 ? "touch" : "touches"}
                    {p.last_at ? ` · ${ago(p.last_at)}` : " · never"}
                  </p>
                </button>
              ))}
              {c.rows.length === 0 ? (
                <p className="px-1 py-3 text-center text-[11.5px] text-[var(--ds-faint)]">Empty</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- table */

type SortKey = "name" | "firm" | "touches" | "last";

function TableView({
  people,
  onOpen,
  openId,
}: {
  people: PersonRow[];
  onOpen: (id: string) => void;
  openId: string | null;
}) {
  const [sort, setSort] = useState<SortKey>("last");
  const [desc, setDesc] = useState(true);

  const rows = useMemo(() => {
    const dir = desc ? -1 : 1;
    return [...people].sort((a, b) => {
      switch (sort) {
        case "name":
          return dir * String(a.display_name).localeCompare(String(b.display_name));
        case "firm":
          return (
            dir *
            String(a.account_name ?? a.company ?? "").localeCompare(
              String(b.account_name ?? b.company ?? ""),
            )
          );
        case "touches":
          return dir * (Number(a.interactions ?? 0) - Number(b.interactions ?? 0));
        default:
          // Most recent first when descending, which is what "last seen" means.
          return dir * (days(b.last_at) - days(a.last_at));
      }
    });
  }, [people, sort, desc]);

  const head = (key: SortKey, label: string, className = "") => (
    <th className={`px-3 py-2 text-left font-medium ${className}`}>
      <button
        type="button"
        onClick={() => {
          if (sort === key) setDesc((d) => !d);
          else {
            setSort(key);
            setDesc(true);
          }
        }}
        className={`transition hover:text-[var(--ds-ink)] ${
          sort === key ? "text-[var(--ds-ink)]" : ""
        }`}
      >
        {label}
        {sort === key ? <span className="ml-1 text-[10px]">{desc ? "▼" : "▲"}</span> : null}
      </button>
    </th>
  );

  return (
    <Panel className="overflow-hidden p-0">
      <div className="max-h-[66vh] overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 bg-[var(--ds-card)] text-[11.5px] uppercase tracking-wide text-[var(--ds-faint)]">
            <tr className="border-b border-[var(--ds-line)]">
              {head("name", "Name")}
              {head("firm", "Firm")}
              <th className="px-3 py-2 text-left font-medium">Title</th>
              {head("touches", "Touches", "text-right")}
              {head("last", "Last seen")}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={p.id}
                onClick={() => onOpen(p.id)}
                className={`cursor-pointer border-b border-[var(--ds-line)] transition ${
                  openId === p.id
                    ? "bg-[var(--ds-accent-soft,rgba(232,162,79,.12))]"
                    : "hover:bg-[var(--ds-sunk,rgba(0,0,0,.02))]"
                }`}
              >
                <td className="px-3 py-2">
                  <span className="font-medium text-[var(--ds-ink)]">{p.display_name}</span>
                  {p.internal ? (
                    <span className="ml-2 rounded-full border border-[var(--ds-line)] px-1.5 text-[10px] text-[var(--ds-faint)]">
                      us
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-[var(--ds-muted)]">
                  {(p.account_name ?? p.company ?? "").trim() || "—"}
                </td>
                <td className="px-3 py-2 text-[var(--ds-muted)]">{p.title ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--ds-ink)]">
                  {Number(p.interactions ?? 0)}
                </td>
                <td className="px-3 py-2 text-[var(--ds-muted)]">
                  {p.last_at ? ago(p.last_at) : "never"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/**
 * WHY THESE TWO ARE CONNECTED.
 *
 * A line with no sentence on it is a shape. The note is the part somebody
 * reads a month later, so it is asked for at the moment the line is drawn
 * rather than left for later -- and it is written once and kept on the link
 * itself, which both people's cards read from. One fact, one place, visible
 * from either end: the alternative is the same sentence copied onto two
 * records that then drift apart.
 */
function ConnectTwo({
  from,
  to,
  onClose,
  onSaved,
}: {
  from: PersonRow | null;
  to: PersonRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<PersonLink["kind"]>("introduced");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!from || !to) return null;

  const KINDS: { id: PersonLink["kind"]; label: string; how: string }[] = [
    { id: "introduced", label: "Introduced", how: `${from.display_name} introduced ${to.display_name}` },
    { id: "worked_with", label: "Worked together", how: "They have worked together" },
    { id: "met_at", label: "Met somewhere", how: "They met somewhere" },
    { id: "knows", label: "Knows", how: "They know each other" },
  ];

  const save = async () => {
    setSaving(true);
    setProblem(null);
    try {
      await addLink({
        fromPerson: from.id,
        toPerson: to.id,
        kind,
        note: note.trim() || null,
      });
      onSaved();
    } catch (e) {
      setProblem((e as { message?: string })?.message ?? "That did not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(11,17,31,0.32)] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] rounded-2xl border border-[var(--ds-line)] bg-[var(--ds-card)] p-5 shadow-[var(--ds-shadow-lg,0_12px_40px_rgba(0,0,0,.18))]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[16px] font-semibold text-[var(--ds-ink)]">
          {from.display_name} and {to.display_name}
        </h3>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setKind(k.id)}
              className={`rounded-full border px-3 py-1 text-[12.5px] transition ${
                kind === k.id
                  ? "border-[var(--ds-accent)] bg-[var(--ds-accent-soft,rgba(232,162,79,.16))] text-[var(--ds-ink)]"
                  : "border-[var(--ds-line)] text-[var(--ds-muted)] hover:text-[var(--ds-ink)]"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] text-[var(--ds-faint)]">
          {KINDS.find((k) => k.id === kind)?.how}
        </p>

        <textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="What is worth knowing about this connection?"
          className="mt-3 w-full resize-y rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] px-3 py-2 text-[13px] leading-relaxed text-[var(--ds-ink)] outline-none focus:border-[var(--ds-accent)]"
        />

        {problem ? <p className="mt-2 text-[12.5px] text-[#c43d3d]">{problem}</p> : null}

        <div className="mt-3 flex items-center gap-2">
          <Button tone="primary" busy={saving} onClick={() => void save()}>
            Connect them
          </Button>
          <Button tone="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
