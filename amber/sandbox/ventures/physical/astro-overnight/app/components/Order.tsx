"use client";
import { useState } from "react";

const SIZES = ["Newborn", "Size 1", "Size 2", "Size 3", "Size 4", "Size 5", "Size 6"];

const plans = [
  {
    id: "trial_pack",
    name: "Trial Pack",
    price: "$39",
    billing: "one-time",
    count: "20 diapers",
    includes: [
      "20 overnight diapers",
      "Free standard shipping",
      "30-day guarantee",
    ],
    cta: "Buy Trial Pack",
    featured: false,
  },
  {
    id: "starter_bundle",
    name: "Starter Kit",
    price: "$59",
    billing: "one-time",
    count: "40 diapers + Astro Sense clip",
    includes: [
      "40 overnight diapers",
      "Astro Sense clip included",
      "Free priority shipping",
      "30-day guarantee",
      "App setup guide",
    ],
    cta: "Buy Starter Kit",
    featured: true,
  },
  {
    id: "monthly_sub",
    name: "Monthly Subscription",
    price: "$49",
    billing: "per month",
    count: "80 diapers / month",
    includes: [
      "80 diapers per month",
      "Automatic size-up when ready",
      "Free shipping on every order",
      "Skip or cancel any time",
    ],
    cta: "Subscribe",
    featured: false,
  },
];

export default function Order() {
  const [size, setSize] = useState("Size 2");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkout(productId: string) {
    setLoading(productId);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, size }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <section id="order" style={{ paddingTop: "6rem", paddingBottom: "6rem" }}>
      <div className="container">
        <div className="rule" style={{ marginBottom: "5rem" }} />

        <p className="label" style={{ marginBottom: "1rem" }}>Get started</p>
        <h2
          style={{
            fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)",
            fontWeight: 700,
            letterSpacing: "-0.025em",
            lineHeight: 1.15,
            color: "#f0ede8",
            maxWidth: "22ch",
            marginBottom: "0.75rem",
          }}
        >
          Your family deserves a better night.
        </h2>
        <p style={{ fontSize: "0.875rem", color: "#8a94a6", marginBottom: "3rem", maxWidth: "38ch", lineHeight: 1.6 }}>
          Start with a trial. Subscribe when you&apos;re converted. Every order ships free.
        </p>

        {/* Size selector */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", marginBottom: "3rem" }}>
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "#515b6e",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginRight: "0.5rem",
            }}
          >
            Size
          </span>
          {SIZES.map((s) => (
            <button
              key={s}
              onClick={() => setSize(s)}
              style={{
                padding: "0.4rem 0.875rem",
                borderRadius: "5px",
                fontSize: "0.8rem",
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.15s",
                background: size === s ? "#c8a84a" : "transparent",
                color: size === s ? "#06080f" : "#8a94a6",
                border: size === s ? "1px solid #c8a84a" : "1px solid rgba(255,255,255,0.1)",
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Plan cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
            gap: "1.25rem",
            marginBottom: "2rem",
          }}
        >
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="card"
              style={{
                padding: "2rem",
                display: "flex",
                flexDirection: "column",
                gap: "1.25rem",
                border: plan.featured
                  ? "1px solid rgba(200,168,74,0.4)"
                  : "1px solid rgba(255,255,255,0.07)",
                position: "relative",
              }}
            >
              {plan.featured && (
                <span
                  style={{
                    position: "absolute",
                    top: "-1px",
                    left: "1.5rem",
                    background: "#c8a84a",
                    color: "#06080f",
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    padding: "0.2rem 0.625rem",
                    borderRadius: "0 0 4px 4px",
                  }}
                >
                  Most Popular
                </span>
              )}

              <div>
                <p
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "#8a94a6",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    marginBottom: "0.5rem",
                  }}
                >
                  {plan.name}
                </p>
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.375rem" }}>
                  <span
                    style={{
                      fontSize: "2.5rem",
                      fontWeight: 800,
                      letterSpacing: "-0.04em",
                      color: "#f0ede8",
                      lineHeight: 1,
                    }}
                  >
                    {plan.price}
                  </span>
                  <span style={{ fontSize: "0.8rem", color: "#515b6e" }}>{plan.billing}</span>
                </div>
                <p style={{ fontSize: "0.775rem", color: "#515b6e", marginTop: "0.25rem" }}>{plan.count}</p>
              </div>

              <ul style={{ display: "flex", flexDirection: "column", gap: "0.5rem", flexGrow: 1 }}>
                {plan.includes.map((item) => (
                  <li
                    key={item}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "0.625rem",
                      fontSize: "0.8rem",
                      color: "#8a94a6",
                      lineHeight: 1.45,
                    }}
                  >
                    <span style={{ color: "#c8a84a", flexShrink: 0, marginTop: "0.05rem" }}>+</span>
                    {item}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => checkout(plan.id)}
                disabled={loading !== null}
                className={plan.featured ? "btn-primary" : "btn-outline"}
                style={{
                  width: "100%",
                  textAlign: "center",
                  opacity: loading !== null ? 0.6 : 1,
                  cursor: loading !== null ? "not-allowed" : "pointer",
                }}
              >
                {loading === plan.id ? "Loading..." : `${plan.cta} / ${size}`}
              </button>
            </div>
          ))}
        </div>

        {error && (
          <p style={{ fontSize: "0.85rem", color: "#f87171", textAlign: "center", marginTop: "1rem" }}>
            {error}
          </p>
        )}

        {/* Trust bar */}
        <div
          style={{
            marginTop: "2.5rem",
            paddingTop: "2rem",
            borderTop: "1px solid rgba(255,255,255,0.07)",
            display: "flex",
            flexWrap: "wrap",
            gap: "1.5rem 3rem",
            justifyContent: "center",
          }}
        >
          {[
            "Secure checkout via Stripe",
            "Free shipping on every order",
            "30-day money-back guarantee",
            "Cancel subscription any time",
            "Ships within 1–2 business days",
          ].map((t) => (
            <span key={t} style={{ fontSize: "0.775rem", color: "#515b6e" }}>
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
