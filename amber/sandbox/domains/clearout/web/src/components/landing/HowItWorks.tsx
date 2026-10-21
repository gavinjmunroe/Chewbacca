import { Plug, Brain, Sparkles, CheckCheck } from "lucide-react"

const STEPS = [
  {
    icon: Plug,
    step: "01",
    title: "Connect your channels",
    description:
      "Link Gmail, Slack, iMessage, and more in seconds. ClearOut securely pulls your recent messages.",
  },
  {
    icon: Brain,
    step: "02",
    title: "AI triages everything",
    description:
      "ClearOut scores every thread for urgency, importance, and action type - instantly organizing chaos into signal.",
  },
  {
    icon: Sparkles,
    step: "03",
    title: "Clear with voice or text",
    description:
      "Work through your queue by voice or keyboard. Approve drafts, archive noise, snooze what can wait.",
  },
  {
    icon: CheckCheck,
    step: "04",
    title: "Stay on top, every day",
    description:
      "ClearOut becomes your daily communication briefing. Less anxiety, more control, better relationships.",
  },
]

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 border-t border-co-border">
      <div className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-gradient mb-4">
            How it works
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            From connected to cleared in minutes. ClearOut is designed to feel obvious from day one.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {STEPS.map(({ icon: Icon, step, title, description }) => (
            <div key={step} className="flex gap-4">
              <div className="shrink-0">
                <div className="w-10 h-10 rounded-xl bg-co-blue/10 border border-co-blue/20 flex items-center justify-center">
                  <Icon className="w-4.5 h-4.5 text-co-blue" />
                </div>
              </div>
              <div>
                <div className="text-[10px] text-co-blue font-mono font-medium mb-1">{step}</div>
                <h3 className="text-sm font-semibold text-foreground mb-1.5">{title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
