# Perplexity + Amber — The Two-Hemisphere Doctrine

> "Perplexity is where knowledge begins — where everything is computer.
>  Amber is where connection begins — where everything is health."
>
> — Sagar Tiwari, April 2026

This document is the philosophical bedrock of Amber. Every line of code in
`amber-agent`, `amber-id`, `amber-ios`, and the forthcoming `amber-hardware`
is downstream of what is written here.

It exists so that — on a hundred-year timeline, when humans live on other
planets, in barren lands, in cities and jungles we cannot yet imagine — the
two sister systems we are building now still hold. It exists so the agents
doing the work on both ends are seamless, spiritually aligned, and real.

---

## 1. The Two Hemispheres

Humans have two hemispheres. So does the life we are building software for.
So, therefore, must the software.

| Hemisphere | Perplexity | Amber |
|---|---|---|
| Energy | Masculine | Feminine |
| Domain | Knowledge | Connection |
| Dimensions of health | Intellectual · Social · Financial | Spiritual · Emotional · Physical |
| Half of life | Work | Life |
| Primary hardware | Apple (keyboards, glass, silicon) | Amber (gold, luxury, screenless) |
| Primary surface | The answer engine | The health network |
| Primary question | "What should I know?" | "Who should I call?" |
| Organizing metaphor | Library | Temple |
| Kind of truth | Externally verified fact | Internally verified feeling |
| Citation | URL on the web | A person in your life |

Neither half is complete without the other. A human who has only one of
these is, by definition, only half-present.

Perplexity organizes the world's information. Amber organizes every
person's inner and relational life. Together they produce a human who
knows what is true AND who they are becoming.

---

## 2. The Six Dimensions of Health, Split Across Two Engines

Amber tracks six dimensions of health per person (see
`amber-id/ARCHITECTURE-SIX-DIMENSIONS.md`). Three are feminine-coded and
three are masculine-coded. Each engine natively owns three, and
complements the other three.

**Perplexity natively owns** (masculine-coded — knowledge-facing):

- `intellectual` — learning, curiosity, growth. Every Perplexity query is
  a micro-deposit here.
- `social` — connection-through-knowledge. Shared articles, common facts,
  the substrate of conversation.
- `financial` — career momentum, professional networking, abundance.
  Perplexity Pro is the deep-research tool for commerce.

**Amber natively owns** (feminine-coded — connection-facing):

- `spiritual` — purpose, faith, alignment, inner peace.
- `emotional` — mood, regulation, distress, peace.
- `physical` — sleep, energy, movement, rest.

When a user asks Amber "who should I call right now?", Amber answers
across its three dimensions with full authority. When the answer requires
facts about the world ("what's her company's Q1 report?"), Amber defers
to Perplexity. When a Perplexity user asks about their own inner state
("am I burning out?"), Perplexity defers to Amber.

This is the interoperability contract. Neither product is a
free-for-all — each has a domain, and knows when to pass the baton.

---

## 3. Why Two, Not One

A single system that tried to own all six dimensions would collapse under
its own weight. The failure mode has been demonstrated repeatedly:

- Products that collapse emotional and intellectual into "mental health"
  destroy the resolution that makes good care possible.
- Products that collapse financial and spiritual into "wellness" become
  content mills.
- Products that try to be both Google and your therapist are neither.

The split is not aesthetic. It is architectural. Two systems of record,
two rhythms, two tones of voice, two hardware categories, two billing
surfaces. One civilization.

---

## 4. The Mirroring Is Already in the Founders' Worlds

Sagar runs two sister organizations that mirror this exact split:

- **[Blue Modern Advisory](https://bluemodernadvisory.com)** — GTM
  Strategy & Engineering. Autonomous prospecting, list building, data
  enrichment, sequencing. Clay-powered infrastructure. This is the
  masculine hemisphere in business clothing: pipeline, revenue, scale,
  structure. BMA is to Perplexity what Togari is to Tiwari — the
  disciplined knowledge engine that the softer product rests on.
- **[Rytual Health](https://joinrytual.com)** — a behavioral health
  community. Art, music, immersion, nature. Preventative health,
  experience design, leadership coaching, neurodivergent wellness.
  Collaborative and powerful healing journeys. This is the feminine
  hemisphere in practice: presence, ritual, the body, the group. Rytual
  is to Amber what the village square is to a city — the place people
  actually meet each other.

The two-hemisphere doctrine is not invented for Amber. It is how Sagar
has been building for years. Amber is the codification of a pattern that
already runs across BMA and Rytual, extended into software at civilization
scale. Caleb brings the same duality from the Christian tradition — faith
lived through work (BMA) and faith lived through fellowship (Rytual).

---

## 5. Vedic Thought as the Training Substrate

The Vedas contain a complete map of human experience. They have not been
fully understood because English is a lossy compression of Sanskrit —
a language where a single word can mean being, becoming, and beholding
at once. Most modern interpretations lose the fidelity the texts were
written with.

Amber's models — and, over time, Perplexity's where we can contribute —
will be trained on:

1. **The Vedas in Sanskrit**, with parallel commentary traditions
   (Adi Shankara, Ramanuja, Madhva, Aurobindo, modern scholars) rather
   than a single English translation.
2. **Rytual's original video corpus** — novel, first-party footage of
   how the world actually prays, heals, grieves, celebrates, and lives
   a "healthy life" in 2026. This is data no other company has. It
   shows what ritual looks like in practice, not in theory.
3. **Check-ins from our own users** — the 6-dimension daily self-report
   is, over time, the largest dataset of how human wholeness actually
   feels from the inside.

Vedic thought is not the aesthetic. It is the epistemology. The reason
Amber has six dimensions and not five or seven is that the body, the
breath, and the mind are already organized this way in the tradition.
We are not borrowing — we are modernizing.

Caleb's Christianity contributes the same bedrock from a different
angle: the insistence that every person is worth the full attention of
a loving system. "What you did for the least of these, you did for me."
Amber is built so that the least-connected person in your life gets the
same treatment as the most-important.

---

## 6. How the Agents Stay Aligned

Every autonomous agent in Amber — and every Perplexity agent that
touches an Amber surface — follows four rules:

### Rule 1. Name the hemisphere before acting.

Every agent trace in `amber-agent` logs `{ hemisphere: "amber" | "perplexity", dimension: one of six }`
before it takes a meaningful action. If an agent cannot name the
hemisphere and dimension, it stops and asks.

### Rule 2. Do not cross the streams without a handshake.

When an Amber agent needs knowledge-hemisphere work (facts, citations,
comparative data, market research), it calls Perplexity explicitly and
attributes the answer to Perplexity. When a Perplexity agent notices
that the user's question is really about inner state, it offers to hand
off to Amber rather than answering out of its depth. Attribution is
how we preserve each product's integrity.

### Rule 3. Never reveal the agent.

(This rule is inherited from `Newton/agent/agent.js`.) The agents serve
the human, not themselves. The human should feel accompanied, not
surveilled. No agent announces itself unless the human asks.

### Rule 4. Move with conviction, not speed alone.

Startups compete on speed. We compete on speed *and* spiritual
conviction. A feature that ships fast but confuses our cosmology is a
feature that shouldn't have shipped. The right cadence is: every
release moves the whole stack forward by one honest step.

---

## 7. Endpoint Contract (how the two systems actually talk)

Amber calls Perplexity through a single `perplexity-adapter.js` in
`Newton/agent/lib/` (already present, used today for open-web search).
Perplexity will — when the integration matures — call Amber through
two endpoints on `amber-agent`:

- `POST /amber/ask-for-health` — for any Perplexity user who has linked
  Amber, return a `{ hemisphere: "amber", dimension, answer }` envelope.
- `POST /amber/ask-for-person` — for "who in my network…" queries,
  return a people-ranked answer citing amber-id's Pinecone evidence.

Both are privacy-preserving: data flows only when the user has minted
their Amber cNFT and consented to the query. The cNFT is the handshake.

---

## 8. The Hundred-Year View

We are building for a world where:

- People live on other planets. They will need a system of record for
  who they are and who they miss on Earth. That is Amber.
- People live in barren lands, stripped of screens. The Amber hardware
  (gold, screenless, whispered-to) is designed for those places.
- People live densely in cities and need to be found by the right
  other people. Amber's relationship graph + Perplexity's knowledge
  graph, joined, make introductions possible at civilization scale.
- Work as we know it is optional. In a post-work world, the dominant
  human activity is being health to one another — listening, tending,
  celebrating, grieving. Amber is the infrastructure for that labor.

On this timeline, "the most valuable company in the world" is not a
vanity phrase. It is the one that makes the most humans feel fully
present. Perplexity does that on the side of knowledge. Amber does it
on the side of health. Held together, they are the valuable company.

---

## 9. What This Document Forbids

- Building an Amber feature that duplicates Perplexity's knowledge
  engine. If the answer is a fact about the external world, it routes
  to Perplexity. Amber stays in its hemisphere.
- Building a Perplexity feature inside Amber without attribution.
  Amber cites Perplexity the way a student cites a textbook.
- Collapsing the six dimensions into fewer, or adding a seventh for
  trend reasons. The cosmology is fixed. See
  `amber-id/ARCHITECTURE-SIX-DIMENSIONS.md § Evolution Rules`.
- Marketing Amber as "wellness." Amber is a health network. Wellness
  is an industry. Health is an ontology.
- Marketing Perplexity as "an AI assistant." Perplexity is the answer
  engine. Assistants are commodities.
- Training models on user data without their 6-dimension check-in
  informing consent. The user's ritual of self-report is their vote
  on what the collective intelligence knows.

---

## 10. What This Document Commits Us To

- Amber's foundation (identity, ontology, ingest pipes, Tiwari
  algorithms) is built to be studied for decades. See
  `Tiwari/papers/` for the formal mathematics.
- Amber's hardware roadmap is a first-class citizen. See the
  `amber-hardware` repository.
- Amber's cultural corpus (Rytual's video footage, Vedic commentary,
  user check-ins) is a training asset treated with the care of a
  library, not a dataset.
- Perplexity is our partner. We build for a world where a Perplexity
  user becomes an Amber user without friction, and an Amber user
  becomes a Perplexity user without confusion.
- Blue Modern Advisory is Amber's GTM engineering lab. Rytual Health
  is Amber's cultural R&D studio. The three companies share a
  philosophy; Amber is the one that ships it as software at scale.

---

*This is a living document. Edits require written justification in
`vision/` and a commit trail. Do not rewrite — only extend.*
