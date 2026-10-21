"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock } from "@/components/objects/Clock";
import {
  ObjectClip,
  preloadClip,
  type ClipSide,
} from "@/components/objects/ObjectClip";
import { Journal } from "@/components/join/Journal";
import styles from "@/components/objects/kitchen.module.css";
import {
  boundsOf,
  clipPathFor,
  coverView,
  lightFor,
  parseLight,
  pickCamera,
  zoomView,
  type Camera,
  type Light,
  type Pt,
} from "@/lib/fridge";
import { loadManifest, type Clip, type Manifest } from "@/lib/fridge-manifest";

/**
 * THE PAGE IS ONE RENDERED KITCHEN. See docs/FRIDGE-SPEC.md.
 *
 * The still for the visitor's own time of day fills the screen. Everything the
 * page adds rides one transform with it (the hotspots, the clips, the clock
 * layers, the journal ink), computed here as object-fit: cover, so nothing
 * drifts off its object at any window size or browser zoom.
 *
 * The browser never draws a physical thing. It plays rendered clips, rotates
 * rendered clock hands, and draws exactly two things itself: the visitor's
 * signature and their typed number, both as pen ink.
 */

type Open =
  | { kind: "object"; index: number }
  | { kind: "shelf"; index: number };

const LINE_KEY = "amber-journal-line";

const ALT: Record<Light, string> = {
  morning:
    "A kitchen in morning light. A cream fridge holds notes, a photo and cards under amber magnets, a shelf of guest journals hangs by the window, and an open journal lies on the counter.",
  golden:
    "A kitchen in late afternoon light. A cream fridge holds notes, a photo and cards under amber magnets, a shelf of guest journals hangs by the window, and an open journal lies on the counter.",
  night:
    "A kitchen at night with the lamp on. A cream fridge holds notes, a photo and cards under amber magnets, a shelf of guest journals hangs by the window, and an open journal lies on the counter.",
};

function readLine(): number {
  try {
    const n = Number(window.localStorage.getItem(LINE_KEY));
    return Number.isFinite(n) && n >= 0 && n < 12 ? n : 0;
  } catch {
    return 0;
  }
}

function saveLine(n: number) {
  try {
    window.localStorage.setItem(LINE_KEY, String(n));
  } catch {
    // Blocked storage: a returning visitor signs on the first line again.
  }
}

/** The smaller render when it is big enough for the pixels on screen. */
function stillSrc(src: string, cam: Camera, screenPx: number, failed: boolean) {
  const small = cam === "wide" ? 1920 : 1080;
  if (failed || screenPx > small) return src;
  return src.replace(/\.webp$/, `-${small}.webp`);
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => setReduced(q.matches);
    set();
    q.addEventListener("change", set);
    return () => q.removeEventListener("change", set);
  }, []);
  return reduced;
}

function Hotspot({
  poly,
  label,
  expanded,
  disabled,
  onActivate,
  onWarm,
  innerRef,
}: {
  poly: Pt[];
  label: string;
  expanded?: boolean;
  disabled?: boolean;
  onActivate: () => void;
  onWarm?: () => void;
  innerRef?: (el: HTMLButtonElement | null) => void;
}) {
  const [x, y, w, h] = boundsOf(poly);
  return (
    <button
      ref={innerRef}
      type="button"
      className={styles.spot}
      style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}
      aria-expanded={expanded}
      tabIndex={disabled ? -1 : 0}
      onClick={onActivate}
      onPointerEnter={onWarm}
      onFocus={onWarm}
    >
      <span
        className={styles.spotHit}
        style={{ clipPath: clipPathFor(poly) }}
      />
      <span className="sr-only">{label}</span>
    </button>
  );
}

/** Flip on once morning and night clips exist for both cameras. */
const FOLLOW_CLOCK = false;

export function Kitchen() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [light, setLight] = useState<Light>("golden");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [side, setSide] = useState<ClipSide>("front");
  const [busy, setBusy] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [line, setLine] = useState(0);
  const [live, setLive] = useState("");
  const [stillFailed, setStillFailed] = useState(false);
  const reduced = usePrefersReducedMotion();
  const mainRef = useRef<HTMLElement>(null);
  const spotRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastSpot = useRef<string | null>(null);

  // Light and manifest are read on the client only, so the server render and
  // the first paint never disagree about what time it is.
  useEffect(() => {
    const forced = parseLight(
      new URLSearchParams(window.location.search).get("light"),
    );
    // Only golden hour has every clip rendered, so the page stays golden
    // until morning and night are; following the clock showed a night room
    // that jumped to daylight the moment a clip played (Caleb, 2026-10-07).
    // ?light= still previews the others.
    setLight(forced ?? (FOLLOW_CLOCK ? lightFor(new Date().getHours()) : "golden"));
    setLine(readLine());
    let alive = true;
    loadManifest().then((m) => {
      if (alive) setManifest(m);
    });
    return () => {
      alive = false;
    };
  }, []);

  // The visitor's clock can cross 11:00 or 18:00 while the page is open.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("light")) return;
    const t = window.setInterval(
      () => setLight(lightFor(new Date().getHours())),
      60_000,
    );
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const camera: Camera | null =
    manifest && size ? pickCamera(size.w, size.h, manifest.cameras) : null;
  const frame = manifest && camera ? manifest.cameras[camera] : null;
  const page = manifest && camera ? manifest.journal.page[camera][light] : null;

  const view = useMemo(() => {
    if (!frame || !size) return null;
    // A page rendered as its own full frame (looking down at the book) fills
    // the screen like the room does; a smaller page rect is zoomed onto.
    if (journalOpen && page && page.rect[2] < 100)
      return zoomView(frame.width, frame.height, size.w, size.h, page.rect);
    return coverView(frame.width, frame.height, size.w, size.h, frame.focus);
  }, [frame, size, journalOpen, page]);

  const announce = useCallback((text: string) => {
    // Clear first so the same sentence twice is still read out.
    setLive("");
    window.setTimeout(() => setLive(text), 30);
  }, []);

  const clipFor = useCallback(
    (o: Open): Clip | null => {
      if (!manifest || !camera) return null;
      if (o.kind === "object")
        return manifest.objects[o.index]?.clip[camera][light] ?? null;
      return manifest.shelf.clip[camera][light][o.index] ?? null;
    },
    [manifest, camera, light],
  );

  const textFor = useCallback(
    (o: Open): string => {
      if (!manifest) return "";
      if (o.kind === "object") return manifest.objects[o.index]?.backText ?? "";
      const year = manifest.shelf.years[o.index];
      return `The ${year} journal falls open to that year's signatures.`;
    },
    [manifest],
  );

  const labelFor = useCallback(
    (o: Open): string =>
      o.kind === "object" ? (manifest?.objects[o.index]?.label ?? "") : "",
    [manifest],
  );

  const keyOf = (o: Open) => `${o.kind}-${o.index}`;

  // Click a thing in the room and it comes up front first. While it is held,
  // clicking it turns it over (as often as you like) and clicking anywhere
  // else puts it back. Caleb, 2026-10-07.
  const activate = (o: Open) => {
    if (journalOpen || open) return;
    lastSpot.current = keyOf(o);
    setOpen(o);
    setSide(o.kind === "object" ? "front" : "back");
    announce(o.kind === "object" ? labelFor(o) : textFor(o));
  };

  const onClipClosed = useCallback(() => {
    setOpen(null);
    setBusy(false);
    const k = lastSpot.current;
    if (k) spotRefs.current.get(k)?.focus({ preventScroll: true });
  }, []);

  const putBack = useCallback(() => {
    if (open && !busy) setSide("down");
  }, [open, busy]);

  const turn = useCallback(() => {
    if (!open || busy || open.kind !== "object") return;
    const c = clipFor(open);
    if (!c || c.frontAt === undefined) return;
    setSide((s) => {
      const nextSide = s === "front" ? "back" : "front";
      announce(nextSide === "back" ? textFor(open) : labelFor(open));
      return nextSide;
    });
  }, [open, busy, clipFor, announce, textFor, labelFor]);

  // The ruled columns of the open page, padded out to the paper's edges.
  const isOnPaper = (clientX: number, clientY: number) => {
    if (!frame || !view || !page) return false;
    const fx = ((clientX - view.x) / view.scale / frame.width) * 100;
    const fy = ((clientY - view.y) / view.scale / frame.height) * 100;
    const pts = [...page.nameColumn, ...page.numberColumn];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const padX = (Math.max(...xs) - Math.min(...xs)) * 0.08;
    const padY = (Math.max(...ys) - Math.min(...ys)) * 0.2;
    // On a laptop the left-hand page of signatures is in view too, and it is
    // still the journal.
    const left = camera === "wide" ? Math.max(...xs) - Math.min(...xs) + padX * 2 : 0;
    return (
      fx > Math.min(...xs) - padX - left &&
      fx < Math.max(...xs) + padX &&
      fy > Math.min(...ys) - padY &&
      fy < Math.max(...ys) + padY
    );
  };

  // A click on the held object turns it; anywhere else puts it back. The
  // object's own on-screen box comes from the render (clip.held); the centre
  // band is only a fallback for clips that predate it.
  const isOnHeld = (clientX: number, clientY: number) => {
    if (!frame || !view || !camera || !open) return false;
    const fx = ((clientX - view.x) / view.scale / frame.width) * 100;
    const fy = ((clientY - view.y) / view.scale / frame.height) * 100;
    const box = clipFor(open)?.held;
    if (box) {
      const [x, y, w, h] = box;
      return fx >= x && fx <= x + w && fy >= y && fy <= y + h;
    }
    const [hw, hh] = camera === "wide" ? [22, 37] : [44, 31];
    return Math.abs(fx - 50) < hw && Math.abs(fy - 50) < hh;
  };

  const closeAll = useCallback(() => {
    if (journalOpen) {
      setJournalOpen(false);
      spotRefs.current.get("journal")?.focus({ preventScroll: true });
      return;
    }
    putBack();
  }, [journalOpen, putBack]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeAll]);

  // Warm the first object's clip lightly once the room is up.
  useEffect(() => {
    if (!manifest || !camera || reduced) return;
    const first = manifest.objects[0]?.clip[camera][light];
    if (!first?.in) return;
    const t = window.setTimeout(() => preloadClip(first.in, "metadata"), 1500);
    return () => window.clearTimeout(t);
  }, [manifest, camera, light, reduced]);

  const warm = (o: Open) => () => {
    const c = clipFor(o);
    if (c?.in && !reduced) preloadClip(c.in);
  };

  const openClip = open ? clipFor(open) : null;
  const clock = manifest && camera ? manifest.clock[camera][light] : null;
  const ambient = manifest && camera ? manifest.ambient[camera][light] : null;

  return (
    <main
      ref={mainRef}
      className={styles.kitchen}
      data-journal={journalOpen}
      onPointerDown={(e) => {
        // Tapping anywhere off the paper puts the journal down. The page
        // render fills the whole screen, so "off the paper" is measured
        // against the ruled columns, not the element: Caleb couldn't get back
        // to the room on 2026-10-07 because every tap landed on the render.
        if (!journalOpen) return;
        const t = e.target as HTMLElement;
        if (t.closest("input, [role=group]")) return;
        if (!isOnPaper(e.clientX, e.clientY)) closeAll();
      }}
      onClick={(e) => {
        if (!open || journalOpen) return;
        if (isOnHeld(e.clientX, e.clientY)) turn();
        else putBack();
      }}
    >
      <h1 className="sr-only">Amber</h1>
      {manifest && camera && frame && view ? (
        <div
          className={styles.stage}
          data-animate={!reduced}
          style={{
            width: `${frame.width}px`,
            height: `${frame.height}px`,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            ["--s" as string]: String(view.scale),
          }}
        >
          <img
            className={styles.still}
            src={stillSrc(
              manifest.stills[camera][light],
              camera,
              frame.width *
                view.scale *
                (typeof window === "undefined"
                  ? 1
                  : window.devicePixelRatio || 1),
              stillFailed || journalOpen,
            )}
            alt={ALT[light]}
            draggable={false}
            onError={() => setStillFailed(true)}
          />

          {ambient && !reduced
            ? (["steam", "lamp"] as const).map((k) => {
                const loop = ambient[k];
                if (!loop) return null;
                const [x, y, w, h] = loop.rect;
                return (
                  <video
                    key={k}
                    className={styles.layer}
                    style={{
                      left: `${x}%`,
                      top: `${y}%`,
                      width: `${w}%`,
                      height: `${h}%`,
                    }}
                    src={loop.src}
                    autoPlay
                    loop
                    muted
                    playsInline
                    aria-hidden="true"
                  />
                );
              })
            : null}

          {clock ? <Clock {...clock} /> : null}

          <div className={styles.spots} inert={journalOpen || !!open}>
            {manifest.objects.map((o, i) => {
              const key = keyOf({ kind: "object", index: i });
              // Nothing to show yet for this camera and light: no hotspot.
              const c = o.clip[camera][light];
              if (!c.in && !c.poster) return null;
              return (
                <Hotspot
                  key={o.id}
                  poly={o.hotspot[camera]}
                  label={o.label}
                  expanded={open?.kind === "object" && open.index === i}
                  onActivate={() => activate({ kind: "object", index: i })}
                  onWarm={warm({ kind: "object", index: i })}
                  innerRef={(el) => {
                    if (el) spotRefs.current.set(key, el);
                  }}
                />
              );
            })}
            {manifest.shelf.hotspot[camera].map((poly, i) => {
              const c = manifest.shelf.clip[camera][light][i];
              if (!c || (!c.in && !c.poster)) return null;
              return (
                <Hotspot
                  key={`shelf-${i}`}
                  poly={poly}
                  label={`Guest journal from ${manifest.shelf.years[i]}`}
                  expanded={open?.kind === "shelf" && open.index === i}
                  onActivate={() => activate({ kind: "shelf", index: i })}
                  onWarm={warm({ kind: "shelf", index: i })}
                />
              );
            })}
            <Hotspot
              poly={manifest.journal.hotspot[camera]}
              label="This year's guest journal, open on the counter. Sign it and leave your number to join the waitlist."
              expanded={journalOpen}
              innerRef={(el) => {
                if (el) spotRefs.current.set("journal", el);
              }}
              onActivate={() => {
                setJournalOpen(true);
              }}
            />
          </div>

          {open && openClip ? (
            <ObjectClip
              key={`${keyOf(open)}-${camera}-${light}`}
              clip={openClip}
              side={side}
              reduced={reduced}
              onClosed={onClipClosed}
              onBusy={setBusy}
            />
          ) : null}

          {page ? (
            <div data-journal-part="" className={styles.journal}>
              <Journal
                page={page}
                frameW={frame.width}
                frameH={frame.height}
                screenScale={view.scale}
                open={journalOpen}
                line={line}
                announce={announce}
                onDone={() => {
                  saveLine(line + 1);
                  setJournalOpen(false);
                  spotRefs.current
                    .get("journal")
                    ?.focus({ preventScroll: true });
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite" role="status">
        {live}
      </p>
    </main>
  );
}
