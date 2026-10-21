"use client";

/**
 * THE KEY, AND WHY IT IS NOT INSIDE THE GRAPH.
 *
 * It was, and it did not appear on screen -- twice, through two deploys, while
 * the colored arcs it explains rendered perfectly. Rather than keep reasoning
 * about why a panel nested inside the canvas component was not painting, it
 * now sits at page level beside the header and the search box, which are known
 * to show, and it is `fixed` rather than `absolute` so no ancestor's
 * positioning, stacking or overflow can take it away.
 *
 * IT ALWAYS RENDERS. The previous version disappeared entirely when it had no
 * groups, which makes "the server sent nothing" and "the panel is broken" look
 * identical from the outside -- and that ambiguity is what cost two rounds. An
 * empty key says it is empty.
 *
 * CLICKING A CHIP HIGHLIGHTS AND NOTHING ELSE. No re-layout, no zoom, no
 * panel. The point of moving groups out of the layout was that membership
 * should be sayable without moving anybody.
 */

import type { NetworkGroup } from "@/lib/amber";
import { groupColors } from "@/lib/constellation";

export default function NetworkKey({
  groups,
  active,
  onToggle,
  loading,
}: {
  groups: NetworkGroup[];
  active: string | null;
  onToggle: (key: string | null) => void;
  loading: boolean;
}) {
  const colors = groupColors(groups);

  return (
    <div
      style={{
        position: "fixed",
        left: 20,
        top: 68,
        zIndex: 40,
        width: 248,
        maxHeight: "calc(100vh - 190px)",
        overflowY: "auto",
        background: "rgba(20,11,6,0.96)",
        border: "1px solid var(--ds-line-strong)",
        borderRadius: 16,
        padding: 12,
        boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ color: "var(--ds-ink)", fontSize: 14 }}>Key</span>
        {active ? (
          <button
            onClick={() => onToggle(null)}
            style={{ color: "var(--ds-muted)", fontSize: 12, textDecoration: "underline" }}
          >
            clear
          </button>
        ) : null}
      </div>

      <div style={{ color: "var(--ds-muted)", fontSize: 11, lineHeight: 1.6, margin: "6px 0 8px" }}>
        squares are businesses and places, not people
      </div>

      {loading ? (
        <div style={{ color: "var(--ds-muted)", fontSize: 12 }}>Loading…</div>
      ) : groups.length === 0 ? (
        <div style={{ color: "var(--ds-muted)", fontSize: 12, lineHeight: 1.5 }}>
          No shared companies or schools found in your contacts yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {groups.map((g) => {
            const on = active === g.key;
            const color = colors.get(g.key) ?? "var(--ds-muted)";
            return (
              <button
                key={g.key}
                onClick={() => onToggle(on ? null : g.key)}
                title={`${g.label} · ${g.memberCount} people`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  maxWidth: "100%",
                  padding: "4px 8px",
                  fontSize: 12,
                  textAlign: "left",
                  borderRadius: 999,
                  border: `1px solid ${on ? color : "var(--ds-line)"}`,
                  background: on ? "rgba(251,246,236,0.07)" : "transparent",
                  color: on ? "var(--ds-ink)" : "var(--ds-muted)",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: color,
                    flex: "0 0 auto",
                  }}
                />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 150,
                  }}
                >
                  {g.label}
                </span>
                <span style={{ color: "var(--ds-muted)", flex: "0 0 auto" }}>{g.memberCount}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
