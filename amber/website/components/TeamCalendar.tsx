"use client";

/**
 * EVERYBODY'S WEEK, IN ONE PLACE, WITH A WAY TO NARROW IT.
 *
 * The old version showed the team's events as a flat list, which answers
 * "what is scheduled" and not the question a team actually has, which is
 * "when can the four of us talk". For that you need several people's
 * calendars at once, laid on the same hours, with the gaps visible.
 *
 * SO IT IS A GRID, NOT A LIST. Days across, hours down, each person's
 * commitments as blocks in their own colour. A list can tell you Tuesday is
 * busy; only a grid tells you Tuesday afternoon is free for everyone except
 * Sam.
 *
 * IT OPENS SHOWING ONLY YOU, and that is deliberate. A six-person team with
 * three calendars each is eighteen overlapping blocks, which is unreadable
 * and, worse, teaches people the feature is noise before they find the
 * filter. Your own week is legible, immediately useful, and the switches
 * above it make the comparison an explicit act.
 *
 * SEVERAL ACCOUNTS PER PERSON IS THE NORMAL CASE, not an edge one. People
 * have a work Google and a personal one; contractors have one per client.
 * Each connected account is its own switch, so somebody can put their work
 * calendar in front of the team and keep the other two to themselves — which
 * is the only arrangement a person will actually agree to.
 *
 * WHAT THE OPENINGS ROW IS AND IS NOT. It is the hours in which nobody
 * currently shown has anything, inside working hours. It is NOT a scheduler:
 * it does not know about time zones beyond the viewer's own, it cannot see a
 * calendar nobody shared, and it will happily call an hour free when the one
 * person who matters has kept their calendar private. It is a prompt for a
 * human, which is what a team of six needs, rather than an answer, which is
 * what a team of six hundred needs and is a different product.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { AmberError } from "@/lib/amber";
import { hueFor } from "@/lib/cn";
import {
  addGroupEvent,
  getGroupCalendar,
  getMyCalendars,
  removeGroupEvent,
  shareCalendar,
  startCalendarConnect,
  type GroupEvent,
  type MyCalendar,
} from "@/lib/workspace";
import { Alert, Avatar, Badge, Button, Field, Modal, TextField } from "@/components/ui";

/** The band the grid draws. Outside it, a block is clipped to the edge. */
const DAY_START = 7;
const DAY_END = 21;
const HOURS = DAY_END - DAY_START;
const ROW_PX = 34;

/** Working hours for the openings row. Narrower than the drawn band. */
const WORK_START = 9;
const WORK_END = 18;

type Person = { id: string; name: string };

export default function TeamCalendar({
  groupId,
  groupName,
  meId,
  isAdmin,
}: {
  groupId: string;
  groupName: string;
  meId: string | null;
  isAdmin: boolean;
}) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [events, setEvents] = useState<GroupEvent[]>([]);
  const [mine, setMine] = useState<MyCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showOpenings, setShowOpenings] = useState(false);

  /**
   * Who is shown. `null` means "not chosen yet" and resolves to just the
   * viewer on first load — distinct from the empty set, which means somebody
   * has deliberately unticked everybody and should see an empty grid rather
   * than being silently reset to themselves.
   */
  const [shown, setShown] = useState<Set<string> | null>(null);

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      getGroupCalendar(groupId, {
        from: weekStart.toISOString(),
        to: weekEnd.toISOString(),
      }),
      getMyCalendars(groupId).catch(() => ({ calendars: [] as MyCalendar[], count: 0 })),
    ])
      .then(([cal, m]) => {
        setEvents(cal.events);
        setMine(m.calendars);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof AmberError ? e.message : "Could not load the calendar."),
      )
      .finally(() => setLoading(false));
  }, [groupId, weekStart, weekEnd]);

  useEffect(load, [load]);

  /** Everybody with something on this team's calendar, plus the viewer. */
  const people: Person[] = useMemo(() => {
    const m = new Map<string, string>();
    if (meId) m.set(meId, "You");
    for (const e of events) {
      if (!e.owner_id) continue;
      if (e.owner_id === meId) m.set(e.owner_id, "You");
      else m.set(e.owner_id, e.owner_name ?? "Someone");
    }
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [events, meId]);

  const visible = useMemo(() => {
    // Default: just me. See the comment on `shown`.
    const set = shown ?? new Set(meId ? [meId] : []);
    return events.filter((e) => {
      // A team event belongs to the team rather than to a person, so it is
      // always shown: it is the thing everybody is meant to see.
      if (e.kind === "team") return true;
      return e.owner_id ? set.has(e.owner_id) : false;
    });
  }, [events, shown, meId]);

  const chosen = shown ?? new Set(meId ? [meId] : []);

  function togglePerson(id: string) {
    setShown((prev) => {
      const base = prev ?? new Set(meId ? [meId] : []);
      const next = new Set(base);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <Alert>{error}</Alert>

      {/* ── the week, and what to do to it ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button tone="quiet" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button tone="quiet" size="sm" onClick={() => setWeekStart(mondayOf(new Date()))}>
            This week
          </Button>
          <Button tone="quiet" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <span className="ml-2 text-[12px] text-[var(--ds-muted)]">
            {weekStart.toLocaleDateString(undefined, { month: "long", day: "numeric" })} –{" "}
            {addDays(weekStart, 6).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
          {loading ? (
            <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin text-[var(--ds-faint)]" />
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            tone={showOpenings ? "primary" : "quiet"}
            size="sm"
            onClick={() => setShowOpenings((v) => !v)}
            title="Hours when nobody shown is busy"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Openings
          </Button>
          <Button tone="primary" size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add event
          </Button>
        </div>
      </div>

      {/* ── whose week is on the grid ── */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[var(--ds-line)] bg-[var(--ds-hover)] p-2">
        <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-[var(--ds-faint)]">
          Showing
        </span>
        {people.map((p) => {
          const on = chosen.has(p.id);
          return (
            <button
              key={p.id}
              onClick={() => togglePerson(p.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] transition-colors ${
                on
                  ? "border-transparent text-white"
                  : "border-[var(--ds-line)] bg-[var(--ds-card)] text-[var(--ds-muted)] hover:border-[var(--ds-line-strong)]"
              }`}
              style={on ? { background: hueFor(p.id) } : undefined}
            >
              <Avatar name={p.name === "You" ? "You" : p.name} size={16} />
              {p.name}
            </button>
          );
        })}
        {people.length > 1 ? (
          <button
            onClick={() => setShown(new Set(people.map((p) => p.id)))}
            className="rounded-full px-2 py-0.5 text-[12px] font-medium text-[var(--ds-accent)] hover:bg-[var(--ds-accent-soft)]"
          >
            Everyone
          </button>
        ) : null}
        {people.length <= 1 ? (
          <span className="text-[12px] text-[var(--ds-dim)]">
            Only you so far. Teammates appear here once they share a calendar with{" "}
            {groupName}.
          </span>
        ) : null}
      </div>

      <WeekGrid
        weekStart={weekStart}
        events={visible}
        openings={showOpenings ? freeSlots(visible, weekStart) : null}
        meId={meId}
        isAdmin={isAdmin}
        onRemove={async (id) => {
          await removeGroupEvent(groupId, id).catch(() => null);
          load();
        }}
      />

      <MyCalendars calendars={mine} groupId={groupId} onChanged={load} />

      <AddEvent
        open={adding}
        groupId={groupId}
        groupName={groupName}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          load();
        }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── the grid */

function WeekGrid({
  weekStart,
  events,
  openings,
  meId,
  isAdmin,
  onRemove,
}: {
  weekStart: Date;
  events: GroupEvent[];
  openings: { day: number; from: number; to: number }[] | null;
  meId: string | null;
  isAdmin: boolean;
  onRemove: (id: string) => void;
}) {
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const today = new Date().toDateString();

  /** Events bucketed per day, with their position inside the drawn band. */
  const laid = useMemo(() => {
    const byDay: { ev: GroupEvent; top: number; height: number }[][] = days.map(() => []);
    for (const e of events) {
      const start = new Date(e.starts_at);
      const i = days.findIndex((d) => d.toDateString() === start.toDateString());
      if (i < 0) continue;
      const end = e.ends_at ? new Date(e.ends_at) : new Date(start.getTime() + 3_600_000);
      const sh = start.getHours() + start.getMinutes() / 60;
      const eh = end.getHours() + end.getMinutes() / 60;
      // Clipped to the band rather than dropped: an 06:30 standup should
      // still be visible, pinned to the top edge, not silently missing.
      const top = (Math.max(DAY_START, Math.min(sh, DAY_END)) - DAY_START) * ROW_PX;
      const bottom = (Math.max(DAY_START, Math.min(eh, DAY_END)) - DAY_START) * ROW_PX;
      byDay[i].push({ ev: e, top, height: Math.max(16, bottom - top) });
    }
    return byDay;
  }, [days, events]);

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--ds-line)]">
      <div className="grid grid-cols-[40px_repeat(7,minmax(0,1fr))] border-b border-[var(--ds-line)] bg-[var(--ds-hover)]">
        <span />
        {days.map((d) => (
          <span
            key={d.toISOString()}
            className={`px-1 py-1.5 text-center text-[11px] ${
              d.toDateString() === today
                ? "font-semibold text-[var(--ds-accent-ink)]"
                : "text-[var(--ds-muted)]"
            }`}
          >
            {d.toLocaleDateString(undefined, { weekday: "short" })}{" "}
            <span className="tnum">{d.getDate()}</span>
          </span>
        ))}
      </div>

      <div className="relative grid grid-cols-[40px_repeat(7,minmax(0,1fr))]">
        {/* the hour gutter */}
        <div className="border-r border-[var(--ds-line)]">
          {Array.from({ length: HOURS }, (_, i) => (
            <div
              key={i}
              style={{ height: ROW_PX }}
              className="pr-1 text-right text-[10px] leading-none text-[var(--ds-faint)]"
            >
              <span className="relative -top-1">{label(DAY_START + i)}</span>
            </div>
          ))}
        </div>

        {days.map((d, i) => (
          <div
            key={d.toISOString()}
            className="relative border-r border-[var(--ds-line)] last:border-r-0"
          >
            {/* recessive hour lines: the grid is scaffolding, not content */}
            {Array.from({ length: HOURS }, (_, h) => (
              <div
                key={h}
                style={{ height: ROW_PX }}
                className="border-b border-[var(--ds-line)] last:border-b-0"
              />
            ))}

            {/* openings sit UNDER the events, so a block always wins */}
            {(openings ?? [])
              .filter((o) => o.day === i)
              .map((o) => (
                <div
                  key={`${o.day}-${o.from}`}
                  className="pointer-events-none absolute inset-x-0.5 rounded bg-[var(--ds-accent-soft)]"
                  style={{
                    top: (o.from - DAY_START) * ROW_PX,
                    height: (o.to - o.from) * ROW_PX,
                  }}
                />
              ))}

            {laid[i].map(({ ev, top, height }) => (
              <button
                key={ev.id}
                title={`${ev.title}${ev.owner_name ? ` · ${ev.owner_name}` : ""}${
                  ev.calendar_label ? ` (${ev.calendar_label})` : ""
                }`}
                onClick={() => {
                  const canRemove =
                    ev.kind === "team" && (isAdmin || ev.owner_id === meId);
                  if (canRemove && confirm(`Remove “${ev.title}” from the team calendar?`)) {
                    onRemove(ev.id);
                  }
                }}
                className="absolute inset-x-0.5 overflow-hidden rounded px-1 py-0.5 text-left text-[10px] leading-tight text-white shadow-sm"
                style={{
                  top,
                  height,
                  // Colour by WHOSE it is, so the same person is the same
                  // colour in every column and the eye can follow one person
                  // across the week.
                  background:
                    ev.kind === "team" ? "var(--ds-accent)" : hueFor(ev.owner_id ?? ev.title),
                }}
              >
                <span className="block truncate font-medium">{ev.title}</span>
                {height > 26 && ev.owner_name ? (
                  <span className="block truncate opacity-80">{ev.owner_name}</span>
                ) : null}
              </button>
            ))}
          </div>
        ))}
      </div>

      {openings ? (
        <p className="border-t border-[var(--ds-line)] bg-[var(--ds-sunk)] px-3 py-1.5 text-[11px] text-[var(--ds-dim)]">
          Shaded hours are free for everybody currently shown, between{" "}
          {label(WORK_START)} and {label(WORK_END)}. It only knows about calendars
          people have shared with this team.
        </p>
      ) : null}
    </div>
  );
}

/* ───────────────────────────────────────────────────────── my calendars */

function MyCalendars({
  calendars,
  groupId,
  onChanged,
}: {
  calendars: MyCalendar[];
  groupId: string;
  onChanged: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--ds-line)] bg-[var(--ds-hover)] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--ds-faint)]">
        <CalendarPlus className="h-3 w-3" />
        Your calendars on this team
      </div>

      {calendars.length === 0 ? (
        <div className="space-y-2">
          <p className="text-[12px] leading-relaxed text-[var(--ds-muted)]">
            You have no calendars connected yet. Connect as many as you like — work,
            personal, one per client — and choose which of them this team can see.
          </p>
          <ConnectCalendar />
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {calendars.map((c) => (
              <button
                key={c.id}
                onClick={async () => {
                  await shareCalendar(groupId, c.id, !c.shared).catch(() => null);
                  onChanged();
                }}
                title={c.account_email}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-all ${
                  c.shared
                    ? "border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] text-[var(--ds-ink)]"
                    : "border-[var(--ds-line)] bg-[var(--ds-card)] text-[var(--ds-muted)] hover:border-[var(--ds-line-strong)]"
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: c.shared ? "var(--ds-accent)" : "var(--ds-line-strong)" }}
                />
                {c.display_name || c.account_email}
                <Badge>{c.provider === "google" ? "Google" : "Outlook"}</Badge>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[var(--ds-dim)]">
            Nothing is copied. Unsharing removes those events from the team&rsquo;s week
            immediately, and leaving the group ends it without touching your account.
          </p>
          <ConnectCalendar compact />
        </div>
      )}

      {calendars.some((c) => c.last_error) ? (
        <p className="mt-2 text-[11px] text-[var(--ds-danger)]">
          A calendar has stopped syncing. Connect it again below, or the team will be
          looking at a week that stopped updating.
        </p>
      ) : null}
    </div>
  );
}

/**
 * CONNECTING, FROM THE PLACE THAT NEEDS ONE.
 *
 * It used to say "connect in your account settings", which the website does
 * not have. And a server with no OAuth client for the provider says so in
 * words an admin can act on, rather than being a button that does nothing
 * twice.
 */
function ConnectCalendar({ compact }: { compact?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function go(provider: "google" | "microsoft") {
    setBusy(provider);
    setProblem(null);
    try {
      const returnTo = typeof window === "undefined" ? "/org" : window.location.pathname;
      const r = await startCalendarConnect(provider, returnTo);
      window.location.href = r.authorize_url;
    } catch (e) {
      const msg = e instanceof AmberError ? e.message : "";
      setProblem(
        /not_configured/i.test(String(msg))
          ? `${provider === "google" ? "Google" : "Microsoft"} calendar sync is not set up on this server yet — an admin has to add the OAuth client ID and secret to the API.`
          : "Could not start that connection.",
      );
      setBusy(null);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        <Button tone="quiet" size="sm" busy={busy === "google"} onClick={() => go("google")}>
          <CalendarPlus className="h-3.5 w-3.5" />
          {compact ? "Add another Google" : "Connect Google"}
        </Button>
        <Button
          tone="quiet"
          size="sm"
          busy={busy === "microsoft"}
          onClick={() => go("microsoft")}
        >
          <CalendarPlus className="h-3.5 w-3.5" />
          {compact ? "Add another Outlook" : "Connect Outlook"}
        </Button>
      </div>
      {problem ? (
        <p className="text-[11px] leading-snug text-[var(--ds-danger)]">{problem}</p>
      ) : null}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── add an event */

function AddEvent({
  open,
  groupId,
  groupName,
  onClose,
  onAdded,
}: {
  open: boolean;
  groupId: string;
  groupName: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("10:00");
  const [mins, setMins] = useState("60");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setError(null);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={`Add to ${groupName}`}
      note="A team event belongs to the team. It stays when whoever typed it leaves, which is why it is not an event on anybody's own calendar."
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>Cancel</Button>
          <Button
            tone="primary"
            busy={busy}
            disabled={!title.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const starts = new Date(`${day}T${time}`);
                const ends = new Date(starts.getTime() + Number(mins || 60) * 60_000);
                await addGroupEvent(groupId, {
                  title: title.trim(),
                  startsAt: starts.toISOString(),
                  endsAt: ends.toISOString(),
                });
                onAdded();
              } catch (e) {
                setError(e instanceof AmberError ? e.message : "Could not add that.");
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
      <div className="space-y-3">
        <Field label="What is it">
          <TextField
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Weekly review"
          />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Day">
            <TextField type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label="Start">
            <TextField type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Minutes">
            <TextField
              type="number"
              min={15}
              step={15}
              value={mins}
              onChange={(e) => setMins(e.target.value)}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/* ───────────────────────────────────────────────────────────────── helpers */

function mondayOf(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  // getDay() is 0 on Sunday, which belongs to the week that just ended.
  const shift = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - shift);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function label(h: number) {
  const am = h < 12 || h === 24;
  const n = h % 12 === 0 ? 12 : h % 12;
  return `${n}${am ? "am" : "pm"}`;
}

/**
 * Hours in which nobody shown is busy.
 *
 * Deliberately coarse — whole hours, inside working hours, on the half-open
 * interval. Half-hour precision would be more accurate and less useful: the
 * output is a sentence somebody says out loud ("Thursday after two?"), and
 * "Thursday 14:30 to 15:15" is not that sentence.
 *
 * An hour is busy if ANY shown event overlaps it at all, which is the
 * conservative direction: proposing a time somebody is busy costs a round of
 * messages, and missing one costs nothing.
 */
function freeSlots(events: GroupEvent[], weekStart: Date) {
  const out: { day: number; from: number; to: number }[] = [];
  for (let day = 0; day < 7; day++) {
    const date = addDays(weekStart, day);
    // Weekends are not openings. A team that works Saturdays knows it does.
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    const busy = new Set<number>();
    for (const e of events) {
      const s = new Date(e.starts_at);
      if (s.toDateString() !== date.toDateString()) continue;
      const end = e.ends_at ? new Date(e.ends_at) : new Date(s.getTime() + 3_600_000);
      const from = Math.floor(s.getHours() + s.getMinutes() / 60);
      const to = Math.ceil(end.getHours() + end.getMinutes() / 60);
      for (let h = from; h < to; h++) busy.add(h);
    }

    // Merge adjacent free hours into one block, so a free afternoon reads as
    // an afternoon rather than as four separate suggestions.
    let run: { from: number; to: number } | null = null;
    for (let h = WORK_START; h < WORK_END; h++) {
      if (busy.has(h)) {
        if (run) out.push({ day, ...run });
        run = null;
      } else if (run) {
        run.to = h + 1;
      } else {
        run = { from: h, to: h + 1 };
      }
    }
    if (run) out.push({ day, ...run });
  }
  return out;
}
