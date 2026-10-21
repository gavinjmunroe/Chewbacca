"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Users, Briefcase, Calendar, Bookmark,
  BookOpen, User, LogOut, Bell, Settings, Film, ShieldCheck,
  ShieldAlert, MessageSquare,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/types/database";
import NavUnreadBadge, { NavUnreadPill } from "@/components/nav-unread-badge";
import SearchBar from "@/components/search-bar";

const DANCER_NAV = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/jobs", icon: Briefcase, label: "Jobs" },
  { href: "/dashboard/camps", icon: Calendar, label: "Camps" },
  { href: "/dashboard/bookings", icon: BookOpen, label: "Bookings" },
  { href: "/dashboard/messages", icon: MessageSquare, label: "Messages" },
  { href: "/dashboard/portfolio", icon: Film, label: "Portfolio" },
  { href: "/dashboard/profile", icon: User, label: "Profile" },
  { href: "/dashboard/settings", icon: Settings, label: "Settings" },
];

const RECRUITER_NAV = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/dancers", icon: Users, label: "Find Creatives" },
  { href: "/dashboard/jobs", icon: Briefcase, label: "My Jobs" },
  { href: "/dashboard/shortlists", icon: Bookmark, label: "Shortlists" },
  { href: "/dashboard/bookings", icon: BookOpen, label: "Bookings" },
  { href: "/dashboard/messages", icon: MessageSquare, label: "Messages" },
  { href: "/dashboard/profile", icon: User, label: "Profile" },
  { href: "/dashboard/settings", icon: Settings, label: "Settings" },
];

const VERIFIER_NAV = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/verify", icon: ShieldCheck, label: "Verify Queue" },
  { href: "/dashboard/profile", icon: User, label: "Profile" },
  { href: "/dashboard/settings", icon: Settings, label: "Settings" },
];

const ADMIN_NAV = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/admin", icon: ShieldAlert, label: "Admin Panel" },
  { href: "/dashboard/verify", icon: ShieldCheck, label: "Verify Queue" },
  { href: "/dashboard/profile", icon: User, label: "Profile" },
  { href: "/dashboard/settings", icon: Settings, label: "Settings" },
];

interface NavProps {
  role: UserRole;
  displayName: string;
  avatarUrl?: string | null;
  unreadNotifications?: number;
  userId?: string;
}

export default function Nav({ role, displayName, avatarUrl, unreadNotifications = 0, userId = "" }: NavProps) {
  const pathname = usePathname();
  const router = useRouter();

  const navItems =
    role === "admin"
      ? ADMIN_NAV
      : role === "recruiter"
      ? RECRUITER_NAV
      : role === "verifier"
      ? VERIFIER_NAV
      : DANCER_NAV; // covers "dancer" | "creative" | unknown

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
  }

  return (
    <aside className="fixed left-0 top-0 h-full w-[228px] flex flex-col z-40 bg-[rgba(28,28,30,0.94)] backdrop-blur-xl border-r border-white/[0.08]">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/[0.07]">
        <Link href="/" className="flex items-center gap-2.5 group">
          <Image
            src="/egatslogosimple.png"
            alt="EGATS"
            width={28}
            height={28}
            className="w-7 h-7 object-contain"
            style={{ filter: "invert(40%) sepia(1) saturate(4) hue-rotate(242deg) brightness(1.1)" }}
          />
          <div>
            <div className="text-base font-bold tracking-tight gradient-text leading-none">EGATS</div>
            <div className="text-[9px] text-white/25 uppercase tracking-widest mt-0.5">
              {role === "recruiter"
                ? "Recruiter"
                : role === "verifier"
                ? "Verifier"
                : role === "admin"
                ? "Admin"
                : "Creative"}{" "}
              Portal
            </div>
          </div>
        </Link>
      </div>

      {/* Search */}
      <div className="pt-3">
        <SearchBar />
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-2 px-2.5 overflow-y-auto">
        <div className="flex flex-col gap-0.5">
          {navItems.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-[13.5px] tracking-tight transition-all ${
                  active
                    ? "font-semibold text-violet-300 bg-violet-500/[0.15] shadow-[inset_0_0_0_1px_rgba(191,90,242,0.15)]"
                    : "font-normal text-white/45 hover:text-white/80 hover:bg-white/[0.06]"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </Link>
            );
          })}

          {/* Notifications */}
          <Link
            href="/dashboard/notifications"
            className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-[13.5px] tracking-tight transition-all ${
              pathname === "/dashboard/notifications"
                ? "font-semibold text-violet-300 bg-violet-500/[0.15] shadow-[inset_0_0_0_1px_rgba(191,90,242,0.15)]"
                : "font-normal text-white/45 hover:text-white/80 hover:bg-white/[0.06]"
            }`}
          >
            <div className="relative shrink-0">
              <Bell className="w-4 h-4" />
              {userId && (
                <NavUnreadBadge initialCount={unreadNotifications} userId={userId} />
              )}
            </div>
            Notifications
            {userId && (
              <NavUnreadPill initialCount={unreadNotifications} userId={userId} />
            )}
          </Link>
        </div>
      </nav>

      {/* User area */}
      <div className="p-3 border-t border-white/[0.07]">
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/[0.06]">
          <div className="w-8 h-8 rounded-full bg-violet-500/25 border-2 border-violet-500/50 flex items-center justify-center text-[11px] font-bold text-violet-400 shrink-0 overflow-hidden">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={displayName}
                width={32}
                height={32}
                className="w-full h-full object-cover"
                placeholder="blur"
                blurDataURL="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
              />
            ) : (
              displayName.slice(0, 2).toUpperCase()
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-white truncate">{displayName}</div>
            <div className="text-[11px] text-white/30 capitalize">{role}</div>
          </div>
          <button
            onClick={signOut}
            title="Sign out"
            aria-label="Sign out"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-white/28 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
