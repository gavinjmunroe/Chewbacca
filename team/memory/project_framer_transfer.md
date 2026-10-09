---
name: Framer site transfer exploration (BMA + Rytual)
description: 2026-05-13 session, explored options to move bluemodernadvisory.com and joinrytual.com off Framer hosting to GitHub. Parked without shipping. What was tried, what failed, viable paths forward.
type: project
originSessionId: 3128d416-4664-46bd-b452-b0ab1dc5989c
---

**Status:** Parked 2026-05-13. Nothing pushed to GitHub or deployed.

**Goal:** Move two Caleb-owned Framer sites onto his GitHub + Vercel:

- bluemodernadvisory.com (B2B consultancy, Sagar's firm; serif EB Garamond + Inter, #6d7aff periwinkle accent on #ecedf1 bg)
- joinrytual.com (Rytual wellness community, Inter Display + PT Mono + Karu, white minimal palette)

**Why:** Caleb explicitly does NOT want to pay for the React Export Framer plugin that unframer requires.

**What was tried (and failed):**

1. **unframer (github.com/remorses/unframer)**, official path requires paid React Export plugin in Framer. No free workaround exists; StackBlitz button is launched from inside the paid plugin.
2. **AnyDownload + Puppeteer**, Chrome rendered the page fine, captured all asset URLs, but Framer's CDN (framerusercontent.com) returns 403 to raw HTTP requests due to hotlink protection. Tried with system Chrome via PUPPETEER_EXECUTABLE_PATH.
3. **single-file-cli**, captured a 1.8MB self-contained HTML for BMA and 5.7MB for Rytual. Animations completely dead in output (DOM is frozen).
4. **Custom Puppeteer mirror script** (`/Users/joelnewton/code/archive/2026-code-root/framer-test/mirror.mjs`), uses CDP `Network.getResponseBody` to capture all 66 assets via the browser (no 403), rewrites URLs in HTML/CSS/JS to local paths. On-load animations work. **Scroll-triggered animations DO NOT work** even after the hybrid fix (using `curl` for raw HTML to preserve the `opacity: 0` initial states, verified the HTML now has 19 opacity:0 occurrences matching live site). Root cause uncertain, possibly framer-motion's IntersectionObserver setup checks the original Framer domain, or something in their minified runtime suppresses re-animation when the page is served from a different host. Did not get time to dig into the minified bundle.

**Viable paths forward (in order of recommendation):**

1. **Pay the plugin**, $19 × 2 = $38 total. Time-spent-vs-cost makes this the rational choice. Gets real component source, importable into Next.js, animations intact, edits round-trip back to Framer.
2. **Next.js rebuild from scratch**, BMA scaffold partially exists at `/Users/joelnewton/code/archive/2026-code-root/bluemodernadvisory/` with EB Garamond + Inter wired, periwinkle palette in globals.css, useScrollNav hook in `app/hooks/`. No sections built yet. ~1 focused day per site.
3. **Static mirror with no animations**, Either single-file capture or `bma-dist/` mirror work as static deploys, just don't have scroll-triggered reveals.

**Artifacts on disk (don't delete without asking):**

- `/Users/joelnewton/code/refs/unframer/`, cloned tool, reference
- `/Users/joelnewton/code/archive/2026-code-root/framer-test/mirror.mjs`, custom mirror script. Works on non-Framer sites. For Framer specifically, scroll animations don't survive.
- `/Users/joelnewton/code/archive/2026-code-root/framer-test/bma-singlefile.html`, 1.8MB frozen snapshot
- `/Users/joelnewton/code/archive/2026-code-root/framer-test/rytual-singlefile.html`, 5.7MB frozen snapshot
- `/Users/joelnewton/code/archive/2026-code-root/framer-test/bma-dist/`, 66-asset mirror
- `/Users/joelnewton/code/archive/2026-code-root/bluemodernadvisory/`, Next.js 16 scaffold, fonts + palette wired, no sections yet

**BMA content captured (live site, full breakdown):** see WebFetch result from this session, full hero copy, who-we-are, 3-person team (Sagar Tiwari Founder & Chairman, Kevin Cong Founding GTM Strategist, Karthik Devarakonda Founding GTM Engineer), 3-step How We Work (Data Diagnostic, System Design & Deployment, Campaign Activation), 4 testimonials (Mike/Tide Rock, Jack/Maple AI, Joe/Healthcare, Ron/Alpha School), 4 FAQs, Calendly CTA. All content is verbatim usable for a rebuild.

**Rytual content captured:** thin from WebFetch (SPA didn't render in fetch). Known sections: Hero (NY & SoCal practitioners, art/music/immersion/nature healing), Moments (Japan Ski 2026, Olana Artist 2025, NYC Sunday Sunsets 2024, J-Tree Meditation 2023), Footer. Subpages: /moments, /colorbridge, /about, /contact. Need Puppeteer-rendered scrape for full content if rebuilding.
