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
import { rankPeople, type PersonRow } from "@/lib/people-rows";

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
        setError(err instanceof AmberError ? err.message : "Could not load your network.");
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

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <header
        className="absolute left-0 right-0 top-0 z-30 flex items-center justify-between px-6 py-4"
        style={{ background: "rgba(20,11,6,0.92)" }}
      >
        <span className="text-lg" style={{ color: "var(--ink)" }}>
          Amber
        </span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {loading
            ? "Loading…"
            : [
                `${stats?.people ?? rows.length} people`,
                stats?.places ? `${stats.places} places` : null,
                `${resolvedGroups.length} groups`,
              ]
                .filter(Boolean)
                .join(" · ")}
          <button onClick={() => setShowGraph((v) => !v)} className="ml-4 underline">
            {showGraph ? "List" : "Graph"}
          </button>
          <button onClick={signOut} className="ml-4 underline">
            Sign out
          </button>
        </span>
      </header>

      {error ? (
        <div className="flex h-full items-center justify-center px-6 text-center">
          <p style={{ color: "var(--muted)" }}>{error}</p>
        </div>
      ) : showGraph ? (
        <>
          <NetworkGraph
            nodes={graphNodes}
            groups={resolvedGroups}
            activeGroup={activeGroup}
            focusId={focusTarget}
            selectedId={selectedId}
            highlighted={hits ?? new Set()}
            onSelect={setSelectedId}
          />
          <NetworkKey
            groups={resolvedGroups}
            active={activeGroup}
            onToggle={setActiveGroup}
            loading={loading}
          />
          {/* THE SAME SEARCH THE LIST USES, so the two views can never
              disagree about what matched. Typing a name lights its node and,
              once it is the only match, pans to it and opens the card. */}
          <div className="absolute bottom-0 left-0 right-0 z-30 flex flex-col items-center gap-2 px-6 pb-6">

            <Suggestions
              rows={suggestions}
              onPick={(id) => {
                setSelectedId(id);
                setFocusTarget(id);
              }}
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your people"
              className="w-full max-w-xl rounded-full border px-5 py-3 outline-none"
              style={{
                background: "rgba(20,11,6,0.95)",
                borderColor: "var(--hair)",
                color: "var(--ink)",
              }}
            />
          </div>
        </>
      ) : (
        <div className="flex h-full">
          {/* The key is a filter on the list as well as a legend for the
              graph, so a chip means the same thing in both views. */}
          <div
            className="hidden w-64 shrink-0 overflow-y-auto border-r px-4 pb-6 pt-20 md:block"
            style={{ borderColor: "var(--hair)" }}
          >
            <NetworkKeyInline
              groups={resolvedGroups}
              active={activeGroup}
              onToggle={setActiveGroup}
              colors={colors}
              loading={loading}
            />
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-10 pt-20">
            <div className="mx-auto max-w-2xl">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your people by name, company or school"
                className="w-full rounded-full border px-5 py-3 outline-none"
                style={{
                  background: "var(--surface)",
                  borderColor: "var(--hair)",
                  color: "var(--ink)",
                }}
              />

              <Suggestions rows={suggestions} onPick={(id) => setSelectedId(id)} />

              <p className="mb-1 mt-5 text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                {heading}
              </p>

              {loading ? (
                <p className="py-8 text-sm" style={{ color: "var(--muted)" }}>
                  Loading…
                </p>
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
        </div>
      )}

      {selected ? (
        <ContactCard token={token} contact={selected} onClose={() => setSelectedId(null)} />
      ) : null}

    </main>
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
        <span className="text-sm" style={{ color: "var(--ink)" }}>
          Key
        </span>
        {active ? (
          <button onClick={() => onToggle(null)} className="text-xs underline" style={{ color: "var(--muted)" }}>
            clear
          </button>
        ) : null}
      </div>
      <p className="mb-3 text-xs" style={{ color: "var(--muted)", lineHeight: 1.5 }}>
        squares are businesses and places, not people
      </p>
      {loading ? (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Loading…
        </p>
      ) : groups.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--muted)", lineHeight: 1.5 }}>
          No shared companies or schools found in your contacts yet.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {groups.map((g) => {
            const on = active === g.key;
            const color = colors.get(g.key) ?? "var(--muted)";
            return (
              <button
                key={g.key}
                onClick={() => onToggle(on ? null : g.key)}
                className="flex items-center gap-2 rounded-lg px-2 py-1 text-left text-xs"
                style={{
                  background: on ? "rgba(251,246,236,0.07)" : "transparent",
                  color: on ? "var(--ink)" : "var(--muted)",
                }}
              >
                <span
                  aria-hidden
                  style={{ width: 8, height: 8, borderRadius: 999, background: color, flex: "0 0 auto" }}
                />
                <span className="flex-1 truncate">{g.label}</span>
                <span style={{ color: "var(--muted)" }}>{g.memberCount}</span>
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
      style={{ background: "rgba(20,11,6,0.97)", borderColor: "var(--hair)" }}
    >
      {rows.map((r) => (
        <li key={r.id}>
          <button
            onClick={() => onPick(r.id)}
            className="flex w-full items-baseline gap-2 px-4 py-2 text-left"
            style={{ color: "var(--ink)", fontSize: 13 }}
          >
            <span className="truncate">{r.name}</span>
            {r.subtitle ? (
              <span className="truncate" style={{ color: "var(--muted)", fontSize: 11 }}>
                {r.subtitle}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
