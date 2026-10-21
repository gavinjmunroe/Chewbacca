"use client";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import Nav from "./nav";
import type { UserRole } from "@/types/database";

interface Props {
  role: UserRole;
  displayName: string;
  avatarUrl?: string | null;
  unreadNotifications?: number;
}

export default function MobileNavToggle({ role, displayName, avatarUrl, unreadNotifications }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        className="lg:hidden fixed top-4 left-4 z-50 w-10 h-10 bg-white/10 backdrop-blur rounded-xl flex items-center justify-center border border-white/10"
      >
        <Menu className="w-5 h-5" />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setOpen(false)}
            className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-30"
          />
          {/* Nav panel — clicking any link closes it */}
          <div onClick={() => setOpen(false)} className="lg:hidden">
            <Nav
              role={role}
              displayName={displayName}
              avatarUrl={avatarUrl}
              unreadNotifications={unreadNotifications}
            />
            {/* Close button inside panel */}
            <button
              onClick={() => setOpen(false)}
              aria-label="Close navigation menu"
              className="fixed top-4 left-[calc(228px_-_44px)] z-50 w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </>
      )}
    </>
  );
}
