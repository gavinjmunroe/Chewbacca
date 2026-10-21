const steps = [
  {
    n: "01",
    heading: "Choose your kit",
    body: "Trial pack or monthly subscription. Pick your baby's size.",
  },
  {
    n: "02",
    heading: "Put Astro on at bedtime",
    body: "Works like any diaper. Contour fit and extended absorbency active from first use.",
  },
  {
    n: "03",
    heading: "Add Astro Sense if you want it",
    body: "Clip on the sensor, connect to the app in 30 seconds.",
  },
  {
    n: "04",
    heading: "Sleep",
    body: "No alert means no reason to check. Silent nudge when the threshold is crossed.",
  },
  {
    n: "05",
    heading: "Refill automatically",
    body: "Skip, pause, or cancel any time. We size up when your baby does.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" style={{ paddingTop: "6rem", paddingBottom: "6rem" }}>
      <div className="container">
        <div className="rule" style={{ marginBottom: "5rem" }} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))",
            gap: "4rem",
            alignItems: "start",
          }}
        >
          {/* Left */}
          <div style={{ position: "sticky", top: "7rem" }}>
            <p className="label" style={{ marginBottom: "1rem" }}>How it works</p>
            <h2
              style={{
                fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)",
                fontWeight: 700,
                letterSpacing: "-0.025em",
                lineHeight: 1.15,
                color: "#f0ede8",
                marginBottom: "2rem",
              }}
            >
              Box to better nights in five steps.
            </h2>
            <a href="#order" className="btn-primary">Get Started</a>
          </div>

          {/* Right */}
          <div>
            {steps.map((s, i) => (
              <div
                key={s.n}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2.5rem 1fr",
                  gap: "1.25rem",
                  paddingTop: "1.5rem",
                  paddingBottom: "1.5rem",
                  borderTop: "1px solid rgba(255,255,255,0.07)",
                  borderBottom: i === steps.length - 1 ? "1px solid rgba(255,255,255,0.07)" : "none",
                }}
              >
                <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "#c8a84a", letterSpacing: "0.06em", paddingTop: "0.15rem" }}>
                  {s.n}
                </span>
                <div>
                  <p style={{ fontSize: "0.925rem", fontWeight: 600, color: "#f0ede8", marginBottom: "0.3rem", letterSpacing: "-0.01em" }}>
                    {s.heading}
                  </p>
                  <p style={{ fontSize: "0.85rem", lineHeight: 1.65, color: "#8a94a6" }}>
                    {s.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
