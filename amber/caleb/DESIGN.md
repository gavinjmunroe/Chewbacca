<!--
  Design system for all Amber-facing surfaces.
  Originally authored for Sift (goodnight000/Sift, Caleb's project) and
  adopted verbatim by Amber to keep a consistent look across Caleb-built
  knowledge tools. Reuse via owner consent; update the Decisions Log in
  this file when Amber-specific deviations are introduced.
-->

# Design System — Sift

## Product Context
- **What this is:** The knowledge infrastructure for agents and humans. Sift builds AI-maintained wikis — each with a dedicated Librarian agent that compiles sources, maintains structure, resolves contradictions, and answers questions. Any permissioned human or agent can read, write, and build on a Sift wiki.
- **Who it's for:** Anyone who needs structured, maintained knowledge. Students (go-to-market wedge), knowledge workers, developers/engineering teams, businesses, communities. The wiki serves both humans and AI agents.
- **Space/industry:** Knowledge infrastructure, AI tooling. Competitors: Notion, Confluence (static, no AI maintenance), NotebookLM (ephemeral, no persistent output), RAG pipelines (read-only, human-invisible). Positioned as the only product that's both agent-accessible AND human-readable.
- **Project type:** Web app (React 19 + Vite + Tailwind CSS + shadcn/ui frontend, FastAPI backend, portable deployment)

## Aesthetic Direction
- **Direction:** Confident Knowledge — editorial authority meets premium tool
- **Decoration level:** Intentional — margin annotations on wiki articles, subtle structural lines, no decorative blobs
- **Mood:** Precise, confident, authoritative. Like a fountain pen on good paper. The product should trigger "this is too good for a knowledge tool." Not gamified, not clinical, not AI-generic.
- **Reference sites:** Linear (premium tool feel), well-typeset publications, Stripe docs (clarity + polish)
- **Metaphor:** The wiki feels like a publication. The Librarian feels like a trusted expert. The dashboard feels like mission control.

## Typography
- **Display/Hero:** Satoshi Black (900) — with tight negative letter-spacing (-1.5 to -2px), Satoshi at heavy weights becomes a confident display font. Modern, geometric, sharp. Used for hero headlines, landing page section titles, marketing display text.
  - Load from Fontshare: `f[]=satoshi@300,400,500,600,700,900`
- **Headings:** Satoshi Bold (700) — wiki article headings, section titles, card titles. Clean hierarchy through weight, not font switching.
- **Body:** Satoshi Regular–Medium (400–500) — geometric sans with personality. Carries long-form wiki reading without being default-feeling. Used for article body text, UI labels, navigation, all prose.
- **UI/Labels:** Satoshi Medium (500)
- **Data/Tables:** Geist Mono — modern and clean. Less "IDE/developer" than JetBrains Mono, feels like polished data display rather than a terminal. Used for Librarian status, health check data, timestamps, source citations, compile metadata, quiz scores.
  - Load from Google Fonts: `family=Geist+Mono:wght@400;500;600`
- **Code:** Geist Mono
- **Scale:**
  - H1 (article title): 32px Satoshi Bold, letter-spacing -0.5px
  - H2 (section heading): 22px Satoshi Bold
  - H3 (subsection): 17px Satoshi Semibold
  - Body: 14px Satoshi Regular, line-height 1.7
  - Small: 13px Satoshi
  - Meta/Data: 11px Geist Mono
  - Display (hero/marketing): 48–64px Satoshi Black, letter-spacing -1.5 to -2px
  - Pull-quotes: 20px Satoshi Medium Italic

## Color
- **Approach:** Ink & Coral — deep ink blue for structure, coral for energy and earned mastery. Warm foundations, high contrast.
- **Palette (Light mode — default):**
  - Background: `#FAFAF7` — warm off-white
  - Surface: `#FFFFFF` — pure white cards
  - Surface-2: `#F0EDE6` — subtle warm dividers, hover states
  - Text primary: `#0F172A` — deep ink, near-black
  - Text muted: `#64748B` — cool slate gray
  - Text faint: `#94A3B8` — labels, timestamps
  - Accent (blue): `#1E40AF` — structure, wiki links, navigation, cross-references
  - Energy (coral): `#E05A3A` — CTAs, mastery indicators, quiz actions, progress earned
  - Border: `#E2E0DB` — card borders, dividers
  - Success: `#16764E` — mastered topics, correct answers
  - Warning: `#CA8A04` — due for review, approaching deadlines
  - Error: `#DC2626` — wrong answers, overdue items
  - Info: `#2563EB` — system messages, updates
- **Palette (Dark mode, deferred implementation):**
  - Background: `#0C1222` — deep ink
  - Surface: `#141B2E` — card surfaces
  - Surface-2: `#1C2540` — elevated panels
  - Text primary: `#E2E0DB` — warm off-white
  - Text muted: `#8B95A8` — slate
  - Text faint: `#5A6478` — meta
  - Accent (blue): `#6B8FE8` — lightened for contrast
  - Energy (coral): `#E8704E` — lightened for contrast
  - Border: `#1E2A45`
  - Success: `#4ADE80`
  - Warning: `#FACC15`
  - Error: `#F87171`
  - Info: `#60A5FA`
- **Color rules:**
  - Coral is the "action" color. It appears on primary CTAs, quiz completions, and interactive elements. Blue is for structure and navigation.
  - Wiki cross-reference links use the accent blue with a subtle underline that intensifies on hover.
  - Source citations render in Geist Mono with a `surface-2` background pill.
  - Librarian status and health indicators use the info blue. Contradictions and issues use warning/error.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — generous in wiki article reading areas, tighter in navigation and dashboard
- **Scale:** 2xs(2px) xs(4px) sm(8px) md(16px) lg(24px) xl(32px) 2xl(48px) 3xl(64px)
- **Wiki article content:** 48px horizontal padding, max-width 720px for optimal reading line length
- **Body text line-height:** 1.7 (generous for reading comfort)

## Layout
- **Approach:** Hybrid — grid-disciplined for the app, creative-editorial for the landing page
- **App layout:** Sidebar (240px) + main content area. Sidebar contains topic tree navigation.
- **Landing page:** Left-aligned hero with asymmetric composition. No centered-everything. The value statement is oversized text, stacked in short lines. The right side shows product screenshots.
- **Grid:** 12-column grid for structure, intentionally broken in hero and feature sections on the landing page
- **Max content width:** 1100px (page), 720px (wiki article reading column)
- **Border radius:** sm: 4px (inputs, small elements), md: 6px (cards, buttons), lg: 8px (modals, large panels), full: 9999px (connection tags, pills)

## Motion
- **Approach:** Minimal-functional — smooth state transitions, no bouncy or celebratory animations
- **Easing:** enter: ease-out, exit: ease-in, move: ease-in-out
- **Duration:** micro: 50-100ms (hover states), short: 150-200ms (button feedback), medium: 250-350ms (page transitions, panel slides)
- **Special:** Knowledge graph nodes in the mastery map can have a subtle glow/fill animation as mastery increases. This is the one place where ambient motion tells a story.
- **Never:** Confetti, bounce, shake, XP counters, streak celebrations. Progress is felt through the visual system, not performative animations.

## Design Risks (Intentional Departures)
1. **Single-font system at heavy weights for display (Satoshi Black)** — instead of a separate display font, we use Satoshi at 900 weight with tight letter-spacing. This creates a confident, modern display voice from the same family as the body text. The sophistication comes from restraint, not font variety.
2. **Ink & Coral dual-accent palette** — nobody in knowledge tooling uses deep ink blue + coral. Instant visual recognition. Coral as the action color creates energy without gamification.
3. **Clean article presentation** — pull-quotes in Satoshi Medium Italic, source citations in Geist Mono pills, cross-reference tags as pills. The wiki articles are the viral distribution moment — they need to look worth screenshotting and sharing.
4. **Librarian-forward design** — the Librarian's status, health checks, and Q&A feel like a trusted presence, not a chatbot. Subtle, always available, never intrusive.

## Anti-Patterns (Never Do)
- No purple gradients or any gradient-as-decoration
- No 3-column icon grids with centered text
- No centered-everything layouts
- No decorative blobs, orbs, or mesh gradients
- No mascots, XP bars, streak counters, confetti, or chatbot-style bubbles
- No bouncy/playful border-radius on everything
- No generic stock-photo hero sections
- No overused fonts: Inter, Roboto, Arial, Poppins, Montserrat, Open Sans

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-05 | Initial design system created | Created by /design-consultation. Palette direction chosen from 3 options (Studio Warm, Library After Hours, Ink & Coral). Ink & Coral selected for academic confidence without AI-generic dark mode tropes. |
| 2026-04-05 | Typography: Instrument Serif + Satoshi + JetBrains Mono | Original choice — serif headings for editorial authority. Replaced 2026-04-06. |
| 2026-04-06 | Typography: Satoshi (consolidated) + Geist Mono | Replaced Instrument Serif and JetBrains Mono. Satoshi Black with tight letter-spacing for display, Satoshi Regular–Medium for body/UI, Geist Mono for data. Driven by desire for modern AI aesthetic (Notion, Wispr, Anthropic vibes) over editorial-publication feel. Single-font system — sophistication through restraint. |
| 2026-04-05 | Outside voices consulted: Codex + Claude subagent | Both agreed: reject gamification, use warm tones, distinctive typography, editorial quality. Codex proposed light-first editorial (terracotta + navy). Subagent proposed dark-first "Knowledge Darkroom" (gold + lilac). Final direction synthesized from all three perspectives. |
