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
  // THE PALETTE, FOR A LIGHT GROUND.
  //
  // It was built for a near-black page: cream ink, dark dots, a label plate of
  // solid brown. Dropped straight onto white, a field of dark brown dots reads
  // as mud, and a name in a filled dark box reads as a sticker somebody put on
  // the picture. Both are inverted here. The dots are a soft amber that is
  // legible at six pixels and does not shout at six hundred of them; the ink
  // is the page's own ink; the label plate is the page's own ground.
  ink: "#0b111f",
  dim: "#8591a4",
  dot: "#f1c48a",
  dotWarm: "#e8a24f",
  quiet: "#e8e2d8",
  hot: "#e8840a",
  hit: "#fbb43c",
  bg: "#ffffff",
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


  /**
   * Frame the whole live field.
   *
   * Shared by the first paint and the "fit" button, so the two cannot drift
   * into two different ideas of what the whole thing is.
   */
  const fitView = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || placed.length === 0) return;
    // Framed on the live field rather than on all 966 contacts; see
    // liveExtentOf for why fitting everything makes every name unreadable.
    const extent = liveExtentOf(placed);
    const fit = Math.min(canvas.clientWidth, canvas.clientHeight) / 2 / (extent * 1.12);
    setView({ zoom: Math.max(0.04, Math.min(1.4, fit)), x: 0, y: 0 });
  }, [placed]);

  // Fit once, when the data first arrives. Never again -- re-fitting on every
  // data change would yank the view while somebody is reading it.
  useEffect(() => {
    if (fitted.current || placed.length === 0) return;
    if (!canvasRef.current) return;
    fitView();
    fitted.current = true;
  }, [placed, fitView]);

  /** Step the zoom about the centre of the canvas. What the buttons do. */
  const nudgeZoom = useCallback((factor: number) => {
    setView((v) => {
      const next = Math.max(0.04, Math.min(6, v.zoom * factor));
      const k = next / v.zoom;
      return { zoom: next, x: v.x * k, y: v.y * k };
    });
  }, []);

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
          : `rgba(168,94,5,${0.08 + p.strength * 0.22})`;
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
      /*
       * YOU ARE NOT A HOLE IN THE PAGE.
       *
       * The owner dot was drawn in C.ink, which was cream on the old dark
       * ground and became near-black when the palette inverted -- so the
       * centre of somebody's own network turned into a black circle with
       * their name under it. It is the one node that should read as warm and
       * as the source of everything else, so it takes the accent, and the
       * gradient below gives it the only dimension on the canvas.
       */
      if (p.kind === "owner") ctx.fillStyle = C.hot;
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
        ctx.strokeStyle = "rgba(11,17,31,0.55)";
        ctx.lineWidth = 2 / z;
        ctx.stroke();
      }

      // INITIALS INSIDE THE DOT, once the dot is big enough on screen to hold
      // them. Below that they would be a smudge, and a smudge reads as dirt.
      if (p.kind === "contact" && r * z >= INITIALS_MIN_PX) {
        ctx.globalAlpha = muted ? 0.1 : 0.92;
        ctx.fillStyle = isSel || isHov ? "#ffffff" : "rgba(11,17,31,0.62)";
        ctx.font = `600 ${r * 0.72}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.initials, p.x, p.y + r * 0.03);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
      }

      ctx.globalAlpha = 1;
    }

    /*
     * THE OWNER, DRAWN AGAIN ON TOP.
     *
     * A halo rather than a bigger dot: the centre of a radial layout already
     * has every spoke converging on it, so size adds nothing and a ring says
     * "this is the one you are looking out from" without competing with the
     * names around it.
     */
    {
      const me = placed.find((p) => p.kind === "owner");
      if (me) {
        const r = me.r;
        const glow = ctx.createRadialGradient(me.x, me.y, r * 0.2, me.x, me.y, r * 2.2);
        glow.addColorStop(0, "rgba(240,146,10,0.28)");
        glow.addColorStop(1, "rgba(240,146,10,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(me.x, me.y, r * 2.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(me.x, me.y, r, 0, Math.PI * 2);
        ctx.fillStyle = C.hot;
        ctx.fill();
        ctx.lineWidth = 2 / z;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.stroke();
      }
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
    const muted = (p: PlacedNode) =>
      !!activeGroup && !(p.groupKeys ?? []).includes(activeGroup) && p.kind !== "owner";
    const label = (p: PlacedNode, force: boolean) => {
      const isSel = p.id === selectedId;
      const isHov = p.id === hover?.node.id;
      const r = isSel || isHov ? p.r * 1.18 : p.r;
      const size = (p.kind === "owner" ? 15 : 11) / z;
      ctx.font = `${p.kind === "owner" ? 600 : 500} ${size}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
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
      /*
       * A HALO, NOT A PLATE.
       *
       * This used to fill the label's box with solid ground, which on a dark
       * page was invisible and on a light one is a grey rectangle stuck to the
       * picture -- six hundred of them, which is what the field of dark boxes
       * was. Stroking the text in the page's own colour underneath the fill
       * does the same job, keeping a name legible where it crosses a spoke,
       * and leaves nothing behind where it does not.
       */
      ctx.lineWidth = 3.5 / z;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(245,246,248,0.92)";
      ctx.strokeText(p.name, x, y);
      ctx.fillStyle = muted(p) ? C.dim : C.ink;
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
      {/*
        THE ZOOM CLUSTER.
        
        A canvas with no visible controls is a canvas somebody has to guess at,
        and the guess most people make -- scroll to zoom -- is now pan, so
        there has to be something to press. Bottom right, away from the search
        bar at bottom centre and clear of the groups panel on the right.
      */}
      <div className="absolute bottom-6 right-6 z-20 flex flex-col overflow-hidden rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] shadow-[var(--ds-shadow)]">
        <button
          onClick={() => nudgeZoom(1.25)}
          className="grid h-9 w-9 place-items-center text-[var(--ds-muted)] transition-colors hover:bg-[var(--ds-hover)] hover:text-[var(--ds-ink)]"
          aria-label="Zoom in"
          title="Zoom in"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <div className="h-px bg-[var(--ds-line)]" />
        <button
          onClick={() => nudgeZoom(1 / 1.25)}
          className="grid h-9 w-9 place-items-center text-[var(--ds-muted)] transition-colors hover:bg-[var(--ds-hover)] hover:text-[var(--ds-ink)]"
          aria-label="Zoom out"
          title="Zoom out"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 12h14" />
          </svg>
        </button>
        <div className="h-px bg-[var(--ds-line)]" />
        <button
          onClick={fitView}
          className="grid h-9 w-9 place-items-center text-[var(--ds-muted)] transition-colors hover:bg-[var(--ds-hover)] hover:text-[var(--ds-ink)]"
          aria-label="Fit the whole network"
          title="Fit everything"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
          </svg>
        </button>
      </div>

      {/* What the gestures are, said once, where somebody looking for them looks. */}
      <div className="pointer-events-none absolute bottom-7 right-[72px] z-10 hidden text-right text-[11px] leading-relaxed text-[var(--ds-dim)] xl:block">
        <div>scroll or drag to pan</div>
        <div>pinch to zoom</div>
      </div>

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
          /*
           * SCROLL PANS. PINCH ZOOMS. This is the map idiom, and it is here
           * because the previous behaviour -- every wheel event zooming by a
           * fixed 13% -- is fine with a mouse wheel that fires once per notch
           * and unusable on a trackpad that fires forty times per flick. Two
           * fingers on a trackpad sent the view from the whole network to one
           * dot before you could lift them.
           *
           * A browser reports a pinch as a wheel event with ctrlKey set, which
           * is how this tells the two apart without a gesture library.
           */
          const rect = canvasRef.current!.getBoundingClientRect();
          if (!ev.ctrlKey && !ev.metaKey) {
            setView((v) => ({ ...v, x: v.x - ev.deltaX, y: v.y - ev.deltaY }));
            setHover(null);
            return;
          }
          // Zoom toward the cursor, so you can aim at a part of the field and
          // dive into it rather than zooming the center and hunting again.
          // Proportional to how hard the gesture was, clamped per event so no
          // single frame can jump more than a tenth.
          const mx = ev.clientX - rect.left - rect.width / 2;
          const my = ev.clientY - rect.top - rect.height / 2;
          setView((v) => {
            const factor = Math.min(1.1, Math.max(0.9, Math.exp(-ev.deltaY * 0.0022)));
            const next = Math.max(0.04, Math.min(6, v.zoom * factor));
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
            border: "1px solid var(--ds-line)",
            color: "var(--ds-ink)",
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
