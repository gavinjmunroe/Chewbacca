"use client";

/**
 * THE LIST THAT REPLACED THE GRAPH AS THE FIRST THING YOU SEE.
 *
 * Every row states why it is there. That is the property a spatial graph could
 * not have: a graph must draw all 966 contacts somewhere, and where it draws
 * them is a claim about all of them at once, so a card carrying nothing but the
 * word "Alex" is indistinguishable from a real friend until you click it. In a
 * list, "nothing but a name on file" is a row you dismiss in a glance.
 *
 * The reasons themselves are built in lib/people-rows.ts, away from the markup,
 * because every display claim in this app that went untested turned out to be
 * wrong.
 */

import type { PersonRow } from "@/lib/people-rows";

export default function PersonRows({
  rows,
  colors,
  selectedId,
  onSelect,
  emptyMessage,
}: {
  rows: PersonRow[];
  colors: Map<string, string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-1 py-8 text-sm" style={{ color: "var(--muted)" }}>
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {rows.map((r) => {
        const on = r.id === selectedId;
        return (
          <li key={r.id}>
            <button
              onClick={() => onSelect(on ? null : r.id)}
              className="flex w-full items-start gap-3 border-b px-2 py-3 text-left"
              style={{
                borderColor: "var(--hair)",
                background: on ? "rgba(251,246,236,0.05)" : "transparent",
              }}
            >
              {/* A place is a square, a person is a circle -- the same
                  distinction the graph draws, so the two views agree. */}
              <span
                aria-hidden
                style={{
                  flex: "0 0 auto",
                  width: 38,
                  height: 38,
                  borderRadius: r.entity === "place" ? 10 : 999,
                  background: r.strength > 0.45 ? "#c87a2a" : "#8f5722",
                  color: "#1a0e08",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {r.initials}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span style={{ color: "var(--ink)", fontSize: 15 }}>{r.name}</span>
                  {r.subtitle ? (
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>{r.subtitle}</span>
                  ) : null}
                </span>

                <span className="mt-0.5 block" style={{ color: "#e9bc6e", fontSize: 12 }}>
                  {r.reason}
                </span>

                {r.groups.length > 0 ? (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {r.groups.map((g) => (
                      <span
                        key={g.key}
                        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5"
                        style={{
                          border: `1px solid ${colors.get(g.key) ?? "var(--hair)"}`,
                          color: "var(--muted)",
                          fontSize: 11,
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 999,
                            background: colors.get(g.key) ?? "var(--muted)",
                          }}
                        />
                        {g.label}
                      </span>
                    ))}
                  </span>
                ) : null}

                {/* A silent merge is indistinguishable from a lost contact. */}
                {r.aliases.length > 0 ? (
                  <span className="mt-1 block" style={{ color: "var(--muted)", fontSize: 11 }}>
                    also filed as {r.aliases.join(", ")}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
