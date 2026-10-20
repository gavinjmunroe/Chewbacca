/**
 * @togari/core/tools — `help` tool implementation
 *
 * Returns a curated capability menu for Togari. Closes the
 * "what can you do?" discoverability gap (audit §1.2). The tool is
 * called from the tool-use loop when the user explicitly asks for help.
 *
 * Deterministic — no LLM call. The menu is markdown-formatted so the
 * Slack transport can post it directly.
 */

const FULL_MENU = `*Here's what I can do:*

:mag: *Look things up*
- "show me my pipeline" / "deals I own"
- "what's the status of Acme?" / "tell me about the Carlo deal"
- "what meetings did I have with KCLA last week?"
- "investor pipeline for amber" / "rytual customers"

:hammer_and_wrench: *Manage deals*
- "Pedro Noyola at meeting 2, $7500/mo, BMA inbound" → updates the deal
- "kyle exa partnerships" → creates a new deal
- "transfer Acme to Sagar" → changes ownership
- "promote the Carlo meeting" → turns a capture into a deal

:bulb: *Meetings*
- "next steps from the call with X" / "action items from yesterday's standup"
- "summarize the discovery call with Y"

:calendar: *Calendar*
- "schedule a call with Sarah at 3pm Wednesday"
- "reschedule the Sift discovery to 4pm"

:bell: *Reminders*
- "remind Kevin at 3pm Tuesday to text John"
- "Eric, Pat, Chris for SD visit Sunday-Tuesday"
- "remind me to follow up with Acme next week"

:envelope: *Email & proposals*
- "draft a check-in to john@acme.com"
- "generate a proposal from the call with Carlo, 7k/mo for 3 months"

I'll always confirm before sending an email or transferring a deal. Reminders show up with a [❌ Cancel] button.`;

const TOPIC_MENUS: Record<string, string> = {
  deals: `*Deals* — what to say:
- "kyle exa partnerships" → new deal
- "update river to 7k" / "move acme to discovery" → update
- "transfer Acme to Sagar" → ownership change
- "promote the Carlo meeting" → promote a capture into a tracked deal
- "show me deals at stage X" / "my pipeline" → query
- "what's the status of Acme?" → deal context`,
  reminders: `*Reminders* — what to say:
- "remind Kevin at 3pm Tuesday to text John"
- "have Sagar follow up with Acme tomorrow"
- "remind me to text John about the redline"
Multiple people: "Eric, Pat, Chris for SD visit Sunday-Tuesday" → one reminder per person.
Each reminder posts with a [❌ Cancel] button valid until it fires.`,
  meetings: `*Meetings* — what to say:
- "summarize the BMA standup"
- "next steps from the call with Carlo"
- "action items from yesterday's call"
- "what meetings did I have with KCLA last week" → search only
Tip: I'll find the right Fireflies transcript via the topic, person, or team name.`,
  email: `*Email* — what to say:
- "draft a check-in to john@acme.com"
- "draft a reply: thanks for the intro, let's set time for next week"
I'll always show a draft first; I won't send until you confirm via the :rocket: Send button.`,
  calendar: `*Calendar* — what to say:
- "schedule a discovery with Sarah at 3pm Wednesday"
- "1:1 with Karthik tomorrow at 10"
- "reschedule the Sift discovery to 4pm"
If you skip the time, I'll ask. If you skip the duration, I'll guess from the meeting type (quick=15, discovery/demo=60, 1:1/intro=30).`,
  queries: `*Pipeline & data queries* — what to say:
- "show me my pipeline" → uses your Slack identity to find your deals
- "investor pipeline for amber" → finds investor-tagged deals where Amber is the topic
- "rytual customers" / "amber deals closed this quarter"
- "how many deals closed last month"
I write a read-only SQL query against the warehouse — if the question is ambiguous, I'll explain what I ran.`,
};

export interface HelpToolInput {
  topic?: string;
}

export function runHelp(input: HelpToolInput): { markdown: string; topic: string } {
  const topic = (input.topic ?? '').trim().toLowerCase();
  if (!topic) return { markdown: FULL_MENU, topic: 'full' };
  const menu = TOPIC_MENUS[topic];
  if (!menu) {
    return {
      markdown: `I don't have a "${topic}" section. Try one of: deals, reminders, meetings, email, calendar, queries — or omit topic for the full menu.\n\n${FULL_MENU}`,
      topic: 'unknown',
    };
  }
  return { markdown: menu, topic };
}
