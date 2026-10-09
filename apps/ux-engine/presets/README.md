# Presets

**The corpus under `systems/` cannot describe a dashboard.** A census of all 64
machine-readable systems found **64 product-UI components against 365 marketing
ones**. Every one was extracted from a marketing site, so even `linear.app`
carries `pricing-card` and `testimonial-card`: that is linear.app the website,
not Linear the application.

So `systems/` answers **what should this look like**, and it is genuinely good
at that: colour, type, radius, motion, and what a real brand refuses.

**These files answer what should this DO**, and they are not scraped from
anything. They are compiled from `research/`, which read the specs, the papers
and the shipped source of the libraries that got these primitives right.

**That is the better source anyway.** Scraping Linear's marketing page tells
you its accent is `#5e6ad2`. Reading Radix's focus-scope source tells you that
`focusout` with a null `relatedTarget` must be ignored or the CPU pegs, and
that is the thing that actually breaks.

## The rule

A preset states **behaviour, states and constants**. It never states colour,
radius or type, because those come from the chosen system. Pick a system for
the look, load a preset for the behaviour, and they do not overlap.

## What each preset must carry

1. **Every state.** Loading, empty, error, one, many, too many, offline.
   Missing state is a defect, not an omission (Rams #8, research/05).
2. **Keyboard**, from the ARIA APG table in research/07.
3. **The constants**, with their source, from research/02, 03, 06, 08, 09.
4. **The failure mode**, meaning the thing that breaks in production and is
   invisible in a demo.
