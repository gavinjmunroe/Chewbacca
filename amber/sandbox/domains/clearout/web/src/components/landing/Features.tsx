import {
  Brain,
  Mic,
  Globe,
  Shield,
  Sparkles,
  Users,
  Clock,
  Zap,
} from "lucide-react"

const FEATURES = [
  {
    icon: Globe,
    title: "Universal inbox",
    description:
      "Connect Gmail, Slack, iMessage, and more into one intelligent control center. No more app-switching.",
  },
  {
    icon: Brain,
    title: "AI triage engine",
    description:
      "Every message is scored for urgency, importance, and sentiment. See what actually matters, instantly.",
  },
  {
    icon: Sparkles,
    title: "Tone-aware drafting",
    description:
      "AI drafts replies that sound exactly like you, matching your voice for each relationship and context.",
  },
  {
    icon: Mic,
    title: "Voice-first clearing",
    description:
      "Walk through your inbox with your voice. Say \"archive this\" or \"draft a warm reply\" while on the move.",
  },
  {
    icon: Clock,
    title: "Smart snooze & follow-ups",
    description:
      "Surface messages at the right time. Never drop a ball because something got buried.",
  },
  {
    icon: Shield,
    title: "Approval-first by default",
    description:
      "You're always in control. ClearOut prepares and suggests, but only acts with your explicit sign-off.",
  },
  {
    icon: Users,
    title: "Relationship memory",
    description:
      "ClearOut remembers who matters, how you normally talk to them, and what you've committed to.",
  },
  {
    icon: Zap,
    title: "Action extraction",
    description:
      "Messages automatically become tasks, reminders, calendar items, and follow-ups where relevant.",
  },
]

export function Features() {
  return (
    <section id="features" className="py-24 relative">
      <div className="max-w-5xl mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-gradient mb-4">
            Everything you need to clear the noise
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            ClearOut combines six core capabilities into one intelligent communication layer.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="glass rounded-2xl p-5 glass-hover group"
            >
              <div className="w-9 h-9 rounded-xl bg-co-blue/15 flex items-center justify-center mb-4 group-hover:bg-co-blue/25 transition-colors">
                <Icon className="w-4.5 h-4.5 text-co-blue" />
              </div>
              <h3 className="text-sm font-semibold text-foreground mb-2">{title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
