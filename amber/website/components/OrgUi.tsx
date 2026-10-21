"use client";

/**
 * The small pieces the org pages share. Nothing clever -- a panel, a row, a
 * field, a button, a pill -- but defined once so four screens cannot drift into
 * four slightly different greys.
 */

import type { ReactNode } from "react";

export function Panel({ title, note, action, children }: { title: string; note?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section
      className="mb-6 rounded-2xl border p-5"
      style={{ borderColor: "var(--hair)", background: "var(--surface)" }}
    >
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg" style={{ color: "var(--ink)" }}>{title}</h2>
          {note ? <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{note}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-t py-3 first:border-t-0"
      style={{ borderColor: "var(--hair)" }}
    >
      {children}
    </div>
  );
}

export function Field(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`rounded-xl border bg-transparent px-3 py-2 text-sm outline-none ${props.className ?? ""}`}
      style={{ borderColor: "var(--hair)", color: "var(--ink)", ...(props.style ?? {}) }}
    />
  );
}

export function Button({
  variant = "solid",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "solid" | "quiet" | "danger" }) {
  const style =
    variant === "solid"
      ? { background: "var(--accent)", color: "var(--amber-950)", borderColor: "transparent" }
      : variant === "danger"
        ? { background: "transparent", color: "var(--amber-300)", borderColor: "var(--hair)" }
        : { background: "transparent", color: "var(--muted)", borderColor: "var(--hair)" };
  return (
    <button
      {...props}
      className={`rounded-xl border px-3 py-2 text-sm disabled:opacity-40 ${props.className ?? ""}`}
      style={{ ...style, ...(props.style ?? {}) }}
    />
  );
}

export function Pill({ children, tone = "quiet" }: { children: ReactNode; tone?: "quiet" | "accent" }) {
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-xs"
      style={{
        borderColor: "var(--hair)",
        color: tone === "accent" ? "var(--accent)" : "var(--muted)",
      }}
    >
      {children}
    </span>
  );
}

export function Notice({ kind, children }: { kind: "error" | "info"; children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="mb-4 text-sm" style={{ color: kind === "error" ? "var(--amber-300)" : "var(--muted)" }}>
      {children}
    </p>
  );
}
