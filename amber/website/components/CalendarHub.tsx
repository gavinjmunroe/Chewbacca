"use client";

/**
 * THE CALENDARS, AND WHAT IS ON THEM.
 *
 * WHY THIS SCREEN DID NOT EXIST AND SHOULD HAVE. A calendar was connected
 * once, during onboarding, and then appeared nowhere. The entire network was
 * built out of it and nothing in the product would admit that had happened,
 * so people reasonably concluded the sync had failed -- there was no way to
 * tell "connected and working" from "never connected", and the onboarding
 * kept offering to connect it again. (It offered because the client read a
 * key the server does not send, which is fixed in lib/workspace.)
 *
 * SEVERAL CALENDARS IS THE NORMAL CASE, not an advanced feature. A work
 * Google, a personal Google, an Outlook from the company somebody still
 * advises. Every row has had its own token and its own sync cursor since the
 * table was written; the only thing missing was somewhere to see them and a
 * second Connect button.
 *
 * SYNC IS A BUTTON SOMEBODY PRESSES, never something a render does: a token
 * refresh and a calendar read per account, against somebody else's rate
 * limit. What it reports is what landed -- the events AND how many reached
 * the graph -- because "done" after a sync that wrote nothing is the message
 * that made people stop believing this worked.
 */

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Check, Loader2, Plus, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { Button, Empty, Panel, Section } from "@/components/ui";
import {
  disconnectOrgCalendar,
  getOrgCalendar,
  startCalendarConnect,
  syncOrgCalendar,
  type CalendarEvent,
  type MyCalendar,
} from "@/lib/workspace";
import { ago } from "@/lib/memory";

const PROVIDER: Record<string, string> = {
  google: "Google",
  microsoft: "Outlook",
};

function when(e: CalendarEvent) {
  const d = new Date(e.starts_at);
  if (e.all_day) return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function CalendarHub() {
  const [data, setData] = useState<{
    accounts: MyCalendar[] | null;
    upcoming: CalendarEvent[];
    past: CalendarEvent[];
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(() => {
    getOrgCalendar(30)
      .then(setData)
      .catch(() => setData({ accounts: null, upcoming: [], past: [] }));
  }, []);

  useEffect(load, [load]);

  const connect = async (provider: "google" | "microsoft") => {
    setBusy(provider);
    setFailed(null);
    try {
      const r = await startCalendarConnect(provider, window.location.href);
      window.location.href = r.authorize_url;
    } catch (e) {
      setFailed(
        (e as { message?: string })?.message ??
          `Could not start the ${PROVIDER[provider]} connection.`,
      );
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    setFailed(null);
    setNote(null);
    try {
      const r = await syncOrgCalendar();
      setNote(
        r.calendars === 0
          ? "No calendar connected yet."
          : `${r.events} event${r.events === 1 ? "" : "s"} from ${r.calendars} calendar${
              r.calendars === 1 ? "" : "s"
            }${r.intoTheGraph ? `, ${r.intoTheGraph} into your network` : ""}.`,
      );
      load();
    } catch (e) {
      setFailed((e as { message?: string })?.message ?? "Could not sync.");
    } finally {
      setBusy(null);
    }
  };

  const drop = async (id: string) => {
    setBusy(id);
    try {
      await disconnectOrgCalendar(id);
      load();
    } catch (e) {
      setFailed((e as { message?: string })?.message ?? "Could not disconnect that.");
    } finally {
      setBusy(null);
    }
  };

  const accounts = data?.accounts ?? [];

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-[var(--ds-accent)]" />
          Calendars
        </span>
      }
      note="Every calendar you have connected, and what is on them. Connect as many as you like — a work Google, a personal one, an Outlook. Each keeps its own connection, and disconnecting one takes only its events."
      action={
        <span className="flex gap-2">
          <Button tone="ghost" busy={busy === "sync"} onClick={sync}>
            <RefreshCw className="h-3.5 w-3.5" />
            Sync now
          </Button>
          <Button tone="ghost" busy={busy === "google"} onClick={() => connect("google")}>
            <Plus className="h-3.5 w-3.5" />
            Google
          </Button>
          <Button tone="ghost" busy={busy === "microsoft"} onClick={() => connect("microsoft")}>
            <Plus className="h-3.5 w-3.5" />
            Outlook
          </Button>
        </span>
      }
      bodyClassName="p-0"
    >
      <div className="space-y-4 px-4 py-4">
        {failed ? (
          <p className="rounded-lg border border-[var(--ds-line)] px-3 py-2 text-[12.5px] text-[var(--ds-ink)]">
            {failed}
          </p>
        ) : null}
        {note ? (
          <p className="flex items-center gap-1.5 text-[12.5px] text-[var(--ds-muted)]">
            <Check className="h-3.5 w-3.5 text-[var(--ds-accent)]" />
            {note}
          </p>
        ) : null}

        {/* -------------------------------------------------- the accounts */}
        {data === null ? (
          <p className="flex items-center gap-2 text-[12.5px] text-[var(--ds-muted)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Reading your calendars…
          </p>
        ) : data.accounts === null ? (
          <p className="text-[12.5px] text-[var(--ds-muted)]">
            Could not read your calendars just now. Nothing is disconnected — try again in a
            moment.
          </p>
        ) : accounts.length === 0 ? (
          <Empty
            icon={<CalendarDays className="h-5 w-5" />}
            title="No calendar connected"
            note="Connect one and everybody you meet becomes part of your network. Nobody types anything in."
          />
        ) : (
          <div className="divide-y divide-[var(--ds-line)] rounded-xl border border-[var(--ds-line)]">
            {accounts.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--ds-ink)]">
                      {a.account_email}
                    </span>
                    <span className="rounded-full border border-[var(--ds-line)] px-1.5 text-[10.5px] text-[var(--ds-faint)]">
                      {PROVIDER[a.provider] ?? a.provider}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-[var(--ds-faint)]">
                    {a.last_error ? (
                      <span className="inline-flex items-center gap-1 text-[var(--ds-ink)]">
                        <TriangleAlert className="h-3 w-3" />
                        {a.last_error}
                      </span>
                    ) : a.synced_at ? (
                      `Last pulled ${ago(a.synced_at)}`
                    ) : (
                      "Connected, not pulled yet — press Sync now"
                    )}
                  </span>
                </span>
                <Button tone="ghost" busy={busy === a.id} onClick={() => drop(a.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Disconnect
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* ---------------------------------------------------- the events */}
        {/*
          BOTH DIRECTIONS FROM TODAY, because the two things anybody asks a
          calendar are "what is coming" and "who did I just see", and a list
          that answers one of them sends them back to Google for the other.
        */}
        {data && (data.upcoming.length > 0 || data.past.length > 0) ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <EventList title="Coming up" rows={data.upcoming.slice(0, 20)} />
            <EventList title="Recently" rows={data.past.slice(0, 20)} />
          </div>
        ) : accounts.length > 0 ? (
          <p className="text-[12.5px] text-[var(--ds-muted)]">
            Nothing on them in the last or next thirty days.
          </p>
        ) : null}
      </div>
    </Section>
  );
}

function EventList({ title, rows }: { title: string; rows: CalendarEvent[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-[11.5px] uppercase tracking-wide text-[var(--ds-faint)]">{title}</p>
      <Panel className="divide-y divide-[var(--ds-line)] p-0">
        {rows.map((e) => {
          const guests = (e.attendees ?? []).filter(Boolean);
          return (
            <div key={e.event_id} className="px-3.5 py-2">
              <p className="truncate text-[13px] text-[var(--ds-ink)]">{e.title || "Untitled"}</p>
              <p className="truncate text-[11.5px] text-[var(--ds-faint)]">
                {when(e)}
                {e.place ? ` · ${e.place}` : ""}
                {guests.length > 0
                  ? ` · ${guests.length} ${guests.length === 1 ? "guest" : "guests"}`
                  : ""}
              </p>
            </div>
          );
        })}
      </Panel>
    </div>
  );
}
