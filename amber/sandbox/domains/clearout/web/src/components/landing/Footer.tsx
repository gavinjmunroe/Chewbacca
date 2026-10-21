import Link from "next/link"
import { Zap } from "lucide-react"

export function Footer() {
  return (
    <footer className="border-t border-co-border py-12">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex flex-col md:flex-row items-start justify-between gap-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-md bg-co-blue flex items-center justify-center">
                <Zap className="w-3 h-3 text-white" />
              </div>
              <span className="text-sm font-semibold text-white">ClearOut</span>
            </div>
            <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
              The AI-native communication command center. Stop drowning in messages.
            </p>
          </div>

          {/* Links */}
          <div className="grid grid-cols-2 gap-8">
            <div>
              <h4 className="text-xs font-semibold text-foreground mb-3">Product</h4>
              <ul className="space-y-2">
                {["Features", "Pricing", "Changelog", "Roadmap"].map(item => (
                  <li key={item}>
                    <Link
                      href="#"
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {item}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-foreground mb-3">Company</h4>
              <ul className="space-y-2">
                {["About", "Privacy", "Terms", "Contact"].map(item => (
                  <li key={item}>
                    <Link
                      href="#"
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {item}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-co-border flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>© 2026 ClearOut. All rights reserved.</span>
          <span>Built with AI. Powered by Anthropic Claude.</span>
        </div>
      </div>
    </footer>
  )
}
