import { Check } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/Button"

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Try ClearOut with one channel",
    features: [
      "1 connected channel",
      "50 AI triage/month",
      "10 AI drafts/month",
      "Basic priority queue",
      "7-day message history",
    ],
    cta: "Get started",
    href: "/login",
    highlight: false,
  },
  {
    name: "Pro",
    price: "$18",
    period: "per month",
    description: "For serious daily communicators",
    features: [
      "Unlimited channels",
      "Unlimited AI triage",
      "Unlimited AI drafts",
      "Voice mode",
      "Relationship memory",
      "Cross-channel intelligence",
      "Priority briefings",
      "90-day message history",
    ],
    cta: "Get early access",
    href: "#waitlist",
    highlight: true,
  },
  {
    name: "Team",
    price: "$14",
    period: "per seat/month",
    description: "For small teams and startups",
    features: [
      "Everything in Pro",
      "Team channel summarization",
      "Shared voice profiles",
      "Admin controls",
      "Usage analytics",
      "Priority support",
    ],
    cta: "Contact us",
    href: "mailto:team@clearout.so",
    highlight: false,
  },
]

export function Pricing() {
  return (
    <section id="pricing" className="py-24 border-t border-co-border">
      <div className="max-w-5xl mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-gradient mb-4">
            Simple pricing
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Start free. Upgrade when ClearOut becomes indispensable. And it will.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {PLANS.map(plan => (
            <div
              key={plan.name}
              className={`rounded-2xl p-6 flex flex-col ${
                plan.highlight
                  ? "bg-co-blue/10 border-2 border-co-blue/40 relative"
                  : "glass"
              }`}
            >
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-co-blue text-[10px] text-white font-medium whitespace-nowrap">
                  Most popular
                </div>
              )}

              <div className="mb-6">
                <h3 className="text-sm font-semibold text-foreground mb-1">{plan.name}</h3>
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-3xl font-bold text-foreground">{plan.price}</span>
                  <span className="text-xs text-muted-foreground">{plan.period}</span>
                </div>
                <p className="text-xs text-muted-foreground">{plan.description}</p>
              </div>

              <ul className="space-y-2.5 flex-1 mb-6">
                {plan.features.map(feat => (
                  <li key={feat} className="flex items-start gap-2">
                    <Check className="w-3.5 h-3.5 text-co-blue shrink-0 mt-0.5" />
                    <span className="text-xs text-muted-foreground">{feat}</span>
                  </li>
                ))}
              </ul>

              <Link href={plan.href}>
                <Button
                  variant={plan.highlight ? "default" : "secondary"}
                  className="w-full"
                  size="sm"
                >
                  {plan.cta}
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
