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
        <span className="text-xl font-semibold tracking-tight text-[#3b82f6]">babel</span>
        <a
          href="#waitlist"
          className="text-sm text-white/60 hover:text-white transition-colors border border-white/20 hover:border-white/40 px-4 py-1.5 rounded-full"
        >
          Get Early Access
        </a>
      </nav>

      <section className="flex flex-col items-center justify-center text-center px-6 pt-24 pb-20 max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-2 text-xs text-[#3b82f6] bg-[#3b82f6]/10 border border-[#3b82f6]/20 px-3 py-1 rounded-full mb-8">
          <span className="w-1.5 h-1.5 bg-[#3b82f6] rounded-full animate-pulse" />
          Real-time · 100+ languages
        </div>
        <h1 className="text-5xl sm:text-7xl font-bold tracking-tight leading-[1.05] mb-6">
          Any two humans.{" "}
          <span className="text-[#3b82f6]">Any two languages.</span>{" "}
          Right now.
        </h1>
        <p className="text-lg sm:text-xl text-white/50 max-w-2xl mb-12 leading-relaxed">
          Babel is universal real-time translation. Hold a conversation with anyone on earth, in any language, with zero lag. The language barrier ends here.
        </p>

        <div id="waitlist" className="w-full max-w-md">
          {submitted ? (
            <div className="bg-[#3b82f6]/10 border border-[#3b82f6]/30 rounded-2xl px-6 py-4 text-[#3b82f6] text-sm">
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
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#3b82f6]/60 transition-all"
              />
              <button
                type="submit"
                className="bg-[#3b82f6] hover:bg-[#2563eb] text-white text-sm font-medium px-5 py-3 rounded-xl transition-colors whitespace-nowrap"
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
              title: "8 billion people, 7,000 languages",
              body: "Most of humanity cannot communicate with most of humanity. That's not a cultural fact — it's a solvable problem.",
            },
            {
              title: "Translation has latency",
              body: "Current tools add friction. Real conversation requires presence. Babel disappears into the background.",
            },
            {
              title: "Every connection unlocked",
              body: "Business deals, friendships, medical care, love — none of it should depend on the language you were born speaking.",
            },
          ].map((item) => (
            <div key={item.title} className="space-y-3">
              <div className="w-8 h-px bg-[#3b82f6]" />
              <h3 className="font-semibold text-white">{item.title}</h3>
              <p className="text-sm text-white/50 leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-white/5 px-6 py-8 max-w-6xl mx-auto flex items-center justify-between">
        <span className="text-sm text-[#3b82f6] font-medium">babel</span>
        <span className="text-sm text-white/30">Coming soon · Built by Caleb Newton</span>
      </footer>
    </main>
  );
}
