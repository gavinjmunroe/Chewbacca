"use client";

/**
 * THE ROOM'S MONTH, AS A MONTH.
 *
 * WHY THE LIST WAS WRONG. Thirty-two events in a scrolling column answers
 * "what happened" one row at a time and cannot answer the question people
 * actually bring to a calendar, which is shaped: is next week heavy, is
 * anything on Thursday, did we really not speak to them for three weeks. A
 * grid answers all three without reading a single row, because the gaps are
 * as informative as the entries and a list has no gaps.
 *
 * SEVEN COLUMNS, WHOLE WEEKS, LEADING AND TRAILING DAYS GREYED. The month
 * starts on a Monday because a working week does; a grid that starts on
 * Sunday puts the two quiet days at opposite ends and makes every week look
 * broken in half.
 *
 * A DAY SHOWS WHAT FITS AND SAYS HOW MANY MORE. Truncating silently is how
 * somebody concludes a Thursday is free when it has six things on it.
 */

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Mail, Users, X } from "lucide-react";
import type { CircleEvent } from "@/lib/knowledge";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday of the week containing this date. */
function weekStart(d: Date) {
  const out = new Date(d);
  const day = (out.getDay() + 6) % 7; // Monday = 0
  out.setDate(out.getDate() - day);
  out.setHours(0, 0, 0, 0);
  return out;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * A STABLE COLOUR PER PERSON, so the same colleague is the same colour every
 * time you open the month. Hashed from the name rather than assigned by
 * order, which would reshuffle every time somebody new appears.
 */
const TONES = [
  { bg: "rgba(232,162,79,.18)", fg: "#9a5b12" },
  { bg: "rgba(79,142,232,.16)", fg: "#1a4f93" },
  { bg: "rgba(86,181,134,.18)", fg: "#1f6b47" },
  { bg: "rgba(167,120,214,.16)", fg: "#5b3384" },
  { bg: "rgba(214,120,150,.16)", fg: "#8c3355" },
  { bg: "rgba(104,170,180,.18)", fg: "#1f5f66" },
];

function toneFor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

export default function CircleCalendar({ events }: { events: CircleEvent[] }) {
  const [monthOf, setMonthOf] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [openDay, setOpenDay] = useState<string | null>(null);
  /* The one entry somebody pressed, shown in full under the grid. */
  const [openEvent, setOpenEvent] = useState<CircleEvent | null>(null);

  const byDay = useMemo(() => {
    const map = new Map<string, CircleEvent[]>();
    for (const e of events) {
      const d = new Date(e.occurred_at);
      if (Number.isNaN(d.getTime())) continue;
      const key = d.toDateString();
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => +new Date(a.occurred_at) - +new Date(b.occurred_at));
    }
    return map;
  }, [events]);

  const weeks = useMemo(() => {
    const first = weekStart(monthOf);
    const out: Date[][] = [];
    const cursor = new Date(first);
    for (let w = 0; w < 6; w += 1) {
      const row: Date[] = [];
      for (let i = 0; i < 7; i += 1) {
        row.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      out.push(row);
      // Stop once we are past the month and the row began past it too.
      if (row[0].getMonth() !== monthOf.getMonth() && row[0] > monthOf) break;
    }
    return out;
  }, [monthOf]);

  const today = new Date();
  const shift = (by: number) => {
    const d = new Date(monthOf);
    d.setMonth(d.getMonth() + by);
    setMonthOf(d);
    setOpenDay(null);
  };

  const dayEvents = openDay ? (byDay.get(openDay) ?? []) : [];

  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <p className="flex-1 text-[14px] font-semibold text-[var(--ds-ink)]">
          {monthOf.toLocaleString(undefined, { month: "long", year: "numeric" })}
        </p>
        <button
          type="button"
          onClick={() => shift(-1)}
          aria-label="Previous month"
          className="rounded-lg border border-[var(--ds-line)] p-1.5 text-[var(--ds-muted)] transition hover:text-[var(--ds-ink)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            const d = new Date();
            d.setDate(1);
            d.setHours(0, 0, 0, 0);
            setMonthOf(d);
            setOpenDay(null);
          }}
          className="rounded-lg border border-[var(--ds-line)] px-2.5 py-1 text-[12px] text-[var(--ds-muted)] transition hover:text-[var(--ds-ink)]"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => shift(1)}
          aria-label="Next month"
          className="rounded-lg border border-[var(--ds-line)] p-1.5 text-[var(--ds-muted)] transition hover:text-[var(--ds-ink)]"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--ds-line)]">
        <div className="grid grid-cols-7 border-b border-[var(--ds-line)] bg-[var(--ds-sunk,rgba(0,0,0,.02))]">
          {DAYS.map((d) => (
            <p
              key={d}
              className="px-2 py-1.5 text-center text-[10.5px] uppercase tracking-wide text-[var(--ds-faint)]"
            >
              {d}
            </p>
          ))}
        </div>

        {weeks.map((row, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-[var(--ds-line)] last:border-b-0">
            {row.map((day) => {
              const key = day.toDateString();
              const list = byDay.get(key) ?? [];
              const outside = day.getMonth() !== monthOf.getMonth();
              const isToday = sameDay(day, today);
              return (
                /*
                  THE DAY IS NO LONGER A BUTTON, because the entries inside
                  it are. A button cannot contain a button, which is why
                  nothing in here was clickable: the pills were spans inside
                  the day's own button and every press selected the day.
                */
                <div
                  key={key}
                  className={`min-h-[94px] border-r border-[var(--ds-line)] p-1.5 align-top last:border-r-0 ${
                    outside ? "bg-[var(--ds-sunk,rgba(0,0,0,.015))]" : ""
                  }`}
                >
                  <span
                    className={`inline-grid h-5 w-5 place-items-center rounded-full text-[11px] ${
                      isToday
                        ? "bg-[var(--ds-ink)] font-semibold text-[var(--ds-card)]"
                        : outside
                          ? "text-[var(--ds-faint)]"
                          : "text-[var(--ds-muted)]"
                    }`}
                  >
                    {day.getDate()}
                  </span>

                  <div className="mt-1 space-y-[3px]">
                    {list.slice(0, 3).map((e) => {
                      const tone = toneFor(e.member_name ?? e.source ?? "x");
                      return (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => setOpenEvent(e)}
                          className="block w-full truncate rounded px-1 py-[2px] text-left text-[10.5px] leading-tight transition hover:brightness-95"
                          style={{ backgroundColor: tone.bg, color: tone.fg }}
                          title={[e.summary, e.member_name, e.firm].filter(Boolean).join(" · ")}
                        >
                          {e.summary ?? e.kind}
                        </button>
                      );
                    })}
                    {list.length > 3 ? (
                      <button
                        type="button"
                        onClick={() => setOpenDay(openDay === key ? null : key)}
                        className="block px-1 text-left text-[10px] text-[var(--ds-faint)] transition hover:text-[var(--ds-ink)]"
                      >
                        +{list.length - 3} more
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {openDay && dayEvents.length > 0 ? (
        <div className="mt-3 rounded-xl border border-[var(--ds-line)] p-3.5">
          <p className="mb-1.5 text-[12.5px] font-semibold text-[var(--ds-ink)]">
            {new Date(openDay).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          <ul className="space-y-1">
            {dayEvents.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setOpenEvent(e)}
                  className="flex w-full items-baseline gap-1.5 rounded-md px-1 py-0.5 text-left text-[12.5px] transition hover:bg-[var(--ds-sunk,rgba(0,0,0,.04))]"
                >
                  <span
                    className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: toneFor(e.member_name ?? e.source ?? "x").fg }}
                  />
                  <span className="text-[var(--ds-ink)]">{e.summary ?? e.kind}</span>
                  <span className="text-[var(--ds-muted)]">
                    {[e.member_name, e.person_name, e.firm].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {openEvent ? <EventDetail event={openEvent} onClose={() => setOpenEvent(null)} /> : null}
    </div>
  );
}

/**
 * ONE MEETING, AND WHERE IT CAME FROM.
 *
 * THE QUESTION THIS ANSWERS is the one somebody asks the first time two
 * entries look alike: whose calendar is this, and which of their accounts.
 * A room fills from several people's calendars and several of each person's
 * connected addresses, so "from a calendar" is not an answer -- "from
 * karthik@bluemodernadvisory.com" is.
 *
 * WHAT IT ADMITS. Rows written before the ledger carried the account do not
 * know which one it was, and that is said as "the account is not recorded"
 * rather than guessed from whichever one the person has now. And when
 * several ledger rows collapsed into this entry, it says how many and why,
 * because a count that silently differs from what the database holds is the
 * thing that made these look like duplicates in the first place.
 */
function EventDetail({ event, onClose }: { event: CircleEvent; onClose: () => void }) {
  const when = new Date(event.occurred_at);
  const people = event.people ?? [];
  const members = event.members ?? [];
  const accounts = event.accounts ?? [];

  return (
    <div className="mt-3 rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] p-4">
      <div className="flex items-start gap-2">
        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ds-accent)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[var(--ds-ink)]">
            {event.summary ?? event.kind}
          </p>
          <p className="mt-0.5 text-[12.5px] text-[var(--ds-muted)]">
            {when.toLocaleString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-[var(--ds-faint)] transition hover:text-[var(--ds-ink)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {members.length > 0 ? (
        <Line icon={<Users className="h-3.5 w-3.5" />} label="From the calendar of">
          {members.join(", ")}
        </Line>
      ) : null}

      <Line icon={<Mail className="h-3.5 w-3.5" />} label="Connected account">
        {accounts.length > 0 ? (
          accounts.join(", ")
        ) : (
          <span className="text-[var(--ds-faint)]">
            not recorded on this one — it synced before Amber started keeping the account
          </span>
        )}
      </Line>

      {people.length > 0 ? (
        <Line icon={<Users className="h-3.5 w-3.5" />} label="In the room">
          {people.join(", ")}
          {event.firm ? ` · ${event.firm}` : ""}
        </Line>
      ) : null}

      {Number(event.rows_behind ?? 1) > 1 ? (
        <p className="mt-2.5 border-t border-[var(--ds-line)] pt-2 text-[11.5px] leading-relaxed text-[var(--ds-faint)]">
          {event.rows_behind} entries in the ledger are this one meeting — one for each person in
          it, and one for each calendar it came off. They are shown as the single meeting they
          were.
        </p>
      ) : null}
    </div>
  );
}

function Line({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <p className="mt-2 flex items-baseline gap-2 text-[12.5px]">
      <span className="mt-[2px] shrink-0 text-[var(--ds-muted)]">{icon}</span>
      <span className="shrink-0 text-[var(--ds-faint)]">{label}</span>
      <span className="min-w-0 flex-1 text-[var(--ds-ink)]">{children}</span>
    </p>
  );
}
