"use client";

import { useState } from "react";

export default function Home() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <main className="min-h-screen bg-black text-white font-sans">
      <nav className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <span className="text-xl font-semibold tracking-tight text-[#ec4899]">tally</span>
        <a
          href="#waitlist"
          className="text-sm text-white/60 hover:text-white transition-colors border border-white/20 hover:border-white/40 px-4 py-1.5 rounded-full"
        >
          Get Early Access
        </a>
      </nav>

      <section className="flex flex-col items-center justify-center text-center px-6 pt-24 pb-20 max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-2 text-xs text-[#ec4899] bg-[#ec4899]/10 border border-[#ec4899]/20 px-3 py-1 rounded-full mb-8">
          <span className="w-1.5 h-1.5 bg-[#ec4899] rounded-full animate-pulse" />
          Group screen time competition
        </div>
        <h1 className="text-5xl sm:text-7xl font-bold tracking-tight leading-[1.05] mb-6">
          Monetize your friends,{" "}
          <span className="text-[#ec4899]">ethically.</span>
        </h1>
        <p className="text-lg sm:text-xl text-white/50 max-w-2xl mb-12 leading-relaxed">
          Tally turns screen time reduction into a group sport. Bet your friends, track everyone&apos;s usage, and win real money for actually putting your phone down.
        </p>

        <div id="waitlist" className="w-full max-w-md">
          {submitted ? (
            <div className="bg-[#ec4899]/10 border border-[#ec4899]/30 rounded-2xl px-6 py-4 text-[#ec4899] text-sm">
              Thanks — we&apos;ll be in touch.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#ec4899]/60 transition-all"
              />
              <button
                type="submit"
                className="bg-[#ec4899] hover:bg-[#db2777] text-white text-sm font-medium px-5 py-3 rounded-xl transition-colors whitespace-nowrap"
              >
                Join waitlist
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-20 border-t border-white/5">
        <h2 className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-12">Why it matters</h2>
        <div className="grid sm:grid-cols-3 gap-8">
          {[
            {
              title: "Willpower alone doesn't work",
              body: "Apps are designed by thousand-person teams to keep you on them. Willpower alone is not a fair fight. Social accountability is.",
            },
            {
              title: "Competition changes behavior",
              body: "When your friends can see your screen time and money is on the line, putting your phone down becomes genuinely satisfying.",
            },
            {
              title: "Built with Cayden Ginting",
              body: "Tally is a collaboration. Two people who care about the attention economy building a tool that actually fights back.",
            },
          ].map((item) => (
            <div key={item.title} className="space-y-3">
              <div className="w-8 h-px bg-[#ec4899]" />
              <h3 className="font-semibold text-white">{item.title}</h3>
              <p className="text-sm text-white/50 leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-white/5 px-6 py-8 max-w-6xl mx-auto flex items-center justify-between">
        <span className="text-sm text-[#ec4899] font-medium">tally</span>
        <span className="text-sm text-white/30">Coming soon · Built by Caleb Newton & Cayden Ginting</span>
      </footer>
    </main>
  );
}
