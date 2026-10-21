"use client";
export default function Footer() {
  const nav = [
    {
      heading: "Shop",
      links: [
        { label: "Trial Pack", href: "#order" },
        { label: "Starter Kit", href: "#order" },
        { label: "Monthly Subscription", href: "#order" },
        { label: "Astro Sense Clip", href: "#order" },
        { label: "Size Guide", href: "#" },
      ],
    },
    {
      heading: "Company",
      links: [
        { label: "How It Works", href: "#how-it-works" },
        { label: "Astro Sense", href: "#sense" },
        { label: "Products", href: "#products" },
        { label: "Contact", href: "mailto:hello@astroovernightdiapers.com" },
      ],
    },
    {
      heading: "Support",
      links: [
        { label: "FAQ", href: "#" },
        { label: "Shipping & Returns", href: "#" },
        { label: "Subscription Help", href: "#" },
        { label: "Privacy Policy", href: "#" },
        { label: "Terms of Service", href: "#" },
      ],
    },
  ];

  return (
    <footer style={{ paddingTop: "5rem", paddingBottom: "3rem" }}>
      <div className="container">
        <div className="rule" style={{ marginBottom: "4rem" }} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))",
            gap: "3rem",
            marginBottom: "4rem",
          }}
        >
          {/* Brand */}
          <div style={{ gridColumn: "span 1" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.625rem",
                marginBottom: "1rem",
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: "#c8a84a",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#06080f",
                  fontWeight: 800,
                  fontSize: "0.7rem",
                  flexShrink: 0,
                }}
              >
                A
              </span>
              <span style={{ color: "#f0ede8", fontWeight: 700, fontSize: "0.9rem" }}>Astro Overnight</span>
            </div>
            <p style={{ fontSize: "0.825rem", lineHeight: 1.65, color: "#515b6e", maxWidth: "22ch" }}>
              Premium overnight diaper system. Built for families who believe nights should be peaceful.
            </p>
          </div>

          {/* Nav columns */}
          {nav.map((col) => (
            <div key={col.heading}>
              <p
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "#515b6e",
                  marginBottom: "1rem",
                }}
              >
                {col.heading}
              </p>
              <ul style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      style={{
                        fontSize: "0.85rem",
                        color: "#8a94a6",
                        textDecoration: "none",
                        transition: "color 0.15s",
                      }}
                      onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#f0ede8")}
                      onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "#8a94a6")}
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="rule" style={{ marginBottom: "1.75rem" }} />

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
          }}
        >
          <p style={{ fontSize: "0.775rem", color: "#515b6e" }}>
            &copy; 2026 Astro Overnight, Inc. All rights reserved.
          </p>
          <p style={{ fontSize: "0.775rem", color: "#515b6e" }}>
            Secure checkout by Stripe &nbsp;&middot;&nbsp; Ships from Austin, TX
          </p>
        </div>
      </div>
    </footer>
  );
}
