"use client";

import { useState, useRef, useEffect } from "react";

const ACCENT = "#30d158";

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { el.classList.add("visible"); obs.disconnect(); } },
      { threshold: 0.12 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

function RevealDiv({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const ref = useReveal();
  return <div ref={ref} className={`reveal ${className}`} style={style}>{children}</div>;
}

export default function FiduciaryOSClient() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    try {
      await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // best-effort
    }
    setSubmitted(true);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-white text-[#0a0a0a]">
      {/* Sticky Nav */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="font-semibold text-sm tracking-tight flex items-center gap-2">
              <span
                className="w-6 h-6 rounded flex items-center justify-center"
                style={{ background: "linear-gradient(145deg,#1c2e1e,#0d1a0f)", border: "1px solid rgba(48,209,88,0.3)" }}
              >
                <svg width="12" height="12" viewBox="0 0 32 32" fill="none">
                  <path d="M16 4L28 10L28 22L16 28L4 22L4 10Z" stroke={ACCENT} strokeWidth="2" fill="none" strokeLinejoin="round"/>
                  <path d="M16 10L22 13.5L22 20.5L16 24L10 20.5L10 13.5Z" fill="rgba(48,209,88,0.2)" stroke={ACCENT} strokeWidth="1.5" strokeLinejoin="round"/>
                </svg>
              </span>
              fiduciary.cash
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/calebnewtonusc/fiduciaryos"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-500 hover:text-gray-900 transition-colors hidden sm:block"
            >
              GitHub
            </a>
            <a
              href="/login"
              className="text-sm font-medium px-4 py-1.5 rounded-lg text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: ACCENT }}
            >
              Open App →
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section id="hero" className="max-w-5xl mx-auto px-6 pt-24 pb-20">
        <div className="animate-fade-up delay-0">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-8 border"
            style={{ borderColor: `${ACCENT}40`, color: ACCENT, backgroundColor: `${ACCENT}08` }}
          >
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: ACCENT }} />
            v2 — CPA Replacement · Qwen2.5-32B · 600k+ training pairs
          </div>
        </div>

        <h1
          className="serif animate-fade-up delay-1 text-5xl md:text-7xl font-light leading-[1.05] tracking-tight mb-6"
          style={{ animationDelay: "0.1s" }}
        >
          Replace your
          <br />
          <span style={{ color: ACCENT }}>advisor, CPA,</span>
          <br />
          and consultant.
        </h1>

        <p
          className="animate-fade-up text-lg md:text-xl text-gray-500 max-w-2xl leading-relaxed mb-4"
          style={{ animationDelay: "0.2s" }}
        >
          FiduciaryOS is an autonomous wealth manager and tax advisor — trained to replace the $920B/year financial services industry at 0.1% of the cost.
        </p>
        <p
          className="animate-fade-up text-base text-gray-400 max-w-2xl leading-relaxed mb-12"
          style={{ animationDelay: "0.25s" }}
        >
          AMT planning. ISO/RSU/ESPP equity comp. Schedule D harvesting. Backdoor Roth pro-rata. QSBS §1202. Every decision verified against a signed policy artifact and logged to a cryptographically replayable audit trail.
        </p>

        <div className="animate-fade-up flex flex-col sm:flex-row gap-3 max-w-md" style={{ animationDelay: "0.3s" }}>
          {!submitted ? (
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 w-full">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-emerald-300 transition-colors bg-white"
              />
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{ backgroundColor: ACCENT }}
              >
                {loading ? "..." : "Join Waitlist"}
              </button>
            </form>
          ) : (
            <div
              className="text-sm font-medium px-4 py-2.5 rounded-lg inline-block"
              style={{ color: ACCENT, backgroundColor: `${ACCENT}10`, border: `1px solid ${ACCENT}30` }}
            >
              ✓ You are on the list. We will reach out before launch.
            </div>
          )}
          <a
            href="/login"
            className="px-5 py-2.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 hover:border-gray-400 transition-colors text-center whitespace-nowrap"
          >
            Try the App
          </a>
        </div>
      </section>

      {/* Displacement Table */}
      <section id="displace" className="border-t border-gray-100 bg-gray-50/50">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <RevealDiv className="mb-10">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Market Displacement</p>
            <h2 className="serif text-3xl md:text-4xl font-light tracking-tight">
              $920B/year being replaced
            </h2>
          </RevealDiv>
          <RevealDiv>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Industry</th>
                    <th className="text-left px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Annual Revenue</th>
                    <th className="text-left px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">What FiduciaryOS Replaces</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { industry: "Financial Advisors (1% AUM)", revenue: "$330B/yr", what: "Portfolio management, rebalancing, tax-loss harvesting, fiduciary duty" },
                    { industry: "CPA Firms (tax prep)", revenue: "$160B/yr", what: "AMT, NIIT, equity comp (ISO/RSU/ESPP), Schedule D, quarterly estimates" },
                    { industry: "Management Consulting (finance)", revenue: "$350B/yr", what: "Capital allocation analysis, financial modeling, strategic tax planning" },
                    { industry: "RIAs + Compliance Firms", revenue: "$80B/yr", what: "Policy Artifact + audit log replaces compliance infrastructure" },
                  ].map((row, i) => (
                    <tr key={row.industry} className={`border-b border-gray-100 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/30"}`}>
                      <td className="px-5 py-3.5 font-medium text-gray-800">{row.industry}</td>
                      <td className="px-5 py-3.5 font-semibold" style={{ color: ACCENT }}>{row.revenue}</td>
                      <td className="px-5 py-3.5 text-gray-500">{row.what}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-900">
                    <td className="px-5 py-3.5 font-bold text-white">Total Addressable</td>
                    <td className="px-5 py-3.5 font-bold text-2xl" style={{ color: ACCENT }}>$920B+/yr</td>
                    <td className="px-5 py-3.5 text-gray-400 text-xs">At 0.1% AUM fee = $9,000/year savings vs. advisor + CPA on $1M portfolio</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </RevealDiv>
        </div>
      </section>

      {/* CPA Replacement */}
      <section id="cpa" className="max-w-5xl mx-auto px-6 py-20">
        <RevealDiv className="mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">v2 — CPA Replacement</p>
          <h2 className="serif text-3xl md:text-4xl font-light tracking-tight">
            Your entire tax situation,<br />handled.
          </h2>
        </RevealDiv>
        <div className="grid md:grid-cols-3 gap-5">
          {[
            {
              label: "Equity Compensation",
              items: ["ISO exercise timing vs. AMT", "NSO/RSU W-2 income recognition", "ESPP qualifying vs. disqualifying", "§83(b) election analysis"],
            },
            {
              label: "Capital Gains & Harvesting",
              items: ["Schedule D ST/LT netting", "Wash sale rule enforcement", "QSBS §1202 exclusion (100%)", "$3k/yr ordinary income offset"],
            },
            {
              label: "Retirement Planning",
              items: ["Backdoor Roth pro-rata (Form 8606)", "Roth conversion ladder optimizer", "§72(t) SEPP early distributions", "Inherited IRA 10-year rule"],
            },
            {
              label: "AMT Planning",
              items: ["Full Form 6251 computation", "ISO preference item modeling", "AMT credit carryforward (Form 8801)", "Annual AMT headroom analysis"],
            },
            {
              label: "NIIT & Medicare",
              items: ["3.8% NIIT on NII over threshold", "0.9% additional Medicare surtax", "Real-time MAGI monitoring", "Municipal bond NII reduction"],
            },
            {
              label: "Quarterly Estimates",
              items: ["Safe harbor: 90% current / 110% prior", "Form 1040-ES payment calendar", "Underpayment penalty avoidance", "W-2 withholding gap analysis"],
            },
          ].map((card) => (
            <RevealDiv key={card.label} className="border border-gray-200 rounded-xl p-5 bg-white">
              <p className="font-semibold text-sm mb-3">{card.label}</p>
              <ul className="space-y-1.5">
                {card.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-gray-500">
                    <svg className="mt-0.5 shrink-0" width="13" height="13" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="6" stroke={ACCENT} strokeWidth="1.5" fill={`${ACCENT}15`}/>
                      <path d="M4.5 7l1.5 1.5 3-3" stroke={ACCENT} strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </RevealDiv>
          ))}
        </div>
      </section>

      {/* The Gap */}
      <section id="gap" className="border-t border-gray-100 bg-gray-50/50">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <RevealDiv className="mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">The Gap</p>
            <h2 className="serif text-3xl md:text-4xl font-light tracking-tight">
              What changes when a model specializes
            </h2>
          </RevealDiv>
          <div className="grid md:grid-cols-2 gap-6">
            <RevealDiv className="bg-white border border-gray-200 rounded-xl p-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4">Existing Tools</p>
              <p className="text-gray-700 leading-relaxed text-sm mb-4">
                Robo-advisors automate rules. CPAs apply templates. Neither reasons about your full situation — equity comp timing, household accounts, wash sale rules, AMT headroom — holistically.
              </p>
              <ul className="space-y-2">
                {[
                  "Automate rules, not fiduciary reasoning",
                  "No AMT/NIIT/equity comp modeling",
                  "No machine-verifiable policy constraints",
                  "Audit trails are logs, not replayable proofs",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-gray-500">
                    <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="6" stroke="#E5E7EB" strokeWidth="1.5"/>
                      <path d="M4.5 7l1.5 1.5 3-3" stroke="#9CA3AF" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </RevealDiv>
            <RevealDiv className="border rounded-xl p-6" style={{ borderColor: `${ACCENT}30`, backgroundColor: `${ACCENT}04` }}>
              <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: ACCENT }}>FiduciaryOS</p>
              <p className="text-gray-700 leading-relaxed text-sm mb-4">
                FiduciaryOS compiles your investment policy to a machine-checkable artifact, models your complete tax picture including equity comp and AMT, and optimizes across all accounts simultaneously.
              </p>
              <ul className="space-y-2">
                {[
                  "Policy compiled to signed machine-checkable artifact",
                  "Full AMT, NIIT, ISO/RSU/ESPP tax modeling",
                  "Household-level after-tax optimization",
                  "Kill-switchable in milliseconds with full replay",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-gray-700">
                    <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="6" stroke={ACCENT} strokeWidth="1.5" fill={`${ACCENT}15`}/>
                      <path d="M4.5 7l1.5 1.5 3-3" stroke={ACCENT} strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </RevealDiv>
          </div>
        </div>
      </section>

      {/* How It's Built */}
      <section id="how" className="max-w-5xl mx-auto px-6 py-20">
        <RevealDiv className="mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">How It&apos;s Built</p>
          <h2 className="serif text-3xl md:text-4xl font-light tracking-tight">
            Three-stage training pipeline
          </h2>
        </RevealDiv>
        <div className="grid md:grid-cols-3 gap-5">
          {[
            {
              stage: "Stage 1",
              name: "Supervised Fine-Tuning",
              desc: "600k+ pairs across 7 streams: SEC/FINRA enforcement actions, CPA tax prep, portfolio construction, Roth planning, equity comp, risk assessment. Base: Qwen2.5-32B-Instruct.",
            },
            {
              stage: "Stage 2",
              name: "Reinforcement Learning",
              desc: "GRPO reward: after-tax risk-adjusted return + zero fiduciary policy violations + drawdown within policy. Teaches the model to optimize the full fiduciary objective, not just returns.",
            },
            {
              stage: "Stage 3",
              name: "Direct Preference Optimization",
              desc: "DPO on decision pairs — policy-respecting vs. policy-violating actions, even subtle violations. Calibrates conservative behavior when policy is ambiguous.",
            },
          ].map((s, i) => (
            <RevealDiv key={s.stage} className="border border-gray-200 rounded-xl p-6 flex flex-col gap-3 bg-white" style={{ animationDelay: `${i * 0.1}s` }}>
              <span
                className="text-xs font-bold px-2 py-0.5 rounded w-fit"
                style={{ color: ACCENT, backgroundColor: `${ACCENT}12` }}
              >
                {s.stage}
              </span>
              <p className="font-semibold text-sm">{s.name}</p>
              <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
            </RevealDiv>
          ))}
        </div>
      </section>

      {/* Training Stats */}
      <section id="stats" className="border-t border-gray-100 bg-gray-50/50">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <RevealDiv className="mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Training</p>
            <h2 className="serif text-3xl md:text-4xl font-light tracking-tight">The numbers behind the model</h2>
          </RevealDiv>
          <div className="grid md:grid-cols-4 gap-5">
            {[
              { label: "Training Pairs", value: "600k+", sub: "7 synthesis streams: enforcement actions, CPA tax prep, portfolio, Roth planning, equity comp, risk" },
              { label: "Base Model", value: "32B", sub: "Qwen2.5-32B-Instruct with LoRA rank 128 — 4.5× stronger than 7B baseline" },
              { label: "Training Hardware", value: "18× A6000", sub: "864GB VRAM · IYA Innovation Quest 2026 · DeepSpeed ZeRO-3 · ~18h total runtime" },
              { label: "Reward Signal", value: "Triple", sub: "After-tax risk-adjusted return + zero policy violations + drawdown within policy" },
            ].map((stat) => (
              <RevealDiv
                key={stat.label}
                className="rounded-xl p-6 border"
                style={{ borderColor: `${ACCENT}25`, backgroundColor: `${ACCENT}05` }}
              >
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">{stat.label}</p>
                <p className="text-2xl font-bold mb-1" style={{ color: ACCENT }}>{stat.value}</p>
                <p className="text-sm text-gray-500 leading-relaxed">{stat.sub}</p>
              </RevealDiv>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-6 py-20 text-center">
        <RevealDiv>
          <h2 className="serif text-3xl md:text-4xl font-light tracking-tight mb-4">
            Ready to replace your advisor?
          </h2>
          <p className="text-gray-500 mb-8 max-w-md mx-auto text-sm leading-relaxed">
            Open the app and connect your accounts. FiduciaryOS analyzes your portfolio, computes your full tax picture, and surfaces what to do next.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href="/login"
              className="px-8 py-3 rounded-lg text-white font-medium text-sm transition-opacity hover:opacity-90"
              style={{ backgroundColor: ACCENT }}
            >
              Open App →
            </a>
            <a
              href="https://github.com/calebnewtonusc/fiduciaryos"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3 rounded-lg border border-gray-200 text-gray-700 font-medium text-sm hover:border-gray-400 transition-colors"
            >
              View on GitHub
            </a>
          </div>
        </RevealDiv>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-xs text-gray-400">
            <span className="font-medium" style={{ color: ACCENT }}>fiduciary.cash</span>
            {" · "}FiduciaryOS v2 · Caleb Newton · USC · 2026
          </p>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <a href="/login" className="hover:text-gray-600 transition-colors">App</a>
            <a href="https://github.com/calebnewtonusc/fiduciaryos" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 transition-colors">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
