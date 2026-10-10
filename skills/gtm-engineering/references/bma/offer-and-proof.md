# BMA's offer, proof and ICP, as published

Source: `bluemodernadvisory/bma-website`, `src/data.js` at `d4caefe`
(2026-09-21, Sagar). Everything here is what BMA says about itself on
www.bluemodernadvisory.com. Use it when Chewbacca writes for BMA, pitches BMA's
service, or needs a real example of a BMA engagement. Re-read the file before
quoting a number: Maggie and Sagar edit it often (PRs #14 to #18 in September).

## Who BMA says it is

"A GTM Strategy & Engineering firm." Three pillars:

- Proprietary data sets: TAM maps and enriched, scored account and contact
  data the client owns.
- Managed GTM engineering: a retainer running inbound lead routing, ad
  targeting, hyper-targeted outbound and opportunity surfacing on those sets.
- Custom AI agents: data moats, sales research, GTM features inside the
  client's product.

Stack as published: Clay (enterprise partner, referral link keeps
`?via=213a2e`), Perplexity (enterprise partner, research workflows), and a
code layer of custom agents built with Claude Code and Codex.

The typical motion, in their words: formulaic filtering, CRM checks, contact
enrichment, AI enrichment, then sequencing.

## Best-fit customers, as published

Healthcare data teams first: provider, payer and facility records that must be
verified before outreach or operations. Then growth-stage and PE-backed
businesses buried in manual pipeline ops. The ICP form offers Healthcare, SaaS,
Financial services, Professional services, Manufacturing; sizes 1-50 to 1,000+;
roles from Founder/CEO through Clinical/Care ops and Finance.

## Team, as published

- Maggie Chen, CEO & Managing GTM Engineer (title set 2026-09-03).
- Sagar Tiwari, Founder and Managing Partner. Site bio: Clay employee #21, 150+
  customers sold, ex-McKinsey, Stanford GSB.
- Karthik Devarakonda, Founding GTM Engineer, building the people-rank scoring
  layer.

Caleb is not on the site.

## Proof, and how far each piece goes

| Claim                                                                                                                                                                                                                  | Status on the site                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 11,300 healthcare orgs processed, 8,000 contacts surfaced, up to 5 decision-makers per org                                                                                                                             | Marked "verified figures" in a code comment                     |
| Healthcare case: started from ~350 orgs and 3,000 child NPIs across three states; about half the universe processed and a third of people enriched after 30,000+ credits; contact searches capped at 5 per org         | Anonymized case study                                           |
| Pipeline-engine case: 35,000 existing leads activated; model supports 1,500 emails/day (750 net-new, 750 recycled), about 15,000 leads/month; client was capped near 400 personalized provider-group leads/week before | Anonymized case study. 1,500/day is capacity, not a sent number |
| Jack Johnson, former Head of Sales, Maple AI: "0-1 in 3 months... over $4M in pipeline"                                                                                                                                | `verified: true`                                                |
| "Healthcare Enterprise CRO" testimonial                                                                                                                                                                                | `verified: false`, anonymous                                    |

The site comment says there's deliberately no time-to-pipeline stat because
they don't have a defensible one. Keep it that way in anything Chewbacca
writes. Client names never appear on the site; don't add them.

## Mechanics worth knowing

- Booking link is Maggie's 15-minute Calendly; the site promises a reply to
  every inquiry within one business day.
- The ICP-list wizard posts to `/api/icp-list`, which forwards to
  `ICP_SUBMISSION_WEBHOOK_URL`; the contact form goes through Togari with
  `TOGARI_API_BASE` and `TOGARI_WEBSITE_KEY`, rate limited by
  `WEBSITE_FORM_RATE_LIMIT_PER_MIN`.
- `SHOW_TOGARI = false`: the self-serve Togari section is built and hidden.
- If the site loads on cellular but not WiFi, it's a zombie Netlify deploy plus
  stale DNS and old HSTS; `server/index.js` forces everything to
  `https://www.bluemodernadvisory.com` for that reason
  (`docs/WIFI_ACCESS_FIX.md`).
