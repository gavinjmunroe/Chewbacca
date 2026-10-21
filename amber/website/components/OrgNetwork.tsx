"use client";

/**
 * YOUR NETWORK, AS A PICTURE.
 *
 * WHAT THIS REPLACES. The same data was already on screen -- fourteen people,
 * eight firms -- as two scrolling lists. Lists answer "is Paychex in here",
 * which nobody asks, and they cannot answer the one thing a relationship
 * graph is for: show me the shape of what I have. A list of eight domains is
 * not a network, and reading it does not feel like discovering anything.
 *
 * A PICTURE DOES ONE THING A LIST CANNOT: it puts the people you actually
 * know near the middle and everybody else out at the edge, so the answer to
 * "who do we really have" is the first thing you see rather than something
 * you work out by scanning a column of dates.
 *
 * NOT THE GROUPS GRAPH. The old canvas drew circles -- rooms inside the
 * company -- which is an org chart and not a network. This draws every person
 * the calendar and the inbox produced, clustered by the firm they work at,
 * because that is the question a room full of people actually has: who do we
 * know at Paychex, and how warm is it.
 *
 * THE NUMBER ON A DOT IS TOUCHES, NOT A SCORE. Warmth here is the thing the
 * ledger already computes from recency and frequency, and the dot's size is
 * that number. No invented metric, nothing to explain, and it moves on its
 * own as people meet.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, Network as NetworkIcon } from "lucide-react";
import NetworkGraph from "@/components/NetworkGraph";
import { Empty, Panel } from "@/components/ui";
import { listPeople, type PersonRow } from "@/lib/memory";
import type { GraphNode, NetworkGroup } from "@/lib/amber";

export default function OrgNetwork({
  meId,
  onSelect,
}: {
  meId: string;
  /** Opening a dot shows the person's full record beside the canvas. */
  onSelect?: (personId: string | null) => void;
}) {
  const [people, setPeople] = useState<PersonRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    /*
     * BOTH SIDES IN ONE PICTURE. Splitting colleagues from counterparties is
     * the division that made this two tabs, and the interesting edges are the
     * ones that cross it -- a colleague who knows somebody at the firm you
     * are trying to reach is the entire product.
     */
    Promise.all([
      listPeople({ scope: "external" }).catch(() => [] as PersonRow[]),
      listPeople({ scope: "internal" }).catch(() => [] as PersonRow[]),
    ])
      .then(([ext, int]) => {
        if (!alive) return;
        const seen = new Set<string>();
        const all = [...int, ...ext].filter((p) => {
          if (seen.has(p.id)) return false;
          seen.add(p.id);
          return true;
        });
        setPeople(all);
      })
      .catch(() => alive && setPeople([]));
    return () => {
      alive = false;
    };
  }, []);

  const { nodes, groups } = useMemo(() => {
    const rows = people ?? [];

    /*
     * ONE GROUP PER FIRM, which is what clusters the dots. A person with no
     * firm gets none and floats, which is honest: we do not know where they
     * work, and inventing a bucket for them would put strangers next to each
     * other and imply a relationship.
     */
    const byFirm = new Map<string, { label: string; ids: string[] }>();
    for (const p of rows) {
      const firm = (p.account_name ?? p.company ?? "").trim();
      if (!firm) continue;
      const key = firm.toLowerCase();
      const g = byFirm.get(key) ?? { label: firm, ids: [] };
      g.ids.push(p.id);
      byFirm.set(key, g);
    }

    const graphGroups: NetworkGroup[] = [...byFirm.entries()]
      // The firms you know most people at, first: the key reads top-down and
      // the one with eleven people in it should not be below the one with one.
      .sort((a, b) => b[1].ids.length - a[1].ids.length)
      .map(([key, g]) => ({
        key,
        id: key,
        label: g.label,
        kind: "organization" as const,
        memberCount: g.ids.length,
        memberIds: g.ids,
      }));

    const graphNodes: GraphNode[] = rows.map((p) => {
      const firm = (p.account_name ?? p.company ?? "").trim();
      return {
        id: p.id,
        kind: "contact" as const,
        name: p.display_name,
        /*
         * The ledger's own warmth, already recency- and frequency-weighted.
         * A number the product computes and shows everywhere else, rather
         * than a second one invented for the canvas that would disagree with
         * the node view by the end of the week.
         */
        strength: Number(p.strength ?? 0) || 0,
        company: firm || null,
        title: p.title ?? null,
        lastAt: p.last_at ?? null,
        count90d: Number(p.interactions ?? 0) || 0,
        groupKeys: firm ? [firm.toLowerCase()] : [],
      };
    });

    // You, at the centre, so the picture has a point of view.
    graphNodes.unshift({
      id: meId,
      kind: "owner",
      name: "You",
      strength: 1,
      groupKeys: [],
    });

    return { nodes: graphNodes, groups: graphGroups };
  }, [people, meId]);

  if (people === null) {
    return (
      <Panel className="grid h-[520px] place-items-center">
        <span className="flex items-center gap-2 text-[13px] text-[var(--ds-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Drawing your network…
        </span>
      </Panel>
    );
  }

  if (nodes.length <= 1) {
    return (
      <Empty
        icon={<NetworkIcon className="h-5 w-5" />}
        title="Nothing to draw yet"
        note="Connect a calendar and this fills with everybody you have met. Nobody types anything in."
      />
    );
  }

  return (
    <div className="space-y-2">
      <Panel className="relative h-[560px] overflow-hidden p-0">
        <NetworkGraph
          nodes={nodes}
          groups={groups}
          activeGroup={activeGroup}
          selectedId={selected}
          highlighted={new Set<string>()}
          onSelect={(id) => {
            setSelected(id);
            onSelect?.(id);
          }}
        />
      </Panel>

      {/*
        THE KEY IS A FILTER, not a legend. Reading which colour is which firm
        is a chore; pressing a firm and watching everybody else fade is the
        thing somebody actually wants to do with it.
      */}
      {groups.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setActiveGroup(null)}
            className={`rounded-full border px-2.5 py-1 text-[12px] transition ${
              activeGroup === null
                ? "border-[var(--ds-accent)] text-[var(--ds-ink)]"
                : "border-[var(--ds-line)] text-[var(--ds-muted)] hover:text-[var(--ds-ink)]"
            }`}
          >
            Everyone · {nodes.length - 1}
          </button>
          {groups.slice(0, 14).map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setActiveGroup(activeGroup === g.key ? null : g.key)}
              className={`rounded-full border px-2.5 py-1 text-[12px] transition ${
                activeGroup === g.key
                  ? "border-[var(--ds-accent)] text-[var(--ds-ink)]"
                  : "border-[var(--ds-line)] text-[var(--ds-muted)] hover:text-[var(--ds-ink)]"
              }`}
            >
              {g.label} · {g.memberCount}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
