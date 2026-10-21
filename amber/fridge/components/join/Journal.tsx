"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Stroke } from "./card";
import { drawInk, effectivePressure } from "./ink";
import { writeDigits } from "./pen-digits";
import { boundsOf, isCompletePhone, phoneDigits } from "@/lib/fridge";
import type { JournalPage } from "@/lib/fridge-manifest";
import styles from "@/components/objects/kitchen.module.css";

/**
 * THE WAITLIST IS THE GUEST JOURNAL ON THE COUNTER.
 *
 * Kitchen zooms the whole still onto the page; this component only owns what
 * the visitor adds to it. They sign the next empty line of the name column
 * with a finger or a mouse, and type their number into a field nobody sees,
 * whose digits appear as pen ink on the same line. There is no button. The
 * entry goes in when they press return, or lift the pen, with a complete
 * number on the line. Then the ink dries and Kitchen zooms back out.
 *
 * Everything is in page coordinates (0..1 of the page rect), which is what
 * the guestbook route stores.
 */

type Status = "idle" | "sending" | "done" | "error";

/**
 * Pause after the last pen lift before the number field takes focus, so a
 * second stroke (a dotted i, a crossed t) is not cut off by the keyboard.
 * Guessed, never measured.
 */
const HANDOFF_MS = 1100;

/** How long the drying ink is left to be seen before the zoom out. */
const DRY_MS = 1500;

// The guestbook route refuses more than 40 strokes, 1000 points in one
// stroke, or 1200 points in all. A slow, long signature can pass that, so
// thin it evenly instead of letting the server reject a real hand.
const MAX_STROKES = 40;
const MAX_POINTS = 1000;
const MAX_POINTS_TOTAL = 1200;

function thin(s: Stroke, n: number): Stroke {
  if (s.length <= n) return s;
  const step = (s.length - 1) / (Math.max(2, n) - 1);
  return Array.from({ length: Math.max(2, n) }, (_, i) => s[Math.round(i * step)]);
}

function fitToLimits(all: Stroke[]): Stroke[] {
  const kept = all.slice(0, MAX_STROKES).map((s) => thin(s, MAX_POINTS));
  const total = kept.reduce((n, s) => n + s.length, 0);
  if (total <= MAX_POINTS_TOTAL) return kept;
  const ratio = MAX_POINTS_TOTAL / total;
  return kept.map((s) => thin(s, Math.floor(s.length * ratio)));
}

export function Journal({
  page,
  frameW,
  frameH,
  screenScale,
  open,
  line,
  announce,
  onDone,
}: {
  page: JournalPage;
  frameW: number;
  frameH: number;
  /** CSS px per frame px right now, so the ink canvas is drawn at screen resolution. */
  screenScale: number;
  open: boolean;
  /** Which ruled line (0 = firstLine) is the next empty one. */
  line: number;
  announce: (text: string) => void;
  onDone: () => void;
}) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drawing = useRef<{
    id: number;
    start: number;
    last: number | null;
  } | null>(null);
  const handoff = useRef(0);

  const [rx, ry, rw, rh] = page.rect;
  const baselineY = page.firstLine + line * page.lineGap;
  const name = boundsOf(page.nameColumn);
  const num = boundsOf(page.numberColumn);
  const toPageX = (x: number) => (x - rx) / rw;
  const toPageY = (y: number) => (y - ry) / rh;

  const pagePxW = (rw / 100) * frameW * screenScale;
  const pagePxH = (rh / 100) * frameH * screenScale;

  const digitStrokes = writeDigits(phoneDigits(phone), {
    left: toPageX(num[0]),
    right: toPageX(num[0] + num[2]),
    baseline: toPageY(baselineY),
    height: (page.lineGap / rh) * 0.62,
    aspect: ((rw / 100) * frameW) / ((rh / 100) * frameH),
  });

  // Redraw on every change. A page of strokes is a few hundred segments.
  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.min(4096, Math.round(pagePxW * dpr)));
    const h = Math.max(1, Math.min(4096, Math.round(pagePxH * dpr)));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    drawInk(ctx, [...strokes, ...digitStrokes], {
      cardW: w / dpr,
      cardH: h / dpr,
      dpr,
      // A 0.5 mm ballpoint on the page's 8 mm rows: 1/16 of a row.
      nib: Math.max(0.55, ((page.lineGap / rh) * pagePxH) / 16),
    });
  });

  const submit = useCallback(
    async (via: "key" | "pen") => {
      if (status === "sending" || status === "done") return;
      if (!isCompletePhone(phone)) {
        if (via === "key")
          announce("That number needs all ten digits, area code first.");
        return;
      }
      setStatus("sending");
      try {
        const res = await fetch("/api/guestbook", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            strokes: fitToLimits(strokes).map((s) =>
              s.map((q) => ({
                x: Math.round(q.x * 1e4) / 1e4,
                y: Math.round(q.y * 1e4) / 1e4,
                t: Math.round(q.t),
                p: Math.round(q.p * 100) / 100,
              })),
            ),
            phone: phoneDigits(phone),
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setStatus("done");
        inputRef.current?.blur();
        announce(
          "Signed. Amber will text you at that number when it's your turn.",
        );
        window.setTimeout(onDone, DRY_MS);
      } catch (err) {
        setStatus("error");
        const tooMany = err instanceof Error && err.message === "429";
        announce(
          tooMany
            ? "Too many tries from this connection. Wait a few minutes and press return again."
            : "That didn't go through. Check your connection and press return to try again.",
        );
      }
    },
    [announce, onDone, phone, status, strokes],
  );

  // Pen handling.
  const point = (e: React.PointerEvent) => {
    const c = canvasRef.current;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
      w: r.width,
    };
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!open || status === "sending" || status === "done") return;
    e.preventDefault();
    window.clearTimeout(handoff.current);
    e.currentTarget.setPointerCapture(e.pointerId);
    const q = point(e);
    if (!q) return;
    const now = performance.now();
    drawing.current = { id: e.pointerId, start: now, last: null };
    const p = effectivePressure(e.pointerType, e.pressure, 0.25, null);
    drawing.current.last = p;
    setStrokes((s) => [...s, [{ x: q.x, y: q.y, t: 0, p }]]);
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    const q = point(e);
    if (!q) return;
    const t = performance.now() - d.start;
    setStrokes((all) => {
      const cur = all[all.length - 1];
      const prev = cur[cur.length - 1];
      const dt = Math.max(1, t - prev.t) / 1000;
      const speed =
        Math.hypot(q.x - prev.x, (q.y - prev.y) * (pagePxH / pagePxW)) / dt;
      const p = effectivePressure(e.pointerType, e.pressure, speed, d.last);
      d.last = p;
      return [...all.slice(0, -1), [...cur, { x: q.x, y: q.y, t, p }]];
    });
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    drawing.current = null;
    if (isCompletePhone(phone)) {
      void submit("pen");
      return;
    }
    handoff.current = window.setTimeout(() => {
      if (!phoneDigits(phone)) inputRef.current?.focus();
    }, HANDOFF_MS);
  };

  useEffect(() => () => window.clearTimeout(handoff.current), []);

  // Someone who signs and starts typing straight away would lose the first
  // digits to the handoff wait (seen in testing 2026-10-07: "3105551234"
  // landed as "551234"). Any digit typed while the journal is open goes to the
  // number field, which takes focus before the key is delivered.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const input = inputRef.current;
      if (!input || document.activeElement === input) return;
      if (!/^\d$/.test(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
      window.clearTimeout(handoff.current);
      input.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  // Opening puts the pen on the line; closing gives focus back to Kitchen.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(
      () => surfaceRef.current?.focus({ preventScroll: true }),
      50,
    );
    return () => window.clearTimeout(t);
  }, [open]);

  const lineTop = baselineY - page.lineGap * 2.2;
  const lineH = page.lineGap * 2.7;

  return (
    <>
      {page.image ? (
        <img
          className={styles.journalPage}
          data-on={open}
          src={page.image}
          alt=""
          draggable={false}
          style={{
            left: `${rx}%`,
            top: `${ry}%`,
            width: `${rw}%`,
            height: `${rh}%`,
          }}
        />
      ) : null}
      <canvas
        ref={canvasRef}
        className={styles.ink}
        data-on={open}
        data-dry={status === "done"}
        aria-hidden="true"
        style={{
          left: `${rx}%`,
          top: `${ry}%`,
          width: `${rw}%`,
          height: `${rh}%`,
        }}
      />
      <div
        ref={surfaceRef}
        className={styles.signLine}
        data-on={open}
        role="group"
        tabIndex={open ? 0 : -1}
        aria-label="Signature line in the guest journal. Sign with a finger or a mouse, then type your cell number."
        style={{
          left: `${name[0]}%`,
          top: `${lineTop}%`,
          width: `${name[2]}%`,
          height: `${lineH}%`,
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      />
      <label
        className={styles.numberLine}
        data-on={open}
        style={{
          left: `${num[0]}%`,
          top: `${lineTop}%`,
          width: `${num[2]}%`,
          height: `${lineH}%`,
        }}
      >
        <span className="sr-only">
          Your cell number. Amber lives in iMessage and texts you here.
        </span>
        <input
          ref={inputRef}
          className={styles.numberInput}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={18}
          tabIndex={open ? 0 : -1}
          value={phone}
          disabled={status === "sending" || status === "done"}
          onChange={(e) => {
            setPhone(e.target.value.replace(/[^\d+()\-\s.]/g, ""));
            if (status === "error") setStatus("idle");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit("key");
            }
          }}
        />
      </label>
    </>
  );
}
