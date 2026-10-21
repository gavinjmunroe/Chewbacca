"use client";

/**
 * THE COMPANY, AS A PICTURE SOMEBODY DREW.
 *
 * The old version laid groups in a ring at equal angles, which is a statement
 * and a false one: it says the company is a wheel with equal spokes. No
 * company is. Positions are stored now, so this says what somebody actually
 * believes about how their company is arranged -- which is the only reason to
 * draw it rather than list it.
 *
 * THE CENTRE IS JUST THE NAME. It was a glossy gradient sphere with a label
 * floating over it, and a sphere is a claim: the company is a thing with mass
 * that everything orbits. It is a label. A small quiet oval with the name in
 * it, and everything hanging off it.
 *
 * CONNECTIONS ARE THE PART THAT CARRIES THE INFORMATION. "Sales — Engineering"
 * is a line anybody could have guessed. "Sales — Engineering: scoping calls
 * before a quote goes out" is the thing a new hire needed and nobody wrote
 * down. So an edge is a first-class object with a sentence on it, and drawing
 * one asks for that sentence.
 *
 * DRAGGING SAVES ON RELEASE, NOT DURING. A write per animation frame is sixty
 * writes a second for a gesture nobody is finished making.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link2, Maximize2, Minus, Plus, X } from "lucide-react";
import { AmberError, tokenNow } from "@/lib/amber";
import {
  getGroupLinks,
  linkGroups,
  moveGroup,
  unlinkGroups,
  updateGroupLink,
  type GroupLink,
  type OrgGroup,
  type OrgMember,
} from "@/lib/org";
import { Alert, Avatar, Badge, Button, Field, Modal, TextArea, TextField } from "@/components/ui";
import { hueFor } from "@/lib/cn";

const W = 1000;
const H = 620;

type Pos = { x: number; y: number };

export default function CompanyCanvas({
  orgName,
  groups,
  members,
  membership,
  activeGroup,
  onPick,
  onChanged,
  height = 520,
}: {
  orgName: string;
  groups: OrgGroup[];
  members: OrgMember[];
  membership: Map<string, string[]>;
  activeGroup: string | null;
  onPick: (id: string) => void;
  onChanged?: () => void;
  /** The column this sits in decides; 520 was only ever a guess. */
  height?: number;
}) {
  const [links, setLinks] = useState<GroupLink[]>([]);
  const [pos, setPos] = useState<Map<string, Pos>>(new Map());
  const [error, setError] = useState<string | null>(null);

  // Connecting is a mode, because it has to be: a click means "open this
  // group" the rest of the time, and one gesture cannot mean both.
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [editingLink, setEditingLink] = useState<GroupLink | null>(null);
  const [pendingLink, setPendingLink] = useState<{ a: string; b: string } | null>(null);

  const svg = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);

  /*
   * PAN AND ZOOM, BECAUSE A FIXED FRAME IS A LIE ABOUT HOW BIG A COMPANY IS.
   *
   * The canvas was a fixed 1000x620 window. Four groups fit; twelve do not,
   * and the twelfth was simply off the edge with no way to reach it -- a
   * drawing board you cannot move around is a picture.
   *
   * It is the VIEWBOX that moves, not a CSS transform on the contents. That
   * matters: the drag maths converts a screen pixel into a canvas unit
   * through the viewBox, so a transform would put the node a scaled distance
   * from the cursor and the whole thing would feel broken at any zoom but
   * 100%. One source of truth for "where is this point", used by both.
   *
   * `k` is a zoom DIVISOR -- a bigger k shows more canvas, which is zooming
   * out. Clamped at both ends because a company at 10x is unreadable and at
   * 0.1x is a dot.
   */
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const vw = W * view.k;
  const vh = H * view.k;
  const viewBox = `${view.x - vw / 2} ${view.y - vh / 2} ${vw} ${vh}`;

  /**
   * Put every group on screen with a margin, whatever anybody dragged.
   *
   * The way back from being lost, and the first thing somebody reaches for
   * after dragging a node into the far corner.
   */
  const fit = useCallback(() => {
    const pts = [...pos.values()];
    if (!pts.length) {
      setView({ x: 0, y: 0, k: 1 });
      return;
    }
    // The centre label is at the origin and is part of the picture, so it is
    // included rather than being allowed to fall outside the fitted frame.
    const xs = [0, ...pts.map((p) => p.x)];
    const ys = [0, ...pts.map((p) => p.y)];
    const pad = 120; // room for a node's own box, not just its anchor point
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad;
    const k = Math.max((maxX - minX) / W, (maxY - minY) / H, 0.4);
    setView({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, k: Math.min(k, 4) });
  }, [pos]);

  const loadLinks = useCallback(() => {
    const token = tokenNow();
    if (!token) return;
    getGroupLinks(token).then((r) => setLinks(r.links)).catch(() => {});
  }, []);

  useEffect(loadLinks, [loadLinks]);

  /*
   * A GROUP THAT HAS NEVER BEEN MOVED GETS A PLACE, not a pile at the origin.
   *
   * The automatic layout is still a ring -- it is the least-wrong arrangement
   * when nothing is known -- but it is a starting point somebody overwrites by
   * dragging, rather than a permanent claim about the company.
   */
  useEffect(() => {
    setPos((prev) => {
      const next = new Map(prev);
      groups.forEach((g, i) => {
        if (next.has(g.id)) return;
        if (g.x != null && g.y != null) {
          next.set(g.id, { x: g.x, y: g.y });
          return;
        }
        const a = (i / Math.max(1, groups.length)) * Math.PI * 2 - Math.PI / 2;
        const r = Math.min(W, H) * 0.33;
        next.set(g.id, { x: Math.cos(a) * r, y: Math.sin(a) * r });
      });
      return next;
    });
  }, [groups]);

  const at = useCallback((id: string): Pos => pos.get(id) ?? { x: 0, y: 0 }, [pos]);

  const toCanvas = useCallback((ev: { clientX: number; clientY: number }): Pos => {
    const rect = svg.current!.getBoundingClientRect();
    // The SVG scales to its container, so a pixel on screen is not a unit in
    // the viewBox. Without this the node leaves the cursor behind.
    // Through the CURRENT viewBox, not the base one: pan and zoom move the
    // mapping, and a stale mapping is a node that drifts away from the
    // cursor the moment anybody zooms.
    return {
      x: view.x + (((ev.clientX - rect.left) / rect.width) - 0.5) * W * view.k,
      y: view.y + (((ev.clientY - rect.top) / rect.height) - 0.5) * H * view.k,
    };
  }, [view]);

  const peopleIn = useCallback(
    (id: string) => {
      const ids = new Set(membership.get(id) ?? []);
      return members.filter((m) => ids.has(m.amberId));
    },
    [members, membership],
  );

  const onTwo = useMemo(() => {
    const count = new Map<string, number>();
    for (const ids of membership.values()) {
      for (const id of ids) count.set(id, (count.get(id) ?? 0) + 1);
    }
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  }, [membership]);

  async function saveLink(a: string, b: string, label: string, description: string) {
    const token = tokenNow();
    if (!token) return;
    try {
      await linkGroups(token, {
        fromGroupId: a,
        toGroupId: b,
        label: label.trim() || null,
        description: description.trim() || null,
      });
      loadLinks();
      onChanged?.();
    } catch (e) {
      setError(e instanceof AmberError ? e.message : "Could not connect those groups.");
    }
  }

  return (
    <div className="space-y-3">
      <Alert>{error}</Alert>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-[var(--ds-dim)]">
          {connectFrom
            ? "Pick the second group to connect it to. Press Escape to stop."
            : "Drag a group to move it. Drag the background to pan, scroll to zoom."}
        </p>
        <div className="flex items-center gap-1.5">
          {/* Zoom is on the toolbar as well as the wheel: a trackpad user
              scrolls, a mouse user who has never zoomed a canvas looks for
              buttons, and neither should have to guess. */}
          <Button
            tone="quiet"
            size="sm"
            title="Zoom out"
            onClick={() => setView((v) => ({ ...v, k: Math.min(4, v.k * 1.2) }))}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <Button
            tone="quiet"
            size="sm"
            title="Zoom in"
            onClick={() => setView((v) => ({ ...v, k: Math.max(0.35, v.k / 1.2) }))}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button tone="quiet" size="sm" onClick={fit} title="Fit everything on screen">
            <Maximize2 className="h-3.5 w-3.5" />
            Fit
          </Button>
          <Button
            tone={connectFrom ? "primary" : "quiet"}
            size="sm"
            onClick={() => setConnectFrom(connectFrom ? null : "")}
            disabled={groups.length < 2}
          >
            <Link2 className="h-3.5 w-3.5" />
            {connectFrom ? "Cancel" : "Connect"}
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)]">
        <svg
          ref={svg}
          viewBox={viewBox}
          style={{ height }}
          /*
            GRABBING THE BACKGROUND PANS. It is what every map and every
            canvas tool does, so it is the gesture people try first and the
            only one worth spending a cursor on.
          */
          className={`w-full touch-none select-none ${
            pan.current ? "cursor-grabbing" : "cursor-grab"
          }`}
          onMouseDown={(ev) => {
            // Only the empty background. A node's own handler stops this.
            if (ev.target !== ev.currentTarget) return;
            pan.current = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
          }}
          onWheel={(ev) => {
            /*
              ZOOM AT THE POINTER, not at the centre.
              
              Zooming at the centre walks whatever you were looking at off the
              screen, so you zoom, pan it back, zoom, pan it back. Holding the
              point under the cursor still is the thing that makes a canvas
              feel like a canvas rather than a slider.
            */
            const rect = svg.current!.getBoundingClientRect();
            /*
             * SCALED BY HOW FAR THE WHEEL ACTUALLY TURNED, AND GENTLY.
             *
             * This zoomed by a fixed 10% per event, which is wrong in two
             * ways at once on a trackpad: a two-finger scroll fires dozens of
             * events for one gesture, so the canvas shot from edge to edge
             * before the fingers stopped moving. A mouse wheel sends a few
             * large deltas, a trackpad sends many small ones, and treating
             * both as "one notch" makes one of them unusable.
             *
             * deltaMode matters too: 0 is pixels, 1 is lines, 2 is pages, and
             * a line-mode delta of 3 means something very different from a
             * pixel-mode delta of 3. Normalizing to pixels first, then
             * damping hard, makes the same gesture feel the same on both.
             */
            const px =
              ev.deltaMode === 1
                ? ev.deltaY * 16
                : ev.deltaMode === 2
                  ? ev.deltaY * rect.height
                  : ev.deltaY;
            // Clamped so one violent flick cannot cross the whole zoom range.
            const step = Math.max(-60, Math.min(60, px)) * 0.0022;
            const next = Math.min(4, Math.max(0.35, view.k * Math.exp(step)));
            const fx = (ev.clientX - rect.left) / rect.width - 0.5;
            const fy = (ev.clientY - rect.top) / rect.height - 0.5;
            setView({
              k: next,
              x: view.x + fx * W * (view.k - next),
              y: view.y + fy * H * (view.k - next),
            });
          }}
          onMouseMove={(ev) => {
            const p0 = pan.current;
            if (p0) {
              const rect = svg.current!.getBoundingClientRect();
              setView((v) => ({
                ...v,
                // Screen pixels into canvas units, so the background tracks
                // the cursor exactly at any zoom.
                x: p0.vx - ((ev.clientX - p0.x) / rect.width) * W * v.k,
                y: p0.vy - ((ev.clientY - p0.y) / rect.height) * H * v.k,
              }));
              return;
            }
            const d = drag.current;
            if (!d) return;
            const p = toCanvas(ev);
            d.moved = true;
            setPos((m) => new Map(m).set(d.id, { x: p.x - d.dx, y: p.y - d.dy }));
          }}
          onMouseUp={async () => {
            pan.current = null;
            const d = drag.current;
            drag.current = null;
            if (!d?.moved) return;
            const token = tokenNow();
            const p = pos.get(d.id);
            if (!token || !p) return;
            // On release, once. Sixty writes a second for a gesture nobody has
            // finished making is not persistence, it is a denial of service
            // somebody performs on themselves.
            moveGroup(token, d.id, Math.round(p.x), Math.round(p.y)).catch(() => {});
          }}
          onMouseLeave={() => {
            pan.current = null;
            drag.current = null;
          }}
          onKeyDown={(ev) => ev.key === "Escape" && setConnectFrom(null)}
          tabIndex={0}
        >
          {/* ── the connections, under everything ── */}
          {links.map((l) => {
            const a = at(l.from_group_id);
            const b = at(l.to_group_id);
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            return (
              <g key={l.id}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="var(--ds-line-strong)"
                  strokeWidth={1.5}
                />
                {l.label ? (
                  <g
                    className="cursor-pointer"
                    onClick={() => setEditingLink(l)}
                  >
                    <rect
                      x={mx - Math.min(90, l.label.length * 4 + 14)}
                      y={my - 11}
                      width={Math.min(180, l.label.length * 8 + 28)}
                      height={22}
                      rx={11}
                      fill="var(--ds-card)"
                      stroke="var(--ds-line)"
                    />
                    <text
                      x={mx}
                      y={my + 4}
                      textAnchor="middle"
                      fontSize={11}
                      fill="var(--ds-muted)"
                    >
                      {l.label}
                    </text>
                  </g>
                ) : (
                  <circle
                    cx={mx}
                    cy={my}
                    r={5}
                    fill="var(--ds-card)"
                    stroke="var(--ds-line-strong)"
                    className="cursor-pointer"
                    onClick={() => setEditingLink(l)}
                  />
                )}
              </g>
            );
          })}

          {/* ── the spokes to the centre ── */}
          {groups.map((g) => {
            const p = at(g.id);
            return (
              <line
                key={`spoke-${g.id}`}
                x1={0}
                y1={0}
                x2={p.x}
                y2={p.y}
                stroke="var(--ds-line)"
                strokeWidth={1}
                strokeDasharray="3 4"
              />
            );
          })}

          {/*
            THE CENTRE. A label, not a planet. It is the only thing on this
            canvas that is not a group, so it is the one thing that should look
            like it is not one.
          */}
          <g>
            <rect
              x={-Math.max(70, orgName.length * 4.4)}
              y={-17}
              width={Math.max(140, orgName.length * 8.8)}
              height={34}
              rx={17}
              fill="var(--ds-card)"
              stroke="var(--ds-line-strong)"
            />
            <text
              x={0}
              y={5}
              textAnchor="middle"
              fontSize={13}
              fontWeight={600}
              fill="var(--ds-ink)"
            >
              {orgName}
            </text>
          </g>

          {/* ── the groups ── */}
          {groups.map((g) => {
            const p = at(g.id);
            const on = activeGroup === g.id;
            const arming = connectFrom === g.id;
            const people = peopleIn(g.id).slice(0, 5);
            const w = Math.max(132, g.name.length * 8 + 44);
            return (
              <g
                key={g.id}
                transform={`translate(${p.x} ${p.y})`}
                className="cursor-pointer"
                onMouseDown={(ev) => {
                  if (connectFrom !== null) return;
                  const c = toCanvas(ev);
                  drag.current = { id: g.id, dx: c.x - p.x, dy: c.y - p.y, moved: false };
                }}
                onClick={() => {
                  if (drag.current?.moved) return;
                  if (connectFrom === null) {
                    onPick(g.id);
                    return;
                  }
                  if (!connectFrom) {
                    setConnectFrom(g.id);
                    return;
                  }
                  if (connectFrom === g.id) {
                    setConnectFrom(null);
                    return;
                  }
                  setPendingLink({ a: connectFrom, b: g.id });
                  setConnectFrom(null);
                }}
              >
                <rect
                  x={-w / 2}
                  y={-21}
                  width={w}
                  height={42}
                  rx={10}
                  fill={on ? "var(--ds-accent)" : "var(--ds-card)"}
                  stroke={arming ? "var(--ds-accent)" : on ? "var(--ds-accent)" : "var(--ds-line-strong)"}
                  strokeWidth={arming ? 2 : 1}
                />
                <circle cx={-w / 2 + 14} cy={-4} r={4} fill={on ? "#fff" : hueFor(g.name)} />
                <text
                  x={-w / 2 + 25}
                  y={-1}
                  fontSize={12.5}
                  fontWeight={600}
                  fill={on ? "#fff" : "var(--ds-ink)"}
                >
                  {g.name}
                </text>
                <text
                  x={-w / 2 + 25}
                  y={13}
                  fontSize={10.5}
                  fill={on ? "rgba(255,255,255,0.85)" : "var(--ds-dim)"}
                >
                  {g.memberCount} {g.memberCount === 1 ? "person" : "people"}
                </text>

                {/* The faces, so a group is people rather than a count. */}
                {people.map((m, i) => (
                  <circle
                    key={m.amberId}
                    cx={w / 2 - 12 - i * 11}
                    cy={-26}
                    r={7}
                    fill={hueFor(m.fullName || m.email)}
                    stroke={onTwo.has(m.amberId) ? "var(--ds-ink)" : "var(--ds-card)"}
                    strokeWidth={onTwo.has(m.amberId) ? 1.5 : 2}
                  />
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      {links.length ? (
        <div className="flex flex-wrap gap-1.5">
          {links.map((l) => (
            <button key={l.id} className="ent-choice" onClick={() => setEditingLink(l)}>
              {l.from_name} ↔ {l.to_name}
              {l.label ? <span className="ml-1 opacity-60">{l.label}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      <LinkModal
        open={!!pendingLink}
        title="Connect two groups"
        note="The sentence is the point. “Sales — Engineering” is a line anybody could guess; what runs between them is the thing nobody wrote down."
        initial={null}
        onClose={() => setPendingLink(null)}
        onSave={async (label, description) => {
          if (pendingLink) await saveLink(pendingLink.a, pendingLink.b, label, description);
          setPendingLink(null);
        }}
      />

      <LinkModal
        open={!!editingLink}
        title={editingLink ? `${editingLink.from_name} ↔ ${editingLink.to_name}` : ""}
        note="What runs between these two."
        initial={editingLink}
        onClose={() => setEditingLink(null)}
        onDelete={async () => {
          const token = tokenNow();
          if (token && editingLink) await unlinkGroups(token, editingLink.id).catch(() => null);
          setEditingLink(null);
          loadLinks();
        }}
        onSave={async (label, description) => {
          const token = tokenNow();
          if (token && editingLink) {
            await updateGroupLink(token, editingLink.id, {
              label: label.trim() || null,
              description: description.trim() || null,
            }).catch(() => null);
          }
          setEditingLink(null);
          loadLinks();
        }}
      />
    </div>
  );
}

function LinkModal({
  open,
  title,
  note,
  initial,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  title: string;
  note: string;
  initial: GroupLink | null;
  onClose: () => void;
  onSave: (label: string, description: string) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLabel(initial?.label ?? "");
    setDescription(initial?.description ?? "");
  }, [initial?.id, initial?.label, initial?.description, open]);

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={title}
      note={note}
      footer={
        <>
          {onDelete ? (
            <Button tone="danger" onClick={onDelete}>
              <X className="h-3.5 w-3.5" />
              Remove
            </Button>
          ) : null}
          <Button tone="ghost" onClick={onClose}>Cancel</Button>
          <Button
            tone="primary"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(label, description);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="On the line" hint="Two or three words. It is drawn on the connection itself.">
          <TextField
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="scopes deals"
          />
        </Field>
        <Field label="What runs between them" hint="Read when somebody opens the connection.">
          <TextArea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Engineering joins the scoping call before any quote over $50k goes out."
          />
        </Field>
      </div>
    </Modal>
  );
}
