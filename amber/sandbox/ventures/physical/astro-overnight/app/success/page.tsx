export default function SuccessPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem 1.5rem",
      }}
    >
      <div style={{ maxWidth: "480px", width: "100%", textAlign: "center" }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "rgba(74,222,128,0.12)",
            border: "1px solid rgba(74,222,128,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 2rem",
            fontSize: "1.25rem",
            color: "#4ade80",
            fontWeight: 700,
          }}
        >
          +
        </div>

        <h1
          style={{
            fontSize: "clamp(1.75rem, 4vw, 2.5rem)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            color: "#f0ede8",
            marginBottom: "1rem",
            lineHeight: 1.15,
          }}
        >
          Better nights are on the way.
        </h1>

        <p
          style={{
            fontSize: "1rem",
            lineHeight: 1.7,
            color: "#8a94a6",
            marginBottom: "2.5rem",
          }}
        >
          Your order is confirmed. We&apos;ll send a shipping confirmation within 24 hours.
        </p>

        <div
          style={{
            background: "#0c0f1a",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "10px",
            padding: "1.5rem",
            textAlign: "left",
            display: "flex",
            flexDirection: "column",
            gap: "0.875rem",
            marginBottom: "2.5rem",
          }}
        >
          {[
            { label: "Shipping", value: "Ships within 1–2 business days" },
            { label: "App", value: "Download the Astro app to set up Sense, if included" },
            { label: "Subscription", value: "Manage or cancel at astroovernightdiapers.com" },
            { label: "Help", value: "hello@astroovernightdiapers.com" },
          ].map((item) => (
            <div key={item.label} style={{ display: "flex", gap: "1rem" }}>
              <span
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "#515b6e",
                  minWidth: "6rem",
                  paddingTop: "0.125rem",
                }}
              >
                {item.label}
              </span>
              <span style={{ fontSize: "0.85rem", color: "#8a94a6", lineHeight: 1.5 }}>{item.value}</span>
            </div>
          ))}
        </div>

        <a href="/" className="btn-primary">
          Back to Astro Overnight
        </a>
      </div>
    </main>
  );
}
