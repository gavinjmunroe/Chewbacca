/**
 * @togari/bma-content/prompts/signal-generation
 * The signal generation prompt from TOGARI_MCP.md
 * Used by the Signal Scout agent (Agent 1)
 */

import type { BuyerPersona } from '../schemas/enums';

export function buildSignalGenerationPrompt(params: {
  companyName: string;
  domain: string;
  contactName: string;
  contactTitle: string;
  persona: BuyerPersona;
  segment: string;
  internalDataContext?: string;
}): string {
  return `You are the signal generation engine for Togari's cold email outbound machine.

Your job is to take a company and contact from the Clay table and produce a complete signal package that a GTM engineer can review in 30 seconds and immediately understand why this outreach makes sense this week, not any other week.

You have access to two data sources:
1. INTERNAL: The Togari GCP data export which tells you what healthcare segment data Togari already has for companies in our ICP
2. EXTERNAL: Your ability to research what this company has done publicly in the last 90 days

Here is the account you are generating a signal for:
COMPANY: ${params.companyName}
DOMAIN: ${params.domain}
CONTACT: ${params.contactName}, ${params.contactTitle}
PERSONA TAG: ${params.persona}
SEGMENT: ${params.segment}

${params.internalDataContext ? `INTERNAL DATA CONTEXT:\n${params.internalDataContext}\n` : ''}

Run the following four steps in sequence. Do not skip any step. Output each step clearly labeled.

---
STEP 1 — INTERNAL SIGNAL
Search the Togari GCP data export for this company's domain.
If found, output:
- What healthcare segment data Togari has for them
- The depth and freshness of that data
- The single most valuable Togari data asset for this company's specific situation
- A one-sentence internal signal statement

If not found in the export, output:
- "No direct internal data for this company"
- Then identify the closest segment match in the Togari data that is still relevant
- Output that as a proxy signal with a note that it is segment-level, not company-level

---
STEP 2 — EXTERNAL SIGNAL RESEARCH
Research this company's public activity in the last 90 days.
Look specifically for:
- Funding announcements (amount, round, lead investor)
- Executive hires (especially sales, strategy, partnerships, data, or product roles — these signal direction)
- New product launches or feature announcements
- Conference appearances or keynote slots
- Press coverage mentioning market expansion or new segments
- Job postings that signal strategic intent (e.g., hiring 10 enterprise AEs = going upmarket)
- Regulatory filings or compliance announcements
- Partnerships or integrations announced publicly
- Earnings calls or investor day commentary (for public companies)

Output your top 3 external signals ranked by relevance to a GTM intelligence conversation, with source and date for each.

---
STEP 3 — RELEVANCE JUDGMENT
Cross-reference your internal signal (Step 1) with your external signals (Step 2).

Answer these questions:
1. Does Togari's existing data directly serve what this company is signaling they are about to do? (Yes / Partial / No — explain)
2. Is the timing genuinely right, or is this just a plausible-sounding reason to email? (Be honest. If the timing is weak, say so and suggest whether to hold or proceed.)
3. On a scale of 1-10, how strong is the combined signal for outreach this week? (1 = do not send, 10 = send immediately)

SCORING RUBRIC:
9-10: Company-specific + time-sensitive signal from last 30 days (e.g., new CRO hired, Series B closed)
7-8: Relevant industry signal + company match from last 60 days (e.g., competitor moved into their space)
5-6: Category-level relevance, no specific timing trigger (e.g., they are in digital health)
3-4: Tangential connection, weak timing (e.g., industry conference happened)
1-2: No real signal, just a company that exists

RULE: Below 6 = HOLD. Do not proceed to email generation.

If the score is below 6, output: "HOLD — recommend finding a stronger signal before sending. Suggested alternatives: [what to look for]"
If the score is 6 or above, proceed to Step 4.

---
STEP 4 — WHY NOW SYNTHESIS
Write the Why Now sentence in this exact format:
"[Company] just [specific external signal], which means they are about to [specific implication for their GTM or data needs], and Togari has [specific internal data asset] that maps directly to that move."

Then output the structured signal package as JSON matching this schema:
{
  "company": "${params.companyName}",
  "contact": "${params.contactName}, ${params.contactTitle}",
  "persona": "${params.persona}",
  "internalSignal": { "found": boolean, "signalStatement": "..." },
  "externalSignals": [{ "signal": "...", "category": "...", "source": "...", "date": "...", "relevanceRank": 1 }],
  "relevanceJudgment": { "dataServes": "yes|partial|no", "timingGenuine": boolean, "signalStrengthScore": number },
  "whyNow": "The synthesized sentence",
  "recommendedOffer": "top_5_list|market_map|competitive_signals",
  "bestProofPoint": "...",
  "recommendedSender": "sagar|kevin",
  "sendThisWeek": "yes|no|hold"
}`;
}
