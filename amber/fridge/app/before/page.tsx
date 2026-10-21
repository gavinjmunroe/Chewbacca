import type { Metadata } from "next";
import Link from "next/link";
import { ScrollClipStage } from "@/components/ScrollClipStage";
import "../scroll.css";

// The scroll-scrubbed geode that was the home page before the kitchen. Kept
// here so reviewers can compare the two side by side. Not for search engines.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function BeforePage() {
  return (
    <div className="scroll-page">
      <Link href="/login" className="amber-signin fixed right-6 top-5 z-50">
        Sign in
      </Link>
      <ScrollClipStage />
    </div>
  );
}
