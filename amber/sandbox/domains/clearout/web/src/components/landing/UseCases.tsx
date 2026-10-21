const USE_CASES = [
  {
    title: "Founder mode",
    description:
      "Juggling investor emails, customer escalations, team Slack, and personal texts? ClearOut becomes your communication chief-of-staff. Get a morning briefing, draft investor replies in your tone, and stay responsive without living in your inbox.",
    quote: "\"I went from 3 hours of inbox time to 20 minutes. ClearOut actually sounds like me.\"",
  },
  {
    title: "Executive mode",
    description:
      "High-volume communicators need one command center. ClearOut understands which senders always matter, keeps your response quality high, and protects your focus from low-signal noise.",
    quote: "\"Finally a tool that understands I shouldn't spend 2 hours on email every morning.\"",
  },
  {
    title: "Student mode",
    description:
      "Texts, emails, Discord, group chats, school platforms. ClearOut filters out noise and surfaces what matters - the professor email, the internship follow-up, the important group project thread.",
    quote: "\"I stopped missing emails I actually needed because everything was equally loud before.\"",
  },
  {
    title: "Team mode",
    description:
      "Small teams and startups use ClearOut to summarize internal communication, draft outward-facing responses with aligned company voice, and reduce the cognitive cost of being reachable.",
    quote: "\"Our response quality to customers improved and our team stress went down.\"",
  },
]

export function UseCases() {
  return (
    <section className="py-24 border-t border-co-border">
      <div className="max-w-5xl mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-gradient mb-4">
            Built for people who communicate a lot
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            From solo founders to small teams, ClearOut adapts to how you work.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {USE_CASES.map(({ title, description, quote }) => (
            <div key={title} className="glass rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-3">
                <h3 className="text-base font-semibold text-foreground">{title}</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
              <p className="text-xs text-foreground/60 italic border-l-2 border-co-blue/30 pl-3">
                {quote}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
