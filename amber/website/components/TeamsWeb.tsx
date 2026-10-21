"use client";

/**
 * THE COMPANY'S SHAPE, AS A PICTURE.
 *
 * A roster answers "who is here" and a group list answers "what teams exist".
 * Neither answers the question an admin actually has, which is spatial: who is
 * grouped with whom, which teams are thin, who is on two, and who is in nothing
 * at all. That last one is the useful one and a list cannot show it — somebody
 * in no group is absent from every row, so the screen that should surface them
 * is the one place they are invisible.
 *
 * LAID OUT, NOT SIMULATED. A force graph needs a library, a tick loop and a
 * settling animation to arrange a dozen nodes, and still lands somewhere
 * slightly different on every reload — the opposite of what a reference picture
 * should do. Teams sit on a ring around the company, their people on a smaller
 * ring around them, and the same company draws the same way every time.
 *
 * Each face is tinted from a hash of the person's name, so somebody keeps their
 * colour everywhere they appear — which is what makes "she is on two teams"
 * visible rather than something you work out by reading.
 */

import type { OrgGroup, OrgMember } from "@/lib/org";

type Props = {
  orgName: string;
  groups: OrgGroup[];
  members: OrgMember[];
  membership: Map<string, string[]>;
  onPick?: (groupId: string) => void;
  activeGroup?: string | null;
};

const TINTS = [
  "#b96a14", "#1f7a6b", "#7a4bb8", "#a8324a",
  "#2f6fb5", "#8a6a1f", "#3f7a2e", "#aa4b8c",
];

function tint(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

const label = (m: OrgMember) => m.fullName || m.email || "Unnamed";

const initials = (m: OrgMember) =>
  label(m)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

export default function TeamsWeb({
  orgName,
  groups,
  members,
  membership,
  onPick,
  activeGroup,
}: Props) {
  const size = 720;
  const c = size / 2;
  const ring = groups.length <= 1 ? 0 : groups.length <= 4 ? 190 : 245;

  const byId = new Map(members.map((m) => [m.amberId, m]));
  const grouped = new Set<string>();
  for (const ids of membership.values()) ids.forEach((id) => grouped.add(id));
  const ungrouped = members.filter((m) => !grouped.has(m.amberId));

  // Somebody on two teams, drawn once per team but tinted the same both times.
  const onTwo = new Set(
    members
      .map((m) => m.amberId)
      .filter((id) => [...membership.values()].filter((ids) => ids.includes(id)).length > 1),
  );

  return (
    <div className="w-full">
      {/*
        THE RING SITS INSIDE A GUTTER. Team labels are 136px wide and anchored
        on the ring, so half of each one hangs outside the circle -- which is
        why the labels at three and nine o'clock were sliced off by the card's
        edge. The padding is the half-label.
      */}
      <div
        className="relative mx-auto px-[76px] py-6"
        style={{ width: "100%", maxWidth: size + 152 }}
      >
      <div
        className="relative mx-auto"
        style={{ width: size, height: size, maxWidth: "100%", aspectRatio: "1 / 1" }}
      >
        <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 h-full w-full" style={{ overflow: "visible" }}>
          <defs>
            <radialGradient id="hub" cx="35%" cy="30%">
              <stop offset="0%" stopColor="#fbb43c" />
              <stop offset="100%" stopColor="#e8840a" />
            </radialGradient>
          </defs>

          {groups.map((g, i) => {
            const a = (i / Math.max(1, groups.length)) * Math.PI * 2 - Math.PI / 2;
            const x = c + Math.cos(a) * ring;
            const y = c + Math.sin(a) * ring;
            const on = activeGroup === g.id;
            return (
              <line
                key={g.id}
                x1={c}
                y1={c}
                x2={x}
                y2={y}
                stroke={on ? "#b96a14" : "rgba(36,20,5,0.14)"}
                strokeWidth={on ? 2.5 : 1.25}
              />
            );
          })}

          <circle cx={c} cy={c} r={ring} fill="none" stroke="rgba(36,20,5,0.06)" strokeDasharray="3 7" />
          <circle cx={c} cy={c} r={54} fill="url(#hub)" />
          <text
            x={c}
            y={c + 5}
            textAnchor="middle"
            fill="#fff"
            style={{ font: "600 15px -apple-system, Segoe UI, sans-serif" }}
          >
            {orgName.length > 12 ? orgName.slice(0, 11) + "…" : orgName}
          </text>
        </svg>

        {groups.map((g, i) => {
          const a = (i / Math.max(1, groups.length)) * Math.PI * 2 - Math.PI / 2;
          const x = c + Math.cos(a) * ring;
          const y = c + Math.sin(a) * ring;
          const ids = membership.get(g.id) ?? [];
          const shown = ids.slice(0, 6);
          const on = activeGroup === g.id;
          const pct = (v: number) => `${(v / size) * 100}%`;

          return (
            <div key={g.id}>
              {shown.map((id, k) => {
                const pa = (k / Math.max(1, shown.length)) * Math.PI * 2 - Math.PI / 2;
                const px = x + Math.cos(pa) * 54;
                const py = y + Math.sin(pa) * 54;
                const m = byId.get(id);
                if (!m) return null;
                return (
                  <div
                    key={`${g.id}-${id}`}
                    className="absolute grid place-items-center rounded-full"
                    style={{
                      width: "4%",
                      height: "4%",
                      left: pct(px),
                      top: pct(py),
                      transform: "translate(-50%, -50%)",
                      background: tint(label(m)),
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 600,
                      border: onTwo.has(id) ? "2px solid #fff" : "1px solid rgba(255,255,255,0.7)",
                      boxShadow: "0 1px 4px rgba(36,20,5,0.25)",
                    }}
                    title={`${label(m)}${onTwo.has(id) ? " · on two teams" : ""}`}
                  >
                    {initials(m)}
                  </div>
                );
              })}

              <button
                onClick={() => onPick?.(g.id)}
                className="absolute rounded-xl px-3 py-2 text-center transition-all"
                style={{
                  left: pct(x),
                  top: pct(y),
                  transform: "translate(-50%, -50%)",
                  width: 136,
                  background: on ? "var(--ent-accent)" : "#fff",
                  color: on ? "#fff" : "var(--ent-ink)",
                  border: `1px solid ${on ? "var(--ent-accent)" : "var(--ent-line-strong)"}`,
                  boxShadow: on
                    ? "0 4px 14px rgba(185,106,20,0.35)"
                    : "0 2px 8px rgba(36,20,5,0.1)",
                }}
              >
                <div className="truncate text-[13px] font-semibold">{g.name}</div>
                <div className="text-[11px]" style={{ color: on ? "rgba(255,255,255,0.85)" : "var(--ent-dim)" }}>
                  {g.memberCount}
                  {ids.length > 6 ? ` · +${ids.length - 6} more` : ""}
                </div>
              </button>
            </div>
          );
        })}
      </div>

      </div>

      <div
        className="mt-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 px-4 text-center text-[11px]"
        style={{ color: "var(--ds-dim)" }}
      >
        <span>Each person keeps one color everywhere they appear</span>
        <span>A ring means they are on two teams</span>
      </div>

      {/*
        THE PEOPLE IN NO TEAM, named rather than counted. This is the row an
        admin acts on: somebody who joined and was never put anywhere sees
        whatever goes to the whole company and nothing their colleagues send to
        each other, and has no way to know that is why.
      */}
      {ungrouped.length ? (
        <div className="mt-5 rounded-xl p-4" style={{ background: "var(--ds-hover)" }}>
          <div className="mb-2 text-sm font-semibold" style={{ color: "var(--ent-ink)" }}>
            In no team yet · {ungrouped.length}
          </div>
          <div className="flex flex-wrap gap-2">
            {ungrouped.map((m) => (
              <span key={m.amberId} className="ent-choice" style={{ cursor: "default" }}>
                {label(m)}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs" style={{ color: "var(--ent-dim)" }}>
            They see anything shared with the whole company, and nothing shared with a team.
          </p>
        </div>
      ) : null}
    </div>
  );
}
