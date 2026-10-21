"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MotionProvider } from "@/components/MotionProvider";
import {
  Home,
  MessageSquare,
  Heart,
  Users,
  Activity,
  BookOpen,
  Calendar,
  CheckSquare,
  FolderGit2,
  LogOut,
  Globe,
  Mail,
  Brain,
  Compass,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/health", label: "Health", icon: Heart },
  { href: "/web", label: "WEB", icon: Globe },
  { href: "/clearout", label: "ClearOut", icon: Mail },
  { href: "/wellbeing", label: "Wellbeing", icon: Brain },
  { href: "/lifeplan", label: "LifePlan", icon: Compass },
  { href: "/fiduciary", label: "Fiduciary", icon: Shield },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/contacts", label: "People", icon: Users },
  { href: "/projects", label: "Projects", icon: FolderGit2 },
  { href: "/interactions", label: "Feed", icon: Activity },
  { href: "/context", label: "Context", icon: BookOpen },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="flex h-screen bg-zinc-950 overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-52 border-r border-zinc-800/50 shrink-0">
        <div className="px-4 py-4 border-b border-zinc-800/50">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-indigo-400" />
            </div>
            <span className="font-semibold text-zinc-100 tracking-tight text-sm">
              Amber
            </span>
          </div>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 group",
                  active
                    ? "bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
                    : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60",
                )}
              >
                <Icon
                  className={cn(
                    "w-4 h-4 shrink-0",
                    active
                      ? "text-indigo-400"
                      : "text-zinc-600 group-hover:text-zinc-400",
                  )}
                />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="px-2 py-3 border-t border-zinc-800/50">
          <button
            onClick={logout}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/60 transition-all duration-150 cursor-pointer w-full"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
        <MotionProvider>{children}</MotionProvider>
      </main>

      {/* Bottom bar, mobile */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-zinc-950/95 backdrop-blur-md border-t border-zinc-800/50 flex">
        {NAV.slice(0, 6).map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex-1 flex flex-col items-center justify-center py-2.5 gap-1 transition-colors",
                active
                  ? "text-indigo-400"
                  : "text-zinc-600 hover:text-zinc-400",
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
