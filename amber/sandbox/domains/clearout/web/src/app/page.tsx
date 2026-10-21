import type { Metadata } from "next"
import { Hero } from "@/components/landing/Hero"
import { Features } from "@/components/landing/Features"
import { HowItWorks } from "@/components/landing/HowItWorks"
import { UseCases } from "@/components/landing/UseCases"
import { Pricing } from "@/components/landing/Pricing"
import { Waitlist } from "@/components/landing/Waitlist"
import { Footer } from "@/components/landing/Footer"
import { LandingNav } from "@/components/landing/LandingNav"

export const metadata: Metadata = {
  title: {
    absolute: "ClearOut - AI Communication Command Center",
  },
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-co-dark overflow-x-hidden">
      <LandingNav />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <UseCases />
        <Pricing />
        <Waitlist />
      </main>
      <Footer />
    </div>
  )
}
