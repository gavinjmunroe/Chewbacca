// Waitlist-only landing: mark, wordmark, three fields. No pitch, no sections.
//
// This was the site's root until the scroll experience took it. It is kept as a
// fallback, not decoration: the scrub is driven from JS, so with scripting off
// the root page holds on the hero and never rises the sheet, and this is the
// only way left to reach the form. Not indexed, so it cannot compete with / for
// the same query.
import type { Metadata } from "next";
import Image from "next/image";
import { WaitlistForm } from "@/components/WaitlistForm";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <main className="page">
      <div className="card">
        <div className="brand">
          <span className="brand-glow" aria-hidden="true" />
          <Image
            src="/amber-mark.png"
            alt="Amber"
            width={128}
            height={125}
            priority
            className="brand-mark"
          />
          <span className="brand-word">amber</span>
          <p className="brand-eyebrow">Waitlist</p>
        </div>

        <WaitlistForm />
      </div>

      <footer className="foot">&copy; 2026 Amber Intelligence</footer>
    </main>
  );
}
