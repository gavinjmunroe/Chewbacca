"use client";

/**
 * YOU IN THE MIDDLE, AND EVERYONE ELSE AT THE DISTANCE YOU ACTUALLY KEEP
 * THEM.
 *
 * POSITION IS MEANING, NOT DECORATION. Distance from the centre is how warm
 * the relationship is; angle is the firm, so everyone at one company sits in
 * the same direction and a firm you know six people at is a visible wedge.
 * Somebody who has never seen this points at the inner ring and says "those
 * are the real ones", and they are right.
 *
 * WHY THE FIRST VERSION DREW A CLUMP IN THE MIDDLE OF A HUGE WHITE BOX, which
 * is the whole reason this file was rewritten. Radius was a function of the
 * raw strength VALUE: `sqrt(1 - strength)`. That is only a spread if strength
 * is spread. Real scores are not -- they bunch, hard, at whatever end the
 * ledger's formula favours -- so forty people landed inside the same thin
 * band, on top of each other, with two thirds of the canvas empty.
 *
 * RADIUS IS RANK NOW, not score. Sort everybody by warmth and place the Nth
 * at sqrt(N/total) of the way out. The ORDER is identical -- warmer is still
 * closer, which is the only claim the picture makes -- and the spread is
 * guaranteed by construction whatever the scores look like. A graph cannot
 * bunch when position is a rank.
 *
 * THE NAME IS INSIDE THE NODE, so the node is a pill sized to the name rather
 * than a circle with a caption hanging under it. Captions under dots are what
 * collide: the dots can be comfortably apart while two labels sit on top of
 * each other and neither is readable. If the label IS the node, separating
 * the nodes separates the labels, and the overlap problem stops existing.
 *
 * AND THEN THEY ARE PUSHED APART UNTIL NOTHING TOUCHES. Any analytic layout
 * will collide somewhere -- two firms of one person each, adjacent angles,
 * same rank. A relaxation pass afterwards settles it: overlapping pills push
 * each other away, a weak spring pulls each back toward its own ring, and the
 * ring wins the argument on average, so warmth survives and overlap does not.
 *
 * LINES TO THE CENTRE, NOT BETWEEN DOTS. A line here means "you know this
 * person", which the ledger knows. A line between two contacts would mean
 * "these two know each other", which it does not -- and drawing a
 * relationship nobody has evidence for is the one thing this must never do.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Minus, Network as NetworkIcon, Plus } from "lucide-react";
import { Empty, Panel } from "@/components/ui";
import { listPeople, type PersonLink, type PersonRow } from "@/lib/memory";
import { getMe, tokenNow } from "@/lib/amber";

type Dot = {
  id: string;
  name: string;
  firm: string | null;
  strength: number;
  touches: number;
  lastAt: string | null;
  internal: boolean;
  /** Centre of the pill. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Weight dot radius and measured label width, so the pill can be laid out
   *  from its parts rather than centred by approximation. */
  /** The circle's radius. */
  r: number;
  /** The name, split over one or two lines to fit inside it. */
  lines: string[];
  /** The ring it belongs on, kept so the relaxation can pull it back. */
  homeX: number;
  homeY: number;
};

/** Days since, or null when never. */
function daysSince(iso: string | null) {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return Number.isFinite(d) ? d : null;
}

/**
 * How wide this name will actually be.
 *
 * MEASURED, NOT GUESSED, because the pill has to contain the text and an
 * estimate that is 10% short clips every long name. Canvas measurement is
 * exact and costs one call per name; the character-count fallback is only for
 * the server pass, where nothing is painted anyway.
 */
function makeMeasurer() {
  let ctx: CanvasRenderingContext2D | null = null;
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    ctx = c.getContext("2d");
    /*
     * THE SAME FACE THE LABELS ARE DRAWN IN, or the measurement is of a
     * different typeface than the one on screen and every pill is the wrong
     * width by a few percent -- which shows up as names sitting off-centre
     * in their pill, the exact fault this measurement exists to prevent.
     */
    if (ctx) {
      ctx.font =
        '500 15.5px Optima, "Avenir Next", "Gill Sans", "Gill Sans MT", "Segoe UI", ui-sans-serif, sans-serif';
    }
  }
  return (text: string) => (ctx ? ctx.measureText(text).width : text.length * 8.6);
}

/** First name plus a surname initial, which is what fits and what people read. */
/**
 * A NAME ON UP TO TWO LINES, so a circle can hold it without becoming an
 * egg. One long word stays one line and the circle grows for it; two words
 * stack, which is what makes "Brenda Flores-Reyes" fit in a disc roughly the
 * size of the one holding "Jonah".
 */
function nameLines(full: string): string[] {
  const name = String(full ?? "").trim();
  if (!name) return ["Unknown"];
  const parts = name.split(/\s+/);
  if (parts.length === 1) return [parts[0].slice(0, 16)];
  if (parts.length === 2) return parts;
  /* First and last: a middle name is not what anybody is called. */
  return [parts[0], parts[parts.length - 1]];
}

function shortName(full: string) {
  const name = String(full ?? "").trim();
  if (!name) return "Unknown";
  if (name.length <= 24) return name;
  const parts = name.split(/\s+/);
  if (parts.length === 1) return `${name.slice(0, 19)}…`;
  const first = parts[0];
  const last = parts[parts.length - 1];
  const joined = `${first} ${last}`;
  if (joined.length <= 24) return joined;
  return `${first} ${last[0]}.`;
}

export default function RelationshipOrbit({
  meName,
  onOpen,
  /**
   * THE SET TO DRAW, WHEN SOMEBODY ELSE OWNS IT.
   *
   * The orbit used to fetch its own people, which was right while it was
   * the only thing on the screen. It is one of three views now, and a
   * search or a filter has to move all three together -- so the workspace
   * holds the roster and the filtering, and each view draws what it is
   * handed. Left out, it still loads its own, which keeps every other
   * caller working.
   */
  people: given,
  selectedId,
  links,
  onConnect,
}: {
  /** Whose network this is. The centre says their name, not "You". */
  meName?: string | null;
  onOpen?: (personId: string) => void;
  people?: PersonRow[];
  selectedId?: string | null;
  /**
   * CLAIMED CONNECTIONS BETWEEN TWO PEOPLE, as opposed to the solid ties
   * from the centre. Drawn dotted, because the two mean different things:
   * a solid line is a relationship the data measured, a dotted one is
   * something somebody said.
   */
  links?: PersonLink[];
  onConnect?: (fromId: string, toId: string) => void;
}) {
  /*
   * DRAWING A TIE ON THE CANVAS.
   *
   * Connect, then click two people. The first click arms the second, a line
   * follows the pointer in between so it is obvious what is being drawn, and
   * the second click opens the box that asks what the connection IS -- a
   * line with no sentence on it is a shape, not a fact.
   */
  const [linking, setLinking] = useState(false);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [fetched, setFetched] = useState<PersonRow[] | null>(null);
  const people = given ?? fetched;
  /*
   * THE CENTRE DOES NOT SAY "YOU" FIRST AND YOUR NAME SECOND.
   *
   * The name is fetched after mount, so every open flashed the placeholder
   * and then swapped it -- a wobble on the one element that never moves. It
   * is remembered across opens, so after the first time there is nothing to
   * wait for; the placeholder is only ever seen by somebody who has not
   * loaded this screen before.
   */
  const [myName, setMyName] = useState<string | null>(() => {
    if (meName) return meName;
    try {
      return sessionStorage.getItem("amber.myFirstName");
    } catch {
      return null;
    }
  });
  const [hover, setHover] = useState<Dot | null>(null);
  /* Dimming by firm moved to the workspace's pills, which filter all three
     views at once rather than only this one. */
  const focusFirm: string | null = null;
  const wrap = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 1200, h: 760 });

  /*
   * PAN AND ZOOM, BECAUSE THE CANVAS IS NOT THE WINDOW.
   *
   * Twenty-two people fit on a screen only by squeezing them until the
   * labels touch; two hundred do not fit at all. The layout now spreads
   * people over more room than is visible and the view moves over it --
   * drag to pan, wheel or pinch to zoom, and a button to fit everything
   * back on screen. The transform is on one group, so nothing in the layout
   * has to know about it.
   */
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const dragging = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  useEffect(() => {
    if (given) return;
    let alive = true;
    /*
     * EVERYONE, inside the company and out, in one picture. The edges that
     * matter are the ones that cross -- a colleague who knows somebody at
     * the firm you are chasing is the whole product.
     */
    Promise.all([
      listPeople({ scope: "external" }).catch(() => [] as PersonRow[]),
      listPeople({ scope: "internal" }).catch(() => [] as PersonRow[]),
    ])
      .then(([ext, int]) => {
        if (!alive) return;
        const seen = new Set<string>();
        setFetched(
          [...int, ...ext].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true))),
        );
      })
      .catch(() => alive && setFetched([]));
    return () => {
      alive = false;
    };
  }, [given]);

  /*
   * THE CENTRE IS A PERSON, AND IT SHOULD SAY SO. "You" is what a diagram in
   * a slide deck says. This is somebody's own network and their own name
   * belongs on it -- and it is already on the account, so there is nothing to
   * ask for.
   */
  useEffect(() => {
    if (meName) return;
    const token = tokenNow();
    if (!token) return;
    let alive = true;
    getMe(token)
      .then((r) => {
        if (!alive) return;
        const n = r.profile?.displayName ?? r.displayName ?? r.profile?.fullName ?? r.fullName;
        const first = String(n ?? "").trim().split(/\s+/)[0];
        if (first) {
          setMyName(first);
          try {
            sessionStorage.setItem("amber.myFirstName", first);
          } catch {
            /* Private mode; it just refetches next time. */
          }
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [meName]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    /*
     * ROUNDED TO 24px, so dragging a window edge does not re-run the whole
     * layout once per pixel. The picture is the same at 1201px as at 1200,
     * and the arithmetic behind it is not free.
     */
    const ro = new ResizeObserver(() => {
      const w = Math.round((el.clientWidth || 1200) / 24) * 24;
      const h = Math.round((el.clientHeight || 760) / 24) * 24;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [people]);

  const { dots, firms } = useMemo(() => {
    const rows = people ?? [];
    if (rows.length === 0) return { dots: [] as Dot[], firms: [] as string[] };

    const measure = makeMeasurer();
    const cx = size.w / 2;
    const cy = size.h / 2;

    /*
     * RINGS THAT HOLD WHAT FITS, WHICH IS THE WHOLE LAYOUT.
     *
     * WHY THE OLD ONE LOOKED LIKE A CLUMP. Every node got a radius from its
     * warmth rank and an angle from its firm, and then a relaxation pass
     * pushed apart whatever collided. With labels this wide that is nearly
     * everything: fourteen pills averaging 300px want 4,200px of
     * circumference, and the ring they were assigned to had 1,400. So the
     * relaxation spent all its effort just separating them, the spring
     * dragged them back toward the same radius, and they settled into one
     * crowded band with the edges of the canvas empty. The picture was a
     * fight between two rules, and the fight showed.
     *
     * SO THE RINGS ARE SIZED TO THEIR CONTENTS INSTEAD. Walk out from the
     * middle; each ring takes people in warmth order until their widths use
     * up its circumference, then the next ring starts. A ring never holds
     * more than fits, so nothing has to be shoved anywhere -- and the outer
     * rings are longer, so they hold more, which is exactly the shape a
     * network has.
     *
     * WARMTH STILL READS OUTWARD: the warmest people fill the first ring,
     * the next warmest the second. The claim the picture makes is unchanged;
     * only the arithmetic that places them is.
     */
    /*
     * THE HUB'S REAL SIZE, KNOWN HERE.
     *
     * The layout kept everyone clear of a 46px hub while the hub was drawn
     * at up to 62, so with a longer name the nearest node sat ON it. The
     * number is computed once and both the clearance and the circle use it.
     */
    const centreLabel = (myName ?? "You").trim() || "You";
    const hub = Math.max(52, Math.min(74, centreLabel.length * 4.6 + 30));
    /*
     * THE WORLD IS LARGER THAN THE VIEWPORT.
     *
     * Everything used to be squeezed inside the visible rectangle, so the
     * only way to fit more people was to put them closer together until the
     * names touched -- which is what kept happening. The layout now spreads
     * over a canvas that grows with the roster, and the view pans and zooms
     * over it. Room is no longer a fixed budget to ration.
     */
    /* Discs are much larger than the old pills, so the world grows sooner. */
    const spread = 1.25 + Math.min(1.6, Math.max(0, (rows.length - 6) / 14));
    const rimX = Math.max(260, (size.w / 2 - 40) * spread);
    const rimY = Math.max(190, (size.h / 2 - 36) * spread);

    /* Warmest first. This is the order the rings are filled in. */
    const warm = [...rows].sort(
      (a, b) => (Number(b.strength) || 0) - (Number(a.strength) || 0),
    );

    /*
     * A PILL SIZED TO WHAT IS IN IT.
     *
     * Width used to be a guess -- the label plus a flat 52 -- and the text
     * was then drawn centred on a point shoved right by half the height to
     * dodge the weight dot. Every name therefore sat slightly off centre,
     * and the longer the name the more it showed. The pill is now built the
     * other way round: measure the dot, the gap and the text, add equal
     * padding to both ends, and place each piece at a known offset. Nothing
     * is centred by approximation.
     */
    /*
     * ROUNDER AND LARGER. The pill was sized to fit the text and no more, so
     * it read as a label with a border rather than an object in a drawing.
     * More padding at both ends and more height makes the rx of h/2 describe
     * a real capsule, and gives the warmth dot room to be a size rather than
     * a speck.
     */
    const PAD = 18;

    const sized = warm.map((p) => {
      const label = shortName(p.display_name);
      const touches = Number(p.interactions ?? 0) || 0;
      /*
       * The circle carries the weight; the plate just holds the name. The
       * plate's height is fixed, so a row of people reads as one line of
       * labels with circles of different sizes on it rather than a stack of
       * differently shaped blobs.
       */
      /*
       * THE CIRCLE HOLDS THE NAME.
       *
       * Everything else was a compromise: a capsule stretched by the name,
       * or a dot with a label hanging off it. A disc with the name inside
       * is one object -- you click the thing you read -- and the size still
       * means contact, because the floor grows with it. The widest line
       * decides the minimum; the busiest people push past it.
       */
      const lines = nameLines(p.display_name);
      const widest = Math.max(...lines.map((l) => measure(l)));
      const fromText = widest / 2 + 16;
      const fromTouches = 30 + Math.min(20, Math.sqrt(touches) * 3);
      const r = Math.max(34, fromText, fromTouches);
      return {
        p,
        label,
        lines,
        r,
        /* A circle is square to the layout: width and height are both 2r. */
        w: r * 2,
        h: r * 2,
        touches,
      };
    });

    /*
     * Fill rings by capacity. The radius used for capacity is the SHORTER
     * of the two semi-axes, so a ring that fits on a wide screen also fits
     * when the panel is narrow and nothing has to re-flow on resize.
     */
    const GAP = 26;
    const rings: (typeof sized)[] = [];
    {
      const minR = hub + 150;
      const maxR = Math.min(rimX, rimY);
      let i = 0;
      let ring = 0;
      while (i < sized.length) {
        /*
         * SPACE THE RINGS EVENLY OVER THE DEPTH THEY WILL ACTUALLY USE.
         * Stepping in thirds crowded everything onto the first two rings and
         * left the outside empty whenever there were more than a handful of
         * people, which is what made the spread look lopsided.
         */
        const t = ring === 0 ? 0 : Math.min(1, ring / 4);
        const r = minR + (maxR - minR) * t;
        const capacity = 2 * Math.PI * r * 0.88;
        const row: typeof sized = [];
        let used = 0;
        while (i < sized.length) {
          const need = sized[i].r * 2 + GAP;
          if (row.length > 0 && used + need > capacity) break;
          row.push(sized[i]);
          used += need;
          i += 1;
        }
        rings.push(row);
        ring += 1;
      }
    }

    const out: Dot[] = [];
    rings.forEach((row, ri) => {
      /*
       * The rings spread across the available depth rather than sitting at
       * whatever radius the capacity walk happened to use, so two rings use
       * the whole canvas instead of hugging the middle.
       */
      const depth = rings.length === 1 ? 0.62 : ri / (rings.length - 1);
      const fx = hub + 170 + (rimX - hub - 170) * depth;
      const fy = hub + 150 + (rimY - hub - 150) * depth;

      /* Odd rings are rotated half a slot so neighbours do not line up. */
      const offset = ri % 2 === 0 ? 0 : Math.PI / row.length;

      row.forEach((n, i) => {
        const angle = (i / row.length) * Math.PI * 2 + offset - Math.PI / 2;
        const firm = (n.p.account_name ?? n.p.company ?? "").trim();
        const x = cx + Math.cos(angle) * fx;
        const y = cy + Math.sin(angle) * fy;
        out.push({
          id: n.p.id,
          name: n.label,
          firm: firm || null,
          strength: Math.max(0, Math.min(1, Number(n.p.strength) || 0)),
          touches: n.touches,
          lastAt: n.p.last_at ?? null,
          internal: n.p.internal === true,
          x,
          y,
          w: n.w,
          h: n.h,
          r: n.r,
          lines: n.lines,
          homeX: x,
          homeY: y,
        });
      });
    });

    /*
     * A SHORT TIDY-UP, NOT A SIMULATION. The rings already fit, so this only
     * has to fix the few places where two rings pass close to each other.
     * The spring is weak and the pass count is small: a relaxation doing
     * real work here would mean the rings were wrong.
     */
    /* More passes, because there is now somewhere for a push to land. */
    for (let pass = 0; pass < 140; pass += 1) {
      for (let i = 0; i < out.length; i += 1) {
        for (let j = i + 1; j < out.length; j += 1) {
          const a = out[i];
          const b = out[j];
          /*
           * CIRCLES SEPARATE ON DISTANCE, NOT ON BOXES.
           *
           * The box test pushed on one axis at a time, so two nodes sitting
           * diagonally counted as clear while their corners plainly
           * overlapped -- which is why they kept touching however much
           * padding went into it. Two discs are apart when the distance
           * between their centres exceeds the sum of their radii. That is
           * exact, it is one comparison, and it has no axes to choose
           * between.
           */
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          const need = a.r + b.r + 34;
          if (dist >= need) continue;
          const push = (need - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
        }
      }
      for (const d of out) {
        d.x += (d.homeX - d.x) * 0.06;
        d.y += (d.homeY - d.y) * 0.06;
        const dx = d.x - cx;
        const dy = d.y - cy;
        const dist = Math.hypot(dx, dy) || 1;
        const min = hub + d.r + 48;
        if (dist < min) {
          d.x = cx + (dx / dist) * min;
          d.y = cy + (dy / dist) * min;
        }
        /*
         * Clamped to the WORLD, not the window. Clamping to the viewport was
         * what forced nodes back on top of each other the moment the
         * relaxation pushed one off the edge: it had nowhere to go.
         */
        d.x = Math.min(Math.max(d.x, cx - rimX - 160), cx + rimX + 160);
        d.y = Math.min(Math.max(d.y, cy - rimY - 160), cy + rimY + 160);
      }
    }

    const firmNames = [
      ...new Set(out.map((d) => d.firm).filter((f): f is string => Boolean(f))),
    ];

    return { dots: out, firms: firmNames };
  }, [people, size, myName]);

  if (people === null) {
    return (
      <Panel className="grid h-[76vh] min-h-[640px] place-items-center">
        <span className="flex items-center gap-2 text-[13px] text-[var(--ds-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Drawing your network…
        </span>
      </Panel>
    );
  }

  if (dots.length === 0) {
    return (
      <Empty
        icon={<NetworkIcon className="h-5 w-5" />}
        title="Nothing to draw yet"
        note="Connect a calendar and this fills with everybody you have met. Nobody types anything in."
      />
    );
  }

  const cx = size.w / 2;
  const cy = size.h / 2;
  const dim = (d: Dot) => Boolean(focusFirm && d.firm !== focusFirm);
  const centre = (myName ?? "You").trim() || "You";
  /*
   * A SMALLER CENTRE. It was a dinner plate in the middle of the picture,
   * taking the space the network needed and implying the person matters
   * more than the shape of what they have. It is a point of view, not the
   * subject.
   */
  /* The same number the layout kept everybody clear of. One source. */
  const hubR = Math.max(52, Math.min(74, centre.length * 4.6 + 30));

  return (
    <div className="space-y-2.5">
      {/*
        The ref lives on a plain div inside Panel: Panel is not a forwardRef
        and adding one to it would touch every other screen tonight.
      */}
      {/*
        A WARM SHEET, BARELY THERE. The graph is drawn in amber on white and
        sat in the same flat panel as a table of text, so it read as a
        document with lines on it. A tint a few percent deep and a border to
        match says "this is a surface" without becoming a colour anybody has
        to look at.
      */}
      <Panel
        className="relative h-[76vh] min-h-[640px] overflow-hidden p-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(232,162,79,0.045) 0%, rgba(232,162,79,0.02) 100%)",
          borderColor: "rgba(232,162,79,0.28)",
        }}
      >
        {/*
          THE CONTROLS SIT ON THE CANVAS, not above it, because they act on
          what is under them. Fit is the one that matters: after any amount
          of dragging there is one button that puts everything back on
          screen, so nobody can get lost in an empty quadrant.
        */}
        {/*
          AND BELOW THE PAGE HEADER. These live inside the graph panel, so
          when the panel scrolls up under the sticky header they have to go
          with it. At the same z-index they did not: the later element won
          and the strip hovered over the filters like a loose button.
        */}
        <div className="absolute right-3 top-3 z-[5] flex items-center gap-1 rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] p-1 shadow-[var(--ds-shadow-sm)]">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setView((v) => ({ ...v, k: Math.max(0.35, v.k * 0.85) }))}
            className="grid h-7 w-7 place-items-center rounded-lg text-[var(--ds-muted)] transition hover:bg-[var(--ds-hover)] hover:text-[var(--ds-ink)]"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setLinking((on) => !on);
              setLinkFrom(null);
            }}
            title="Draw a connection between two people"
            className={`rounded-lg px-2 py-1 text-[11.5px] transition ${
              linking
                ? "bg-[var(--ds-accent)] text-white"
                : "text-[var(--ds-muted)] hover:bg-[var(--ds-hover)] hover:text-[var(--ds-ink)]"
            }`}
          >
            {linking ? (linkFrom ? "Pick the second" : "Pick the first") : "Connect"}
          </button>
          <button
            type="button"
            onClick={() => setView({ k: 1, x: 0, y: 0 })}
            className="rounded-lg px-2 py-1 text-[11.5px] text-[var(--ds-muted)] transition hover:bg-[var(--ds-hover)] hover:text-[var(--ds-ink)]"
          >
            Fit
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => setView((v) => ({ ...v, k: Math.min(2.6, v.k * 1.18) }))}
            className="grid h-7 w-7 place-items-center rounded-lg text-[var(--ds-muted)] transition hover:bg-[var(--ds-hover)] hover:text-[var(--ds-ink)]"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div ref={wrap} className="absolute inset-0">
          {/*
            THE TYPEFACE IS SET HERE, NOT INHERITED.
            
            The page's base family is a serif display face, and SVG text
            picked it up -- so every name in the graph was set in a different
            typeface from every name everywhere else in the product, at a
            size chosen for body copy. Naming the interface stack on the svg
            itself makes the labels match the rest of the app, which is the
            whole of what made this look wrong.
          */}
          <svg
            width={size.w}
            height={size.h}
            className="block"
            style={{
              /*
               * A HUMANIST FACE, NOT THE INTERFACE GRID.
               *
               * The labels were set in the same neutral UI stack as every
               * button on the screen, which is correct for a toolbar and
               * flat for a drawing -- a graph of people read like a table of
               * values. These faces have real stroke modulation and open
               * letterforms, so the names look written rather than
               * rendered, without tipping into a script nobody can scan.
               */
              fontFamily:
                '"Optima", "Avenir Next", "Gill Sans", "Gill Sans MT", "Segoe UI", ui-sans-serif, sans-serif',
              cursor: "grab",
              touchAction: "none",
            }}
            onWheel={(e) => {
              /*
               * A SCROLL IS A SCROLL. ONLY A PINCH IS A ZOOM.
               *
               * Hijacking the wheel meant that scrolling the page with the
               * pointer anywhere over the graph zoomed it instead -- so
               * reading the screen became impossible without first steering
               * around a region that eats the gesture. Browsers report a
               * trackpad pinch as a wheel event with ctrlKey set, which is
               * exactly the two-finger gesture asked for; a plain wheel is
               * left alone and the page scrolls as it should.
               *
               * The step is also much smaller. It was 12% per notch, and a
               * trackpad sends notches in bursts, so one flick crossed the
               * whole range.
               */
              if (!e.ctrlKey && !e.metaKey) return;
              e.preventDefault();
              const box = wrap.current?.getBoundingClientRect();
              const px = e.clientX - (box?.left ?? 0);
              const py = e.clientY - (box?.top ?? 0);
              setView((v) => {
                const step = Math.exp(-e.deltaY * 0.0022);
                const k = Math.min(2.6, Math.max(0.35, v.k * step));
                const ratio = k / v.k;
                return { k, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio };
              });
            }}
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              dragging.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
            }}
            onPointerMove={(e) => {
              if (linking && linkFrom) {
                const box = wrap.current?.getBoundingClientRect();
                /* Back out of the transform, so the band tracks the cursor. */
                setPointer({
                  x: (e.clientX - (box?.left ?? 0) - view.x) / view.k,
                  y: (e.clientY - (box?.top ?? 0) - view.y) / view.k,
                });
              }
              const d = dragging.current;
              if (!d) return;
              setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) }));
            }}
            onPointerUp={() => {
              dragging.current = null;
            }}
            onPointerLeave={() => {
              dragging.current = null;
            }}
          >
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {/*
              THE RINGS ARE THE SCALE. Without them the distances are relative
              and unreadable; with them you can see that somebody is in the
              "every week" band rather than merely "quite close to the middle".
            */}
            {[0.45, 0.75, 1].map((f) => (
              <ellipse
                key={f}
                cx={cx}
                cy={cy}
                rx={Math.max(260, size.w / 2 - 40) * f}
                ry={Math.max(190, size.h / 2 - 36) * f}
                fill="none"
                stroke="var(--ds-line)"
                strokeWidth={1}
                strokeDasharray="2 6"
              />
            ))}

            {/*
              EVERY LINE MEANS ONE THING: you know this person. They bow
              rather than run straight, alternating which way, because a
              dozen straight spokes to one point is a sunburst -- the lines
              converge into a solid wedge near the middle and read as a
              diagram of a wheel instead of a drawing of a network. A slight
              curve keeps them apart where they are closest together, and
              each one starts at the hub's edge rather than its centre so
              nothing is drawn underneath the name.
            */}
            {dots.map((d, i) => {
              const dx = d.x - cx;
              const dy = d.y - cy;
              const len = Math.hypot(dx, dy) || 1;
              /* Begin at the rim of the hub, end at the rim of the pill. */
              const x1 = cx + (dx / len) * (hubR + 4);
              const y1 = cy + (dy / len) * (hubR + 4);
              /*
               * STOP ON THE PILL'S EDGE, NOT ON A CIRCLE AROUND IT.
               *
               * Backing off by half the WIDTH treats every node as though it
               * were as tall as it is wide, so a line coming in from above
               * stopped a pill-and-a-half short and the graph read as a set
               * of floating labels near some stray strokes. The pill is a
               * rectangle: the distance to its edge along this direction is
               * whichever of the two sides the ray leaves through.
               */
              /* A circle's edge is its radius in every direction. */
              const stop = Math.max(hubR + 10, len - d.r - 2);
              const x2 = cx + (dx / len) * stop;
              const y2 = cy + (dy / len) * stop;
              /* Bow perpendicular to the run, alternating, scaled to length. */
              const bow = (i % 2 === 0 ? 1 : -1) * Math.min(42, len * 0.13);
              const mx = (x1 + x2) / 2 - (dy / len) * bow;
              const my = (y1 + y2) / 2 + (dx / len) * bow;
              return (
                <path
                  key={`l-${d.id}`}
                  d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`}
                  fill="none"
                  stroke={d.internal ? "var(--ds-accent)" : "var(--ds-line-strong, #d8d2c8)"}
                  strokeWidth={0.8 + d.strength * 2.2}
                  strokeLinecap="round"
                  opacity={dim(d) ? 0.05 : 0.16 + d.strength * 0.4}
                />
              );
            })}

            {/*
              THE TIES BETWEEN PEOPLE, DRAWN DIFFERENTLY ON PURPOSE.
              
              A solid spoke from the centre is a relationship the data
              measured: this many meetings, this recently. A dotted tie
              between two others is something somebody SAID -- "Sagar
              introduced me to Jonah". Those are different kinds of claim and
              drawing them the same way would quietly present an assertion as
              a measurement. An introduction carries an arrow because the
              direction is the content; the rest do not.
            */}
            <defs>
              <marker
                id="tieArrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L8 4 L0 8 z" fill="#b07d3a" opacity="0.6" />
              </marker>
            </defs>
            {(links ?? []).map((l) => {
              const a = dots.find((d) => d.id === l.from_person);
              const b = dots.find((d) => d.id === l.to_person);
              if (!a || !b) return null;
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;

              /*
               * A TIE GOES AROUND WHATEVER IS IN THE WAY.
               *
               * The straight route between two people often passes through a
               * third, and a line that vanishes under somebody's name and
               * reappears on the other side reads as a line to THEM. So the
               * curve is bent until its midpoint clears everything: try the
               * two perpendicular directions at growing offsets and take the
               * first that is clear of every other pill and of the hub. If
               * nothing is clear -- a crowded middle -- the largest bend is
               * used, which at least makes the crossing obviously a crossing.
               */
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const len = Math.hypot(dx, dy) || 1;
              const nx = -dy / len;
              const ny = dx / len;

              const blocked = (px: number, py: number) => {
                if (Math.hypot(px - cx, py - cy) < hubR + 30) return true;
                return dots.some((d) => {
                  if (d.id === a.id || d.id === b.id) return false;
                  return (
                    Math.hypot(px - d.x, py - d.y) < d.r + 26
                  );
                });
              };

              let qx = mx;
              let qy = my;
              const offsets = [34, 64, 96, 132, 172, 216];
              let found = false;
              for (const off of offsets) {
                for (const sign of [1, -1]) {
                  const tx = mx + nx * off * sign;
                  const ty = my + ny * off * sign;
                  /* The curve's midpoint is halfway to the control point. */
                  const cxm = (a.x + 2 * tx + b.x) / 4;
                  const cym = (a.y + 2 * ty + b.y) / 4;
                  if (!blocked(cxm, cym)) {
                    qx = tx;
                    qy = ty;
                    found = true;
                    break;
                  }
                }
                if (found) break;
              }
              if (!found) {
                qx = mx + nx * 216;
                qy = my + ny * 216;
              }
              const pending = !l.accepted_at;
              return (
                <path
                  key={`tie-${l.id}`}
                  d={`M ${a.x} ${a.y} Q ${qx} ${qy} ${b.x} ${b.y}`}
                  fill="none"
                  stroke="#b07d3a"
                  strokeWidth={1.4}
                  strokeDasharray={pending ? "2 7" : "5 6"}
                  strokeLinecap="round"
                  opacity={pending ? 0.3 : 0.55}
                  markerEnd={l.kind === "introduced" ? "url(#tieArrow)" : undefined}
                >
                  <title>
                    {l.kind === "introduced"
                      ? `${l.from_name} introduced ${l.to_name}`
                      : `${l.from_name} and ${l.to_name}`}
                    {l.note ? ` — ${l.note}` : ""}
                  </title>
                </path>
              );
            })}

            {/* The line that follows the pointer while a tie is being drawn. */}
            {linking && linkFrom && pointer
              ? (() => {
                  const from = dots.find((d) => d.id === linkFrom);
                  if (!from) return null;
                  return (
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={pointer.x}
                      y2={pointer.y}
                      stroke="#b07d3a"
                      strokeWidth={1.6}
                      strokeDasharray="4 6"
                      opacity={0.7}
                    />
                  );
                })()
              : null}

            {dots.map((d) => {
              const quiet = (daysSince(d.lastAt) ?? 999) > 60;
              const tone = d.internal
                ? "var(--ds-accent)"
                : quiet
                  ? "var(--ds-line-strong, #d8d2c8)"
                  : "#e8a24f";
              return (
                <g
                  key={d.id}
                  onMouseEnter={() => setHover(d)}
                  onMouseLeave={() => setHover((h) => (h?.id === d.id ? null : h))}
                  onClick={() => {
                    if (!linking) {
                      onOpen?.(d.id);
                      return;
                    }
                    if (!linkFrom) {
                      setLinkFrom(d.id);
                      return;
                    }
                    if (linkFrom !== d.id) onConnect?.(linkFrom, d.id);
                    setLinkFrom(null);
                    setLinking(false);
                  }}
                  className="cursor-pointer"
                  opacity={dim(d) ? 0.2 : 1}
                >
                  {/*
                    THE PILL IS THE NODE AND THE NAME IS INSIDE IT. Nothing
                    hangs below a dot, so nothing can collide with anything
                    except another node -- which the relaxation already
                    forbids.
                  */}
                  {/*
                    ONE DISC, NAME INSIDE.
                    
                    The thing you read and the thing you click are the same
                    object. Size means contact: the floor is wide enough for
                    the longest line of the name, and somebody you deal with
                    constantly pushes past it.
                  */}
                  <circle
                    cx={d.x}
                    cy={d.y}
                    r={d.r}
                    fill={selectedId === d.id ? "var(--ds-ink)" : "var(--ds-card)"}
                    stroke={selectedId === d.id ? "var(--ds-ink)" : tone}
                    strokeWidth={selectedId === d.id ? 3 : 1.5 + d.strength * 2}
                  />
                  {/* A quiet wash inside, so warmth reads at a glance. */}
                  <circle
                    cx={d.x}
                    cy={d.y}
                    r={d.r - 1}
                    fill={tone}
                    opacity={selectedId === d.id ? 0 : 0.07 + d.strength * 0.16}
                  />
                  <text
                    x={d.x}
                    y={d.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="pointer-events-none select-none"
                    fill={selectedId === d.id ? "var(--ds-card)" : "var(--ds-ink)"}
                    fontSize={d.lines.length > 1 ? 14 : 15}
                    fontWeight="500"
                    letterSpacing="0.1"
                  >
                    {d.lines.map((line, i) => (
                      <tspan
                        key={line + i}
                        x={d.x}
                        dy={i === 0 ? (d.lines.length > 1 ? "-0.55em" : "0") : "1.15em"}
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              );
            })}

            {/* The person whose network this is. */}
            {/*
              THE CENTRE IS WARM, NOT A HOLE IN THE PAGE.
              
              A flat near-black disc on white is the heaviest thing a screen
              can show, and it sat in the middle of a drawing made of thin
              amber lines -- so the eye went to the one element carrying no
              information. It keeps the same weight relative to the nodes and
              stops shouting: a deep amber that belongs to the same palette,
              with a soft halo so it reads as a source rather than a blot.
            */}
            {/*
              THE CENTRE IS A RING, NOT A DISC.
              
              A filled circle in the middle is the heaviest mark on the page
              and it carries one word. Everything around it is drawn in thin
              amber on white, so the centre was the only solid object in the
              picture and the eye landed on it first and learned nothing.
              An outline with a soft glow says "this is where it all meets"
              without competing with the thing it is the centre OF.
            */}
            <defs>
              <radialGradient id="hubGlow">
                <stop offset="55%" stopColor="#e8a24f" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#e8a24f" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx={cx} cy={cy} r={hubR + 26} fill="url(#hubGlow)" />
            <circle
              cx={cx}
              cy={cy}
              r={hubR}
              fill="var(--ds-card)"
              stroke="#d08f3f"
              strokeWidth={2}
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--ds-ink)"
              fontSize={hubR > 62 ? 16 : 17}
              fontWeight="600"
              letterSpacing="0.2"
            >
              {centre}
            </text>
            </g>
          </svg>

          {hover ? (
            <div
              className="pointer-events-none absolute z-10 max-w-[240px] rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] px-3 py-2 shadow-[var(--ds-shadow-md,0_4px_16px_rgba(0,0,0,.1))]"
              style={{
                left: Math.min(Math.max(hover.x + 14, 8), size.w - 250),
                top: Math.min(Math.max(hover.y - 10, 8), size.h - 90),
              }}
            >
              <p className="text-[13px] font-semibold text-[var(--ds-ink)]">{hover.name}</p>
              {hover.firm ? (
                <p className="text-[12px] text-[var(--ds-muted)]">{hover.firm}</p>
              ) : null}
              <p className="mt-1 text-[11.5px] text-[var(--ds-faint)]">
                {hover.touches} {hover.touches === 1 ? "touch" : "touches"}
                {hover.lastAt
                  ? ` · last ${daysSince(hover.lastAt) === 0 ? "today" : `${daysSince(hover.lastAt)}d ago`}`
                  : " · never"}
              </p>
            </div>
          ) : null}

          <p className="pointer-events-none absolute bottom-3 left-4 text-[11px] text-[var(--ds-faint)]">
            Closer means warmer · bigger means more touches · grey has gone quiet
          </p>
        </div>
      </Panel>

    </div>
  );
}
