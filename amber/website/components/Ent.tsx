"use client";

/**
 * The console's building blocks. Deliberately plain, and all of them read from
 * the enterprise tokens in globals.css rather than carrying their own colours,
 * so changing the ground changes everything at once.
 */

import type { ReactNode } from "react";

export function Card({
  title,
  note,
  action,
  children,
  wide,
}: {
  title?: string;
  note?: string;
  action?: ReactNode;
  // Optional: a card whose whole content is its title and its one explanatory
  // line is a legitimate card -- an empty state is exactly that shape.
  children?: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={`ent-card overflow-hidden ${wide ? "lg:col-span-2" : ""}`}>
      {title ? (
        <header
          className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5"
          style={{ borderBottom: "1px solid var(--ds-line)" }}
        >
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold" style={{ color: "var(--ds-ink)" }}>{title}</h2>
            {note ? (
              <p className="mt-1 max-w-prose text-[13px] leading-relaxed" style={{ color: "var(--ds-muted)" }}>
                {note}
              </p>
            ) : null}
          </div>
          {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
        </header>
      ) : null}
      {children ? <div className="px-5 py-4">{children}</div> : null}
    </section>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return (
    <div className="ent-row flex flex-wrap items-center justify-between gap-3 px-2 py-2.5 text-[13px]">
      {children}
    </div>
  );
}

export function Stat({ value, label, hint }: { value: ReactNode; label: string; hint?: string }) {
  return (
    <div className="ent-card px-4 py-3.5">
      <div className="text-[12px] font-medium" style={{ color: "var(--ds-muted)" }}>{label}</div>
      <div className="tnum mt-2 text-[26px] font-semibold leading-none" style={{ color: "var(--ds-ink)" }}>
        {value}
      </div>
      {hint ? <div className="mt-1.5 text-[12px]" style={{ color: "var(--ds-dim)" }}>{hint}</div> : null}
    </div>
  );
}

export function Btn({
  tone = "solid",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "solid" | "quiet" | "danger" }) {
  const style =
    tone === "solid"
      ? { background: "var(--ds-accent)", color: "#ffffff", borderColor: "transparent" }
      : tone === "danger"
        ? { background: "var(--ds-card)", color: "var(--ds-danger)", borderColor: "var(--ds-line)" }
        : { background: "var(--ds-card)", color: "var(--ds-ink)", borderColor: "var(--ds-line)" };
  return (
    <button
      {...props}
      className={`inline-flex h-8.5 items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-all active:scale-[0.985] disabled:opacity-45 ${props.className ?? ""}`}
      style={{ ...style, ...(props.style ?? {}) }}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-9 rounded-lg border px-3 text-[13px] outline-none transition-all placeholder:text-[var(--ds-dim)] focus:border-[var(--ds-accent)] focus:ring-2 focus:ring-[var(--ds-accent-ring)] ${props.className ?? ""}`}
      style={{ borderColor: "var(--ds-line)", background: "var(--ds-card)", color: "var(--ds-ink)", ...(props.style ?? {}) }}
    />
  );
}

export function Tag({ children, on }: { children: ReactNode; on?: boolean }) {
  return (
    <span
      className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-5"
      style={{
        borderColor: on ? "var(--ds-accent-ring)" : "var(--ds-line)",
        background: on ? "var(--ds-accent-soft)" : "var(--ds-hover)",
        color: on ? "var(--ds-accent-ink)" : "var(--ds-muted)",
      }}
    >
      {children}
    </span>
  );
}

export function Err({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      className="mb-3 rounded-lg border px-3 py-2 text-[13px]"
      style={{ borderColor: "var(--ds-danger)", background: "var(--ds-danger-soft)", color: "var(--ds-danger)" }}
    >
      {children}
    </p>
  );
}

/**
 * THE AUDIENCE LADDER AS A ROW OF BUTTONS, not a dropdown.
 *
 * A native select on a dark ground renders the operating system's own menu,
 * which is why the policy screen looked like a different product every time it
 * opened. It also hides the thing that matters: a ceiling is a POSITION ON A
 * LINE, and five options stacked behind a click say nothing about where the
 * line sits. Laid out left to right, narrowest first, the choice reads as what
 * it is — and everything past the cap stays visible and dimmed, so an admin can
 * see what they are shutting off rather than only what they are allowing.
 */
export function Ladder<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const index = options.findIndex((o) => o.value === value);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className="ent-choice"
          data-on={i === index}
          data-beyond={i > index}
          title={i > index ? "Above the limit you have set" : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
