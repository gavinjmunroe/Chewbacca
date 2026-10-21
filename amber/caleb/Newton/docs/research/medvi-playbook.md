# The Medvi Playbook: Lessons for Medha

**Source:** Medvi (founded September 2024 by Matthew Gallagher)

---

## The Numbers

| Metric | Value |
|--------|-------|
| Startup cost | $20,000 |
| Employees | 2 (founder + brother) |
| Month 1 customers | 300 |
| Month 2 customers | 1,300 |
| 2025 revenue | $401 million |
| 2025 customers | 250,000+ |
| 2026 projected revenue | $1.8 billion |
| Net profit margin | 16.2% |

---

## What Medvi Got Right

### 1. Outsource everything clinical
Medvi owns the brand and the customer. Everything else is outsourced:
- **CareValidate** — physician network, prescriber credentialing
- **OpenLoop Health** — prescription processing, pharmacy operations, fulfillment, shipping, regulatory compliance
- **Compounding pharmacies** — for custom GLP-1 formulations

Medha equivalent: Use OpenLoop/Wheel for psych providers, Truepill for pharmacy, Candid for billing.

### 2. AI agents replace employees
Gallagher used 12+ AI tools to run the entire operation:
- **ChatGPT, Claude, Grok** — code, copywriting, operational logic
- **Midjourney, Runway** — ad creatives and marketing visuals
- **ElevenLabs** — voice-based customer communication
- **Custom AI agents** — connecting the systems

Medha equivalent: Same stack, plus custom agents for prior auth, provider matching, and clinical screening.

### 3. Cash-pay subscription eliminates insurance friction
Medvi charges $179/month for GLP-1 drugs. No insurance. No prior auth. Patient pays, gets treated.

Medha equivalent: Tier 1 (psychiatric meds) should be cash-pay subscription ($79-199/month). Tier 2 (therapy) can offer insurance for reach. Tier 3 (psychedelics) is always cash-pay.

### 4. Massive market + low starting cost = fast growth
GLP-1 demand was already exploding. Gallagher rode the wave with $20K in ads.

Medha equivalent: 40M+ Americans on SSRIs. 10M+ ADHD diagnoses. Mental health is the largest underserved market in US healthcare. The wave is already here.

### 5. Speed > perfection
Medvi launched in September 2024 and hit $401M in 12 months. First-mover advantage in a massive market beats polish.

---

## What Medvi Got Wrong (Warnings for Medha)

### 1. FDA warning letter within months
On February 20, 2026, the FDA sent Medvi a warning letter for misbranding violations on the website. The AI-generated content made unsubstantiated claims.

**Medha lesson:** Every piece of copy — especially health claims — must be reviewed by a human compliance officer before publishing. AI writes, human reviews.

### 2. AI customer service hallucinated
Medvi's AI chatbot fabricated drug prices and hallucinated product lines that didn't exist.

**Medha lesson:** Customer service AI must be constrained to verified information only. Use RAG (retrieval augmented generation) against a verified knowledge base, never open-ended generation for medical claims.

### 3. Regulatory scrutiny is inevitable at scale
The NYT profile brought immediate regulatory and legal attention.

**Medha lesson:** Build compliance infrastructure from day one, not after you scale. Especially for controlled substances (ADHD meds) where the regulatory bar is 10x higher than GLP-1s.

### 4. Overprescribing risk is existential
Done. CEO was convicted. Cerebral paid $3.6M fine. Both were ADHD telehealth companies.

**Medha lesson:** For ADHD/stimulant prescribing, clinical protocols must be conservative. Start with non-stimulant options. Require follow-up appointments. Never let growth incentives compromise clinical standards.

---

## How Medha Differs from Medvi

| Dimension | Medvi | Medha |
|-----------|-------|-------|
| Market | GLP-1 weight loss | Full psychiatric spectrum |
| Medications | Single drug class | 6+ drug classes |
| Regulatory complexity | Moderate (GLP-1 not controlled) | High (ADHD meds = Schedule II) |
| Insurance | Cash-pay only | Cash-pay + insurance (therapy) |
| Treatments beyond meds | None (expanding to men's health) | Therapy, coaching, psychedelics |
| Clinical risk | Low (GLP-1 well-tolerated) | Higher (psychiatric meds need monitoring) |
| Market size | ~$100B (obesity) | ~$240B (mental health) |
| Competitive landscape | Hims, Ro, Noom | Brightside, Talkiatry, Done, Cerebral |
| Key advantage | Speed, AI, low friction | Breadth of services, trusted brand |

---

## The Medha Formula

```
Medvi playbook
  + Psychiatric medication (cash-pay subscription)
  + Therapy/coaching (insurance + cash)
  + Psychedelic treatments (regulated markets)
  + Conservative clinical protocols (avoid Done/Cerebral fate)
  + Compliance-first AI (no hallucinated medical claims)
  = Medha
```
