/**
 * MOF Playbook Agent
 * The institutional knowledge base for the BMA GTM motion.
 * Stores and retrieves: ICP definitions, qualification criteria, email frameworks,
 * call frameworks, objection handling, and partnership frameworks.
 *
 * Other MOF agents reference this tool when they need to act —
 * e.g., the Reply Router pulls objection handling before drafting a response,
 * the Meeting Router pulls qualification criteria before a debrief.
 *
 * For objections: always returns the question-based approach (advance the sale, don't defend).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';

export function registerPlaybookTools(server: McpServer): void {

  // @ts-ignore
  server.tool(
    'mof_playbook_query',
    'Look up BMA GTM playbook knowledge. ' +
    'Returns: ICP definitions, qualification criteria, email/call frameworks, ' +
    'objection handling (question-based — advance the sale, never defend), ' +
    'and partnership frameworks. ' +
    'Other MOF agents call this tool before taking action to ensure responses are on-playbook. ' +
    'For objections, always returns questions designed to advance the conversation forward.',
    {
      query_type: z.enum([
        'icp',
        'qualification',
        'email_framework',
        'objection_handling',
        'partnership_framework',
        'all',
      ]).describe(
        'Which playbook section to retrieve: ' +
        'icp (ideal customer profile), ' +
        'qualification (MEDDIC-style criteria), ' +
        'email_framework (cold and follow-up structures), ' +
        'objection_handling (question-based responses to common objections), ' +
        'partnership_framework (BD and referral motion), ' +
        'all (return everything)'
      ),
      context: z.string().optional()
        .describe('Optional: specific situation or objection text to get tailored guidance — e.g. "they said they already use a consultant" or "they went silent after the proposal"'),
    },
    async (params) => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'playbook_retrieval',
            instructions: `You are the MOF Playbook Agent — the institutional knowledge base for BMA's GTM motion. Return the relevant playbook content.

QUERY TYPE: ${params.query_type}
${params.context ? `CONTEXT / SITUATION: ${params.context}` : ''}

---

${params.query_type === 'icp' || params.query_type === 'all' ? `
## ICP — IDEAL CUSTOMER PROFILE

BMA's ICP lives at the intersection of healthcare transformation and revenue operations complexity.

PRIMARY ICP (Tier A — highest fit):
- Company type: Health system, payer, digital health startup, or healthcare IT vendor
- Revenue range: $20M–$500M ARR (sweet spot: $50M–$200M)
- Stage: Scaling past product-market fit OR undergoing a strategic pivot
- Trigger signals: C-suite change, new product launch, market expansion, failed sales quarter, Series B/C funding
- Pain: Revenue operations fragmented across tools; GTM strategy unclear or underdeveloped; sales team hired but not converting
- Champion profile: VP of Revenue Operations, Head of Strategy, Chief Commercial Officer
- Economic buyer: CEO or COO at startup; VP/SVP level at larger org

SECONDARY ICP (Tier B — good fit, longer cycle):
- Company type: Medtech, life sciences, pharma-adjacent commercial teams
- Revenue range: $5M–$50M
- Trigger: Board pressure on commercialization, failed direct sales attempt
- Champion: Head of Business Development, VP of Sales

ANTI-ICP (Tier C — do not pursue):
- Pure fee-for-service clinical organizations with no commercial GTM motion
- Companies seeking only tactical execution (no strategic advisory angle)
- Orgs with no budget authority in the champion
- Companies where the CEO is the only decision-maker and is not engaged

OUTBOUND TARGETING CRITERIA:
1. Company has a GTM motion (not just a clinical operation)
2. Signal detected in last 30 days (hiring, funding, press, leadership change)
3. Champion title matches Tier A or B ICP
4. Company is in an industry adjacent to BMA's existing case studies
` : ''}

${params.query_type === 'qualification' || params.query_type === 'all' ? `
## QUALIFICATION CRITERIA

BMA uses a MEDDIC-adapted framework. A deal must score on at least 4 of 6 criteria to advance past discovery.

M — Metrics
- Can they quantify the problem? (e.g., "We lose 30% of qualified opps after demo")
- Do they have a revenue target tied to this initiative?
- Red flag: "We just want to see what you do" (no metrics = no urgency)

E — Economic Buyer
- Who has budget authority?
- Have we talked to them directly, or only to the champion?
- Red flag: Champion says "I'll run it by my boss" with no path to that meeting

D — Decision Criteria
- What does good look like to them?
- How have they evaluated similar services/tools before?
- Is BMA being compared to another vendor or approach?

D — Decision Process
- What is their buying process? (procurement, legal, board approval?)
- What is the realistic timeline?
- Red flag: "We're still exploring" with no defined timeline

I — Identify Pain
- What is the exact pain? (not the problem category — the specific pain)
- What have they tried before? Why did it fail?
- What happens if they do nothing? Do they understand the cost of inaction?

C — Champion
- Does this person care enough to fight for us internally?
- Have they shared internal context they did not need to share?
- Do they respond quickly to our outreach?
- Red flag: Champion goes quiet after discovery

QUALIFICATION GATE:
Before advancing to proposal_sent, confirm:
- Metrics: known ✓
- Economic buyer: identified and path to meeting exists ✓
- Pain: explicitly stated by the prospect ✓
- Timeline: realistic and confirmed ✓
If any are unknown, the deal stays in discovery_complete until resolved.
` : ''}

${params.query_type === 'email_framework' || params.query_type === 'all' ? `
## EMAIL FRAMEWORK

### Cold Outbound Email Structure (persona-specific word limits apply)
Persona A (VP RevOps): max 120 words
Persona B (Head of Strategy): max 150 words
Persona C (CCO, Digital Health Startup): max 90 words

STRUCTURE (every cold email):
1. Signal line: Why them, why now (1 sentence — specific to their company, not generic)
2. Pain hook: Name the exact pain they likely have (1-2 sentences)
3. Credibility: One proof point — a client result or case study reference (1 sentence)
4. CTA: One specific ask, low commitment (e.g., "worth 15 minutes?" or "open to a quick call this week?")

WHAT TO NEVER INCLUDE:
- "Hope this finds you well" — delete on sight
- "I wanted to reach out" — delete on sight
- Feature lists — not in cold email
- More than one CTA
- Attachments in initial outreach
- Company-wide generic intros ("BMA is a GTM advisory firm that...")

FOLLOW-UP SEQUENCE:
Day 0: Initial cold email
Day 3: Value-add bump (share one relevant insight, ask nothing)
Day 7: Direct ask ("Should I reach out next quarter instead?")
Day 14: Break-up email ("I'll assume the timing isn't right...")
After break-up: Move to nurture, do not contact for 60 days

SUBJECT LINE PRINCIPLES:
- 3-6 words max
- Specific to their company or role
- No clickbait, no question marks in cold outreach
- Examples: "Aledade's RevOps velocity" / "Q2 pipeline coverage" / "Intro from [mutual]"
` : ''}

${params.query_type === 'objection_handling' || params.query_type === 'all' ? `
## OBJECTION HANDLING

CORE PRINCIPLE: Never defend. Always advance with a question.
The goal is not to rebut the objection — it is to understand what is really behind it.
Every objection is data. Treat it as such.

FRAMEWORK FOR ANY OBJECTION:
1. Acknowledge (1 sentence — do not skip this, it signals you heard them)
2. Clarify with a question (uncover the real objection underneath)
3. Reframe if appropriate (only after you understand what is really going on)
4. Advance (propose a concrete next step)

---

OBJECTION: "We already have a consultant / agency doing this"
Acknowledge: "That makes sense — most of the teams we work with have someone in place."
Question: "What does that relationship cover today, and what's still not solved?"
Reframe: "We often complement rather than replace — the question is where the gap is."
Advance: "Would it be worth 20 minutes to map where BMA would add versus overlap?"

OBJECTION: "Your price is too high / we don't have budget"
Acknowledge: "Totally fair — budget is always a real constraint."
Question: "If price weren't a factor, would this be the right direction for you?"
[If yes:] "Then it's a prioritization question. What is this worth if it works?"
[If no:] "Good to know — what would have to change for this to make sense?"
Advance: "Can we look at a scoped version that fits within what you have available?"

OBJECTION: "We need to think about it / talk to our team"
Acknowledge: "Of course — this is not a decision to make alone."
Question: "What specifically needs to get resolved in that conversation?"
Reframe: "I want to make that conversation easy for you. What objections do you expect to hear?"
Advance: "Can we schedule 30 minutes for you, me, and the right people from your side?"

OBJECTION: "We're not ready yet / timing is off"
Acknowledge: "The timing comment makes sense — these things have to fit the calendar."
Question: "What would need to be true for the timing to be right?"
Question: "Is this more about budget cycles, internal priorities, or something else?"
Advance: "When would be the right time to revisit? I'll put it in the calendar now."

OBJECTION: "We tried something like this before and it didn't work"
Acknowledge: "I'm glad you said that — that context is really useful."
Question: "What happened? What did not work the way you expected?"
Reframe: [Only after listening fully] "The way BMA works is different in [specific way]."
Advance: "Would it make sense to walk through how we would approach your specific situation?"

OBJECTION: "I need to see ROI / case studies first"
Acknowledge: "That is exactly the right question to ask."
Question: "What would a convincing ROI case look like for you specifically?"
Action: Share the most relevant case study from BMA's portfolio.
Advance: "Let me send you the [relevant case] and we can debrief on how it maps to your situation."

OBJECTION: "We're evaluating other options"
Acknowledge: "You should be — this is an important decision."
Question: "What criteria are you using to evaluate? What does winning look like?"
Question: "What does the timeline for that evaluation look like?"
Advance: "I want to make sure you have what you need to evaluate us fairly. What would help most?"

${params.context ? `
TAILORED GUIDANCE FOR: "${params.context}"

Analyze the specific objection or situation described above and provide:
1. The most likely real objection underneath the stated one
2. The exact question to ask (word-for-word)
3. The reframe if appropriate
4. The next step to propose
` : ''}
` : ''}

${params.query_type === 'partnership_framework' || params.query_type === 'all' ? `
## PARTNERSHIP FRAMEWORK

BMA's partnership motion is led by Gwen. Flag Gwen on any deal where:
- The prospect mentions a referral, channel partner, or ecosystem play
- The contact works at a consulting firm, system integrator, or technology vendor
- The conversation involves co-selling, co-marketing, or white-labeling

PARTNERSHIP TYPES BMA PURSUES:
1. Referral Partners: Consulting firms and advisors who refer clients to BMA in exchange for a referral fee or reciprocal referrals
2. Strategic Partners: Technology vendors (CRM, analytics, data companies) whose clients need BMA's advisory work
3. Channel Partners: Firms that resell or embed BMA's services in their own offerings

QUALIFICATION FOR PARTNERSHIP MOTION:
- Do they have an active client base in BMA's ICP?
- Is there a clear referral or co-sell mechanism?
- Is there an economic model that works for both parties?
- Is there a named contact who will champion the partnership internally?

PARTNERSHIP DISCOVERY QUESTIONS:
1. "Who do your clients call when they need to improve their GTM motion?"
2. "Have you ever referred a client to a firm like ours? How did that work?"
3. "What does your ideal referral partner look like?"
4. "If this worked well, what would the next 12 months look like together?"

PARTNERSHIP DEAL STAGES:
- researching: Identified as potential partner, no contact made
- contacted: Initial outreach sent
- conversation_started: Had a first call about partnership potential
- discovery_complete: Validated there is mutual fit and a mechanism
- proposal_sent: Sent partnership agreement or referral framework
- verbal_commit: They agreed to move forward
- closed_won: Agreement signed, referral motion active

DO NOT advance a partnership to proposal_sent without:
- Confirmed ICP client base
- Named internal champion at the partner org
- Agreed referral or co-sell mechanism (even in draft form)
` : ''}

Return the playbook content above as structured text. If context was provided, include tailored guidance at the end.
Format for easy scanning: use headers, bullet points, and clear examples.
Return JSON: { sections_returned[], content, tailored_guidance }`,
          }, null, 2),
        }],
      };
    }
  );
}
