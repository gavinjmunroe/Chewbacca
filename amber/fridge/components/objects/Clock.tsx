"use client";

import { useEffect, useState } from "react";
import { clockAngles, msToNextMinute, type Pt } from "@/lib/fridge";
import styles from "./kitchen.module.css";

/**
 * The wall clock's hands are rendered layers (full-frame transparent PNGs lit
 * with the room), turned about the pivot to the visitor's own time. The
 * browser rotates pictures; it never draws a hand. Updated on the minute.
 */
export function Clock({
  pivot,
  hour,
  minute,
  cap,
}: {
  pivot: Pt;
  hour: string;
  minute: string;
  cap: string;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const d = new Date();
      setNow(d);
      timer = window.setTimeout(tick, msToNextMinute(d) + 20);
    };
    timer = window.setTimeout(tick, msToNextMinute(new Date()) + 20);
    return () => window.clearTimeout(timer);
  }, []);

  if (!hour && !minute && !cap) return null;
  const a = clockAngles(now);
  const origin = `${pivot[0]}% ${pivot[1]}%`;
  const layers: [string, number][] = [
    [hour, a.hour],
    [minute, a.minute],
    [cap, 0],
  ];
  return (
    <>
      {layers.map(([src, deg], i) =>
        src ? (
          <img
            key={i}
            className={styles.layer}
            src={src}
            alt=""
            draggable={false}
            style={{ transformOrigin: origin, transform: `rotate(${deg}deg)` }}
          />
        ) : null,
      )}
    </>
  );
}
