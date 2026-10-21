"use client";

/**
 * ONE NODE PER RELATIONSHIP, AND EVERYTHING THAT HAPPENED ON IT.
 *
 * THE WHOLE SCREEN IS ONE COLUMN. A person or a firm at the top, and
 * underneath, in one time-ordered list: a calendar meeting, a transcript, a
 * CRM stage change, an enrichment, and an agent's research. Same width, same
 * weight, no separate AI panel.
 *
 * That column is not a stylistic choice, it is the argument. An agent's work
 * sitting as a peer to a human touch is what "AI as a channel" means once it
 * is drawn rather than described; research being on the node instead of in
 * somebody's chat history is what makes it shared rather than siloed; an
 * enrichment landing here instead of in an exported list is what agent-native
 * GTM data looks like. Four claims, one list, no tabs.
 *
 * WHAT A VIEWER SEES AND WHAT THEY DO NOT. The company sees that a
 * relationship exists and how warm it is -- that is the edge strip, and it is
 * the question no CRM can answer. What was said stays with the person who
 * said it. So the timeline shows this viewer's own touches plus whatever
 * somebody deliberately published, and says out loud how many it is not
 * showing, because a history that looks complete and is not is how somebody
 * decides a relationship is cold the day after a colleague had lunch with
 * them.
 *
 * THE NAMES ARE USUALLY ADDRESSES, and that is the data rather than a bug: of
 * 515 guest entries on a real calendar, 5 carried a display name. Every
 * heading is editable in place for exactly that reason.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  CalendarDays,
  Check,
  FileText,
  Flame,
  GitMerge,
  Globe,
  Mail,
  MessageSquare,
  Network,
  Pencil,
  Share2,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Empty,
  Panel,
  Section,
  Segmented,
  Spinner,
  TextField,
} from "@/components/ui";
import { listMyCalendars, startCalendarConnect } from "@/lib/workspace";
import {
  ago,
  duplicates,
  getAccount,
  getPerson,
  goingCold,
  listAccounts,
  listPeople,
  mergePeople,
  patchPerson,
  readableName,
  shareInteraction,
  unshareInteraction,
  type AccountRow,
  type ColdRow,
  type DuplicateGroup,
  type Interaction,
  type Knower,
  type PersonDetail,
  type PersonRow,
  syncMemory,
} from "@/lib/memory";

/* ------------------------------------------------------------- the chrome */

/**
 * What a source looks like at a glance.
 *
 * A timeline somebody scans rather than reads needs the channel legible
 * without the label being read, which is what the icon is for. The label
 * stays anyway: an icon alone is a quiz.
 */
const SOURCE: Record<string, { label: string; icon: React.ReactNode }> = {
  calendar: { label: "Meeting", icon: <CalendarDays className="h-3.5 w-3.5" /> },
  mail: { label: "Email", icon: <Mail className="h-3.5 w-3.5" /> },
  transcript: { label: "Transcript", icon: <FileText className="h-3.5 w-3.5" /> },
  crm: { label: "CRM", icon: <Building2 className="h-3.5 w-3.5" /> },
  enrichment: { label: "Enrichment", icon: <Globe className="h-3.5 w-3.5" /> },
  chatgpt: { label: "ChatGPT", icon: <Sparkles className="h-3.5 w-3.5" /> },
  claude: { label: "Claude", icon: <Sparkles className="h-3.5 w-3.5" /> },
  copilot: { label: "Copilot", icon: <Sparkles className="h-3.5 w-3.5" /> },
  manual: { label: "Note", icon: <MessageSquare className="h-3.5 w-3.5" /> },
};

const sourceOf = (s: string) =>
  SOURCE[s] ?? { label: s, icon: <MessageSquare className="h-3.5 w-3.5" /> };

/** Warmth as a bar, because a number between 0 and 1 means nothing to anybody. */
function Warmth({ value }: { value: string | number | null }) {
  const n = Math.max(0, Math.min(1, Number(value ?? 0)));
  return (
    <span className="inline-flex h-1.5 w-12 overflow-hidden rounded-full bg-[var(--ds-hover)]">
      <span
        className="h-full rounded-full bg-[var(--ds-accent)]"
        style={{ width: `${Math.round(n * 100)}%` }}
      />
    </span>
  );
}

/* ----------------------------------------------------------- the timeline */

function TimelineRow({
  item,
  meId,
  onShare,
}: {
  item: Interaction;
  meId: string;
  onShare: (id: string, next: boolean) => void;
}) {
  const src = sourceOf(item.source);
  const mine = item.member_id === meId;
  const shared = item.visibility === "org";

  return (
    <li className="flex gap-3 py-2.5">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--ds-hover)] text-[var(--ds-muted)]">
        {src.icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[13px] font-medium text-[var(--ds-ink)]">
            {item.summary || src.label}
          </span>
          {item.person_name ? (
            <span className="text-[12px] text-[var(--ds-dim)]">
              with {readableName(item.person_name)}
            </span>
          ) : null}
        </span>

        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--ds-dim)]">
          <span>{src.label}</span>
          <span aria-hidden>·</span>
          <span className="tnum">{new Date(item.occurred_at).toLocaleDateString()}</span>
          {item.member_name ? (
            <>
              <span aria-hidden>·</span>
              <span>{item.member_name}</span>
            </>
          ) : null}
          {item.artifact_url ? (
            <>
              <span aria-hidden>·</span>
              <a
                href={item.artifact_url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-[var(--ds-accent)] hover:underline"
              >
                Open
              </a>
            </>
          ) : null}
        </span>
      </span>

      {/*
        SHARING IS PER ITEM AND ONLY YOUR OWN. There is no admin path and no
        column for one to set, so nobody can publish somebody else's work or
        be pressured into having it published for them.
      */}
      {mine ? (
        <Button
          tone="quiet"
          size="sm"
          onClick={() => onShare(item.id, !shared)}
          title={shared ? "Visible to the company. Click to make private again." : "Share with the company"}
        >
          {shared ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
        </Button>
      ) : null}
    </li>
  );
}

/* -------------------------------------------------------------- the node */

function NodeDetail({
  personId,
  meId,
  onChanged,
}: {
  personId: string;
  meId: string;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getPerson>> | null>(null);
  const [busy, setBusy] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const load = useCallback(() => {
    setBusy(true);
    getPerson(personId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setBusy(false));
  }, [personId]);

  useEffect(load, [load]);

  const share = async (id: string, next: boolean) => {
    // Optimistic: the row flips now and reconciles on the reload. A share is
    // a one-bit change and waiting a round trip for it reads as broken.
    setData((d) =>
      d
        ? {
            ...d,
            history: d.history.map((h) =>
              h.id === id ? { ...h, visibility: next ? "org" : "private" } : h,
            ),
          }
        : d,
    );
    try {
      await (next ? shareInteraction(id) : unshareInteraction(id));
    } catch {
      load();
    }
  };

  /**
   * THE NAME IS USUALLY WRONG AND ONLY A PERSON CAN FIX IT.
   *
   * Of 515 guest entries on a real calendar, 5 carried a display name, so
   * nearly every node is titled after an email address. A producer is only
   * ever allowed to upgrade an address to a name it was given; a person can
   * write what is actually true. This is that.
   */
  const rename = async () => {
    const name = draft.trim();
    setEditing(false);
    if (!name || !data || name === data.person.display_name) return;

    // Optimistic, because a rename that waits for a round trip feels like it
    // did not take and gets typed twice.
    setData({ ...data, person: { ...data.person, display_name: name } });
    try {
      await patchPerson(personId, { displayName: name });
    } catch {
      load();
      return;
    }
    onChanged();
  };

  if (busy && !data) {
    return (
      <Panel className="grid h-64 place-items-center">
        <Spinner />
      </Panel>
    );
  }
  if (!data) return <Alert>That person is not in this company's graph.</Alert>;

  const { person, whoKnows, history, hidden } = data;
  const name = readableName(person.display_name);

  return (
    <div className="space-y-3">
      <Panel className="p-4">
        <div className="flex items-start gap-3">
          <Avatar name={name} size={44} />
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="flex items-center gap-2">
                <TextField
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void rename();
                    if (e.key === "Escape") setEditing(false);
                  }}
                />
                <Button tone="quiet" size="sm" onClick={() => setEditing(false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <h2 className="flex items-center gap-2 text-[17px] font-semibold text-[var(--ds-ink)]">
                {name}
                <Button
                  tone="quiet"
                  size="sm"
                  onClick={() => {
                    setDraft(person.display_name);
                    setEditing(true);
                  }}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </h2>
            )}

            <p className="mt-0.5 text-[13px] text-[var(--ds-muted)]">
              {[person.title, person.account_name ?? person.company].filter(Boolean).join(" · ") ||
                "No firm yet"}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {person.identities.slice(0, 6).map((i) => (
                <Badge key={`${i.kind}:${i.value}`}>{i.value}</Badge>
              ))}
              {/*
                SAID OUT LOUD. A node that quietly absorbed three others looks
                identical to one that always had three addresses, and the
                difference is the thing somebody needs to audit.
              */}
              {person.merged_count > 0 ? (
                <Badge tone="accent">
                  <GitMerge className="mr-1 inline h-3 w-3" />
                  {person.merged_count} merged in
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <p className="tnum text-[20px] font-semibold text-[var(--ds-ink)]">
              {person.company_interactions}
            </p>
            <p className="text-[11px] uppercase tracking-wide text-[var(--ds-faint)]">
              touches
            </p>
            <p className="mt-1 text-[12px] text-[var(--ds-dim)]">{ago(person.company_last_at)}</p>
          </div>
        </div>
      </Panel>

      {/*
        THE QUESTION NO CRM CAN ANSWER. Salesforce has the account record; it
        has never had the relationship, because the relationship lives in
        calendars and inboxes nobody enters into it.
      */}
      <Section title="Who here knows them" note="Counts and dates are company-wide. What was said is not.">
        {whoKnows.length === 0 ? (
          <p className="px-4 pb-4 text-[13px] text-[var(--ds-muted)]">Nobody yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--ds-line)]">
            {whoKnows.map((k: Knower) => (
              <li key={k.member_id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar name={k.member_name} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[var(--ds-ink)]">
                    {k.member_name ?? "Someone"}
                  </span>
                  <span className="block text-[12px] text-[var(--ds-dim)]">
                    {k.interactions} touches · last {ago(k.last_at)}
                  </span>
                </span>
                <Warmth value={k.strength} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Everything that happened"
        note="Every source on one timeline, newest first. An agent's work sits beside a human's."
      >
        {history.length === 0 ? (
          <p className="px-4 pb-4 text-[13px] text-[var(--ds-muted)]">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--ds-line)] px-4 pb-2">
            {history.map((h) => (
              <TimelineRow key={h.id} item={h} meId={meId} onShare={share} />
            ))}
          </ul>
        )}
        {hidden > 0 ? (
          <p className="border-t border-[var(--ds-line)] px-4 py-2.5 text-[12px] text-[var(--ds-dim)]">
            {hidden} more {hidden === 1 ? "touch" : "touches"} by colleagues, kept private to them.
            The counts above include {hidden === 1 ? "it" : "them"}.
          </p>
        ) : null}
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------- the duplicates */

function DuplicateBanner({ groups, onMerged }: { groups: DuplicateGroup[]; onMerged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (groups.length === 0) return null;

  return (
    <Panel className="border-[var(--ds-accent-ring)] bg-[var(--ds-accent-soft)] p-4">
      <p className="text-[13px] font-medium text-[var(--ds-ink)]">
        {groups.length === 1
          ? "One set of nodes looks like a single person"
          : `${groups.length} sets of nodes look like single people`}
      </p>
      <p className="mt-0.5 max-w-prose text-[12px] leading-relaxed text-[var(--ds-muted)]">
        A calendar invite carries one address per guest and nothing joining a work address to a
        personal one, so one person arrives as several. These share an address prefix and have
        never been in the same meeting. Nothing merges until you say so.
      </p>

      <ul className="mt-3 space-y-2">
        {groups.map((g) => {
          const keep = g.people.find((p) => p.id === g.suggestedKeepId) ?? g.people[0];
          const others = g.people.filter((p) => p.id !== keep.id);
          return (
            <li
              key={keep.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] px-3 py-2"
            >
              <span className="text-[13px] font-medium text-[var(--ds-ink)]">
                {readableName(keep.display_name)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--ds-dim)]">
                + {others.map((o) => o.emails[0] ?? o.display_name).join(", ")}
              </span>
              <Button
                tone="primary"
                size="sm"
                disabled={busy === keep.id}
                onClick={async () => {
                  setBusy(keep.id);
                  await mergePeople(keep.id, others.map((o) => o.id)).catch(() => null);
                  setBusy(null);
                  onMerged();
                }}
              >
                <GitMerge className="h-3.5 w-3.5" />
                Merge {g.n}
              </Button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* ------------------------------------------------------------- first run */

/**
 * ONE SCREEN, ONE BUTTON, AND THEN THE GRAPH.
 *
 * THE FAILURE THIS REPLACES. Connecting a calendar meant finding it inside a
 * circle, consenting, and being returned to a screen that looked exactly as
 * empty as before. Both halves worked perfectly and the person was shown
 * nothing, which is indistinguishable from broken and is how somebody
 * decides a product does not work on the day it would have impressed them.
 *
 * So the empty state is not a message, it is the setup. Connect, come back,
 * one call pulls three years and builds the graph, and the result is on the
 * screen before anybody has to go looking for it.
 *
 * NOTHING IS ENTERED. That sentence is the product, and it belongs here
 * rather than in marketing copy, because the moment it becomes believable is
 * the moment somebody watches a network they did not build appear.
 */
function FirstRun({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<"checking" | "connect" | "building" | "done">("checking");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof syncMemory>> | null>(null);

  const build = useCallback(async () => {
    setPhase("building");
    setError(null);
    try {
      const out = await syncMemory();
      setResult(out);
      if (!out.ok) {
        setError(out.hint ?? "That source is not available.");
        setPhase("connect");
      } else if (out.people > 0) {
        setPhase("done");
        setTimeout(onDone, 1400);
      } else {
        setError("Nothing came back. The connected calendar may have no past meetings with other people on them.");
        setPhase("connect");
      }
    } catch {
      setError("The sync did not finish. Try again in a moment.");
      setPhase("connect");
    }
  }, [onDone]);

  /*
   * THE SECOND BUTTON IS GONE, and it should never have been there.
   *
   * It said "Already connected", which made somebody returning from Google
   * -- who had just connected, thirty seconds ago -- press a button to tell
   * us something we could see for ourselves. Every button that asks a person
   * to restate a fact the system already holds is one the system should have
   * read instead.
   *
   * So: if a calendar is connected, build. That covers the return from
   * consent and the calendar somebody connected last week, with no button
   * and no branch for the person to understand.
   */
  useEffect(() => {
    let alive = true;
    listMyCalendars()
      .then((res) => {
        if (!alive) return;
        if ((res?.calendars ?? []).length > 0) void build();
        else setPhase("connect");
      })
      .catch(() => alive && setPhase("connect"));
    return () => {
      alive = false;
    };
  }, [build]);

  const connect = async () => {
    setError(null);
    try {
      const { authorize_url } = await startCalendarConnect(
        "google",
        typeof window === "undefined" ? "/org" : window.location.pathname,
      );
      window.location.href = authorize_url;
    } catch {
      setError("Could not start the connection. Check that Google sign-in is configured.");
    }
  };

  return (
    <Panel className="mx-auto max-w-xl p-8 text-center">
      <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]">
        {phase === "building" ? <Spinner /> : <Network className="h-6 w-6" />}
      </span>

      {phase === "building" ? (
        <>
          <h2 className="text-[18px] font-semibold text-[var(--ds-ink)]">Building your network</h2>
          <p className="mx-auto mt-2 max-w-md text-[13px] text-[var(--ds-muted)]">
            Reading three years of meetings and working out who you actually know. About twenty
            seconds.
          </p>
        </>
      ) : phase === "done" && result ? (
        <>
          <h2 className="text-[18px] font-semibold text-[var(--ds-ink)]">
            {result.people} people, {result.accounts} firms
          </h2>
          <p className="mx-auto mt-2 max-w-md text-[13px] text-[var(--ds-muted)]">
            From {result.synced.reduce((n, x) => n + x.events, 0).toLocaleString()} meetings.
            Nobody entered any of it.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-[18px] font-semibold text-[var(--ds-ink)]">
            Connect a calendar and your network is already here
          </h2>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-[var(--ds-muted)]">
            Every external person you have actually met with, ranked by how well you know them,
            with the ones going quiet at the top. Three years of history, in about twenty seconds.
            Nobody enters anything.
          </p>
          {phase === "connect" ? (
            <div className="mt-5">
              <Button tone="primary" onClick={connect}>
                <CalendarDays className="h-4 w-4" />
                Connect Google Calendar
              </Button>
            </div>
          ) : (
            <div className="mt-5 flex justify-center">
              <Spinner />
            </div>
          )}
        </>
      )}

      {error ? <p className="mt-4 text-[12.5px] text-[var(--ds-muted)]">{error}</p> : null}

      <p className="mt-5 border-t border-[var(--ds-line)] pt-4 text-[12px] leading-relaxed text-[var(--ds-dim)]">
        What was said stays yours. Your colleagues see that a relationship exists and how warm it
        is, never the content, until you publish a specific item.
      </p>
    </Panel>
  );
}

/* ----------------------------------------------------------------- the tab */

/**
 * INTERNAL AND EXTERNAL ARE THE SAME SCREEN, and that is the point.
 *
 * A colleague is a relationship with the same shape as a customer: you met
 * them on a date, somebody knows them better than you do, and it can go
 * quiet. Giving internal people a different, thinner screen would be saying
 * the opposite, and would mean the one question that spans both -- who here
 * knows this person -- has two answers in two places.
 *
 * Internal is DERIVED from the company's email domain rather than filed by
 * hand. Somebody who turns up on your calendar before they have accepted
 * their invitation is already a colleague; waiting for them to join before
 * filing them correctly would mean the directory is wrong on exactly the
 * days it matters. When they do join, the node links to their account and
 * the row says so.
 */
export default function RelationshipMemory({
  meId,
  scope,
}: {
  meId: string;
  scope?: "internal" | "external";
}) {
  const [mode, setMode] = useState<"people" | "firms">("people");
  const [search, setSearch] = useState("");
  const [people, setPeople] = useState<PersonRow[] | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [cold, setCold] = useState<ColdRow[]>([]);
  const [dupes, setDupes] = useState<DuplicateGroup[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [accountPeople, setAccountPeople] = useState<PersonRow[] | null>(null);

  const reload = useCallback(() => {
    listPeople({ scope }).then(setPeople).catch(() => setPeople([]));
    listAccounts().then(setAccounts).catch(() => setAccounts([]));
    goingCold({ mine: true }).then(setCold).catch(() => setCold([]));
    duplicates().then(setDupes).catch(() => setDupes([]));
  }, [scope]);

  useEffect(reload, [reload]);

  const internal = scope === "internal";

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const match = (s: string | null) => !needle || (s ?? "").toLowerCase().includes(needle);
    if (mode === "firms") {
      return (accounts ?? []).filter((a) => match(a.name) || match(a.domain));
    }
    return (people ?? []).filter(
      (p) => match(p.display_name) || match(p.account_name) || match(p.company),
    );
  }, [mode, search, people, accounts]);

  const loading = people === null || accounts === null;
  const empty = !loading && (people ?? []).length === 0;

  if (empty) {
    // Internal gets the plain message: the fix is the same connection, and
    // offering it twice on two screens is how somebody connects twice.
    return internal ? (
      <Panel>
        <Empty
          icon={<Users className="h-5 w-5" />}
          title="No colleagues found yet"
          note="Anyone on this company's email domain who turns up in your calendar appears here, whether or not they have accepted an invitation. Connect a calendar under External and they will."
        />
      </Panel>
    ) : (
      <FirstRun onDone={reload} />
    );
  }

  return (
    <div className="space-y-3">
      <DuplicateBanner groups={dupes} onMerged={reload} />

      {/*
        THE NUDGE, ABOVE EVERYTHING. A graph is a database until it tells you
        something you did not ask it. Warm once, quiet since, is the one thing
        a relationship ledger knows that nobody's memory does.
      */}
      {cold.length > 0 ? (
        <Panel className="p-4">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--ds-ink)]">
            <Flame className="h-3.5 w-3.5 text-[var(--ds-accent)]" />
            Going quiet
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {cold.slice(0, 8).map((c) => (
              <li key={`${c.id}:${c.member_id}`}>
                <button
                  onClick={() => {
                    setMode("people");
                    setSelected(c.id);
                  }}
                  className="rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] px-2.5 py-1.5 text-left hover:bg-[var(--ds-hover)]"
                >
                  <span className="block text-[12.5px] font-medium text-[var(--ds-ink)]">
                    {readableName(c.display_name)}
                  </span>
                  <span className="block text-[11.5px] text-[var(--ds-dim)]">
                    {c.days_since}d quiet · {c.interactions} touches
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(260px,340px)_1fr]">
        <div className="space-y-2">
          {/*
            No firm switch inside the company. Everybody here works at the
            same one, and a control with a single possible answer is a
            control that makes somebody wonder what they are missing.
          */}
          {internal ? null : (
            <div className="flex items-center gap-2">
              <Segmented
                value={mode}
                onChange={(v) => {
                  setMode(v);
                  setSelected(null);
                }}
                options={[
                  { value: "people" as const, label: "People", count: people?.length },
                  { value: "firms" as const, label: "Firms", count: accounts?.length },
                ]}
              />
            </div>
          )}

          <TextField
            placeholder={mode === "firms" ? "Search firms" : "Search people"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <Panel className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="grid h-32 place-items-center">
                <Spinner />
              </div>
            ) : (
              <ul className="divide-y divide-[var(--ds-line)]">
                {rows.map((r) => {
                  const isFirm = mode === "firms";
                  const label = isFirm
                    ? (r as AccountRow).name
                    : readableName((r as PersonRow).display_name);
                  const sub = isFirm
                    ? `${(r as AccountRow).people} people · ${(r as AccountRow).knowers} of us`
                    : (r as PersonRow).account_name ?? (r as PersonRow).company ?? "";
                  const on = selected === r.id;
                  return (
                    <li key={r.id}>
                      <button
                        onClick={() => {
                          setSelected(r.id);
                          if (isFirm) {
                            getAccount(r.id)
                              .then((a) => setAccountPeople(a.people))
                              .catch(() => setAccountPeople([]));
                          }
                        }}
                        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${
                          on ? "bg-[var(--ds-accent-soft)]" : "hover:bg-[var(--ds-hover)]"
                        }`}
                      >
                        {isFirm ? (
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--ds-hover)] text-[var(--ds-muted)]">
                            <Building2 className="h-3.5 w-3.5" />
                          </span>
                        ) : (
                          <Avatar name={label} size={28} />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-[var(--ds-ink)]">
                            {label}
                          </span>
                          {sub ? (
                            <span className="block truncate text-[11.5px] text-[var(--ds-dim)]">
                              {sub}
                            </span>
                          ) : null}
                          {/*
                            KNOWN BUT NOT JOINED is a real state and a useful
                            one: it is the list of people to invite, and it
                            appears without anybody compiling it.
                          */}
                          {internal && !isFirm && !(r as PersonRow).member_amber_id ? (
                            <span className="mt-0.5 inline-block rounded px-1 py-px text-[10.5px] font-medium text-[var(--ds-faint)] ring-1 ring-[var(--ds-line)]">
                              not joined yet
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-right">
                          <Warmth value={r.strength} />
                          <span className="mt-0.5 block text-[11px] text-[var(--ds-faint)]">
                            {ago(r.last_at)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <div>
          {selected === null ? (
            <Panel>
              <Empty
                icon={<Users className="h-5 w-5" />}
                title="Pick someone"
                note="Everything the company knows about them, on one timeline."
              />
            </Panel>
          ) : mode === "firms" ? (
            <FirmDetail accountId={selected} meId={meId} people={accountPeople} onPick={(id) => {
              setMode("people");
              setSelected(id);
            }} />
          ) : (
            <NodeDetail personId={selected} meId={meId} onChanged={reload} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- the firm */

/**
 * A firm is a relationship too, and usually the one that matters.
 *
 * A payroll company's warm pipeline runs through accounting firms: a managing
 * partner, two partners, an office manager. Four people, one relationship,
 * and the people churn while the relationship persists. So the firm view
 * sums across everybody at it, which is the question a CRM cannot answer
 * because it holds the account record and not the relationship.
 */
function FirmDetail({
  accountId,
  meId,
  people,
  onPick,
}: {
  accountId: string;
  meId: string;
  people: PersonRow[] | null;
  onPick: (personId: string) => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getAccount>> | null>(null);

  useEffect(() => {
    getAccount(accountId)
      .then(setData)
      .catch(() => setData(null));
  }, [accountId]);

  if (!data) {
    return (
      <Panel className="grid h-64 place-items-center">
        <Spinner />
      </Panel>
    );
  }

  const { account, whoKnows, history, hidden } = data;

  return (
    <div className="space-y-3">
      <Panel className="p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--ds-hover)] text-[var(--ds-muted)]">
            <Building2 className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold text-[var(--ds-ink)]">{account.name}</h2>
            <p className="mt-0.5 text-[13px] text-[var(--ds-muted)]">
              {account.domain ?? "No domain"} · {account.people} people · {account.knowers} of us
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="tnum text-[20px] font-semibold text-[var(--ds-ink)]">
              {account.interactions}
            </p>
            <p className="text-[11px] uppercase tracking-wide text-[var(--ds-faint)]">touches</p>
            <p className="mt-1 text-[12px] text-[var(--ds-dim)]">{ago(account.last_at)}</p>
          </div>
        </div>
      </Panel>

      <Section title="Who we know there">
        <ul className="divide-y divide-[var(--ds-line)]">
          {(people ?? data.people).map((p) => (
            <li key={p.id}>
              <button
                onClick={() => onPick(p.id)}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-[var(--ds-hover)]"
              >
                <Avatar name={readableName(p.display_name)} size={26} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--ds-ink)]">
                  {readableName(p.display_name)}
                </span>
                <span className="text-[12px] text-[var(--ds-dim)]">{ago(p.last_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Who here has the relationship">
        <ul className="divide-y divide-[var(--ds-line)]">
          {whoKnows.map((k) => (
            <li key={k.member_id} className="flex items-center gap-3 px-4 py-2.5">
              <Avatar name={k.member_name} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-[var(--ds-ink)]">
                  {k.member_name ?? "Someone"}
                </span>
                <span className="block text-[12px] text-[var(--ds-dim)]">
                  {k.people} {k.people === 1 ? "person" : "people"} · {k.interactions} touches ·
                  last {ago(k.last_at)}
                </span>
              </span>
              <Warmth value={k.strength} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Everything that happened" note="Across everybody at the firm.">
        <ul className="divide-y divide-[var(--ds-line)] px-4 pb-2">
          {history.map((h) => (
            <TimelineRow key={h.id} item={h} meId={meId} onShare={() => {}} />
          ))}
        </ul>
        {hidden > 0 ? (
          <p className="border-t border-[var(--ds-line)] px-4 py-2.5 text-[12px] text-[var(--ds-dim)]">
            {hidden} more kept private to the colleagues who had them.
          </p>
        ) : null}
      </Section>
    </div>
  );
}
