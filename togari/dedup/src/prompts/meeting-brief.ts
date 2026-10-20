/**
 * @togari/bma-content/prompts/meeting-brief
 * Pre-meeting brief generation prompt
 * from MIDDLE_FUNNEL_FOUNDATION.md
 * Used by the Meeting Router agent (Agent 4)
 */

export function buildPreMeetingBriefPrompt(params: {
  prospectName: string;
  prospectTitle: string;
  company: string;
  meetingDate: string;
  meetingTime: string;
  meetingDuration: string;
  platform: string;
  assignedTo: string;
  companyContext: string;
  whyNow: string;
  emailThread: string;
  togariDataRelevance: string;
  bestProofPoint: string;
  gwenRelevant: boolean;
  gwenAngle?: string;
  karthikRelevant: boolean;
  karthikContext?: string;
  personalNotes?: string;
}): string {
  return `You are generating a pre-meeting brief for a Togari prospect meeting.

This brief will be delivered to the team member 24 hours before the meeting. It must be so thorough that the person reading it feels like they have known this prospect for weeks. Not a CRM dump. A human picture that makes the team member fully prepared.

PROSPECT: ${params.prospectName}, ${params.prospectTitle} at ${params.company}
MEETING: ${params.meetingDate} at ${params.meetingTime}, ${params.meetingDuration} via ${params.platform}
ASSIGNED TO: ${params.assignedTo}

COMPANY CONTEXT:
${params.companyContext}

WHY WE REACHED OUT:
${params.whyNow}

EMAIL THREAD:
${params.emailThread}

TOGARI DATA RELEVANCE:
${params.togariDataRelevance}

BEST PROOF POINT:
${params.bestProofPoint}

${params.personalNotes ? `PERSONAL NOTES ABOUT THIS PROSPECT:\n${params.personalNotes}\n` : ''}

Generate a complete pre-meeting brief in this exact structure:

1. WHO THEY ARE (READ THIS FIRST)
Write 3-4 sentences as if you are introducing this person to a friend. Not a bio. A human picture. What they care about, what drives them, what their situation is right now. Reference anything personal they have shared.

2. WHY WE ARE IN THIS ROOM
The exact Why Now signal that triggered outreach. Plain English. Not corporate. One paragraph.

3. WHAT HAS BEEN SAID SO FAR
Summary of the entire email thread. What we sent. What they said. What the tone has been. What they seemed most interested in. What they seemed skeptical about.

4. WHAT THEY CARE MOST ABOUT
Based on everything we know — their role, their company's situation, what they said — the ONE thing that matters most to THIS person in this meeting. Not what we want to talk about. What THEY want to get out of this.

5. THE ONE GOAL OF THIS MEETING
One sentence. Specific. Measurable. Not "explore synergies" or "build relationship." Something like: "Confirm whether their VP of Sales would find value in a live demo of the Medicare Advantage targeting list we built for their segment, and get a commitment on who else needs to be in the next conversation."

6. TOGARI DATA TO REFERENCE
The specific data asset most relevant to this meeting. How to introduce it naturally. What to show if they ask to see something.

7. THE PROOF POINT TO LEAD WITH
The most relevant case or data example. How to tell it in 90 seconds.

8. LIKELY QUESTIONS AND HOW TO ANSWER THEM
At least 3 questions. The third should be a skeptical or objection question. For each, provide a specific (not generic) answer.

9. ROLE BRIEFINGS
- ${params.assignedTo}: Specific guidance for this meeting — your job is X, watch for Y, if Z happens do W.
${params.gwenRelevant ? `- Gwen: The partnership angle to explore is: ${params.gwenAngle || 'TBD'}` : ''}
${params.karthikRelevant ? `- Karthik: Product questions likely to come up: ${params.karthikContext || 'TBD'}` : ''}

10. WHAT SUCCESS LOOKS LIKE WHEN WE HANG UP
Three outcomes ranked:
1. Best: [specific, measurable]
2. Good: [specific, measurable]
3. Acceptable: [specific, measurable]

11. GWEN FLAG: ${params.gwenRelevant ? 'YES' : 'NO'}${params.gwenAngle ? ` — ${params.gwenAngle}` : ''}

Output as structured JSON matching the PreMeetingBrief schema.`;
}
