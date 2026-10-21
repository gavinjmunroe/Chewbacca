"use client";

/**
 * A SMALL MENU THAT CANNOT BE CLIPPED.
 *
 * WHY NOT `absolute`. A menu positioned inside a scrolling column is cut off
 * by that column: `overflow-y-auto` clips, so the menu on the last row --
 * the one somebody is most likely to be tidying up -- loses its bottom item
 * off the edge. Expanding the row instead avoids the clip and pushes
 * everything else down, which reads as the page jumping.
 *
 * SO IT IS `fixed`, PLACED FROM THE BUTTON'S OWN RECTANGLE. It floats above
 * everything, it is pinned to the control that opened it, and it flips above
 * the button when there is no room below -- which is the same behaviour every
 * menu has and the one nobody notices until it is missing.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export default function Popover({
  anchor,
  onClose,
  children,
  width = 180,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const h = box.current?.offsetHeight ?? 120;
    const below = window.innerHeight - r.bottom;
    setAt({
      top: below > h + 12 ? r.bottom + 6 : Math.max(8, r.top - h - 6),
      // Right-aligned to the button, clamped inside the window.
      left: Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8),
    });
  }, [anchor, width]);

  /* Escape, a click anywhere else, or scrolling the page away all close it. */
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  if (!anchor) return null;

  return (
    <>
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-[60] cursor-default"
      />
      <div
        ref={box}
        style={{ width, top: at?.top ?? -9999, left: at?.left ?? -9999 }}
        className="fixed z-[61] overflow-hidden rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] py-1 shadow-[var(--ds-shadow-md,0_8px_28px_rgba(0,0,0,.14))]"
      >
        {children}
      </div>
    </>
  );
}

export function PopoverItem({
  icon,
  label,
  onClick,
  tone,
}: {
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition hover:bg-[var(--ds-sunk,rgba(0,0,0,.05))] ${
        tone === "danger" ? "text-[#b4402f]" : "text-[var(--ds-ink)]"
      }`}
    >
      {icon ? <span className="text-[var(--ds-muted)]">{icon}</span> : null}
      {label}
    </button>
  );
}
