const problems = [
  {
    n: "01",
    heading: "Uncertainty",
    body: "You don't know if it's the diaper. So you check. Now everyone's up.",
  },
  {
    n: "02",
    heading: "Leakage",
    body: "Diapers fail because of fit and saturation, not just absorbency. The wrong size leaks regardless.",
  },
  {
    n: "03",
    heading: "Skin health",
    body: "Moisture and stool left too long irritate skin. Timing matters as much as material.",
  },
  {
    n: "04",
    heading: "Sleep fragmentation",
    body: "Over-check and you wake your baby. Under-check and you risk a leak. That's the trade-off every night.",
  },
  {
    n: "05",
    heading: "Transition",
    body: "When it's time for potty training, most families start from scratch.",
  },
];

export default function Problem() {
  return (
    <section style={{ paddingTop: "6rem", paddingBottom: "6rem" }}>
      <div className="container">
        <div className="rule" style={{ marginBottom: "5rem" }} />

        <div style={{ marginBottom: "3rem" }}>
          <p className="label" style={{ marginBottom: "1rem" }}>The problem</p>
          <h2
            style={{
              fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              lineHeight: 1.15,
              color: "#f0ede8",
              maxWidth: "26ch",
            }}
          >
            Nighttime is still the most poorly served moment in baby care.
          </h2>
        </div>

        <div>
          {problems.map((p, i) => (
            <div
              key={p.n}
              style={{
                display: "grid",
                gridTemplateColumns: "2.5rem 1fr 2fr",
                gap: "1.5rem",
                paddingTop: "1.5rem",
                paddingBottom: "1.5rem",
                borderTop: "1px solid rgba(255,255,255,0.07)",
                borderBottom: i === problems.length - 1 ? "1px solid rgba(255,255,255,0.07)" : "none",
                alignItems: "baseline",
              }}
            >
              <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "#515b6e", letterSpacing: "0.06em" }}>
                {p.n}
              </span>
              <p style={{ fontSize: "0.9rem", fontWeight: 600, color: "#f0ede8", letterSpacing: "-0.01em" }}>
                {p.heading}
              </p>
              <p style={{ fontSize: "0.85rem", lineHeight: 1.65, color: "#8a94a6" }}>
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
