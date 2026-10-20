"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Navbar, TopBar } from "@/components/layout/navbar";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";

  if (isLogin) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <>
      <Navbar />
      <TopBar />
      <main className="min-h-screen pb-24">{children}</main>
    </>
  );
}
