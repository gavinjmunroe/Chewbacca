"use client";

/**
 * THE ONLY SIGNED-IN PAGE: find somebody, then look at them.
 *
 * IT LEADS WITH A QUESTION, NOT A PICTURE. Four versions of this page led with
 * a force graph, and each one failed the same way for the same structural
 * reason: a graph has to draw every contact somewhere, and where it draws them
 * is a claim about all of them at once. A card carrying nothing but the word
 * "Alex" -- no source, no company, one observation five weeks old -- sat in the
 * owner's closest circle and looked exactly like a real friend until it was
 * clicked. No amount of layout work fixes that, because the format cannot say
 * "I have nothing on this one".
 *
 * A RANKED ROW CAN. Every row states why it is there, so a thin card reads as
 * thin and is dismissed in a glance. The graph is still here, behind a toggle,
 * because seeing the shape of a network is worth something -- just not as the
 * first and only way in.
 *
 * There is deliberately nothing else on this page. The token it holds can read
 * the network graph and contact cards and is refused everywhere else by the
 * server, so any feature added here would 403 before it rendered. That is the
 * intended shape, not a limitation to work around.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import NetworkGraph from "@/components/NetworkGraph";
import NetworkKey from "@/components/NetworkKey";
import PersonRows from "@/components/PersonRows";
import ContactCard from "@/components/ContactCard";
import {
  AmberError,
  asContactList,
  clearSession,
  displayName,
  getContacts,
  getEdges,
  readSession,
  searchContacts,
  type Contact,
  type GraphNode,
  type NetworkGroup,
} from "@/lib/amber";
import { groupColors, resolveGroups } from "@/lib/constellation";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import { AppShell } from "@/components/AppShell";
import { Rows3, Search as SearchIcon, Share2, UserPlus } from "lucide-react";
import { rankPeople, type PersonRow } from "@/lib/people-rows";

/** How many group chips the panel shows before you ask for the rest. */
const GROUPS_SHOWN = 8;

export default function NetworkPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [groups, setGroups] = useState<NetworkGroup[]>([]);
  const [stats, setStats] = useState<{ people: number; places?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showGraph, setShowGraph] = useState(false);
  // The panel shows the eight biggest groups by default. Twenty-five rows of
  // chips is a list to scroll past, not a filter -- but the rest have to be
  // reachable, or the count in the header is a number about something you
  // cannot see.
  const [allGroups, setAllGroups] = useState(false);
  // Which node the graph should pan onto. Separate from selectedId because
  // clicking a dot selects without moving the view out from under the click.
  const [focusTarget, setFocusTarget] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  // null means "not searching" and is different from an empty result set.
  const [hits, setHits] = useState<Set<string> | null>(null);
  const [why, setWhy] = useState<Map<string, string>>(new Map());
  // Every keystroke is a request otherwise, and the last answer to arrive is
  // not necessarily the answer to what is currently typed.
  const searchSeq = useRef(0);

  const signOut = useCallback(() => {
    clearSession();
    router.push("/login");
  }, [router]);

  useEffect(() => {
    const s = readSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setToken(s.token);
    (async () => {
      try {
        const [list, e] = await Promise.all([getContacts(s.token), getEdges(s.token)]);
        setContacts(asContactList(list));
        setGraphNodes(e.nodes ?? []);
        setGroups(e.groups ?? []);
        setStats(e.stats ?? null);
      } catch (err) {
        // An expired or revoked token is not an error to display, it is a
        // reason to send somebody back to the door.
        if (err instanceof AmberError && (err.status === 401 || err.status === 403)) {
          clearSession();
          router.replace("/login");
          return;
        }
        /*
         * AN EMPTY BOOK IS NOT AN ERROR.
         *
         * A work account has no contacts until somebody brings some in, and the
         * API answers 404 for a book that is not there. Rendering that as
         * "Amber refused that (404)" tells somebody their account is broken
         * when the truth is that it is new.
         */
        if (err instanceof AmberError && err.status === 404) {
          setContacts([]);
          setGraphNodes([]);
          setGroups([]);
          setStats(null);
        } else {
          setError(err instanceof AmberError ? err.message : "Could not load your network.");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  useEffect(() => {
    const q = query.trim();
    if (!token || q.length < 2) {
      setHits(null);
      setWhy(new Map());
      return;
    }
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      try {
        const r = await searchContacts(token, q);
        if (seq !== searchSeq.current) return; // a newer query already won
        const list = asContactList(r) as (Contact & { why?: string })[];
        setHits(new Set(list.map((c) => String(c.id))));
        // The server's own explanation of the match, which beats anything the
        // client could infer about why a row is in the list.
        setWhy(new Map(list.filter((c) => c.why).map((c) => [String(c.id), String(c.why)])));
      } catch {
        if (seq === searchSeq.current) {
          setHits(new Set());
          setWhy(new Map());
        }
      }
    }, 180);
    return () => clearTimeout(t);
  }, [token, query]);

  const resolvedGroups = useMemo(() => resolveGroups(graphNodes, groups), [graphNodes, groups]);
  const colors = useMemo(() => groupColors(resolvedGroups), [resolvedGroups]);

  useEffect(() => {
    if (activeGroup && !resolvedGroups.some((g) => g.key === activeGroup)) setActiveGroup(null);
  }, [resolvedGroups, activeGroup]);

  /**
   * What the list is showing, in order.
   *
   * A chip in the key narrows the list the same way it lights the graph, so the
   * two views never disagree about who is in a group. A typed query wins over a
   * chip, because typing is the more specific intent.
   */
  const rows = useMemo(() => {
    const matched =
      hits !== null
        ? hits
        : activeGroup
          ? new Set(resolvedGroups.find((g) => g.key === activeGroup)?.memberIds ?? [])
          : null;
    const withWhy = graphNodes.map((n) =>
      why.has(n.id) ? { ...n, why: why.get(n.id) } : n,
    );
    return rankPeople(withWhy, resolvedGroups, { matchedIds: matched });
  }, [graphNodes, resolvedGroups, hits, why, activeGroup]);

  /**
   * The one person a query resolved to, or null.
   *
   * Only when it is unambiguous. Opening a card the moment a search returns
   * three people would be picking one of them on the user's behalf, and
   * whichever it picked would be wrong two times in three.
   */
  const soleMatch = useMemo(() => {
    if (!hits || hits.size !== 1) return null;
    return [...hits][0];
  }, [hits]);

  useEffect(() => {
    if (soleMatch) {
      setSelectedId(soleMatch);
      setFocusTarget(soleMatch);
    }
  }, [soleMatch]);

  /**
   * WHAT YOU GET WHILE YOU ARE STILL TYPING.
   *
   * Built from the rows the search already produced rather than from a second
   * request, so a suggestion can never name somebody the list below would not
   * show. Capped, because a dropdown covering the page is not a suggestion.
   */
  const suggestions = useMemo(() => {
    if (query.trim().length < 2 || hits === null) return [];
    return rows.slice(0, 6);
  }, [query, hits, rows]);

  const selected = useMemo(
    () => contacts.find((c) => String(c.id) === selectedId) ?? null,
    [contacts, selectedId],
  );

  const heading = query.trim().length >= 2
    ? `${rows.length} ${rows.length === 1 ? "match" : "matches"}`
    : activeGroup
      ? resolvedGroups.find((g) => g.key === activeGroup)?.label ?? "Group"
      : "Closest to you";

  const groupCount = resolvedGroups.length;

  /**
   * Biggest first, and either the top eight or every one of them.
   *
   * An active filter is always in the list even when it is the twentieth
   * largest -- collapsing the panel out from under the chip you just pressed
   * reads as the filter having been cleared.
   */
  const visibleGroups = useMemo(() => {
    const sorted = [...resolvedGroups].sort((a, b) => b.memberCount - a.memberCount);
    if (allGroups) return sorted;
    const head = sorted.slice(0, GROUPS_SHOWN);
    if (activeGroup && !head.some((g) => g.key === activeGroup)) {
      const pinned = sorted.find((g) => g.key === activeGroup);
      if (pinned) return [...head, pinned];
    }
    return head;
  }, [resolvedGroups, allGroups, activeGroup]);

  return (
    <AppShell
      product="Amber"
      subtitle="Your network"
      fill
      nav={[
        { key: "graph", label: "Graph", icon: <Share2 className="h-4 w-4" /> },
        { key: "list", label: "List", icon: <Rows3 className="h-4 w-4" /> },
        { key: "add", label: "Add people", icon: <UserPlus className="h-4 w-4" />, foot: true },
      ]}
      active={showGraph ? "graph" : "list"}
      onNavigate={(k) => {
        if (k === "add") router.push("/people");
        else setShowGraph(k === "graph");
      }}
      workspace={<WorkspaceSwitcher />}
      account={{ name: "Your account", detail: "Personal" }}
    >
      <div className="flex h-full min-w-0 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-6 border-b border-[var(--ds-line)] px-6 py-3.5">
          <div className="min-w-0">
            <h1 className="truncate text-[19px] font-semibold text-[var(--ds-ink)]">
              Your social web
            </h1>
            <p className="text-[12px] text-[var(--ds-dim)]">
              Closer to the middle means more recent contact.
            </p>
          </div>

          {/*
            THE THREE NUMBERS THAT SAY WHAT IS IN HERE. People and places are
            different kinds of thing -- a dentist's office is not a friend --
            and a single "contacts" count hides that. Groups is the third
            because it is the one the right-hand panel is about.
          */}
          <div className="ml-auto flex items-center gap-6">
            <Stat value={stats?.people ?? contacts.length} label="People" />
            {stats?.places ? <Stat value={stats.places} label="Places" /> : null}
            <Stat value={groupCount} label="Groups" accent />
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <section className="relative min-w-0 flex-1 overflow-hidden">
            {error ? (
              <div className="flex h-full items-center justify-center px-6 text-center">
                <p style={{ color: "var(--ds-muted)" }}>{error}</p>
              </div>
            ) : !loading && contacts.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <p className="mb-3 text-lg" style={{ color: "var(--ds-ink)" }}>Nothing here yet.</p>
                <p className="mb-6 max-w-sm text-sm" style={{ color: "var(--ds-muted)" }}>
                  This workspace has no contacts in it. Bring an address book in, or connect the
                  iOS app on a personal account.
                </p>
                <button
                  onClick={() => router.push("/people")}
                  className="rounded-xl px-4 py-2 text-sm"
                  style={{ background: "var(--ds-accent-ink)", color: "#ffffff" }}
                >
                  Add people
                </button>
              </div>
            ) : showGraph ? (
              <NetworkGraph
                nodes={graphNodes}
                groups={resolvedGroups}
                activeGroup={activeGroup}
                focusId={focusTarget}
                selectedId={selectedId}
                highlighted={hits ?? new Set()}
                onSelect={setSelectedId}
              />
            ) : (
              <div className="h-full overflow-y-auto px-6 pb-28 pt-6">
                <div className="mx-auto max-w-2xl">
                  <p className="mb-2 text-xs uppercase tracking-wider" style={{ color: "var(--ds-muted)" }}>
                    {heading}
                  </p>
                  {loading ? (
                    <p className="py-8 text-sm" style={{ color: "var(--ds-muted)" }}>Loading…</p>
                  ) : (
                    <PersonRows
                      rows={rows}
                      colors={colors}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                      emptyMessage={
                        query.trim().length >= 2
                          ? `Nothing in your contacts matches "${query.trim()}".`
                          : "No contacts yet."
                      }
                    />
                  )}
                </div>
              </div>
            )}

            {/*
              THE SEARCH BAR LIVES AT THE BOTTOM, over whichever view is open.

              It is the one control that is used while looking at something
              rather than before looking at anything, and a field at the top of
              a page is a field you fill in on arrival. Down here it sits under
              the thumb, the graph stays whole behind it, and the suggestions
              open upward so a name never covers the dot it would select.
            */}
            {!error && !(!loading && contacts.length === 0) ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-6 pb-6">
                <div className="pointer-events-auto relative w-full max-w-xl">
                  {suggestions.length ? (
                    <div
                      className="absolute bottom-full left-0 right-0 z-40 mb-2 overflow-hidden rounded-2xl border shadow-2xl"
                      style={{ background: "var(--ds-card)", borderColor: "var(--ds-line)" }}
                    >
                      <Suggestions
                        rows={suggestions}
                        onPick={(id) => {
                          setSelectedId(id);
                          setFocusTarget(id);
                        }}
                      />
                    </div>
                  ) : null}
                  <div className="relative">
                    <svg
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
                      width="17" height="17" viewBox="0 0 24 24" fill="none"
                      stroke="var(--ds-dim)" strokeWidth="1.8" strokeLinecap="round"
                    >
                      <circle cx="11" cy="11" r="6.5" />
                      <path d="m16 16 4.5 4.5" />
                    </svg>
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search your people"
                      className="w-full rounded-2xl border py-3.5 pl-11 pr-11 text-sm outline-none shadow-2xl"
                      style={{
                        background: "rgba(255,255,255,0.96)",
                        backdropFilter: "blur(12px)",
                        boxShadow: "var(--ds-shadow-lg)",
                        borderColor: "var(--ds-line-strong)",
                        color: "var(--ds-ink)",
                      }}
                    />
                    {query ? (
                      <button
                        onClick={() => setQuery("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs"
                        style={{ color: "var(--ds-muted)" }}
                        aria-label="Clear search"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          {/*
            THE GROUPS PANEL, and it is a filter rather than a legend. Clicking
            one narrows both views at once, which is the property that makes the
            two views the same dataset rather than two screens.
          */}
          <aside
            className="hidden w-[340px] shrink-0 overflow-y-auto border-l px-5 pb-10 pt-6 xl:block"
            style={{ borderColor: "var(--ds-line)", background: "var(--ds-bg-deep)" }}
          >
            <div className="text-[11px] uppercase tracking-wider" style={{ color: "var(--ds-muted)" }}>
              Your network
            </div>
            <h2 className="mt-1 text-xl" style={{ color: "var(--ds-ink)" }}>
              People, places &amp; groups
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--ds-muted)" }}>
              Explore the circles that connect you.
            </p>

            <div className="mt-6 flex items-baseline justify-between">
              <h3 className="text-lg" style={{ color: "var(--ds-ink)" }}>Groups</h3>
              <span className="text-sm" style={{ color: "var(--ds-muted)" }}>{groupCount} total</span>
            </div>

            <div className="mt-3 space-y-1">
              {loading ? (
                <p className="text-sm" style={{ color: "var(--ds-muted)" }}>Loading…</p>
              ) : groupCount === 0 ? (
                <p className="text-sm" style={{ color: "var(--ds-muted)" }}>
                  No groups yet. They appear as shared companies and schools show up in your book.
                </p>
              ) : (
                visibleGroups.map((g) => {
                  const on = activeGroup === g.key;
                  return (
                    <button
                      key={g.key}
                      onClick={() => setActiveGroup(on ? null : g.key)}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors"
                      style={{ background: on ? "var(--ds-accent-soft)" : "transparent" }}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: colors.get(g.key) ?? "var(--ds-accent-ink)" }}
                        />
                        <span className="truncate text-sm" style={{ color: on ? "var(--ds-accent-ink)" : "var(--ds-ink)" }}>
                          {g.label}
                        </span>
                      </span>
                      <span className="text-sm" style={{ color: "var(--ds-muted)" }}>{g.memberCount}</span>
                    </button>
                  );
                })
              )}
            </div>

            {groupCount > GROUPS_SHOWN ? (
              <button
                onClick={() => setAllGroups((v) => !v)}
                className="mt-2 w-full rounded-xl px-3 py-2 text-left text-sm"
                style={{ color: "var(--ds-accent-ink)" }}
              >
                {allGroups
                  ? "Show fewer"
                  : `See all ${groupCount} groups`}
              </button>
            ) : null}

            {activeGroup ? (
              <button
                onClick={() => setActiveGroup(null)}
                className="mt-3 w-full rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: "var(--ds-line)", color: "var(--ds-muted)" }}
              >
                Clear filter
              </button>
            ) : null}

            <div className="mt-8">
              <h3 className="text-lg" style={{ color: "var(--ds-ink)" }}>How to read your web</h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--ds-muted)" }}>
                Closer to you means more recent contact. Colored rims show which group somebody
                belongs to, and a name you search for lights up in both views.
              </p>
              <div className="mt-3 flex items-center gap-5 text-sm" style={{ color: "var(--ds-muted)" }}>
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--ds-accent-ink)" }} />
                  People
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5" style={{ background: "var(--ds-accent-ink)" }} />
                  Places &amp; businesses
                </span>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {selected ? (
        <ContactCard token={token} contact={selected} onClose={() => setSelectedId(null)} />
      ) : null}
    </AppShell>
  );
}

/** One number and its noun. The header's whole vocabulary. */
function Stat({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className="text-center">
      <div className="text-2xl leading-none" style={{ color: accent ? "var(--ds-accent-ink)" : "var(--ds-ink)" }}>
        {value}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wider" style={{ color: "var(--ds-muted)" }}>
        {label}
      </div>
    </div>
  );
}

/**
 * A rail button. Icon over label, because at this width a label alone is
 * unreadable and an icon alone is a guess.
 */
function RailButton({
  label,
  on,
  onClick,
  icon,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  icon: "graph" | "list" | "plus";
}) {
  const paths = {
    graph: (
      <>
        <circle cx="12" cy="5" r="2.5" />
        <circle cx="5" cy="18" r="2.5" />
        <circle cx="19" cy="18" r="2.5" />
        <path d="M12 7.5v3M10.5 12.5 7 15.5M13.5 12.5 17 15.5" />
      </>
    ),
    list: (
      <>
        <path d="M4 7h16M4 12h16M4 17h10" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
  }[icon];

  return (
    <button
      onClick={onClick}
      className="flex w-14 flex-col items-center gap-1 rounded-xl py-2 transition-colors"
      style={{
        background: on ? "var(--ds-accent-soft)" : "transparent",
        color: on ? "var(--ds-accent-ink)" : "var(--ds-muted)",
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        {paths}
      </svg>
      <span className="text-[10px]">{label}</span>
    </button>
  );
}

/**
 * The key, as a column beside the list rather than a floating panel.
 *
 * Same chips, same colors, same meaning as the graph's key -- it just has room
 * to sit in the layout here instead of being positioned over a canvas.
 */
function NetworkKeyInline({
  groups,
  active,
  onToggle,
  colors,
  loading,
}: {
  groups: NetworkGroup[];
  active: string | null;
  onToggle: (key: string | null) => void;
  colors: Map<string, string>;
  loading: boolean;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm" style={{ color: "var(--ds-ink)" }}>
          Key
        </span>
        {active ? (
          <button onClick={() => onToggle(null)} className="text-xs underline" style={{ color: "var(--ds-muted)" }}>
            clear
          </button>
        ) : null}
      </div>
      <p className="mb-3 text-xs" style={{ color: "var(--ds-muted)", lineHeight: 1.5 }}>
        squares are businesses and places, not people
      </p>
      {loading ? (
        <p className="text-xs" style={{ color: "var(--ds-muted)" }}>
          Loading…
        </p>
      ) : groups.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--ds-muted)", lineHeight: 1.5 }}>
          No shared companies or schools found in your contacts yet.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {groups.map((g) => {
            const on = active === g.key;
            const color = colors.get(g.key) ?? "var(--ds-muted)";
            return (
              <button
                key={g.key}
                onClick={() => onToggle(on ? null : g.key)}
                className="flex items-center gap-2 rounded-lg px-2 py-1 text-left text-xs"
                style={{
                  background: on ? "rgba(251,246,236,0.07)" : "transparent",
                  color: on ? "var(--ds-ink)" : "var(--ds-muted)",
                }}
              >
                <span
                  aria-hidden
                  style={{ width: 8, height: 8, borderRadius: 999, background: color, flex: "0 0 auto" }}
                />
                <span className="flex-1 truncate">{g.label}</span>
                <span style={{ color: "var(--ds-muted)" }}>{g.memberCount}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Matches offered while somebody is still typing.
 *
 * Drawn from the ranked rows rather than from a second request, so a
 * suggestion is always something the list itself would show -- two lists that
 * can disagree about what matched is the class of bug this app has spent long
 * enough on.
 */
function Suggestions({
  rows,
  onPick,
}: {
  rows: PersonRow[];
  onPick: (id: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <ul
      className="w-full max-w-xl overflow-hidden rounded-2xl border"
      style={{ background: "rgba(20,11,6,0.97)", borderColor: "var(--ds-line)" }}
    >
      {rows.map((r) => (
        <li key={r.id}>
          <button
            onClick={() => onPick(r.id)}
            className="flex w-full items-baseline gap-2 px-4 py-2 text-left"
            style={{ color: "var(--ds-ink)", fontSize: 13 }}
          >
            <span className="truncate">{r.name}</span>
            {r.subtitle ? (
              <span className="truncate" style={{ color: "var(--ds-muted)", fontSize: 11 }}>
                {r.subtitle}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
