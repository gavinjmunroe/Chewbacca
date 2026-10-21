"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/cashflow", label: "Cash Flow" },
  { href: "/tax", label: "Tax" },
  { href: "/invoices", label: "Invoices" },
  { href: "/spending", label: "Spending" },
  { href: "/energy", label: "Energy" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/contracts", label: "Contracts" },
  { href: "/docket", label: "Docket" },
  { href: "/split", label: "Split" },
  { href: "/updates", label: "Updates" },
  { href: "/data", label: "Data" },
  { href: "/settings", label: "Settings" },
];

export default function Nav() {
  const path = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <header
      className="glass-nav"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        height: 52,
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        gap: 0,
      }}
    >
      {/* Logo */}
      <Link
        href="/dashboard"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          textDecoration: "none",
          marginRight: 32,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "linear-gradient(145deg,#1c2e1e,#0d1a0f)",
            border: "1px solid rgba(48,209,88,0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 32 32" fill="none">
            <path
              d="M16 4L28 10L28 22L16 28L4 22L4 10Z"
              stroke="#30d158"
              strokeWidth="2"
              fill="none"
              strokeLinejoin="round"
            />
            <path
              d="M16 10L22 13.5L22 20.5L16 24L10 20.5L10 13.5Z"
              fill="rgba(48,209,88,0.2)"
              stroke="#30d158"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span className="t-headline" style={{ color: "var(--label)" }}>
          FiduciaryOS
        </span>
      </Link>

      {/* Nav links */}
      <nav style={{ display: "flex", gap: 4, flex: 1 }}>
        {LINKS.map(({ href, label }) => {
          const active = path === href;
          return (
            <Link
              key={href}
              href={href}
              style={{
                padding: "5px 12px",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: active ? 600 : 400,
                color: active ? "var(--label)" : "var(--label-2)",
                background: active ? "var(--surface-2)" : "transparent",
                textDecoration: "none",
                transition: "background 0.15s, color 0.15s",
                letterSpacing: "-0.24px",
              }}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <button
        onClick={logout}
        style={{
          padding: "5px 12px",
          borderRadius: 8,
          fontSize: 14,
          color: "var(--label-3)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "var(--font)",
          letterSpacing: "-0.24px",
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--red)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--label-3)")}
      >
        Sign out
      </button>
    </header>
  );
}
