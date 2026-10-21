"use client";

import { useEffect, useRef, useState } from "react";
import type { Clip } from "@/lib/fridge-manifest";
import styles from "./kitchen.module.css";

/**
 * ONE RENDERED OBJECT, HELD UP AND TURNED BY HAND.
 *
 * `in` carries the object out from under its magnet, holds on its front at
 * `frontAt`, then turns it to its back. `out` is the same frames reversed. Two
 * videos and a seek cover every move Caleb asked for on 2026-10-07: "clicking
 * the object when it is in the foreground flips it, as many times as you
 * want, clicking on the background makes it go back".
 *
 *   lift   in   0 -> frontAt          (pause on the front)
 *   turn   in   frontAt -> end        (front to back)
 *   turn   out  0 -> end - frontAt    (back to front)
 *   down   out  from wherever the object is -> end
 *
 * The browser draws nothing: every frame is a render. A clip that cannot play
 * shows the matching still (front or poster) instead, and reduced motion uses
 * only the stills.
 */

/**
 * How long a click waits for a clip before showing the still instead.
 * Guessed, never measured: long enough for a short h264 on a decent
 * connection, short enough that a click never feels ignored.
 */
const READY_TIMEOUT_MS = 1800;

const warm = new Map<string, HTMLVideoElement>();

/** Starts fetching a clip in the background, once. */
export function preloadClip(src: string, level: "auto" | "metadata" = "auto") {
  if (!src || typeof document === "undefined") return;
  const have = warm.get(src);
  if (have) {
    if (level === "auto" && have.preload !== "auto") {
      have.preload = "auto";
      have.load();
    }
    return;
  }
  const v = document.createElement("video");
  v.muted = true;
  v.preload = level;
  v.src = src;
  v.load();
  warm.set(src, v);
}

/** Which way the held object faces, or that it is going back on the door. */
export type ClipSide = "front" | "back" | "down";

type Layer = "none" | "in" | "out" | "front" | "poster";

function ready(v: HTMLVideoElement) {
  return v.readyState >= 3;
}

/** Plays `v` from `from` until `to` (seconds, or the end), then calls `done`. */
function playRange(
  v: HTMLVideoElement,
  from: number,
  to: number | null,
  done: () => void,
): () => void {
  let raf = 0;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    if (to !== null && v.currentTime >= to) {
      v.pause();
      v.currentTime = to;
      done();
      return;
    }
    raf = window.requestAnimationFrame(tick);
  };
  const onEnded = () => {
    if (!stopped && to === null) done();
  };
  v.addEventListener("ended", onEnded);
  v.currentTime = from;
  v.play()
    .then(() => {
      raf = window.requestAnimationFrame(tick);
    })
    .catch(() => {
      if (!stopped) done();
    });
  return () => {
    stopped = true;
    window.cancelAnimationFrame(raf);
    v.removeEventListener("ended", onEnded);
  };
}

export function ObjectClip({
  clip,
  side,
  reduced,
  onClosed,
  onBusy,
}: {
  clip: Clip;
  side: ClipSide;
  reduced: boolean;
  onClosed: () => void;
  /** True while a move is playing; a click then would land mid-turn. */
  onBusy: (busy: boolean) => void;
}) {
  const [layer, setLayer] = useState<Layer>("none");
  const [imgReady, setImgReady] = useState(false);
  const inRef = useRef<HTMLVideoElement>(null);
  const outRef = useRef<HTMLVideoElement>(null);
  // Where the object is now: which face shows, and on which layer.
  const at = useRef<{
    face: "front" | "back";
    on: "in" | "out" | "still";
  } | null>(null);
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;
  const busyRef = useRef(onBusy);
  busyRef.current = onBusy;

  const hasFront = clip.frontAt !== undefined;
  const frontAt = clip.frontAt ?? 0;

  useEffect(() => {
    const vin = inRef.current;
    const vout = outRef.current;
    const still = (face: "front" | "back") => {
      at.current = { face, on: "still" };
      setLayer(face === "front" && clip.front ? "front" : "poster");
    };
    const usable = !reduced && !!clip.in && !!vin && !!vout;
    const prev = at.current;

    // Going back onto the door.
    if (side === "down") {
      if (
        !usable ||
        !vin ||
        !vout ||
        !prev ||
        prev.on === "still" ||
        !vout.duration
      ) {
        closedRef.current();
        return;
      }
      const from = prev.face === "front" ? vout.duration - frontAt : 0;
      setLayer("out");
      busyRef.current(true);
      return playRange(vout, from, null, () => {
        busyRef.current(false);
        closedRef.current();
      });
    }

    const want: "front" | "back" = hasFront ? side : "back";
    if (!usable || !vin || !vout) {
      still(want);
      return;
    }
    if (prev && prev.face === want) return;

    let cancel: () => void = () => {};
    let settled = false;
    const fallback = () => {
      if (settled) return;
      settled = true;
      still(want);
    };
    const timer = window.setTimeout(fallback, READY_TIMEOUT_MS);
    const go = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      busyRef.current(true);
      if (!prev) {
        // Lift: off the magnet and up to the front, or straight to the back
        // for things with no front, like the shelf journals.
        setLayer("in");
        cancel = playRange(vin, 0, want === "front" ? frontAt : null, () => {
          at.current = { face: want, on: "in" };
          busyRef.current(false);
        });
      } else if (want === "back") {
        setLayer("in");
        cancel = playRange(vin, frontAt, null, () => {
          at.current = { face: "back", on: "in" };
          busyRef.current(false);
        });
      } else {
        setLayer("out");
        cancel = playRange(vout, 0, vout.duration - frontAt, () => {
          at.current = { face: "front", on: "out" };
          busyRef.current(false);
        });
      }
    };
    const v = !prev || want === "back" ? vin : vout;
    const onError = () => {
      window.clearTimeout(timer);
      fallback();
    };
    if (ready(v) && v.duration) go();
    else {
      v.addEventListener("canplay", go, { once: true });
      v.addEventListener("error", onError, { once: true });
    }
    return () => {
      window.clearTimeout(timer);
      v.removeEventListener("canplay", go);
      v.removeEventListener("error", onError);
      cancel();
      busyRef.current(false);
    };
  }, [side, clip.in, clip.front, reduced, hasFront, frontAt]);

  // Whatever the object does next, it will need the other direction.
  useEffect(() => {
    if (clip.out && !reduced) preloadClip(clip.out);
  }, [clip.out, reduced]);

  const [x, y, w, h] = clip.rect;
  const still =
    layer === "front" ? clip.front : layer === "poster" ? clip.poster : null;
  return (
    <div
      className={styles.clip}
      style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}
      aria-hidden="true"
    >
      {clip.in && !reduced ? (
        <video
          ref={inRef}
          className={styles.clipMedia}
          data-on={layer === "in"}
          src={clip.in}
          muted
          playsInline
          preload="auto"
        />
      ) : null}
      {clip.out && !reduced ? (
        <video
          ref={outRef}
          className={styles.clipMedia}
          data-on={layer === "out"}
          src={clip.out}
          muted
          playsInline
          preload="auto"
        />
      ) : null}
      {still ? (
        <img
          key={still}
          className={styles.clipMedia}
          data-on={imgReady}
          src={still}
          alt=""
          draggable={false}
          onLoad={() => setImgReady(true)}
          onError={() => setImgReady(false)}
        />
      ) : null}
    </div>
  );
}
