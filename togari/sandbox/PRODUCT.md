# Product

## Register

product

## Users

Blue Modern Advisory's internal team (founders Sagar and Caleb, plus operators like Colin and Tyler). They sign in with their bluemodernadvisory.com Google account after landing on the marketing site. In-app they are always mid-task: checking where a deal sits, asking Togari a question in plain English, moving a lead across the pipeline, pulling up a client's contract and context, or editing an ops runbook in the wiki. This is a working tool used many times a day on a laptop, occasionally checked on a phone.

## Product Purpose

The authenticated front end for Togari, BMA's screenless data layer that auto-ingests Gmail, Fireflies, and Calendar into BigQuery and exposes it over MCP. The dashboard makes that data visible and editable across five views: Mass Data (people and companies with a Togari chat panel), Channels, Pipeline (kanban), Clients (paying accounts), and the internal Wiki, plus a Settings page for connection status and personal API keys. Success is an operator trusting the numbers at a glance and making a change (promote a lead, move a stage, ask a question) without friction.

## Brand Personality

Editorial, precise, quietly premium. BMA's identity is a serif-forward, advisory-firm voice (Newsreader display type, a slate-blue palette, a single sunset-orange accent). The product should feel like a considered instrument from a firm that takes craft seriously, not a generic SaaS admin panel. Three words: composed, credible, exact.

## Anti-references

- Generic SaaS admin templates (Material dashboards, bootstrap-gray tables, purple-gradient headers).
- The "hero metric" template: giant number, gradient accent, three supporting stats.
- Over-decorated product chrome: heavy shadows, glassmorphism everywhere, motion for its own sake.
- Marketing-site serif body copy misapplied to dense data. The brand is editorial; the tool still has to read like a tool.

## Design Principles

- **The tool disappears into the task.** Earned familiarity beats novelty. Standard affordances for standard actions; a fluent Linear/Stripe/Notion user should trust it on sight.
- **Serif for identity, sans for work.** Reserve the Newsreader serif for page titles and the Togari wordmark. Data, labels, controls, and body render in a clean sans so information stays fast to scan.
- **One accent, meaning-bearing.** Slate blue marks the current selection, primary action, and live state; sunset orange is a rare highlight. Color is never decoration.
- **Every state is designed.** Default, hover, focus, active, disabled, loading, empty, and error each exist for every interactive element. No blank rectangles, no dead ends.
- **Density with air.** Dense where operators need it (tables, kanban), with deliberate spacing rhythm so nothing feels cramped or arbitrary.

## Accessibility & Inclusion

WCAG 2.1 AA. Body text at 4.5:1 minimum against its surface, large text and UI glyphs at 3:1. Visible keyboard focus on every interactive element, never removed without replacement. Respect prefers-reduced-motion. Touch targets 44px minimum on the phone breakpoint. Do not encode meaning in color alone (stage, status, and connection state carry a label, not just a hue).
