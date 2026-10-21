"use client";
const products = [
  {
    id: "core",
    label: "Astro Overnight Core",
    headline: "The overnight diaper, rebuilt.",
    features: [
      "Extended absorbency for 10–12 hours",
      "Contour-fit leg cuffs for nighttime movement",
      "Breathable outer layer",
      "Wetness indicator strip",
      "Hypoallergenic, fragrance-free",
    ],
    available: true,
  },
  {
    id: "sense",
    label: "Astro Sense",
    headline: "Optional smart layer.",
    features: [
      "Reusable magnetic clip",
      "Three states: All Good / Check Soon / Change Now",
      "Silent, sleep-preserving alerts",
      "Bluetooth Low Energy, no WiFi required",
      "3-month battery life",
    ],
    available: true,
  },
  {
    id: "transition",
    label: "Astro Transition",
    headline: "Readiness support, not pressure.",
    features: [
      "For toddlers 18–36 months",
      "AAP-aligned readiness framing",
      "Dry-stretch tracking via the app",
      "Positive reinforcement, no punishment",
    ],
    available: false,
  },
];

export default function Products() {
  return (
    <section id="products" style={{ paddingTop: "6rem", paddingBottom: "6rem" }}>
      <div className="container">
        <div className="rule" style={{ marginBottom: "5rem" }} />

        <p className="label" style={{ marginBottom: "1rem" }}>The system</p>
        <h2
          style={{
            fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)",
            fontWeight: 700,
            letterSpacing: "-0.025em",
            lineHeight: 1.15,
            color: "#f0ede8",
            maxWidth: "22ch",
            marginBottom: "3.5rem",
          }}
        >
          Start with the diaper. Add sensing when you want it.
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
            gap: "1.25rem",
          }}
        >
          {products.map((p) => (
            <div
              key={p.id}
              className="card"
              style={{
                padding: "1.75rem",
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
                opacity: p.available ? 1 : 0.65,
                position: "relative",
              }}
            >
              {!p.available && (
                <span
                  style={{
                    position: "absolute",
                    top: "1.25rem",
                    right: "1.25rem",
                    fontSize: "0.6rem",
                    fontWeight: 600,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "#515b6e",
                    border: "1px solid rgba(255,255,255,0.08)",
                    padding: "0.2rem 0.5rem",
                    borderRadius: "4px",
                  }}
                >
                  Coming Soon
                </span>
              )}

              <div>
                <p className="label" style={{ marginBottom: "0.375rem" }}>{p.label}</p>
                <h3
                  style={{
                    fontSize: "1.1rem",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    color: "#f0ede8",
                    lineHeight: 1.25,
                  }}
                >
                  {p.headline}
                </h3>
              </div>

              <ul style={{ display: "flex", flexDirection: "column", gap: "0.5rem", flexGrow: 1 }}>
                {p.features.map((f) => (
                  <li
                    key={f}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "0.5rem",
                      fontSize: "0.8rem",
                      color: "#8a94a6",
                      lineHeight: 1.45,
                    }}
                  >
                    <span style={{ color: "#c8a84a", flexShrink: 0 }}>+</span>
                    {f}
                  </li>
                ))}
              </ul>

              {p.available && (
                <a
                  href="#order"
                  style={{
                    marginTop: "0.25rem",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    color: "#c8a84a",
                    textDecoration: "none",
                  }}
                >
                  Shop {p.label} &rarr;
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
