export default function Sense() {
  return (
    <section id="sense" style={{ paddingTop: "6rem", paddingBottom: "6rem" }}>
      <div className="container">
        <div className="rule" style={{ marginBottom: "5rem" }} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))",
            gap: "5rem",
            alignItems: "start",
          }}
        >
          {/* Left */}
          <div>
            <p className="label" style={{ marginBottom: "1rem" }}>Astro Sense</p>
            <h2
              style={{
                fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)",
                fontWeight: 700,
                letterSpacing: "-0.025em",
                lineHeight: 1.15,
                color: "#f0ede8",
                marginBottom: "1.5rem",
              }}
            >
              One question. Does this need your attention right now?
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "2rem" }}>
              {[
                "Reusable magnetic clip, no disposable electronics",
                "Passive strip, no electronics inside the diaper",
                "Bluetooth Low Energy, no WiFi needed",
                "Silent alerts only, no sounds",
                "3-month battery life",
              ].map((f) => (
                <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: "0.625rem" }}>
                  <span style={{ color: "#c8a84a", fontSize: "0.75rem", marginTop: "0.15rem", flexShrink: 0 }}>+</span>
                  <span style={{ fontSize: "0.85rem", color: "#8a94a6", lineHeight: 1.5 }}>{f}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right — three states */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
            <p
              style={{
                fontSize: "0.65rem",
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "#515b6e",
                marginBottom: "0.25rem",
              }}
            >
              The three states
            </p>

            {[
              {
                state: "All Good",
                desc: "Saturation within range. No action needed.",
                dot: "#4ade80",
                bg: "rgba(74,222,128,0.05)",
                border: "rgba(74,222,128,0.15)",
              },
              {
                state: "Check Soon",
                desc: "Approaching threshold. Plan to check within the hour.",
                dot: "#c8a84a",
                bg: "rgba(200,168,74,0.05)",
                border: "rgba(200,168,74,0.18)",
              },
              {
                state: "Change Now",
                desc: "Threshold crossed, or stool detected. Time to intervene.",
                dot: "#f87171",
                bg: "rgba(248,113,113,0.05)",
                border: "rgba(248,113,113,0.15)",
              },
            ].map((s) => (
              <div
                key={s.state}
                style={{
                  padding: "1.125rem 1.25rem",
                  borderRadius: "10px",
                  background: s.bg,
                  border: `1px solid ${s.border}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.dot, flexShrink: 0 }} />
                  <span style={{ fontSize: "0.85rem", fontWeight: 700, color: s.dot }}>{s.state}</span>
                </div>
                <p style={{ fontSize: "0.8rem", lineHeight: 1.55, color: "#8a94a6", paddingLeft: "1.1rem" }}>
                  {s.desc}
                </p>
              </div>
            ))}

          </div>
        </div>
      </div>
    </section>
  );
}
