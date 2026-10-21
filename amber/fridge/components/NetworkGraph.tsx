"use client";

/**
 * YOUR NETWORK AS A CONSTELLATION.
 *
 * Layout lives in lib/constellation.ts and the reasoning for it is there. This
 * file is the drawing, and what it is trying to avoid is everything the three
 * previous versions got wrong in turn: a hairball, then a clock face, then a
 * set of rings that asserted membership for whoever happened to land inside
 * them.
 *
 * MEMBERSHIP IS COLOR, NOT PLACE. A shared company or school is an arc on the
 * rim of a dot and a chip in the legend. Clicking a chip lights its members and
 * does nothing else -- no re-layout, no zoom, no panel. A person in three
 * groups wears three arcs, which is a thing a ring could never show, and a
 * person standing next to seven colleagues is not claimed to be one of them.
 *
 * A DOT SAYS WHO IT IS WITHOUT BEING ASKED. Nodes are large enough to carry
 * initials and hovering gives the full card. The first version required a
 * click per person to learn anything, which on nine hundred contacts is not a
 * feature, it is a maze.
 *
 * IT FITS ON OPEN. The view is scaled to the extent of the data the first time
 * it is drawn. After that the view is the user's -- zoom and pan are never
 * reset out from under them.
 *
 * IT DRAWS ON CHANGE, NOT ON A CLOCK. There is no animation loop. A static
 * picture that holds still is easier to read than one that breathes, and it
 * costs nothing when nobody is touching it.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { GraphNode, NetworkGroup } from "@/lib/amber";
import {
  buildConstellation,
  liveExtentOf,
  groupColors,
  type PlacedNode,
} from "@/lib/constellation";
import { sinceLabel } from "@/lib/relationship-label";

/**
 * Below this on-screen radius, initials are unreadable, so they are not drawn.
 * Every contact carries them; zooming in is what reveals them.
 */
const INITIALS_MIN_PX = 7;
/**
 * A dot smaller than this on screen does not get to try for a name. Combined
 * with the collision pass below it means names appear as you zoom in, rather
 * than twenty of them piling up in the middle at every zoom level.
 */
const LABEL_MIN_PX = 5;

const C = {
  ink: "#fbf6ec",
  dim: "#a4907c",
  dot: "#8f5722",
  dotWarm: "#c87a2a",
  quiet: "#6b4426",
  hot: "#e2a13c",
  hit: "#e9bc6e",
  bg: "#1a0e08",
};

export default function NetworkGraph({
  nodes,
  groups,
  activeGroup,
  focusId = null,
  selectedId,
  highlighted,
  onSelect,
}: {
  nodes: GraphNode[];
  /** Already resolved by the page, so the canvas and the key cannot disagree. */
  groups: NetworkGroup[];
  activeGroup: string | null;
  /** Pan the view onto this node when it changes. Zoom is left alone. */
  focusId?: string | null;
  selectedId: string | null;
  highlighted: Set<string>;
  onSelect: (id: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{ node: PlacedNode; sx: number; sy: number } | null>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const fitted = useRef(false);

  const { placed } = useMemo(() => buildConstellation(nodes), [nodes]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);
  const colors = useMemo(() => groupColors(groups), [groups]);
  const labelOf = useMemo(() => new Map(groups.map((g) => [g.key, g.label])), [groups]);

  /** The ids the active chip is claiming, straight from the server's list. */
  const litByGroup = useMemo(() => {
    if (!activeGroup) return null;
    const g = groups.find((x) => x.key === activeGroup);
    return g ? new Set(g.memberIds) : null;
  }, [activeGroup, groups]);


  // Fit once, when the data first arrives. Never again -- re-fitting on every
  // data change would yank the view while somebody is reading it.
  useEffect(() => {
    if (fitted.current || placed.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Framed on the live field rather than on all 966 contacts; see
    // liveExtentOf for why fitting everything makes every name unreadable.
    const extent = liveExtentOf(placed);
    const fit = Math.min(canvas.clientWidth, canvas.clientHeight) / 2 / (extent * 1.12);
    setView({ zoom: Math.max(0.04, Math.min(1.4, fit)), x: 0, y: 0 });
    fitted.current = true;
  }, [placed]);

  /**
   * BRING A SEARCHED PERSON INTO VIEW.
   *
   * Highlighting a dot is useless when the dot is off screen, and on nine
   * hundred contacts it usually is. So a search that resolves to exactly one
   * person pans to them. Only pans -- the zoom is the user's, and changing it
   * under somebody who has deliberately zoomed in is the yank this file has
   * avoided everywhere else.
   */
  useEffect(() => {
    if (!focusId) return;
    const p = byId.get(focusId);
    if (!p) return;
    setView((v) => ({ ...v, x: -p.x * v.zoom, y: -p.y * v.zoom }));
  }, [focusId, byId]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2 + view.x, h / 2 + view.y);
    ctx.scale(view.zoom, view.zoom);

    const z = view.zoom;
    const searching = highlighted.size > 0;
    const focus = hover?.node.id ?? selectedId;
    // Search and the legend both narrow the picture; either one dims the rest.
    const narrowing = searching || litByGroup !== null;
    const isLit = (id: string) =>
      (searching && highlighted.has(id)) || (litByGroup !== null && litByGroup.has(id));

    // ── spokes from you ───────────────────────────────────────────────────
    //
    // Only to the people you actually deal with. Nine hundred lines to one
    // point is a starburst that hides everything underneath it, so the quiet
    // field is left unlined -- its distance already says what it is.
    const me = byId.get("me");
    if (me) {
      for (const p of placed) {
        if (p.kind !== "contact" || p.quiet) continue;
        const lit = focus === p.id || isLit(p.id);
        if (narrowing && !lit) continue;
        ctx.strokeStyle = lit
          ? "rgba(226,161,60,0.75)"
          : `rgba(233,188,110,${0.05 + p.strength * 0.16})`;
        ctx.lineWidth = (lit ? 1.6 : 1) / z;
        ctx.beginPath();
        ctx.moveTo(me.x, me.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }

    // ── nodes ─────────────────────────────────────────────────────────────
    for (const p of placed) {
      const isSel = p.id === selectedId;
      const isHov = p.id === hover?.node.id;
      const hit = isLit(p.id);
      const muted = narrowing && !hit && !isSel && !isHov && p.kind !== "owner";
      ctx.globalAlpha = muted ? 0.1 : 1;

      const r = isSel || isHov ? p.r * 1.18 : p.r;

      // A PLACE IS NOT A PERSON, so it is not a circle. The gym, the dentist
      // and the no-reply mailbox are real contacts worth keeping, but reading
      // a network means picking out the people, and a square does that without
      // needing the legend or a click.
      ctx.beginPath();
      if (p.entity === "place") {
        ctx.roundRect(p.x - r * 0.88, p.y - r * 0.88, r * 1.76, r * 1.76, r * 0.3);
      } else {
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      }
      if (p.kind === "owner") ctx.fillStyle = C.ink;
      else if (isSel || isHov) ctx.fillStyle = C.hot;
      else if (hit) ctx.fillStyle = C.hit;
      else if (p.quiet) ctx.fillStyle = C.quiet;
      else ctx.fillStyle = p.strength > 0.45 ? C.dotWarm : C.dot;
      ctx.fill();

      // GROUP COLORS ON THE RIM. One arc per group, so three memberships are
      // three arcs rather than a choice between them. The arcs are the whole
      // of what the picture claims about who somebody works with.
      const keys = p.groupKeys ?? [];
      if (keys.length > 0 && !muted) {
        const rr = r + 3.5 / z;
        const span = (Math.PI * 2) / keys.length;
        const gap = keys.length > 1 ? Math.min(0.22, span * 0.16) : 0;
        keys.forEach((key, i) => {
          const color = colors.get(key);
          if (!color) return;
          ctx.beginPath();
          ctx.arc(p.x, p.y, rr, i * span + gap / 2, (i + 1) * span - gap / 2);
          ctx.strokeStyle = color;
          ctx.globalAlpha = activeGroup && key !== activeGroup ? 0.35 : 1;
          ctx.lineWidth = (activeGroup === key ? 4 : 2.6) / z;
          ctx.stroke();
        });
        ctx.globalAlpha = muted ? 0.1 : 1;
      }

      if (isSel || isHov || hit) {
        ctx.beginPath();
        if (p.entity === "place") {
          ctx.roundRect(p.x - r * 0.88, p.y - r * 0.88, r * 1.76, r * 1.76, r * 0.3);
        } else {
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        }
        ctx.strokeStyle = "rgba(251,246,236,0.85)";
        ctx.lineWidth = 2 / z;
        ctx.stroke();
      }

      // INITIALS INSIDE THE DOT, once the dot is big enough on screen to hold
      // them. Below that they would be a smudge, and a smudge reads as dirt.
      if (p.kind === "contact" && r * z >= INITIALS_MIN_PX) {
        ctx.globalAlpha = muted ? 0.1 : 0.92;
        ctx.fillStyle = isSel || isHov ? C.bg : "rgba(26,14,8,0.82)";
        ctx.font = `600 ${r * 0.72}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.initials, p.x, p.y + r * 0.03);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
      }

      ctx.globalAlpha = 1;
    }

    // ── names, last and without piling up ─────────────────────────────────
    //
    // The previous version labelled the eighteen strongest ties unconditionally
    // and they landed on top of each other in a heap in the middle, which is
    // not eighteen names, it is one smear. Names are now laid out with a
    // collision check: each one claims a box, and a name whose box overlaps a
    // box already claimed is simply not drawn. Zooming in spreads the boxes
    // apart, so more names appear the further in you go -- which is the
    // behaviour somebody expects from a map.
    const claimed: Array<[number, number, number, number]> = [];
    const label = (p: PlacedNode, force: boolean) => {
      const isSel = p.id === selectedId;
      const isHov = p.id === hover?.node.id;
      const r = isSel || isHov ? p.r * 1.18 : p.r;
      const size = (p.kind === "owner" ? 15 : 11) / z;
      ctx.font = `${size}px "Iowan Old Style", Palatino, Georgia, serif`;
      const w = ctx.measureText(p.name).width;
      // UNDER THE DOT, CENTERED, NOT BESIDE IT.
      //
      // A name set to the right of a node reads as a separate object floating
      // in the field, and in a radial layout the space to the right is exactly
      // where the next node sits -- which is why twenty names piled into each
      // other in the middle. Centered underneath, a name belongs to its dot
      // and occupies the one direction the spiral does not crowd.
      const x = p.x - w / 2;
      const y = p.y + r + size * 1.05;
      const pad = 3 / z;
      const box: [number, number, number, number] = [
        x - pad,
        y - size - pad,
        x + w + pad,
        y + pad,
      ];
      if (!force) {
        for (const c of claimed) {
          if (box[0] < c[2] && box[2] > c[0] && box[1] < c[3] && box[3] > c[1]) return;
        }
      }
      claimed.push(box);
      // A hairline of ground behind the text, so a name crossing a spoke or a
      // dot stays readable instead of dissolving into it.
      ctx.fillStyle = "rgba(26,14,8,0.72)";
      ctx.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
      ctx.fillStyle = C.ink;
      ctx.fillText(p.name, x, y);
    };

    // Forced first, so they always win the space: you, whatever is under the
    // cursor, whatever is open.
    for (const p of placed) {
      if (p.kind === "owner" || p.id === selectedId || p.id === hover?.node.id) label(p, true);
    }
    // Then everything lit by a search or a chip, then the rest by strength.
    // A dot too small on screen to read does not compete for the space.
    const rest = placed
      .filter((p) => p.kind === "contact" && p.id !== selectedId && p.id !== hover?.node.id)
      .sort((a, b) => Number(isLit(b.id)) - Number(isLit(a.id)) || b.strength - a.strength);
    for (const p of rest) {
      if (narrowing && !isLit(p.id)) continue;
      if (p.r * z < LABEL_MIN_PX && !isLit(p.id)) continue;
      label(p, false);
    }

    ctx.restore();
  }, [placed, byId, colors, activeGroup, litByGroup, selectedId, highlighted, hover, view]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  const toWorld = (ev: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left - rect.width / 2 - view.x) / view.zoom,
      y: (ev.clientY - rect.top - rect.height / 2 - view.y) / view.zoom,
    };
  };

  const nearest = (wx: number, wy: number): PlacedNode | null => {
    let best: PlacedNode | null = null;
    let bestD = Infinity;
    for (const p of placed) {
      const d = Math.hypot(p.x - wx, p.y - wy);
      // Generous but bounded: the target is the dot, not the whole canvas.
      if (d < Math.max(p.r + 6, 14 / view.zoom) && d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        style={{ cursor: drag.current?.moved ? "grabbing" : hover ? "pointer" : "grab" }}
        aria-label="Your network"
        onMouseDown={(ev) => {
          drag.current = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y, moved: false };
        }}
        onMouseUp={(ev) => {
          const d = drag.current;
          drag.current = null;
          if (d?.moved) return; // a pan is not a click
          const { x, y } = toWorld(ev);
          const hit = nearest(x, y);
          onSelect(hit && hit.kind === "contact" ? hit.id : null);
        }}
        onMouseMove={(ev) => {
          const d = drag.current;
          if (d) {
            if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 3) d.moved = true;
            if (d.moved) {
              setView((v) => ({ ...v, x: d.vx + (ev.clientX - d.x), y: d.vy + (ev.clientY - d.y) }));
              setHover(null);
            }
            return;
          }
          const { x, y } = toWorld(ev);
          const hit = nearest(x, y);
          const rect = canvasRef.current!.getBoundingClientRect();
          setHover(hit ? { node: hit, sx: ev.clientX - rect.left, sy: ev.clientY - rect.top } : null);
        }}
        onMouseLeave={() => {
          drag.current = null;
          setHover(null);
        }}
        onWheel={(ev) => {
          // Zoom toward the cursor, so you can aim at a part of the field and
          // dive into it rather than zooming the center and hunting again.
          const rect = canvasRef.current!.getBoundingClientRect();
          const mx = ev.clientX - rect.left - rect.width / 2;
          const my = ev.clientY - rect.top - rect.height / 2;
          setView((v) => {
            const next = Math.max(0.04, Math.min(6, v.zoom * (ev.deltaY < 0 ? 1.13 : 1 / 1.13)));
            const k = next / v.zoom;
            return { zoom: next, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k };
          });
        }}
      />

      {hover ? (
        <div
          className="pointer-events-none absolute z-20 rounded-xl px-3 py-2"
          style={{
            left: Math.min(hover.sx + 16, (canvasRef.current?.clientWidth ?? 0) - 250),
            top: hover.sy + 16,
            maxWidth: 240,
            background: "rgba(26,14,8,0.96)",
            border: "1px solid var(--hair)",
            color: "var(--ink)",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 500 }}>{hover.node.name}</div>
          {hover.node.kind === "contact" ? (
            <>
              {hover.node.title || hover.node.company ? (
                <div style={{ color: C.dim, fontSize: 12, marginTop: 1 }}>
                  {[hover.node.title, hover.node.company].filter(Boolean).join(" · ")}
                </div>
              ) : null}
              <div style={{ color: C.hit, fontSize: 12, marginTop: 3 }}>
                {sinceLabel(hover.node.lastAt, hover.node.lastChannel) ?? "no contact recorded"}
                {hover.node.count90d ? ` · ${hover.node.count90d} in 90d` : ""}
              </div>
              {/* WHAT THIS DOT STANDS FOR, when it stands for two cards. A
                  silent merge is indistinguishable from a lost contact. */}
              {(hover.node.aliases ?? []).length > 0 ? (
                <div style={{ color: C.dim, fontSize: 12, marginTop: 3 }}>
                  also filed as {(hover.node.aliases ?? []).join(", ")}
                </div>
              ) : null}
              {(hover.node.origins ?? []).length > 0 ? (
                <div style={{ color: C.dim, fontSize: 11, marginTop: 3 }}>
                  from {(hover.node.origins ?? []).join(" + ")}
                </div>
              ) : null}
              {(hover.node.groupKeys ?? []).length > 0 ? (
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  {(hover.node.groupKeys ?? []).map((k) => (
                    <span key={k} style={{ color: colors.get(k) ?? C.dim, marginRight: 8 }}>
                      {labelOf.get(k) ?? k}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div style={{ color: C.dim, fontSize: 12 }}>everyone here is connected to you</div>
          )}
        </div>
      ) : null}

      <div
        className="pointer-events-none absolute bottom-24 right-6 text-right text-xs"
        style={{ color: C.dim, lineHeight: 1.8 }}
      >
        <div>closer to you = more recent contact</div>
        <div>the outer field is people you never talk to</div>
        <div>color on a rim is a group in the key</div>
        <div>zoom in for initials and names</div>
        <div>scroll to zoom · drag to pan</div>
      </div>
    </div>
  );
}
