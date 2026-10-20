"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useScrollNav } from "@/hooks/use-scroll-nav";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Briefcase,
  Phone,
  ListChecks,
  Settings,
  Sparkles,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/engagements", label: "Engagements", icon: Briefcase },
  { href: "/dialer", label: "Dialer", icon: Phone },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/admin", label: "Admin", icon: Settings },
];

export function Navbar() {
  const pathname = usePathname();
  const visible = useScrollNav();
  const isLogin = pathname === "/login";
  if (isLogin) return null;

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-zinc-950/80 border-b border-zinc-800/50"
      style={{
        transform: visible ? "translateY(0)" : "translateY(-100%)",
        opacity: visible ? 1 : 0,
        transition: "transform 0.3s ease, opacity 0.3s ease",
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 text-zinc-50 font-semibold tracking-tight"
        >
          <span className="grid place-items-center w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </span>
          Togari
          <span className="text-zinc-500 text-xs font-normal pl-1">
            / 48 North
          </span>
        </Link>
        <div className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer",
                  active
                    ? "bg-zinc-800 text-zinc-50"
                    : "text-zinc-400 hover:text-zinc-50 hover:bg-white/5",
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            48n live
          </span>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-xs font-semibold text-white">
            KP
          </div>
        </div>
      </div>
    </nav>
  );
}

export function TopBar() {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  return (
    <div className="sticky top-0 z-40 backdrop-blur-md bg-zinc-950/70 border-b border-zinc-800/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 text-zinc-50 font-semibold tracking-tight text-sm"
        >
          <span className="grid place-items-center w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </span>
          Togari
          <span className="text-zinc-500 text-xs font-normal pl-1">
            / 48 North
          </span>
        </Link>
        <div className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer",
                  active
                    ? "bg-zinc-800 text-zinc-50"
                    : "text-zinc-400 hover:text-zinc-50 hover:bg-white/5",
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            48n live
          </span>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-xs font-semibold text-white">
            KP
          </div>
        </div>
      </div>
    </div>
  );
}
