export default function Hero() {
  return (
    <section
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        paddingTop: "8rem",
        paddingBottom: "6rem",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Subtle radial glow — purely decorative */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: "30%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(800px, 100vw)",
          height: "min(800px, 100vw)",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(200,168,74,0.055) 0%, transparent 68%)",
          pointerEvents: "none",
        }}
      />

      <div className="container" style={{ position: "relative", zIndex: 1 }}>
        {/* Eyebrow */}
        <p className="label fade-up" style={{ marginBottom: "1.75rem" }}>
          Premium overnight diaper system
        </p>

        {/* Headline */}
        <h1
          className="fade-up delay-1"
          style={{
            fontSize: "clamp(2.75rem, 7.5vw, 7rem)",
            fontWeight: 800,
            lineHeight: 1.0,
            letterSpacing: "-0.035em",
            color: "#f0ede8",
            maxWidth: "14ch",
            marginBottom: "2rem",
          }}
        >
          Better nights.<br />
          <span style={{ color: "#c8a84a" }}>Fewer leaks.</span><br />
          Less guessing.
        </h1>

        {/* Subhead */}
        <p
          className="fade-up delay-2"
          style={{
            fontSize: "clamp(1rem, 1.8vw, 1.25rem)",
            lineHeight: 1.65,
            color: "#8a94a6",
            maxWidth: "48ch",
            marginBottom: "2.75rem",
          }}
        >
          Better absorbency, precision fit, and optional smart sensing. Built for nights that need to actually work.
        </p>

        {/* CTAs */}
        <div
          className="fade-up delay-3"
          style={{ display: "flex", flexWrap: "wrap", gap: "0.875rem", alignItems: "center" }}
        >
          <a href="#order" className="btn-primary">
            Shop Starter Kit
          </a>
          <a href="#how-it-works" className="btn-outline">
            How It Works
          </a>
        </div>

        {/* Simple trust line */}
        <p
          className="fade-up delay-4"
          style={{
            marginTop: "2.5rem",
            fontSize: "0.8rem",
            color: "#515b6e",
            letterSpacing: "0.03em",
          }}
        >
          Free shipping &nbsp;&middot;&nbsp; 30-day guarantee &nbsp;&middot;&nbsp; Cancel subscription anytime
        </p>
      </div>
    </section>
  );
}
