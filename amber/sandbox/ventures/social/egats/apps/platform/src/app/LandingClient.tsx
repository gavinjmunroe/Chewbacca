"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  motion,
  useScroll,
  useTransform,
  AnimatePresence,
  useReducedMotion,
} from "framer-motion";
import Link from "next/link";
import {
  ArrowRight, CheckCircle, Zap, Clock, ChevronDown,
  Menu, X, Plane, DollarSign, Camera, Award, Instagram, Linkedin,
  Film, Mail, ChevronUp, Search, Star, Users, Briefcase,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();

const DISCIPLINES = [
  "Dancer", "Musician", "Actor", "Model", "Photographer",
  "Videographer", "Stylist", "Comedian", "Host / MC", "Director",
  "Vocalist", "Film Actor", "Runway Model",
  "DJ", "Choreographer", "Cinematographer", "Makeup Artist", "Spoken Word",
];

const SOCIAL_LINKS = [
  { Icon: Instagram, label: "Instagram", href: "https://www.instagram.com/egats.co/" },
  { Icon: Linkedin, label: "LinkedIn (coming soon)", href: null },
  { Icon: Film, label: "TikTok (coming soon)", href: null },
];

const STATS = [
  {
    value: 5,
    suffix: "%",
    label: "Platform fee",
    sub: "vs. 15 to 20% industry standard",
    accent: "#BF5AF2",
    textOverride: null as string | null,
    animDuration: 2200,
  },
  {
    value: 3,
    suffix: "",
    label: "Verification tiers",
    sub: "Every level earns you something real",
    accent: "#5E5CE6",
    textOverride: null as string | null,
    animDuration: 1400,
  },
  {
    value: 0,
    suffix: "",
    label: "Prerequisites",
    sub: "Open to all. No agent, no credits, no network required.",
    accent: "#FFD60A",
    textOverride: "Open",
    animDuration: 1400,
  },
  {
    value: 100,
    suffix: "%",
    label: "Pro-filmed portfolios",
    sub: "Every attendee leaves with usable footage.",
    accent: "#30D158",
    textOverride: null as string | null,
    animDuration: 1400,
  },
];

const HOW_STEPS = [
  {
    n: "01",
    title: "Attend a Camp",
    body: "Open to all creative disciplines. No prior credits required. Get filmed by professionals, receive written feedback, and earn your attendance credential.",
    img: "/dancer-carnival.webp",
    imgAlt: "Vibrant creative performer at an EGATS camp event, full energy on display",
    color: "#BF5AF2",
    useImg: true,
  },
  {
    n: "02",
    title: "Earn Verification",
    body: "Industry professionals evaluate your work using a standardized rubric: technique, execution, professionalism, coachability, and on-camera presence. Written feedback is provided regardless of outcome.",
    img: "/dancer-duo.webp",
    imgAlt: "Two performers being evaluated side-by-side at an EGATS camp",
    color: "#5E5CE6",
    useImg: true,
  },
  {
    n: "03",
    title: "Build Your Profile",
    body: "Camp clips, discipline tags, and your verification badge become your professional identity. Your verified status follows you to every booking and is searchable by recruiters.",
    img: "/dancer-portrait.jpg",
    imgAlt: "Close-up portrait of a dancer, professional and personal identity feel",
    color: "#FFD60A",
    useImg: true,
  },
  {
    n: "04",
    title: "Get Booked",
    body: "Recruiters find you through search or AI match. Every booking strengthens your verified profile and builds your track record on the platform.",
    img: "/dancer-hiphop-flow.webp",
    imgAlt: "Hip-hop performer mid-routine, dynamic performance energy",
    color: "#FF9F0A",
    useImg: true,
  },
  {
    n: "05",
    title: "Get Paid",
    body: "Recruiters pay through the platform. After the booking is marked complete, funds are released to you minus the 5% fee. Each job adds to your verified track record.",
    img: "",
    imgAlt: "",
    color: "#30D158",
    useImg: false,
  },
];

const TIERS = [
  {
    tier: "Tier 0",
    label: "Camp Attendee",
    fullName: "Tier 0: Camp Attendee",
    border: "rgba(255,255,255,0.08)",
    badgeBg: "rgba(255,255,255,0.08)",
    badgeColor: "rgba(235,235,245,0.75)",
    accentColor: "rgba(235,235,245,0.6)",
    desc: "You showed up and got filmed. Professionally produced clips and written feedback, proof of participation, open to every creative.",
    points: ["Professionally filmed portfolio clips", "Written evaluator feedback", "Attendance credential"],
    pricingBadge: "Free forever",
    pricingNote: "No cost to attend subject to camp registration. Travel support available.",
    earnCta: "Sign up to attend a camp",
    earnHref: "/signup",
  },
  {
    tier: "Tier 1",
    label: "Verified Human",
    fullName: "Tier 1: Verified Human",
    border: "rgba(94,92,230,0.3)",
    badgeBg: "rgba(94,92,230,0.2)",
    badgeColor: "#7B79F7",
    accentColor: "#7B79F7",
    desc: "Identity confirmed and professional baseline met. Trusted and safe for any platform interaction.",
    points: ["Identity verified", "Professional baseline confirmed", "Fraud-prevention layer"],
    pricingBadge: "Earned at camp",
    pricingNote: "Awarded during the camp evaluation process. No separate purchase.",
    earnCta: "How to earn this",
    earnHref: "#how-it-works",
  },
  {
    tier: "Tier 2",
    label: "EGATS Verified",
    fullName: "Tier 2: EGATS Verified",
    border: "rgba(255,214,10,0.25)",
    badgeBg: "linear-gradient(135deg,#FFD60A,#FF9F0A)",
    badgeColor: "#000",
    accentColor: "#FFD60A",
    glow: "0 0 80px rgba(255,214,10,0.2), 0 0 120px rgba(255,214,10,0.08)",
    desc: "The badge recruiters search for. Discipline-specific, earned through evidence-based scoring at camp.",
    points: ["Evidence-based skill scoring", "Discipline-specific endorsement", "Priority recruiter search", "Your track record grows with every booking"],
    pricingBadge: "Earned at camp",
    pricingNote: "Awarded during the camp evaluation process. No separate purchase.",
    earnCta: "How to earn this",
    earnHref: "#how-it-works",
  },
];

const FAQS = [
  {
    q: "Is EGATS free for creatives?",
    a: "Yes. Creating a profile and applying to jobs is always free. We only charge a 5% fee on completed bookings, well below the 15 to 20% standard agency rate.",
    slug: "free-for-creatives",
  },
  {
    q: "What creative disciplines does EGATS support?",
    a: "All of them. Dancers, musicians, actors, models, photographers, videographers, stylists, makeup artists, directors, comedians, hosts, and more. If you create, EGATS is for you.",
    slug: "disciplines",
  },
  {
    q: "How does verification work?",
    a: "Tier 1 verifies your identity as a real professional. Tier 2 requires an in-person evaluation by certified EGATS verifiers in your specific discipline at one of our camps.",
    slug: "how-verification-works",
  },
  {
    q: "When are camps announced?",
    a: "Camps are planned for Los Angeles, New York, and Atlanta, with more cities expanding globally. Create a free account and we'll notify you when registration opens in your city.",
    slug: "camp-dates",
  },
  {
    q: "What if I don't make Tier 2 at my first camp?",
    a: "You still receive your Tier 0 credential, professionally filmed clips, and written evaluator feedback. Re-attendance policies vary by camp. Create a free account for updates on re-attendance windows.",
    slug: "tier2-miss",
  },
  {
    q: "How do I get paid?",
    a: "Recruiters pay through the platform. After the booking is marked complete, funds are released to you minus the 5% fee.",
    slug: "get-paid",
  },
  {
    q: "How does the AI shortlist work for recruiters?",
    a: "When you post a role, EGATS matches it against creative profiles: discipline tags, tier status, availability, location, and verified camp clips. The AI ranks top candidates and shows clear match reasoning.",
    slug: "ai-shortlist",
  },
  {
    q: "Can I have both a creative and recruiter account?",
    a: "Not yet, but dual-role support is one of our most requested features and we're actively building it. For now, single-role accounts keep the verification process clean and conflict-free. Create a free account and we'll notify you the moment dual-role launches.",
    slug: "dual-account",
  },
];

// Nav sections for active tracking
const NAV_SECTIONS = [
  { id: "how-it-works", label: "How It Works" },
  { id: "for-recruiters", label: "For Recruiters" },
  { id: "camps", label: "Camps" },
  { id: "tiers", label: "Tiers" },
  { id: "faq", label: "FAQ" },
];

// ─── Utility hooks ────────────────────────────────────────────────────────────

function useCountUp(target: number, active: boolean, duration = 1400) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (target === 0) { setCount(0); return; }
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(2, -10 * p);
      setCount(Math.floor(eased * target));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setCount(target);
    };
    setCount(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target, duration]);
  return count;
}

function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ─── Animation defaults ───────────────────────────────────────────────────────

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-40px" },
  transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
};

const fadeUpStill = {
  initial: { opacity: 1, y: 0 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0 },
};

// ─── FooterBrandCol ───────────────────────────────────────────────────────────

function FooterBrandCol() {
  return (
    <div>
      <Link
        href="/"
        style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", marginBottom: 14 }}
        aria-label="EGATS — Every Great Artist Takes Space — home"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/egatslogosimple.png" alt="" aria-hidden="true" style={{ width: 28, height: 28, objectFit: "contain" }} />
        <span style={{ fontSize: 16, fontWeight: 700, color: "#fff", letterSpacing: "-0.03em" }}>EGATS</span>
      </Link>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.7, margin: "0 0 6px", maxWidth: 220 }}>
        Built for creatives. Not gatekeepers.
      </p>
      <p style={{ fontSize: 12, fontStyle: "italic", color: "rgba(191,90,242,0.7)", letterSpacing: "0.02em", margin: "0 0 20px", maxWidth: 220 }}>
        Every Great Artist Takes Space
      </p>
      <div style={{ display: "flex", gap: 10 }}>
        {SOCIAL_LINKS.map(({ Icon, label, href }) => (
          href ? (
            <a
              key={label}
              href={href}
              aria-label={label}
              target="_blank"
              rel="noopener noreferrer"
              className="landing-social-btn"
              style={{
                width: 44, height: 44, borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.08)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "rgba(255,255,255,0.5)", textDecoration: "none",
              }}
            >
              <Icon size={16} aria-hidden="true" />
            </a>
          ) : (
            <span
              key={label}
              aria-label={label}
              title="Coming soon"
              aria-disabled="true"
              role="img"
              className="landing-social-btn"
              style={{
                width: 44, height: 44, borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.08)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "rgba(255,255,255,0.5)", cursor: "not-allowed",
              }}
            >
              <Icon size={16} aria-hidden="true" />
            </span>
          )
        ))}
      </div>
    </div>
  );
}
FooterBrandCol.displayName = "FooterBrandCol";

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({
  value, suffix, label, sub, accent, textOverride, animDuration, prefersReducedMotion,
}: {
  value: number; suffix: string; label: string; sub: string;
  accent: string; textOverride: string | null; animDuration: number;
  prefersReducedMotion: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const count = useCountUp(value, active && !textOverride && !prefersReducedMotion, animDuration);
  const displayCount = prefersReducedMotion ? value : count;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setActive(true); obs.disconnect(); } },
      { threshold: 0.3 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // "Open" stat gets a visually distinct pill treatment
  const isTextStat = Boolean(textOverride);
  const finalDisplay = textOverride ?? `${value}${suffix}`;

  return (
    <div
      ref={ref}
      style={{
        padding: isTextStat ? "24px 16px" : "28px 16px",
        borderRadius: 16,
        border: isTextStat ? `1px solid ${accent}44` : "1px solid rgba(255,255,255,0.08)",
        background: isTextStat ? `${accent}08` : "#0f0f12",
        position: "relative", overflow: "hidden",
        textAlign: "center",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute", top: 0, left: 0, right: 0,
          height: 4, background: accent, borderRadius: "16px 16px 0 0",
        }}
      />
      {isTextStat ? (
        <div
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            padding: "6px 20px", borderRadius: 99,
            background: `${accent}22`, border: `1px solid ${accent}55`,
            fontSize: "clamp(22px,3vw,36px)", fontWeight: 800,
            letterSpacing: "-0.03em", color: accent,
            marginBottom: 12,
          }}
          aria-label={finalDisplay}
        >
          <span aria-hidden="true">{textOverride}</span>
        </div>
      ) : (
        <div
          aria-label={`${value}${suffix}`}
          style={{
            fontSize: "clamp(36px,4vw,56px)", fontWeight: 800,
            letterSpacing: "-0.04em", lineHeight: 1, color: "#fff",
            marginBottom: 8, fontVariantNumeric: "tabular-nums",
          }}
        >
          <span aria-hidden="true">{`${displayCount}${suffix}`}</span>
        </div>
      )}
      <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.85)", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>{sub}</div>
    </div>
  );
}
StatCard.displayName = "StatCard";

// ─── FAQItem — smooth CSS grid-template-rows animation ────────────────────────

function FAQItem({ question, answer, slug }: { question: string; answer: string; slug: string }) {
  const [open, setOpen] = useState(false);
  const panelId = `faq-panel-${slug}`;
  const btnId = `faq-btn-${slug}`;

  return (
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <button
        id={btnId}
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", textAlign: "left", background: "none",
          border: "none", cursor: "pointer", padding: "22px 0",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 16, color: "#fff",
        }}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.2px" }}>{question}</span>
        <span
          aria-hidden="true"
          style={{
            width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
            border: "1px solid rgba(255,255,255,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: open ? "#BF5AF2" : "rgba(255,255,255,0.5)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.3s cubic-bezier(0.16,1,0.3,1), color 0.2s ease",
          }}
        >
          <ChevronDown size={16} />
        </span>
      </button>
      {/* CSS grid-template-rows trick for smooth expand/collapse */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={btnId}
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 0.35s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", lineHeight: 1.8, paddingBottom: 22, margin: 0 }}>
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}
FAQItem.displayName = "FAQItem";

// ─── Eyebrow ──────────────────────────────────────────────────────────────────

function Eyebrow({ children, color = "#BF5AF2" }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      style={{
        fontSize: 11, fontWeight: 700, letterSpacing: "0.14em",
        textTransform: "uppercase", color, display: "block", marginBottom: 16,
      }}
    >
      {children}
    </span>
  );
}
Eyebrow.displayName = "Eyebrow";

// ─── Platform Preview Mock ────────────────────────────────────────────────────

const MOCK_PROFILES = [
  {
    name: "Creative A.",
    location: "Los Angeles",
    discipline: "Contemporary",
    tier: "EGATS VERIFIED",
    tierBg: "linear-gradient(135deg,#FFD60A,#FF9F0A)",
    tierColor: "#000",
    img: "/dancer-silhouette.jpg",
    tags: ["Contemporary", "Ballet", "On-camera"],
  },
  {
    name: "Artist B.",
    location: "New York",
    discipline: "Hip-Hop",
    tier: "EGATS VERIFIED",
    tierBg: "linear-gradient(135deg,#FFD60A,#FF9F0A)",
    tierColor: "#000",
    img: "/dancer-breaking.jpg",
    tags: ["Hip-Hop", "Breaking", "Freestyle"],
  },
  {
    name: "Performer C.",
    location: "Atlanta",
    discipline: "Contemporary",
    tier: "Tier 1",
    tierBg: "rgba(94,92,230,0.2)",
    tierColor: "#7B79F7",
    img: "/dancer-contemporary.jpg",
    tags: ["Contemporary", "Jazz", "Commercial"],
  },
];

function PlatformPreview() {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
      aria-label="Illustrative product concept. Not real user data."
    >
      {/* Mock profile cards row */}
      <div style={{ display: "flex", gap: 10 }}>
        {MOCK_PROFILES.map((profile) => (
          <div
            key={profile.name}
            style={{
              flex: 1,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.02)",
              overflow: "hidden",
            }}
            aria-label={`Example profile card for ${profile.name} (illustrative)`}
          >
            <div style={{ position: "relative", height: 90, background: "#1a1a1d" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={profile.img}
                alt=""
                aria-hidden="true"
                loading="lazy"
                decoding="async"
                style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 20%" }}
              />
              <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(9,9,11,0.7), transparent)" }} />
            </div>
            <div style={{ padding: "10px 10px 12px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 2 }}>{profile.name}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 8 }}>{profile.location}</div>
              <div
                style={{
                  display: "inline-block", padding: "2px 8px", borderRadius: 99,
                  background: profile.tierBg, color: profile.tierColor,
                  fontSize: 9, fontWeight: 800, letterSpacing: "0.05em", marginBottom: 8,
                }}
                aria-hidden="true"
              >
                {profile.tier}
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {profile.tags.slice(0, 2).map((tag) => (
                  <span
                    key={tag}
                    aria-hidden="true"
                    style={{
                      padding: "2px 7px", borderRadius: 99, fontSize: 9, fontWeight: 600,
                      background: "rgba(94,92,230,0.15)", color: "#7B79F7",
                      border: "1px solid rgba(94,92,230,0.25)",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Mock recruiter search row */}
      <div
        style={{
          padding: "16px 20px",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.02)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
        aria-label="Example recruiter search interface (illustrative)"
      >
        <Search size={16} style={{ color: "#BF5AF2", flexShrink: 0 }} aria-hidden="true" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>
            Contemporary dancer, LA, Tier 2, available this month
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
            AI match: verified candidates shown
          </div>
        </div>
        <div
          aria-hidden="true"
          style={{
            padding: "5px 12px", borderRadius: 8,
            background: "#BF5AF2", fontSize: 12, fontWeight: 700, color: "#fff",
            flexShrink: 0,
          }}
        >
          View
        </div>
      </div>

      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textAlign: "center", margin: 0 }}>
        Illustrative product concept.
      </p>
    </div>
  );
}
PlatformPreview.displayName = "PlatformPreview";

// ─── WaitlistForm ─────────────────────────────────────────────────────────────

function WaitlistForm({ source = "camps" }: { source?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), source }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; alreadyExists?: boolean };
      if (data.ok) {
        setStatus("success");
      } else {
        setStatus("error");
        setErrorMsg(data.error ?? "Something went wrong. Try again or email hello@egats.co");
      }
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong. Try again or email hello@egats.co");
    }
  };

  if (status === "success") {
    return (
      <p style={{ fontSize: 14, color: "#30D158", fontWeight: 600, margin: 0 }}>
        You&apos;re on the list. We&apos;ll notify you when camps open in your city.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        aria-label="Email address for camp notifications"
        style={{
          flex: "1 1 200px",
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.05)",
          color: "#fff",
          fontSize: 14,
          outline: "none",
          // placeholder color via global styles
        }}
      />
      <button
        type="submit"
        disabled={status === "loading"}
        className="landing-btn-indigo"
        style={{
          padding: "10px 20px",
          background: "#5E5CE6",
          color: "#fff",
          border: "none",
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 600,
          cursor: status === "loading" ? "not-allowed" : "pointer",
          opacity: status === "loading" ? 0.7 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {status === "loading" ? "..." : "Notify Me"}
      </button>
      {status === "error" && (
        <p style={{ width: "100%", fontSize: 13, color: "#FF453A", margin: "4px 0 0", lineHeight: 1.5 }}>
          {errorMsg}
        </p>
      )}
    </form>
  );
}
WaitlistForm.displayName = "WaitlistForm";

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function LandingClient() {
  const shouldReduceMotion = useReducedMotion() ?? false;

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    const debouncedCheck = debounce(check, 120);
    window.addEventListener("resize", debouncedCheck);
    return () => window.removeEventListener("resize", debouncedCheck);
  }, []);

  const mobile = mounted && isMobile;

  // Mobile nav drawer
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  // Active nav section tracking
  const [activeSection, setActiveSection] = useState<string>("");
  useEffect(() => {
    if (!mounted) return;
    const observers = NAV_SECTIONS.map(({ id }) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveSection(id); },
        { threshold: 0.3, rootMargin: "-60px 0px -30% 0px" }
      );
      obs.observe(el);
      return obs;
    });
    return () => observers.forEach(o => o?.disconnect());
  }, [mounted]);

  // Focus trap for mobile nav
  useEffect(() => {
    if (!mobileNavOpen) return;
    document.body.style.overflow = "hidden";
    const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button, [tabindex]:not([tabindex="-1"])'
    );
    focusable?.[0]?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileNavOpen(false);
        hamburgerRef.current?.focus();
        return;
      }
      if (e.key !== "Tab" || !focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileNavOpen]);

  // Hero parallax (desktop only) — useScroll always called at top level for hooks rules
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress: heroScroll } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const photoYRaw = useTransform(heroScroll, [0, 1], ["0%", "15%"]);
  // Only apply parallax on desktop and when motion is not reduced
  const photoY = (shouldReduceMotion || !mounted || isMobile) ? "0%" : photoYRaw;

  // Active step tracking for How It Works
  const [activeStep, setActiveStep] = useState(0);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    if (!mounted) return;
    const observers = stepRefs.current.map((el, i) => {
      if (!el) return null;
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveStep(i); },
        { threshold: 0.4, rootMargin: "-10% 0px -10% 0px" }
      );
      obs.observe(el);
      return obs;
    });
    return () => observers.forEach(o => o?.disconnect());
  }, [mounted]);

  // Scroll-to-top
  const [showScrollTop, setShowScrollTop] = useState(false);
  useEffect(() => {
    const handler = () => setShowScrollTop(window.scrollY > 600);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const closeMobileNav = useCallback(() => {
    setMobileNavOpen(false);
    // Restore focus to hamburger after nav closes
    setTimeout(() => hamburgerRef.current?.focus(), 0);
  }, []);

  // Motion variants — memoized to avoid object re-creation on every render
  const motionFadeUp = useMemo(
    () => shouldReduceMotion ? fadeUpStill : fadeUp,
    [shouldReduceMotion]
  );
  const delayedFadeUp = useMemo(
    () => shouldReduceMotion ? fadeUpStill : { ...fadeUp, transition: { ...fadeUp.transition, delay: 0.12 } },
    [shouldReduceMotion]
  );
  const delayedFadeUp14 = useMemo(
    () => shouldReduceMotion ? fadeUpStill : { ...fadeUp, transition: { ...fadeUp.transition, delay: 0.14 } },
    [shouldReduceMotion]
  );

  return (
    <>
      {/* Skip to content */}
      <a
        href="#main-content"
        style={{
          position: "absolute", top: 0, left: 0,
          transform: "translateY(-100%)",
          background: "#BF5AF2", color: "#fff",
          padding: "8px 16px", borderRadius: "0 0 6px 6px",
          fontSize: 14, fontWeight: 600, textDecoration: "none",
          zIndex: 9999, transition: "transform 0.2s ease",
        }}
        onFocus={e => { e.currentTarget.style.transform = "translateY(0)"; }}
        onBlur={e => { e.currentTarget.style.transform = "translateY(-100%)"; }}
      >
        Skip to content
      </a>

      {/* Global CSS */}
      <style id="landing-styles">{`
        html { scroll-behavior: smooth; }
        @media (prefers-reduced-motion: reduce) {
          html { scroll-behavior: auto; }
        }
        .landing-btn-primary {
          transition: background 0.18s ease, transform 0.18s ease;
        }
        .landing-btn-primary:hover {
          background: #c96cf5 !important;
          transform: translateY(-1px);
        }
        .landing-btn-primary:focus-visible {
          outline: 2px solid #BF5AF2;
          outline-offset: 3px;
        }
        .landing-btn-secondary {
          transition: border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
        }
        .landing-btn-secondary:hover {
          border-color: rgba(255,255,255,0.4) !important;
          color: #fff !important;
          transform: translateY(-1px);
        }
        .landing-btn-secondary:focus-visible {
          outline: 2px solid rgba(255,255,255,0.5);
          outline-offset: 3px;
        }
        .landing-btn-yellow {
          transition: opacity 0.18s ease, transform 0.18s ease;
        }
        .landing-btn-yellow:hover { opacity: 0.88; transform: translateY(-1px); }
        .landing-btn-yellow:focus-visible { outline: 2px solid #FFD60A; outline-offset: 3px; }
        .landing-btn-indigo {
          transition: opacity 0.18s ease, transform 0.18s ease;
        }
        .landing-btn-indigo:hover { opacity: 0.88; transform: translateY(-1px); }
        .landing-nav-link { transition: color 0.15s ease; }
        .landing-nav-link:hover { color: rgba(255,255,255,0.95) !important; }
        .landing-link { transition: color 0.15s ease, opacity 0.15s ease; }
        .landing-link:hover { color: #fff !important; opacity: 1 !important; }
        .landing-card { transition: transform 0.2s ease, border-color 0.2s ease; }
        .landing-card:hover { border-color: rgba(255,255,255,0.14) !important; transform: translateY(-2px); }
        .landing-stat-card { border-radius: 16px; }
        .landing-step-item {
          transition: background 0.15s ease;
          border-radius: 10px;
          padding: 10px 10px 10px 0;
          cursor: pointer;
        }
        .landing-step-item:hover { background: rgba(255,255,255,0.04); }
        .landing-social-btn { transition: border-color 0.15s ease, color 0.15s ease; }
        .landing-social-btn:hover { border-color: rgba(255,255,255,0.3) !important; color: rgba(255,255,255,0.85) !important; }
        .landing-pill-btn { transition: background 0.15s ease, border-color 0.15s ease; }
        .landing-pill-btn:hover { background: rgba(191,90,242,0.18) !important; border-color: rgba(191,90,242,0.5) !important; }
        .landing-scroll-top { transition: opacity 0.2s ease, transform 0.2s ease; }
        .landing-scroll-top:hover { opacity: 1 !important; transform: translateY(-2px); }
        .landing-btn-indigo:focus-visible { outline: 2px solid #5E5CE6; outline-offset: 3px; }
        input[type="email"]::placeholder { color: rgba(255,255,255,0.4); }
        input[type="email"]:focus { border-color: rgba(94,92,230,0.5) !important; outline: 2px solid rgba(94,92,230,0.3); outline-offset: 0; }
        button:focus-visible, a:focus-visible {
          outline: 2px solid #BF5AF2;
          outline-offset: 2px;
          border-radius: 6px;
        }
        [role="button"]:focus-visible {
          outline: 2px solid #BF5AF2;
          outline-offset: 2px;
          border-radius: 6px;
        }
        .marquee-track { will-change: transform; }
        @keyframes marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .marquee-track {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
          }
        }
        .step-badge {
          transition: background 0.3s ease, color 0.3s ease;
        }
        .nav-link-active {
          color: rgba(255,255,255,0.95) !important;
        }
      `}</style>

      <div style={{ background: "#09090B", color: "#fff", minHeight: "100vh" }}>

        {/* NAV */}
        <nav
          aria-label="Main navigation"
          style={{
            position: "fixed", top: 0, left: 0, right: 0, zIndex: 200,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "0 clamp(16px,4vw,48px)", height: 60,
            background: "rgba(9,9,11,0.82)",
            backdropFilter: "blur(24px) saturate(180%)",
            WebkitBackdropFilter: "blur(24px) saturate(180%)",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <Link
            href="/"
            style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}
            aria-label="EGATS — Every Great Artist Takes Space — home"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/egatslogosimple.png" alt="" aria-hidden="true" style={{ width: 28, height: 28, objectFit: "contain" }} />
            <span style={{ fontSize: 16, fontWeight: 700, color: "#fff", letterSpacing: "-0.03em" }}>EGATS</span>
          </Link>

          {mounted && !isMobile && (
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              {NAV_SECTIONS.map(({ label, id }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className={`landing-nav-link${activeSection === id ? " nav-link-active" : ""}`}
                  style={{
                    fontSize: 14, fontWeight: 500,
                    color: activeSection === id ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.65)",
                    textDecoration: "none",
                  }}
                >
                  {label}
                </a>
              ))}
            </div>
          )}

          {mounted && !isMobile && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Link
                href="/login"
                className="landing-nav-link"
                style={{ fontSize: 14, fontWeight: 500, color: "rgba(255,255,255,0.75)", textDecoration: "none", padding: "7px 16px" }}
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="landing-btn-primary"
                style={{
                  fontSize: 14, fontWeight: 600, color: "#fff", textDecoration: "none",
                  padding: "8px 18px", background: "#BF5AF2", borderRadius: 10,
                }}
              >
                Join Free
              </Link>
            </div>
          )}

          {mounted && isMobile && (
            <button
              ref={hamburgerRef}
              onClick={() => setMobileNavOpen(o => !o)}
              aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-nav-drawer"
              style={{ background: "none", border: "none", cursor: "pointer", color: "#fff", padding: 8 }}
            >
              {mobileNavOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
            </button>
          )}
        </nav>

        {/* Mobile nav drawer */}
        <AnimatePresence>
          {mobileNavOpen && (
            <motion.div
              id="mobile-nav-drawer"
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label="Navigation menu"
              initial={shouldReduceMotion ? { x: 0 } : { x: "100%" }}
              animate={{ x: 0 }}
              exit={shouldReduceMotion ? { x: 0 } : { x: "100%" }}
              transition={shouldReduceMotion ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30 }}
              style={{
                position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 195,
                background: "rgba(9,9,11,0.98)", backdropFilter: "blur(24px)",
                padding: "80px clamp(24px,6vw,48px) 40px",
                display: "flex", flexDirection: "column",
                overflowY: "auto",
                maxHeight: "100dvh",
              }}
            >
              {NAV_SECTIONS.map(({ label, id }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  onClick={closeMobileNav}
                  style={{
                    fontSize: 20, fontWeight: 600, color: "rgba(255,255,255,0.85)",
                    textDecoration: "none", padding: "18px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                    display: "block",
                  }}
                >
                  {label}
                </a>
              ))}
              <div style={{ display: "flex", gap: 12, marginTop: 36 }}>
                <Link
                  href="/login"
                  onClick={closeMobileNav}
                  className="landing-btn-secondary"
                  style={{
                    flex: 1, textAlign: "center", fontSize: 15, fontWeight: 600,
                    color: "#fff", textDecoration: "none", padding: "13px 0",
                    border: "1px solid rgba(255,255,255,0.18)", borderRadius: 10,
                  }}
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  onClick={closeMobileNav}
                  className="landing-btn-primary"
                  style={{
                    flex: 1, textAlign: "center", fontSize: 15, fontWeight: 600,
                    color: "#fff", textDecoration: "none", padding: "13px 0",
                    background: "#BF5AF2", borderRadius: 10,
                  }}
                >
                  Join Free
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* MAIN CONTENT */}
        <main id="main-content">

          {/* HERO */}
          <section
            ref={heroRef}
            aria-labelledby="hero-headline"
            style={{
              minHeight: "100vh",
              paddingTop: 60,
              display: "flex",
              flexDirection: mobile ? "column" : "row",
              position: "relative", overflow: "hidden",
            }}
          >
            {/* Purple bloom behind text panel */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                background: "radial-gradient(ellipse at 30% 50%, rgba(191,90,242,0.08) 0%, transparent 60%)",
                zIndex: 0,
              }}
            />

            {/* Left panel */}
            <div
              style={{
                flex: mobile ? "none" : "0 0 55%",
                display: "flex", flexDirection: "column", justifyContent: "center",
                padding: mobile
                  ? "56px clamp(20px,5vw,40px) 40px"
                  : "0 clamp(32px,5vw,80px) 80px",
                position: "relative", zIndex: 1,
              }}
            >
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: shouldReduceMotion ? 0 : 0.05, duration: shouldReduceMotion ? 0 : 0.4 }}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 24 }}
              >
                <span
                  style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: "0.12em",
                    textTransform: "uppercase", color: "#BF5AF2",
                    background: "rgba(191,90,242,0.1)", padding: "4px 12px",
                    borderRadius: 99, border: "1px solid rgba(191,90,242,0.25)",
                  }}
                >
                  Flipping the narrative of how artists get on stage
                </span>
              </motion.div>

              <motion.h1
                id="hero-headline"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: shouldReduceMotion ? 0 : 0.1, duration: shouldReduceMotion ? 0 : 0.6 }}
                style={{
                  fontSize: "clamp(36px,5.5vw,72px)", fontWeight: 800,
                  letterSpacing: "-0.04em", lineHeight: 1.05,
                  margin: "0 0 20px", color: "#fff",
                }}
              >
                <span style={{ display: "block" }}>Get <span style={{ color: "#BF5AF2" }}>Verified.</span></span>
                <span style={{ display: "block" }}>Get Booked.</span>
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: shouldReduceMotion ? 0 : 0.18, duration: shouldReduceMotion ? 0 : 0.55 }}
                style={{
                  fontSize: "clamp(15px,1.6vw,18px)", fontWeight: 400,
                  color: "rgba(255,255,255,0.85)", lineHeight: 1.6,
                  margin: "0 0 32px",
                }}
              >
                EGATS connects artists worldwide directly with promoters and show runners recruiting for live
                performances, bypassing the agents and managers who control who gets seen. Verified in person.
                Open to everyone, everywhere.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: shouldReduceMotion ? 0 : 0.26, duration: shouldReduceMotion ? 0 : 0.5 }}
                style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 32 }}
              >
                <Link
                  href="/signup?role=creative"
                  className="landing-btn-primary"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    fontSize: 16, fontWeight: 700, color: "#fff", textDecoration: "none",
                    padding: "15px 30px", background: "#BF5AF2", borderRadius: 10,
                    letterSpacing: "-0.01em",
                  }}
                >
                  Join as a Creative <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <Link
                  href="/signup?role=recruiter"
                  className="landing-btn-secondary"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    fontSize: 16, fontWeight: 600, color: "#fff", textDecoration: "none",
                    padding: "15px 24px", border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: 10, letterSpacing: "-0.01em",
                  }}
                >
                  Hire Verified Creatives
                </Link>
              </motion.div>

              {/* Brand manifesto line */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: shouldReduceMotion ? 0 : 0.38, duration: shouldReduceMotion ? 0 : 0.6 }}
                style={{ marginBottom: 28 }}
              >
                <div
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 10,
                    borderTop: "1px solid rgba(191,90,242,0.2)",
                    paddingTop: 18,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13, fontStyle: "italic",
                      color: "rgba(191,90,242,0.75)",
                      letterSpacing: "0.06em", fontWeight: 500,
                    }}
                  >
                    Every Great Artist Takes Space
                  </span>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: shouldReduceMotion ? 0 : 0.48, duration: shouldReduceMotion ? 0 : 0.5 }}
                style={{ display: "flex", gap: 20, rowGap: 8, flexWrap: "wrap", alignItems: "center" }}
              >
                {[
                  { Icon: Zap, text: "5% fee vs. 15 to 20% industry avg" },
                  { Icon: CheckCircle, text: "In-person verification only" },
                  { Icon: CheckCircle, text: "Written feedback at every camp" },
                ].map(({ Icon, text }) => (
                  <div
                    key={text}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      fontSize: 12, color: "rgba(255,255,255,0.55)", fontWeight: 500,
                    }}
                  >
                    <Icon size={13} aria-hidden="true" style={{ color: "#BF5AF2" }} />
                    {text}
                  </div>
                ))}
              </motion.div>
            </div>

            {/* Right panel */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: shouldReduceMotion ? 0 : 0.2, duration: shouldReduceMotion ? 0 : 0.8 }}
              style={{
                flex: mobile ? "none" : "0 0 45%",
                position: "relative",
                minHeight: mobile ? 300 : "100%",
                overflow: "hidden",
              }}
            >
              <motion.div style={{ y: photoY, position: "absolute", inset: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/hero-dancer.jpg"
                  alt="Performer at an EGATS verification camp, professional production in the background"
                  loading="eager"
                  // @ts-expect-error fetchpriority is lowercase in HTML but React 18 accepts fetchPriority
                  fetchpriority="high"
                  decoding="async"
                  width="800"
                  height="600"
                  style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 20%" }}
                />
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute", inset: 0,
                    background: "linear-gradient(to right, #09090B 0%, transparent 30%)",
                  }}
                />
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute", inset: 0,
                    background: "linear-gradient(to top, rgba(9,9,11,0.6) 0%, transparent 60%)",
                  }}
                />
              </motion.div>

              {/* Verification badge overlay */}
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  bottom: 32,
                  ...(mobile ? { left: 20 } : { right: 24 }),
                  background: "rgba(9,9,11,0.82)", backdropFilter: "blur(16px)",
                  border: "1px solid rgba(255,214,10,0.3)", borderRadius: 16,
                  padding: "14px 18px", display: "flex", alignItems: "center", gap: 10,
                }}
              >
                <div
                  style={{
                    width: 32, height: 32, borderRadius: "50%",
                    background: "linear-gradient(135deg,#FFD60A,#FF9F0A)",
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}
                >
                  <CheckCircle size={18} style={{ color: "#000" }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#FFD60A", letterSpacing: "0.06em" }}>EGATS VERIFIED</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontWeight: 500 }}>Tier 2: in-person confirmed</div>
                </div>
              </div>
            </motion.div>
          </section>

          {/* MARQUEE */}
          <div
            aria-hidden="true"
            style={{
              overflow: "hidden",
              borderTop: "1px solid rgba(255,255,255,0.08)",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.015)",
              padding: "14px 0",
            }}
          >
            <div
              className="marquee-track"
              style={{ display: "flex", gap: 48, width: "max-content", animation: "marquee 28s linear infinite" }}
            >
              {[...DISCIPLINES, ...DISCIPLINES].map((d, i) => (
                <span
                  key={`${d}-${i}`}
                  style={{
                    fontSize: 13, fontWeight: 600, letterSpacing: "0.08em",
                    textTransform: "uppercase", color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap",
                  }}
                >
                  {d}
                  <span style={{ color: "#BF5AF2", marginLeft: 24 }}> ·</span>
                </span>
              ))}
            </div>
          </div>

          {/* STATS */}
          <section
            id="stats"
            aria-labelledby="stats-heading"
            style={{ padding: "clamp(64px,8vw,100px) clamp(20px,5vw,80px)", background: "#09090B", position: "relative", overflow: "hidden" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/dancer-contemporary.jpg"
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.05, zIndex: 0 }}
            />
            <div style={{ maxWidth: 1100, margin: "0 auto", position: "relative", zIndex: 1 }}>
              <motion.div {...motionFadeUp} style={{ textAlign: "center", marginBottom: 48 }}>
                <Eyebrow color="#BF5AF2">The EGATS difference</Eyebrow>
                <h2
                  id="stats-heading"
                  style={{
                    fontSize: "clamp(28px,3.5vw,48px)", fontWeight: 800,
                    letterSpacing: "-0.03em", margin: 0, textAlign: "center",
                  }}
                >
                  A platform designed for creatives, not agencies.
                </h2>
              </motion.div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4, 1fr)",
                  gap: 16,
                }}
              >
                {STATS.map((s) => (
                  <StatCard key={s.label} {...s} prefersReducedMotion={shouldReduceMotion} />
                ))}
              </div>
            </div>
          </section>

          {/* PROBLEM */}
          <section
            id="problem"
            aria-labelledby="problem-heading"
            style={{
              padding: "clamp(64px,8vw,100px) clamp(20px,5vw,80px)",
              background: "#0f0f12",
              borderTop: "1px solid rgba(255,255,255,0.08)",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ maxWidth: 1100, margin: "0 auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: mobile ? "1fr" : "1fr 1fr",
                  gap: mobile ? 48 : "clamp(40px,6vw,64px)",
                  alignItems: "start",
                }}
              >
                <motion.div {...motionFadeUp} style={{ position: "relative", overflow: "hidden", borderRadius: 20, padding: "36px 32px" }}>
                  {/* Dancer silhouette background */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/dancer-silhouette.jpg"
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    decoding="async"
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0 }}
                  />
                  <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(9,9,11,0.92) 0%, rgba(9,9,11,0.75) 100%)", zIndex: 1 }} />
                  <div style={{ position: "relative", zIndex: 2 }}>
                    <Eyebrow color="#FF9F0A">The problem</Eyebrow>
                    <h2
                      id="problem-heading"
                      style={{
                        fontSize: "clamp(26px,3vw,44px)", fontWeight: 800,
                        letterSpacing: "-0.03em", margin: "0 0 24px",
                      }}
                    >
                      Live show recruitment is rigged.
                    </h2>
                    <p style={{ fontSize: 15, color: "rgba(255,255,255,0.55)", lineHeight: 1.8, margin: "0 0 24px" }}>
                      A local agent&apos;s reach is limited to who they personally know. If you live far from a major arts
                      city, or don&apos;t have the right connections, you don&apos;t get the call. Exceptional talent stays
                      invisible while the same names cycle through the same rosters.
                    </p>
                    <div
                      style={{
                        padding: "20px 24px",
                        background: "rgba(255,159,10,0.08)",
                        border: "1px solid rgba(255,159,10,0.25)",
                        borderRadius: 16,
                      }}
                    >
                      <div style={{ fontSize: 15, color: "rgba(255,255,255,0.65)", lineHeight: 1.7 }}>
                        Promoters and show runners can&apos;t find the best talent. Artists outside the network can&apos;t find the work. That&apos;s not a talent problem. That&apos;s an access problem.
                      </div>
                    </div>
                  </div>
                </motion.div>

                <motion.div {...delayedFadeUp}>
                  <div
                    style={{
                      padding: "28px",
                      border: "1px solid rgba(191,90,242,0.28)",
                      borderRadius: 16,
                      background: "rgba(191,90,242,0.07)",
                      marginBottom: 16,
                    }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#BF5AF2", marginBottom: 12 }}>
                      EGATS opens the door for everyone.
                    </div>
                    <p style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", lineHeight: 1.8, margin: 0 }}>
                      Every Great Artist Takes Space. EGATS connects artists from all over the world directly with
                      promoters and show runners who are actively recruiting, outside the control of managers and agents.
                      Verified in person. Opportunities based on ability, not access.
                    </p>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {[
                      "Global reach. Not limited to who your agent knows.",
                      "Transparent pricing: 5% on completed bookings only.",
                      "Instant connections between artists and live show recruiters.",
                      "No agent, no network, no major market required.",
                    ].map((point) => (
                      <div
                        key={point}
                        style={{
                          display: "flex", alignItems: "flex-start", gap: 10,
                          fontSize: 14, color: "rgba(255,255,255,0.7)",
                        }}
                      >
                        <CheckCircle size={16} aria-hidden="true" style={{ color: "#30D158", flexShrink: 0, marginTop: 2 }} />
                        {point}
                      </div>
                    ))}
                  </div>
                  <a
                    href="#how-it-works"
                    className="landing-link"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "6px 0", fontSize: 14, fontWeight: 600,
                      color: "#BF5AF2", textDecoration: "none", marginTop: 24,
                    }}
                  >
                    See how it works <ArrowRight size={14} aria-hidden="true" />
                  </a>
                </motion.div>
              </div>
            </div>
          </section>

          {/* HOW IT WORKS */}
          <section
            id="how-it-works"
            aria-labelledby="how-heading"
            style={{ padding: "clamp(64px,8vw,100px) 0", background: "#09090B" }}
          >
            <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 clamp(20px,5vw,80px)" }}>
              <motion.div {...motionFadeUp} style={{ marginBottom: 64 }}>
                <Eyebrow color="#5E5CE6">The creative journey</Eyebrow>
                <h2
                  id="how-heading"
                  style={{
                    fontSize: "clamp(28px,3.5vw,48px)", fontWeight: 800,
                    letterSpacing: "-0.03em", margin: 0,
                  }}
                >
                  How it works.
                </h2>
              </motion.div>

              {mobile ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                  {HOW_STEPS.map((step) => (
                    <motion.div key={step.n} {...motionFadeUp}>
                      <div
                        style={{
                          borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)",
                          background: "#0f0f12", overflow: "hidden",
                        }}
                      >
                        <div style={{ aspectRatio: "4/3", background: "#1a1a1d", position: "relative" }}>
                          {step.useImg ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={step.img}
                                alt={step.imgAlt}
                                loading="lazy"
                                decoding="async"
                                width="800"
                                height="600"
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              />
                              <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "rgba(9,9,11,0.2)" }} />
                            </>
                          ) : (
                            <div
                              style={{
                                width: "100%", height: "100%",
                                background: `linear-gradient(135deg, ${step.color}22, #0a0a0c)`,
                                display: "flex", alignItems: "center", justifyContent: "center",
                              }}
                            >
                              <DollarSign size={56} aria-hidden="true" style={{ color: "#30D158", opacity: 0.8 }} />
                            </div>
                          )}
                        </div>
                        <div style={{ padding: "24px 20px" }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: step.color, marginBottom: 8, letterSpacing: "0.06em" }}>
                            {step.n}
                          </div>
                          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>{step.title}</div>
                          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.7 }}>{step.body}</div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div style={{ display: "flex", gap: "clamp(32px,4vw,64px)", alignItems: "flex-start" }}>
                  {/* Sticky left */}
                  <div
                    style={{
                      flex: "0 0 42%", position: "sticky", top: 80,
                      maxHeight: "calc(100vh - 100px)",
                      overflowY: "auto",
                    }}
                  >
                    <div
                      style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 16, letterSpacing: "0.06em" }}
                      aria-hidden="true"
                    >
                      {HOW_STEPS.length} steps
                    </div>
                    <ol aria-label="Steps to get verified on EGATS" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                      {HOW_STEPS.map((step, i) => (
                        <li key={step.n}>
                          <motion.div
                            animate={shouldReduceMotion ? {} : {
                              opacity: activeStep === i ? 1 : 0.35,
                            }}
                            transition={{ duration: 0.3 }}
                            className="landing-step-item"
                            style={{ marginBottom: 20 }}
                            role="button"
                            aria-label={`Go to step ${step.n}: ${step.title}`}
                            aria-current={activeStep === i ? "step" : undefined}
                            tabIndex={0}
                            onClick={() => {
                              stepRefs.current[i]?.scrollIntoView({ behavior: shouldReduceMotion ? "auto" : "smooth", block: "center" });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                stepRefs.current[i]?.scrollIntoView({ behavior: shouldReduceMotion ? "auto" : "smooth", block: "center" });
                              }
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                              <div
                                className="step-badge"
                                style={{
                                  width: 36, height: 36, borderRadius: 10,
                                  background: activeStep === i ? step.color : "rgba(255,255,255,0.06)",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: 12, fontWeight: 700,
                                  color: activeStep === i ? "#000" : "rgba(255,255,255,0.4)",
                                  flexShrink: 0,
                                }}
                                aria-hidden="true"
                              >
                                {step.n}
                              </div>
                              <div>
                                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{step.title}</div>
                                {activeStep === i && (
                                  <motion.div
                                    initial={shouldReduceMotion ? {} : { opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.7 }}
                                  >
                                    {step.body}
                                  </motion.div>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        </li>
                      ))}
                    </ol>

                    <Link
                      href="/signup?role=creative"
                      className="landing-btn-primary"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 8,
                        fontSize: 14, fontWeight: 600, color: "#fff", textDecoration: "none",
                        padding: "11px 22px", background: "#BF5AF2", borderRadius: 10, marginTop: 24,
                      }}
                    >
                      Join and attend a camp <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  </div>

                  {/* Scrolling right images */}
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 48 }}>
                    {HOW_STEPS.map((step, i) => (
                      <div
                        key={step.n}
                        ref={(el) => { stepRefs.current[i] = el; }}
                        style={{
                          borderRadius: 24, overflow: "hidden", position: "relative",
                          aspectRatio: "4/3", background: "#1a1a1d",
                        }}
                      >
                        {step.useImg ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={step.img}
                              alt={step.imgAlt}
                              loading="lazy"
                              decoding="async"
                              width="800"
                              height="600"
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                            <div
                              aria-hidden="true"
                              style={{
                                position: "absolute", inset: 0,
                                background: `linear-gradient(135deg, ${step.color}22, transparent)`,
                              }}
                            />
                          </>
                        ) : (
                          <div
                            style={{
                              width: "100%", height: "100%",
                              background: "linear-gradient(135deg, #30D15822, #0a0a0c)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}
                          >
                            <DollarSign size={64} aria-hidden="true" style={{ color: "#30D158", opacity: 0.85 }} />
                          </div>
                        )}
                        <div
                          aria-hidden="true"
                          style={{
                            position: "absolute", bottom: 20, left: 20,
                            background: "rgba(9,9,11,0.75)", backdropFilter: "blur(12px)",
                            borderRadius: 10, padding: "10px 16px",
                            border: "1px solid rgba(255,255,255,0.08)",
                          }}
                        >
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{step.title}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* FOR RECRUITERS */}
          <section
            id="for-recruiters"
            aria-labelledby="recruiter-heading"
            style={{
              padding: "clamp(64px,8vw,100px) clamp(20px,5vw,80px)",
              background: "#0f0f12",
              borderTop: "1px solid rgba(255,255,255,0.08)",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ maxWidth: 1100, margin: "0 auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: mobile ? "1fr" : "1fr 1fr",
                  gap: mobile ? 48 : "clamp(40px,6vw,80px)",
                  alignItems: "center",
                }}
              >
                <motion.div {...motionFadeUp}>
                  <Eyebrow color="#30D158">For Recruiters</Eyebrow>
                  <h2
                    id="recruiter-heading"
                    style={{
                      fontSize: "clamp(26px,3vw,44px)", fontWeight: 800,
                      letterSpacing: "-0.03em", margin: "0 0 20px",
                    }}
                  >
                    Stop screening. Start booking.
                  </h2>
                  <p style={{ fontSize: 15, color: "rgba(255,255,255,0.55)", lineHeight: 1.8, margin: "0 0 12px" }}>
                    Every creative on EGATS has been evaluated in person. Their tier tells you exactly what to expect
                    before you reach out. No more guessing from a reel.
                  </p>
                  <p style={{ fontSize: 15, color: "rgba(255,255,255,0.55)", lineHeight: 1.8, margin: "0 0 36px" }}>
                    Recruiter accounts are free. The 5% fee applies only when a booking completes, so you pay nothing until you hire.
                  </p>

                  <div style={{ display: "flex", flexDirection: "column", gap: 20, marginBottom: 36 }}>
                    {[
                      {
                        step: "01",
                        color: "#30D158",
                        title: "Post a role",
                        desc: "Describe what you need: discipline, location, dates, and tier requirement. Takes under two minutes.",
                      },
                      {
                        step: "02",
                        color: "#BF5AF2",
                        title: "Review AI-matched creatives",
                        desc: "EGATS ranks candidates by tier, discipline tags, availability, and location. You see the match reasoning, not just a list of names.",
                      },
                      {
                        step: "03",
                        color: "#FFD60A",
                        title: "Book in one click",
                        desc: "Review verified camp clips, check tier status, and confirm the booking. Payment is held on-platform and released on completion.",
                      },
                    ].map(({ step, color, title, desc }) => (
                      <div key={step} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                        <div
                          style={{
                            width: 36, height: 36, borderRadius: 10,
                            background: `${color}1a`,
                            border: `1px solid ${color}55`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 12, fontWeight: 700, color, flexShrink: 0,
                          }}
                          aria-hidden="true"
                        >
                          {step}
                        </div>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, color: "#fff" }}>{title}</div>
                          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>{desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <Link
                      href="/signup?role=recruiter"
                      className="landing-btn-primary"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 8,
                        fontSize: 15, fontWeight: 700, color: "#fff", textDecoration: "none",
                        padding: "13px 26px", background: "#30D158", borderRadius: 10,
                      }}
                    >
                      <Briefcase size={16} aria-hidden="true" /> Start hiring free
                    </Link>
                    <a
                      href="mailto:hello@egats.co"
                      className="landing-btn-secondary"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 8,
                        fontSize: 15, fontWeight: 600, color: "#fff", textDecoration: "none",
                        padding: "13px 22px", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 10,
                      }}
                    >
                      Talk to us
                    </a>
                  </div>
                </motion.div>

                <motion.div {...delayedFadeUp14}>
                  {/* Handshake image — desktop only */}
                  {!mobile && (
                    <div style={{ aspectRatio: "4/3", borderRadius: 20, overflow: "hidden", position: "relative", marginBottom: 20 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="/handshake.jpg"
                        alt="A handshake representing the direct recruiter-to-creative connection on EGATS"
                        loading="lazy"
                        decoding="async"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(9,9,11,0.4), transparent)" }} />
                    </div>
                  )}
                  <div
                    style={{
                      padding: "28px",
                      border: "1px solid rgba(48,209,88,0.2)",
                      borderRadius: 20,
                      background: "rgba(48,209,88,0.03)",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", marginBottom: 20, textTransform: "uppercase" }}>
                      What recruiters get
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {[
                        "In-person verified talent, not just self-reported claims",
                        "Camp clips you can actually evaluate, shot by a professional crew",
                        "Tier badges that tell you the verification level at a glance",
                        "AI shortlisting that explains its reasoning. No black boxes.",
                        "On-platform payment and booking. One place for everything.",
                        "5% platform fee. No recruiter subscription required.",
                      ].map((text) => (
                        <div key={text} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, color: "rgba(255,255,255,0.7)" }}>
                          <CheckCircle size={15} aria-hidden="true" style={{ color: "#30D158", flexShrink: 0, marginTop: 1 }} />
                          {text}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 16, padding: "18px 20px",
                      border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16,
                      background: "rgba(255,255,255,0.02)",
                      display: "flex", alignItems: "center", gap: 12,
                    }}
                  >
                    <Users size={18} aria-hidden="true" style={{ color: "rgba(255,255,255,0.4)", flexShrink: 0 }} />
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
                      Recruiter accounts are free to create. The 5% fee applies to completed bookings only.
                    </div>
                  </div>
                </motion.div>
              </div>
            </div>
          </section>

          {/* TIERS */}
          <section
            id="tiers"
            aria-labelledby="tiers-heading"
            style={{ padding: "clamp(64px,8vw,100px) clamp(20px,5vw,80px)", background: "#09090B" }}
          >
            <div style={{ maxWidth: 1100, margin: "0 auto" }}>
              <motion.div {...motionFadeUp}>
                <Eyebrow color="#FFD60A">Verification tiers and pricing</Eyebrow>
                <h2
                  id="tiers-heading"
                  style={{
                    fontSize: "clamp(26px,3vw,44px)", fontWeight: 800,
                    letterSpacing: "-0.03em", margin: "0 0 12px",
                  }}
                >
                  Earn your badge. Know what it costs.
                </h2>
                <p style={{ fontSize: 15, color: "rgba(255,255,255,0.55)", margin: "0 0 48px", maxWidth: 560 }}>
                  Verification tiers are not subscription plans. They are earned through the camp evaluation process.
                  Platform access is always free. We only charge a 5% fee on completed bookings.
                </p>
              </motion.div>

              {/* Tier progression path — stacked on mobile, horizontal on desktop */}
              {mobile ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
                  {TIERS.map((tier, i) => (
                    <div key={tier.tier} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div
                        style={{
                          flex: 1, padding: "10px 16px",
                          borderRadius: 12,
                          background: i === 2 ? "rgba(255,214,10,0.1)" : "rgba(255,255,255,0.05)",
                          border: `1px solid ${i === 2 ? "rgba(255,214,10,0.3)" : "rgba(255,255,255,0.08)"}`,
                          fontSize: 13, fontWeight: 600,
                          color: i === 2 ? "#FFD60A" : "rgba(255,255,255,0.55)",
                        }}
                      >
                        {tier.fullName}
                      </div>
                      {i < TIERS.length - 1 && (
                        <div aria-hidden="true" style={{ color: "rgba(255,255,255,0.25)", fontSize: 18, fontWeight: 300 }}>&#8595;</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  role="list"
                  aria-label="Tier progression sequence: Tier 0, then Tier 1, then Tier 2"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 32,
                  }}
                >
                  {TIERS.map((tier, i) => (
                    <div role="listitem" key={tier.tier} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          flex: 1, padding: "8px 14px",
                          borderRadius: 99,
                          background: i === 2 ? "rgba(255,214,10,0.1)" : "rgba(255,255,255,0.05)",
                          border: `1px solid ${i === 2 ? "rgba(255,214,10,0.3)" : "rgba(255,255,255,0.08)"}`,
                          textAlign: "center",
                          fontSize: 12, fontWeight: 600,
                          color: i === 2 ? "#FFD60A" : "rgba(255,255,255,0.55)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {tier.fullName}
                      </div>
                      {i < TIERS.length - 1 && (
                        <ArrowRight size={12} aria-hidden="true" style={{ color: "rgba(255,255,255,0.25)", flexShrink: 0 }} />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Tier 2 hero card */}
              <motion.div {...motionFadeUp}>
                <div
                  className="landing-card"
                  style={{
                    border: `1px solid ${TIERS[2].border}`,
                    borderRadius: 24, background: "rgba(255,255,255,0.02)",
                    boxShadow: TIERS[2].glow, marginBottom: 16, overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: mobile ? "1fr" : "1fr 1fr",
                    }}
                  >
                    <div style={{ padding: "40px 36px" }}>
                      <div
                        style={{
                          display: "inline-block", padding: "4px 12px", borderRadius: 99,
                          background: TIERS[2].badgeBg, color: TIERS[2].badgeColor,
                          fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 8,
                        }}
                      >
                        {TIERS[2].fullName}
                      </div>
                      <div
                        style={{
                          fontSize: 10, fontWeight: 700, color: "#FFD60A",
                          letterSpacing: "0.1em", marginBottom: 16,
                        }}
                        title={TIERS[2].pricingNote}
                      >
                        EARNED AT CAMP
                      </div>
                      <div
                        style={{
                          fontSize: "clamp(20px,2.5vw,30px)", fontWeight: 800,
                          letterSpacing: "-0.03em", marginBottom: 14,
                        }}
                      >
                        The badge recruiters search for.
                      </div>
                      <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.8, margin: "0 0 8px" }}>
                        {TIERS[2].desc}
                      </p>
                      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.6, margin: "0 0 24px" }}>
                        {TIERS[2].pricingNote}
                      </p>
                      <a
                        href={TIERS[2].earnHref}
                        className="landing-pill-btn"
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          fontSize: 12, fontWeight: 700, color: "#FFD60A", textDecoration: "none",
                          padding: "6px 14px", border: "1px solid rgba(255,214,10,0.3)",
                          borderRadius: 99, background: "rgba(255,214,10,0.05)",
                        }}
                      >
                        {TIERS[2].earnCta} <ArrowRight size={12} aria-hidden="true" />
                      </a>
                    </div>
                    <div
                      style={{
                        padding: "40px 36px",
                        borderLeft: mobile ? "none" : "1px solid rgba(255,214,10,0.1)",
                        borderTop: !mobile ? "none" : "1px solid rgba(255,214,10,0.1)",
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.08em", marginBottom: 20 }}>
                        WHAT YOU GET
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: mobile ? "1fr" : "1fr 1fr",
                          gap: 12,
                        }}
                      >
                        {TIERS[2].points.map((p) => (
                          <div
                            key={p}
                            style={{
                              padding: "14px 16px", border: "1px solid rgba(255,214,10,0.1)",
                              borderRadius: 10, background: "rgba(255,214,10,0.03)",
                              display: "flex", alignItems: "center", gap: 8,
                              fontSize: 13, color: "rgba(255,255,255,0.75)", fontWeight: 500,
                            }}
                          >
                            <CheckCircle size={14} aria-hidden="true" style={{ color: "#FFD60A", flexShrink: 0 }} />
                            {p}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Tier 0 + Tier 1 */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: mobile ? "1fr" : "1fr 1fr",
                  gap: 16, marginBottom: 48,
                }}
              >
                {TIERS.slice(0, 2).map((tier) => (
                  <motion.div key={tier.tier} {...motionFadeUp}>
                    <div
                      className="landing-card"
                      style={{
                        border: `1px solid ${tier.border}`, borderRadius: 16,
                        background: "rgba(255,255,255,0.02)", padding: "28px 28px 24px",
                      }}
                    >
                      <div
                        style={{
                          display: "inline-block", padding: "3px 10px", borderRadius: 99,
                          background: tier.badgeBg, color: tier.badgeColor,
                          fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 8,
                        }}
                      >
                        {tier.fullName}
                      </div>
                      <div
                        style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", marginBottom: 4 }}
                        title={tier.pricingNote}
                      >
                        {tier.pricingBadge.toUpperCase()}
                      </div>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5, margin: "0 0 14px" }}>
                        {tier.pricingNote}
                      </p>
                      <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.7, margin: "0 0 20px" }}>
                        {tier.desc}
                      </p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {tier.points.map((p) => (
                          <div key={p} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "rgba(255,255,255,0.6)" }}>
                            <CheckCircle size={13} aria-hidden="true" style={{ color: tier.accentColor, flexShrink: 0 }} />
                            {p}
                          </div>
                        ))}
                      </div>
                      <a
                        href={tier.earnHref}
                        className="landing-pill-btn"
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          fontSize: 12, fontWeight: 700, color: tier.accentColor, textDecoration: "none",
                          padding: "6px 14px", border: `1px solid ${tier.accentColor}33`,
                          borderRadius: 99, background: `${tier.accentColor}08`, marginTop: 20,
                        }}
                      >
                        {tier.earnCta} <ArrowRight size={12} aria-hidden="true" />
                      </a>
                    </div>
                  </motion.div>
                ))}
              </div>

              <p
                style={{
                  textAlign: "center", fontSize: 13,
                  color: "rgba(255,255,255,0.35)", lineHeight: 1.7,
                }}
              >
                Camp registration fees vary by location and are announced with each camp. We keep fees as low as possible
                and offer needs-based travel support for qualifying attendees.
              </p>
            </div>
          </section>

          {/* CAMPS */}
          <section
            id="camps"
            aria-labelledby="camps-heading"
            style={{
              padding: "clamp(64px,8vw,100px) clamp(20px,5vw,80px)",
              background: "#0f0f12",
              borderTop: "1px solid rgba(255,255,255,0.08)",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ maxWidth: 1100, margin: "0 auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: mobile ? "1fr" : "1fr 1fr",
                  gap: mobile ? 48 : "clamp(40px,6vw,64px)",
                  alignItems: "start",
                }}
              >
                <motion.div {...motionFadeUp}>
                  <Eyebrow color="#5E5CE6">Camps</Eyebrow>
                  <h2
                    id="camps-heading"
                    style={{
                      fontSize: "clamp(26px,3vw,44px)", fontWeight: 800,
                      letterSpacing: "-0.03em", margin: "0 0 20px",
                    }}
                  >
                    <span style={{ display: "block" }}>Where verification</span>
                    <span style={{ display: "block" }}>takes place.</span>
                  </h2>
                  <p style={{ fontSize: 15, color: "rgba(255,255,255,0.55)", lineHeight: 1.8, margin: "0 0 32px" }}>
                    EGATS camps are professionally produced events where every creative gets filmed and evaluated by industry
                    professionals. Earn your verified badge permanently on your profile.
                  </p>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: mobile ? "1fr" : "1fr 1fr",
                      gap: 12, marginBottom: 36,
                    }}
                  >
                    {[
                      { Icon: Camera, color: "#BF5AF2", title: "Pro-filmed clips", desc: "Full production crew. Every attendee gets usable footage." },
                      { Icon: Award, color: "#FFD60A", title: "Evidence-based scoring", desc: "Standardized rubric across all disciplines." },
                      { Icon: Plane, color: "#30D158", title: "Travel support", desc: "Needs-based assistance for qualifying attendees." },
                      { Icon: Star, color: "#FF9F0A", title: "Written feedback", desc: "Every attendee receives evaluator notes, regardless of outcome." },
                    ].map(({ Icon, color, title, desc }) => (
                      <div
                        key={title}
                        className="landing-card"
                        style={{
                          padding: "20px 20px", border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 16, background: "rgba(255,255,255,0.02)",
                        }}
                      >
                        <div style={{ color, marginBottom: 10 }}>
                          <Icon size={18} aria-hidden="true" />
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{title}</div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>{desc}</div>
                      </div>
                    ))}
                  </div>

                  {/* City cards */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: 10, marginBottom: 24,
                    }}
                  >
                    {[
                      { city: "Los Angeles", abbr: "LA" },
                      { city: "New York", abbr: "NYC" },
                      { city: "Atlanta", abbr: "ATL" },
                    ].map(({ city, abbr }) => (
                      <div
                        key={abbr}
                        style={{
                          padding: "16px 12px",
                          border: "1px solid rgba(94,92,230,0.2)",
                          borderRadius: 14,
                          background: "rgba(94,92,230,0.04)",
                          textAlign: "center",
                        }}
                      >
                        <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", marginBottom: 2 }}>{abbr}</div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>{city}</div>
                        <div style={{ fontSize: 11, color: "#5E5CE6", fontWeight: 600 }}>Coming soon</div>
                      </div>
                    ))}
                  </div>

                  <div
                    id="camp-waitlist-form"
                    style={{
                      padding: "20px 24px", border: "1px solid rgba(94,92,230,0.25)",
                      borderRadius: 16, background: "rgba(94,92,230,0.05)",
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                      Get notified when camps open in your city
                    </div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", marginBottom: 16 }}>
                      LA, NYC, and ATL. Expanding to more cities.
                    </div>
                    <WaitlistForm source="camps" />
                  </div>
                </motion.div>

                <motion.div {...delayedFadeUp}>
                  <div style={{ borderRadius: 24, overflow: "hidden", aspectRatio: "4/3", position: "relative", background: "#1a1a1d" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/dancer-ballet-stage.webp"
                      alt="Ballet performer on a professionally lit stage during an EGATS camp evaluation session"
                      loading="lazy"
                      decoding="async"
                      width="800"
                      height="600"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(9,9,11,0.5), transparent)" }} />
                    <div
                      aria-hidden="true"
                      style={{
                        position: "absolute", bottom: 24, left: 24, right: 24,
                        padding: "14px 18px", background: "rgba(9,9,11,0.78)",
                        backdropFilter: "blur(12px)", borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 800, color: "#FFD60A" }}>Camps coming to</div>
                      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>LA, NYC, and ATL. Dates TBA.</div>
                    </div>
                  </div>
                </motion.div>
              </div>
            </div>
          </section>

          {/* PLATFORM PREVIEW */}
          <section
            id="platform-preview"
            aria-labelledby="preview-heading"
            style={{
              padding: "clamp(64px,8vw,100px) clamp(20px,5vw,80px)",
              background: "#09090B",
            }}
          >
            <div style={{ maxWidth: 1100, margin: "0 auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: mobile ? "1fr" : "1fr 1fr",
                  gap: mobile ? 48 : "clamp(40px,6vw,80px)",
                  alignItems: "center",
                }}
              >
                <motion.div {...motionFadeUp}>
                  <Eyebrow color="#5E5CE6">Platform preview</Eyebrow>
                  <h2
                    id="preview-heading"
                    style={{
                      fontSize: "clamp(26px,3vw,44px)", fontWeight: 800,
                      letterSpacing: "-0.03em", margin: "0 0 20px",
                    }}
                  >
                    Verified profiles. Smart search.
                  </h2>
                  <p style={{ fontSize: 15, color: "rgba(255,255,255,0.55)", lineHeight: 1.8, margin: "0 0 28px" }}>
                    Every profile shows the creative&apos;s verification tier, discipline tags, and camp-filmed clips.
                    Recruiters search by discipline, tier, location, and availability. AI surfaces the best matches with
                    clear reasoning.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {[
                      "Tier badges visible on every profile card",
                      "Recruiter search filtered by discipline and tier",
                      "Camp clips embedded directly in the profile",
                      "AI match explains why each candidate was surfaced",
                    ].map((point) => (
                      <div key={point} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, color: "rgba(255,255,255,0.65)" }}>
                        <CheckCircle size={15} aria-hidden="true" style={{ color: "#5E5CE6", flexShrink: 0, marginTop: 1 }} />
                        {point}
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 28 }}>
                    <Link
                      href="/signup"
                      className="landing-btn-primary"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 8,
                        fontSize: 14, fontWeight: 700, color: "#fff", textDecoration: "none",
                        padding: "12px 24px", background: "#BF5AF2", borderRadius: 10,
                      }}
                    >
                      Join the waitlist <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  </div>
                </motion.div>

                <motion.div {...delayedFadeUp}>
                  <PlatformPreview />
                </motion.div>
              </div>
            </div>
          </section>

          {/* FAQ */}
          <section
            id="faq"
            aria-labelledby="faq-heading"
            style={{
              padding: "clamp(64px,8vw,100px) clamp(20px,5vw,80px)",
              background: "#0f0f12",
              borderTop: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ maxWidth: 720, margin: "0 auto" }}>
              <motion.div {...motionFadeUp}>
                <Eyebrow color="#BF5AF2">FAQ</Eyebrow>
                <h2
                  id="faq-heading"
                  style={{
                    fontSize: "clamp(26px,3vw,44px)", fontWeight: 800,
                    letterSpacing: "-0.03em", margin: "0 0 28px",
                  }}
                >
                  Common questions, direct answers.
                </h2>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", margin: "0 0 24px" }}>
                  Select any question to expand the answer.
                </p>
              </motion.div>

              <motion.div {...delayedFadeUp}>
                {FAQS.map(({ q, a, slug }) => (
                  <FAQItem key={slug} question={q} answer={a} slug={slug} />
                ))}
              </motion.div>

              <motion.div {...motionFadeUp} style={{ marginTop: 48 }}>
                <div
                  style={{
                    padding: "24px 28px",
                    border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16,
                    display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
                    background: "rgba(255,255,255,0.02)",
                  }}
                >
                  <Mail size={20} aria-hidden="true" style={{ color: "#BF5AF2", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>Still have questions?</div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
                      We respond within 24 hours.
                    </div>
                  </div>
                  <a
                    href="mailto:hello@egats.co"
                    aria-label="Send email to hello@egats.co"
                    className="landing-btn-primary"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      fontSize: 13, fontWeight: 700, color: "#fff", textDecoration: "none",
                      padding: "9px 18px", background: "#BF5AF2", borderRadius: 10,
                    }}
                  >
                    <Mail size={14} aria-hidden="true" /> hello@egats.co
                  </a>
                </div>
              </motion.div>
            </div>
          </section>

          {/* FINAL CTA */}
          <section
            id="get-started"
            aria-labelledby="cta-heading"
            style={{
              padding: "100px clamp(20px,5vw,80px) 80px",
              position: "relative", overflow: "hidden", background: "#09090B",
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: "absolute", inset: 0, pointerEvents: "none",
                background: "radial-gradient(ellipse at 30% 50%, rgba(191,90,242,0.12) 0%, transparent 55%), radial-gradient(ellipse at 75% 60%, rgba(94,92,230,0.08) 0%, transparent 50%)",
              }}
            />

            <motion.div
              {...motionFadeUp}
              style={{ maxWidth: 640, margin: "0 auto", position: "relative", textAlign: "center" }}
            >
              <div
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  fontSize: 12, fontWeight: 600, color: "#FFD60A",
                  background: "rgba(255,214,10,0.1)", border: "1px solid rgba(255,214,10,0.2)",
                  borderRadius: 99, padding: "5px 14px", marginBottom: 28,
                }}
              >
                <Clock size={12} aria-hidden="true" />
                LA, NYC, and ATL. First camps coming soon.
              </div>

              <h2
                id="cta-heading"
                style={{
                  fontSize: "clamp(28px,4vw,52px)", fontWeight: 800,
                  letterSpacing: "-0.04em", margin: "0 0 16px",
                }}
              >
                Your verified portfolio is one camp away.
              </h2>

              <p
                style={{
                  fontSize: "clamp(14px,1.5vw,17px)", color: "rgba(255,255,255,0.55)",
                  lineHeight: 1.7, margin: "0 0 36px",
                }}
              >
                Attend your first camp. Get verified. Get discovered by the recruiters who need you.
              </p>

              <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 40 }}>
                <Link
                  href="/signup?role=creative"
                  className="landing-btn-primary"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    fontSize: 16, fontWeight: 700, color: "#fff", textDecoration: "none",
                    padding: "15px 32px", background: "#BF5AF2", borderRadius: 10,
                    letterSpacing: "-0.01em",
                  }}
                >
                  Join as a Creative <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <Link
                  href="/signup?role=recruiter"
                  className="landing-btn-secondary"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    fontSize: 16, fontWeight: 600, color: "#fff", textDecoration: "none",
                    padding: "15px 26px", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 10,
                  }}
                >
                  Hire Verified Creatives
                </Link>
              </div>

              {/* Brand manifesto close */}
              <div
                style={{
                  borderTop: "1px solid rgba(191,90,242,0.15)",
                  paddingTop: 24,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
                }}
              >
                <span
                  style={{
                    fontSize: 14, fontStyle: "italic",
                    color: "rgba(191,90,242,0.65)",
                    letterSpacing: "0.06em",
                  }}
                >
                  Every Great Artist Takes Space
                </span>
              </div>
            </motion.div>
          </section>

        </main>

        {/* FOOTER */}
        <footer
          aria-label="Site footer"
          style={{
            borderTop: "1px solid rgba(255,255,255,0.08)",
            padding: "60px clamp(20px,5vw,80px) 40px",
            background: "#09090B",
          }}
        >
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            {mobile ? (
              <div style={{ marginBottom: 48 }}>
                <div style={{ marginBottom: 40 }}>
                  <FooterBrandCol />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", marginBottom: 12, textTransform: "uppercase" }}>
                      Product
                    </div>
                    {[
                      { label: "How It Works", href: "#how-it-works" },
                      { label: "Camps", href: "#camps" },
                      { label: "Tiers", href: "#tiers" },
                      { label: "FAQ", href: "#faq" },
                    ].map(({ label, href }) => (
                      <a key={label} href={href} className="landing-link" style={{ display: "block", fontSize: 13, color: "rgba(255,255,255,0.55)", textDecoration: "none", marginBottom: 8 }}>
                        {label}
                      </a>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", marginBottom: 12, textTransform: "uppercase" }}>
                      Company
                    </div>
                    <a
                      href="mailto:hello@egats.co"
                      className="landing-link"
                      style={{ display: "block", fontSize: 13, color: "rgba(255,255,255,0.55)", textDecoration: "none", marginBottom: 20 }}
                    >
                      Contact
                    </a>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", marginBottom: 12, textTransform: "uppercase" }}>
                      Legal
                    </div>
                    <Link
                      href="/privacy"
                      className="landing-link"
                      style={{ display: "block", fontSize: 13, color: "rgba(255,255,255,0.55)", textDecoration: "none", marginBottom: 8 }}
                    >
                      Privacy Policy
                    </Link>
                    <Link
                      href="/terms"
                      className="landing-link"
                      style={{ display: "block", fontSize: 13, color: "rgba(255,255,255,0.55)", textDecoration: "none", marginBottom: 8 }}
                    >
                      Terms of Service
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: "grid", gridTemplateColumns: "3fr 1fr 1fr 1fr",
                  gap: 40, marginBottom: 56,
                }}
              >
                <FooterBrandCol />

                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", marginBottom: 16, textTransform: "uppercase" }}>
                    Product
                  </div>
                  {[
                    { label: "How It Works", href: "#how-it-works" },
                    { label: "For Recruiters", href: "#for-recruiters" },
                    { label: "Camps", href: "#camps" },
                    { label: "Tiers", href: "#tiers" },
                    { label: "FAQ", href: "#faq" },
                  ].map(({ label, href }) => (
                    <a key={label} href={href} className="landing-link" style={{ display: "block", fontSize: 14, color: "rgba(255,255,255,0.55)", textDecoration: "none", marginBottom: 10 }}>
                      {label}
                    </a>
                  ))}
                </div>

                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", marginBottom: 16, textTransform: "uppercase" }}>
                    Company
                  </div>
                  <a
                    href="mailto:hello@egats.co"
                    className="landing-link"
                    style={{ display: "block", fontSize: 14, color: "rgba(255,255,255,0.55)", textDecoration: "none", marginBottom: 10 }}
                  >
                    Contact
                  </a>
                </div>

                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", marginBottom: 16, textTransform: "uppercase" }}>
                    Legal
                  </div>
                  <Link
                    href="/privacy"
                    className="landing-link"
                    style={{ display: "block", fontSize: 14, color: "rgba(255,255,255,0.55)", textDecoration: "none", marginBottom: 10 }}
                  >
                    Privacy Policy
                  </Link>
                  <Link
                    href="/terms"
                    className="landing-link"
                    style={{ display: "block", fontSize: 14, color: "rgba(255,255,255,0.55)", textDecoration: "none", marginBottom: 10 }}
                  >
                    Terms of Service
                  </Link>
                </div>
              </div>
            )}

            <div
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                flexWrap: "wrap", gap: 12,
                borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 28,
              }}
            >
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
                &copy; {CURRENT_YEAR} EGATS. All rights reserved.
              </div>
              <div style={{ display: "flex", gap: 16 }}>
                <Link
                  href="/signup?role=creative"
                  className="landing-link"
                  style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.55)", textDecoration: "none" }}
                >
                  For Creatives
                </Link>
                <Link
                  href="/signup?role=recruiter"
                  className="landing-link"
                  style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.55)", textDecoration: "none" }}
                >
                  For Recruiters
                </Link>
              </div>
            </div>
          </div>
        </footer>

        {/* SCROLL TO TOP — hidden when mobile nav is open */}
        <AnimatePresence>
          {showScrollTop && !mobileNavOpen && (
            <motion.button
              initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.8 }}
              animate={{ opacity: 0.85, scale: 1 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
              onClick={() => window.scrollTo({ top: 0, behavior: shouldReduceMotion ? "auto" : "smooth" })}
              aria-label="Scroll to top of page"
              className="landing-scroll-top"
              style={{
                position: "fixed",
                bottom: "max(40px, env(safe-area-inset-bottom))",
                right: 24, zIndex: 150,
                width: 44, height: 44, borderRadius: "50%",
                background: "rgba(191,90,242,0.9)", backdropFilter: "blur(12px)",
                border: "1px solid rgba(255,255,255,0.15)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", cursor: "pointer",
                boxShadow: "0 4px 20px rgba(191,90,242,0.35)",
              }}
            >
              <ChevronUp size={20} aria-hidden="true" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
LandingClient.displayName = "LandingClient";
