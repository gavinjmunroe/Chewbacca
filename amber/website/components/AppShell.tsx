"use client";

/**
 * THE SHELL — a rail on the left, a scrolling column beside it.
 *
 * WHY THE NAVIGATION MOVED OFF THE TOP. A tab bar in the header puts the
 * answer to "where am I" on the same line as the company's name and the
 * workspace switcher and the sign-out button, and at that point none of the
 * four is findable. It also caps the product at however many words fit across
 * one line, which is why the console had five tabs and needed eight.
 *
 * A rail has room, keeps the current section visible without being re-read,
 * and -- the part that actually fixed the "everything is spread apart"
 * complaint -- it gives the content a left edge to line up against. The old
 * layout centred a 1400px column on a 1900px screen, so every card floated in
 * its own amount of nothing.
 *
 * THE RAIL IS DARKER THAN THE PAGE. A white rail beside white cards makes the
 * content look like a hole cut in the chrome. An inset one makes the cards
 * look like they are resting on something, which is the only reason elevation
 * reads at all on a light ground.
 */

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, LogOut } from "lucide-react";
import { clearSession } from "@/lib/amber";
import { AmberMark } from "@/components/Marks";
import { Avatar, Button, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui";
import { cn } from "@/lib/cn";

export type NavItem<T extends string> = {
  key: T;
  label: string;
  icon: React.ReactNode;
  /*
   * HOW MANY THINGS NEED YOU — never how many things exist.
   *
   * The rail used to carry a count beside Knowledge, Files, Feed and People,
   * and all four were totals. "Files 31" said there are thirty-one files,
   * which you find out by opening Files, and it said it in the visual language
   * every product reserves for "something happened". A badge that always has a
   * number on it is a badge nobody reads, so the only thing that gets one now
   * is unread.
   */
  unread?: number;
  /** Pushed to the bottom of the rail, above the account block. */
  foot?: boolean;
};

export function AppShell<T extends string>({
  product,
  subtitle,
  nav,
  active,
  onNavigate,
  workspace,
  account,
  /** The content fills the viewport and manages its own scrolling (a canvas). */
  fill,
  children,
}: {
  product: string;
  subtitle?: string;
  nav: NavItem<T>[];
  active: T;
  onNavigate: (k: T) => void;
  /** The workspace switcher, rendered in the rail under the product name. */
  workspace?: React.ReactNode;
  account?: { name: string | null; detail?: string | null };
  fill?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // A route change is the one thing that should always close the mobile rail.
  // Leaving it open over the new page is how a menu becomes a modal nobody
  // asked for.
  React.useEffect(() => setOpen(false), [pathname]);

  const main = nav.filter((n) => !n.foot);
  const foot = nav.filter((n) => n.foot);

  const rail = (
    <aside className="ds-rail flex h-full w-[232px] shrink-0 flex-col">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <AmberMark size={26} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-[var(--ds-ink)]">{product}</div>
          {subtitle ? (
            <div className="truncate text-[11px] text-[var(--ds-dim)]">{subtitle}</div>
          ) : null}
        </div>
      </div>

      {workspace ? <div className="px-3 pb-3">{workspace}</div> : null}

      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3">
        {main.map((n) => (
          <RailButton key={n.key} item={n} on={active === n.key} onClick={() => onNavigate(n.key)} />
        ))}
        <div className="flex-1" />
        {foot.length ? (
          <>
            <div className="my-2 h-px bg-[var(--ds-line)]" />
            {foot.map((n) => (
              <RailButton key={n.key} item={n} on={active === n.key} onClick={() => onNavigate(n.key)} />
            ))}
          </>
        ) : null}
      </nav>

      {account ? (
        <div className="border-t border-[var(--ds-line)] p-3">
          <Menu>
            <MenuTrigger asChild>
              <button className="ds-nav-item">
                <Avatar name={account.name} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-[var(--ds-ink)]">
                    {account.name ?? "Signed in"}
                  </span>
                  {account.detail ? (
                    <span className="block truncate text-[11px] font-normal text-[var(--ds-dim)]">
                      {account.detail}
                    </span>
                  ) : null}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-[var(--ds-dim)]" />
              </button>
            </MenuTrigger>
            <MenuContent align="start">
              <MenuLabel>{account.detail ?? "Account"}</MenuLabel>
              <MenuSeparator />
              <MenuItem
                danger
                onSelect={() => {
                  clearSession();
                  router.replace("/login");
                }}
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      ) : null}
    </aside>
  );

  return (
    <div data-surface="enterprise" className="flex h-screen w-screen overflow-hidden">
      <div className="hidden md:flex">{rail}</div>

      {/* The rail on a phone is a sheet, because 232px of a 390px screen is
          not a rail, it is the screen. */}
      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-[rgba(11,17,31,0.32)]" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 shadow-[var(--ds-shadow-lg)]">{rail}</div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <button
          className="ds-nav-item m-3 w-auto self-start md:hidden"
          onClick={() => setOpen(true)}
        >
          Menu
        </button>
        <main className={cn("min-h-0 flex-1", fill ? "overflow-hidden" : "overflow-y-auto")}>
          {children}
        </main>
      </div>
    </div>
  );
}

function RailButton<T extends string>({
  item,
  on,
  onClick,
}: {
  item: NavItem<T>;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button className="ds-nav-item" data-on={on} onClick={onClick}>
      <span className="ds-nav-icon">{item.icon}</span>
      <span className="flex-1">{item.label}</span>
      {typeof item.unread === "number" && item.unread > 0 ? (
        <span className="tnum rounded-full bg-[var(--ds-accent)] px-1.5 text-[11px] font-medium leading-5 text-white">
          {item.unread > 99 ? "99+" : item.unread}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The band at the top of a page: what you are looking at, and what you can do
 * to it. It is sticky because the primary action on a long page should not
 * require scrolling back up to find.
 */
export function PageHeader({
  title,
  note,
  actions,
  children,
}: {
  title: string;
  note?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 border-b border-[var(--ds-line)] bg-[rgba(245,246,248,0.86)] px-6 py-4 backdrop-blur-md lg:px-8">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold text-[var(--ds-ink)]">{title}</h1>
          {note ? <p className="mt-0.5 text-[13px] text-[var(--ds-muted)]">{note}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mx-auto mt-3 max-w-[1240px]">{children}</div> : null}
    </div>
  );
}

/**
 * The scrolling column.
 *
 * THE BOTTOM PADDING IS NOT DECORATION. Without it the last card ends exactly
 * at the viewport edge, which reads as "this is the end" even when it is not,
 * and leaves a menu opened on the last row nowhere to go. Every tool worth
 * using lets you scroll a little past the end of the content.
 */
export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto max-w-[1240px] px-6 pb-24 pt-6 lg:px-8", className)}>
      {children}
    </div>
  );
}
