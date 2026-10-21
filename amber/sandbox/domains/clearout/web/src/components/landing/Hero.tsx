"use client"

import Link from "next/link"
import { Button } from "@/components/ui/Button"
import { ArrowRight, Mic, Mail, MessageSquare, Zap } from "lucide-react"

const MESSAGES = [
  { icon: Mail, text: "147 unread emails", color: "text-blue-400" },
  { icon: MessageSquare, text: "89 Slack messages", color: "text-purple-400" },
  { icon: MessageSquare, text: "34 iMessages", color: "text-green-400" },
]

export function Hero() {
  return (
    <section className="relative pt-32 pb-24 overflow-hidden">
      {/* Background glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-co-blue/8 rounded-full blur-[100px]" />
        <div className="absolute top-1/4 right-0 w-[400px] h-[400px] bg-co-violet/6 rounded-full blur-[80px]" />
      </div>

      <div className="relative max-w-4xl mx-auto px-4 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-co-blue/10 border border-co-blue/20 text-xs text-co-blue font-medium mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-co-blue animate-pulse" />
          Now in early access
        </div>

        {/* Headline */}
        <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.08] mb-6">
          <span className="text-gradient">Clear the flood.</span>
          <br />
          <span className="text-gradient-blue">Reclaim your mind.</span>
        </h1>

        {/* Subheadline */}
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
          ClearOut connects all your communication channels - email, Slack, iMessage, and more -
          and helps you triage, draft, and resolve everything with AI intelligence.
          In one place. In minutes.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-16">
          <Link href="/login">
            <Button size="lg" className="gap-2 glow-sm">
              Get started free
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
          <a href="#how-it-works">
            <Button variant="secondary" size="lg">
              See how it works
            </Button>
          </a>
        </div>

        {/* Demo visualization */}
        <div className="relative max-w-2xl mx-auto">
          {/* Overwhelmed state */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {MESSAGES.map(({ icon: Icon, text, color }) => (
              <div key={text} className="glass rounded-xl p-3 text-left">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-3.5 h-3.5 ${color}`} />
                  <span className="text-[10px] text-muted-foreground font-medium">
                    {text.split(" ")[0]}
                  </span>
                </div>
                <p className={`text-sm font-bold ${color}`}>{text.split(" ").slice(1).join(" ")}</p>
              </div>
            ))}
          </div>

          {/* Arrow */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent to-co-blue/30" />
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-co-blue/15 border border-co-blue/30">
              <Zap className="w-3.5 h-3.5 text-co-blue" />
              <span className="text-xs text-co-blue font-medium">ClearOut AI</span>
            </div>
            <div className="flex-1 h-px bg-gradient-to-l from-transparent to-co-blue/30" />
          </div>

          {/* Cleared state */}
          <div className="glass rounded-2xl p-4 text-left glow-blue">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-red-400" />
              <span className="text-xs font-semibold text-red-400">3 urgent</span>
              <span className="text-muted-foreground text-xs">·</span>
              <span className="text-xs text-muted-foreground">5 need replies</span>
              <span className="text-muted-foreground text-xs">·</span>
              <span className="text-xs text-green-400">142 cleared</span>
            </div>
            <div className="space-y-2">
              {[
                { from: "Sarah (investor)", msg: "Re: Q2 metrics deck - needs response today", tag: "reply", color: "text-red-400" },
                { from: "Mom", msg: "Thanksgiving plans - draft ready for your review", tag: "approved", color: "text-foreground" },
                { from: "Design team", msg: "Launch timeline - 3 decisions needed", tag: "decide", color: "text-orange-400" },
              ].map(item => (
                <div key={item.from} className="flex items-center gap-3 py-1.5 border-b border-co-border/50 last:border-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-co-blue shrink-0" />
                  <span className="text-xs font-medium text-foreground w-28 shrink-0 truncate">{item.from}</span>
                  <span className="text-xs text-muted-foreground flex-1 truncate">{item.msg}</span>
                  <span className={`text-[10px] font-medium ${item.color} shrink-0`}>{item.tag}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-co-border">
              <Mic className="w-3.5 h-3.5 text-co-blue" />
              <span className="text-xs text-co-blue">Voice mode: &ldquo;Reply to Sarah warmly, keep it brief&rdquo;</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
