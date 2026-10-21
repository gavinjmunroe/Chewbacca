"use client";
import { useState, useEffect } from "react";

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 32);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-400 ${
        scrolled ? "bg-[#06080f]/95 backdrop-blur-md border-b border-white/[0.06]" : "bg-transparent"
      }`}
      style={{ paddingTop: "1rem", paddingBottom: "1rem" }}
    >
      <div className="container" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <a href="#" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "#c8a84a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#06080f",
              fontWeight: 800,
              fontSize: "0.75rem",
              flexShrink: 0,
            }}
          >
            A
          </span>
          <span style={{ color: "#f0ede8", fontWeight: 700, fontSize: "1rem", letterSpacing: "-0.01em" }}>
            Astro Overnight
          </span>
        </a>

        {/* Desktop links */}
        <div
          className="hidden md:flex"
          style={{ alignItems: "center", gap: "2.25rem" }}
        >
          {[
            { label: "How It Works", href: "#how-it-works" },
            { label: "Products", href: "#products" },
            { label: "Astro Sense", href: "#sense" },
          ].map((l) => (
            <a
              key={l.href}
              href={l.href}
              style={{
                color: "#8a94a6",
                fontSize: "0.875rem",
                fontWeight: 500,
                textDecoration: "none",
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#f0ede8")}
              onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "#8a94a6")}
            >
              {l.label}
            </a>
          ))}
        </div>

        <a href="#order" className="btn-primary hidden md:inline-block" style={{ padding: "0.625rem 1.375rem", fontSize: "0.8rem" }}>
          Shop Now
        </a>

        {/* Mobile toggle */}
        <button
          className="md:hidden"
          onClick={() => setOpen(!open)}
          style={{ background: "none", border: "none", cursor: "pointer", padding: "4px" }}
          aria-label="Menu"
        >
          <div style={{ width: 20, display: "flex", flexDirection: "column", gap: 5 }}>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  display: "block",
                  height: 1.5,
                  background: "#f0ede8",
                  borderRadius: 1,
                  transition: "all 0.2s",
                  opacity: open && i === 1 ? 0 : 1,
                  transform:
                    open && i === 0 ? "rotate(45deg) translateY(6.5px)" :
                    open && i === 2 ? "rotate(-45deg) translateY(-6.5px)" : "none",
                }}
              />
            ))}
          </div>
        </button>
      </div>

      {open && (
        <div
          className="md:hidden container"
          style={{
            paddingTop: "1.25rem",
            paddingBottom: "1.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            borderTop: "1px solid rgba(255,255,255,0.07)",
            marginTop: "1rem",
          }}
        >
          {[
            { label: "How It Works", href: "#how-it-works" },
            { label: "Products", href: "#products" },
            { label: "Astro Sense", href: "#sense" },
          ].map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              style={{ color: "#8a94a6", fontSize: "0.9rem", textDecoration: "none" }}
            >
              {l.label}
            </a>
          ))}
          <a href="#order" className="btn-primary" style={{ textAlign: "center", marginTop: "0.25rem" }} onClick={() => setOpen(false)}>
            Shop Now
          </a>
        </div>
      )}
    </nav>
  );
}
