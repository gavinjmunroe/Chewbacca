"use client";

/**
 * THE COMPONENT LAYER.
 *
 * Every screen behind the sign-in is built from these and nothing else. That
 * is the whole point of having them: the last version of this console had
 * twelve shades of the same grey in it, because every card wrote its own
 * padding and every button wrote its own radius, and no two agreed. A screen
 * assembled from a fixed set of parts cannot drift that way, and a change to
 * the set lands everywhere at once.
 *
 * THE VARIANTS ARE A SHORT LIST ON PURPOSE. Three button tones, two card
 * densities, one input. A design system with eleven button variants is a
 * system where nobody can tell you which one to use, so everybody picks by
 * eye and you are back where you started.
 *
 * Built on Radix primitives for the two things that are genuinely hard to get
 * right by hand -- a modal that traps focus and restores it, and a menu that
 * handles the keyboard -- and plain elements for everything else, because a
 * dependency that saves you a <button> is a dependency you are carrying for
 * nothing.
 */

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2, X } from "lucide-react";
import { cn, hueFor } from "@/lib/cn";

/* ───────────────────────────────────────────────────────────────── button */

const button = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-all disabled:pointer-events-none disabled:opacity-45 active:scale-[0.985]",
  {
    variants: {
      tone: {
        // The only filled thing on a screen. One per view, ideally.
        primary:
          "bg-[var(--ds-accent)] text-white shadow-[0_1px_2px_var(--ds-accent-ring)] hover:bg-[var(--ds-accent-hover)]",
        // The default. Reads as a control without claiming to be the action.
        quiet:
          "bg-[var(--ds-card)] text-[var(--ds-ink)] border border-[var(--ds-line)] shadow-[var(--ds-shadow-sm)] hover:bg-[var(--ds-hover)] hover:border-[var(--ds-line-strong)]",
        // No chrome at all, for things in a row of other things.
        ghost: "text-[var(--ds-muted)] hover:bg-[var(--ds-hover)] hover:text-[var(--ds-ink)]",
        danger:
          "bg-[var(--ds-card)] text-[var(--ds-danger)] border border-[var(--ds-line)] hover:bg-[var(--ds-danger-soft)] hover:border-[var(--ds-danger)]",
      },
      size: {
        sm: "h-7 px-2.5 text-[12px]",
        md: "h-8.5 px-3 text-[13px]",
        lg: "h-10 px-4 text-sm",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: { tone: "quiet", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  busy?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, tone, size, busy, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(button({ tone, size }), className)}
      disabled={disabled || busy}
      {...props}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

/* ───────────────────────────────────────────────────────────────── surface */

export function Panel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] shadow-[var(--ds-shadow-sm)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * A panel with a header.
 *
 * `note` sits under the title rather than beside it and is capped at a
 * readable measure, because an explanatory line that runs the full width of a
 * 1400px console is a line nobody finishes.
 */
export function Section({
  title,
  note,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  note?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Panel className={className}>
      {title || action ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ds-line)] px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-[var(--ds-ink)]">{title}</h2>
            {note ? (
              <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-[var(--ds-muted)]">
                {note}
              </p>
            ) : null}
          </div>
          {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
        </header>
      ) : null}
      {children ? <div className={cn("px-5 py-4", bodyClassName)}>{children}</div> : null}
    </Panel>
  );
}

/** A full-bleed list inside a Section: rows own their own padding. */
export function List({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("divide-y divide-[var(--ds-line)]", className)}>{children}</div>;
}

export function ListRow({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const cls = cn(
    "flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left transition-colors",
    onClick ? "hover:bg-[var(--ds-hover)]" : "",
    className,
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  ) : (
    <div className={cls}>{children}</div>
  );
}

/* ────────────────────────────────────────────────────────────────── fields */

const fieldBase =
  "w-full rounded-lg border border-[var(--ds-line)] bg-[var(--ds-card)] px-3 text-[13px] text-[var(--ds-ink)] outline-none transition-all placeholder:text-[var(--ds-dim)] hover:border-[var(--ds-line-strong)] focus:border-[var(--ds-accent)] focus:ring-2 focus:ring-[var(--ds-accent-ring)] disabled:opacity-50";

export const TextField = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, "h-9", className)} {...props} />
));
TextField.displayName = "TextField";

export const TextArea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, "py-2.5 leading-relaxed", className)} {...props} />
));
TextArea.displayName = "TextArea";

/** A label, its field, and the sentence that says what the field is for. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-[var(--ds-ink)]">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[12px] text-[var(--ds-dim)]">{hint}</span> : null}
    </label>
  );
}

/* ────────────────────────────────────────────────────────────────── badges */

const badge = cva(
  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-5",
  {
    variants: {
      tone: {
        neutral: "bg-[var(--ds-hover)] text-[var(--ds-muted)] border border-[var(--ds-line)]",
        accent: "bg-[var(--ds-accent-soft)] text-[var(--ds-accent-ink)] border border-[var(--ds-accent-ring)]",
        danger: "bg-[var(--ds-danger-soft)] text-[var(--ds-danger)] border border-[var(--ds-danger-soft)]",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  tone,
  children,
  className,
}: VariantProps<typeof badge> & { children: React.ReactNode; className?: string }) {
  return <span className={cn(badge({ tone }), className)}>{children}</span>;
}

/* ─────────────────────────────────────────────────────────────── identity */

/**
 * Initials on the person's own colour.
 *
 * A photo would be better and there are none, so this is the fallback doing
 * the fallback's real job: making a list of names scannable by something other
 * than reading it.
 */
export function Avatar({
  name,
  size = 28,
  className,
}: {
  name: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  const initials =
    parts.length === 0
      ? "?"
      : parts.length === 1
        ? parts[0].slice(0, 2).toUpperCase()
        : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (
    <span
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold text-white", className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        background: hueFor(name),
      }}
    >
      {initials}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────── stats */

/**
 * One number and its noun.
 *
 * The number is the biggest thing in the tile and the only thing in tabular
 * figures, so a row of four tiles has four numbers at the same baseline and
 * the same width per digit. Four tiles where the digits are different widths
 * is a row that looks broken even though nothing is.
 */
export function Stat({
  value,
  label,
  hint,
  icon,
  tone,
}: {
  value: React.ReactNode;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: "accent";
}) {
  return (
    <Panel className="px-4 py-3.5">
      <div className="flex items-center gap-2">
        {icon ? (
          <span
            className="grid h-6 w-6 place-items-center rounded-md"
            style={{
              background: tone === "accent" ? "var(--ds-accent-soft)" : "var(--ds-hover)",
              color: tone === "accent" ? "var(--ds-accent-ink)" : "var(--ds-dim)",
            }}
          >
            {icon}
          </span>
        ) : null}
        <span className="text-[12px] font-medium text-[var(--ds-muted)]">{label}</span>
      </div>
      <div className="tnum mt-2 text-[26px] font-semibold leading-none text-[var(--ds-ink)]">
        {value}
      </div>
      {hint ? <div className="mt-1.5 text-[12px] text-[var(--ds-dim)]">{hint}</div> : null}
    </Panel>
  );
}

/* ──────────────────────────────────────────────────────────────── feedback */

export function Alert({ children, tone = "danger" }: { children?: React.ReactNode; tone?: "danger" | "info" }) {
  if (!children) return null;
  return (
    <div
      className="mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]"
      style={
        tone === "danger"
          ? { borderColor: "var(--ds-danger)", background: "var(--ds-danger-soft)", color: "var(--ds-danger)" }
          : { borderColor: "var(--ds-accent-ring)", background: "var(--ds-accent-soft)", color: "var(--ds-accent-ink)" }
      }
    >
      {children}
    </div>
  );
}

/**
 * Nothing here yet, and what to do about it.
 *
 * An empty state with no action in it is an error message with better
 * manners. Every one of these takes an action unless there is genuinely
 * nothing the person can do.
 */
export function Empty({
  icon,
  title,
  note,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  note?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon ? (
        <span className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-[var(--ds-hover)] text-[var(--ds-dim)]">
          {icon}
        </span>
      ) : null}
      <p className="text-[14px] font-medium text-[var(--ds-ink)]">{title}</p>
      {note ? (
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-[var(--ds-muted)]">{note}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center gap-2 px-5 py-8 text-[13px] text-[var(--ds-dim)]">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Loading…
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── segmented */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; count?: number }[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex gap-0.5 rounded-lg border border-[var(--ds-line)] bg-[var(--ds-bg-deep)] p-0.5",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className="ent-tab"
          data-on={value === o.value}
        >
          {o.label}
          {typeof o.count === "number" ? (
            <span className="tnum ml-1.5 text-[var(--ds-dim)]">{o.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────── dialog */

export function Modal({
  open,
  onOpenChange,
  title,
  note,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  note?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(11,17,31,0.32)] backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <DialogPrimitive.Content
          data-surface="float"
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] shadow-[var(--ds-shadow-lg)]"
        >
          <div className="flex items-start justify-between gap-4 border-b border-[var(--ds-line)] px-5 py-3.5">
            <div>
              <DialogPrimitive.Title className="text-[15px] font-semibold text-[var(--ds-ink)]">
                {title}
              </DialogPrimitive.Title>
              {note ? (
                <DialogPrimitive.Description className="mt-1 text-[13px] leading-relaxed text-[var(--ds-muted)]">
                  {note}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close asChild>
              <Button tone="ghost" size="icon" aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer ? (
            <div className="flex justify-end gap-2 border-t border-[var(--ds-line)] px-5 py-3">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ───────────────────────────────────────────────────────────────── menu */

export const Menu = DropdownPrimitive.Root;
export const MenuTrigger = DropdownPrimitive.Trigger;

export function MenuContent({
  children,
  align = "end",
  className,
}: {
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={6}
        data-surface="float"
        className={cn(
          "z-50 min-w-[200px] rounded-xl border border-[var(--ds-line)] bg-[var(--ds-card)] p-1 shadow-[var(--ds-shadow-lg)]",
          className,
        )}
      >
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  danger,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  danger?: boolean;
}) {
  return (
    <DropdownPrimitive.Item
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] outline-none transition-colors",
        danger
          ? "text-[var(--ds-danger)] data-[highlighted]:bg-[var(--ds-danger-soft)]"
          : "text-[var(--ds-ink)] data-[highlighted]:bg-[var(--ds-hover)]",
      )}
    >
      {children}
    </DropdownPrimitive.Item>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--ds-dim)]">
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-[var(--ds-line)]" />;
}
