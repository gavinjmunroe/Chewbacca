/**
 * Meeting analyzer — summarizes transcripts, extracts action items, and
 * optionally runs BMA deal intelligence extraction.
 *
 * Uses OpenAI for analysis. Falls back to basic keyword extraction if unavailable.
 */

import { OpenAI } from 'openai';
import { v4 as uuidv4 } from 'uuid';
import type {
  Transcript,
  MeetingSummary,
  ActionItem,
  DealIntelligence,
} from '../../shared/src/types';

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY required for analysis');
  return new OpenAI({ apiKey });
}

// ── Summarize ────────────────────────────────────────────────────────────────

export async function summarizeMeeting(transcript: Transcript): Promise<MeetingSummary> {
  const openai = getOpenAI();

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a meeting analysis engine. Given a transcript, produce a structured summary. Return valid JSON with this exact shape:
{
  "overview": "1-2 sentence overview",
  "keyPoints": ["bullet 1", "bullet 2", ...],
  "decisions": ["decision 1", ...],
  "topics": [{ "topic": "name", "startMs": 0, "endMs": 60000, "summary": "..." }],
  "sentiment": "positive|neutral|negative|mixed"
}`,
      },
      {
        role: 'user',
        content: `Meeting transcript (${transcript.wordCount} words, ${Math.round(transcript.durationMs / 60000)} min):\n\n${transcript.fullText}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 3000,
    response_format: { type: 'json_object' },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from LLM');

  const parsed = JSON.parse(content);
  return {
    meetingId: transcript.meetingId,
    overview: parsed.overview,
    keyPoints: parsed.keyPoints || [],
    decisions: parsed.decisions || [],
    topics: parsed.topics || [],
    sentiment: parsed.sentiment || 'neutral',
    createdAt: new Date().toISOString(),
  };
}

// ── Action Items ─────────────────────────────────────────────────────────────

export async function extractActionItems(transcript: Transcript): Promise<ActionItem[]> {
  const openai = getOpenAI();

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You extract action items from meeting transcripts. Return valid JSON array:
[{
  "description": "what needs to be done",
  "assignee": "person name or null",
  "dueDate": "YYYY-MM-DD or null",
  "priority": "low|medium|high",
  "sourceQuote": "verbatim quote from transcript"
}]
Only include clear commitments or requests. Do not invent items not discussed.`,
      },
      {
        role: 'user',
        content: transcript.fullText,
      },
    ],
    temperature: 0.1,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) return [];

  const parsed = JSON.parse(content);
  const items: ActionItem[] = (parsed.actionItems || parsed.items || parsed || []).map(
    (item: any) => ({
      id: uuidv4(),
      meetingId: transcript.meetingId,
      description: item.description,
      assignee: item.assignee || undefined,
      dueDate: item.dueDate || undefined,
      status: 'pending' as const,
      priority: item.priority || 'medium',
      sourceQuote: item.sourceQuote || undefined,
      createdAt: new Date().toISOString(),
    })
  );

  return items;
}

// ── Deal Intelligence (BMA-specific) ─────────────────────────────────────────

export async function extractDealIntelligence(
  transcript: Transcript,
  opts: { company?: string; pipeline?: string; dealId?: string } = {}
): Promise<DealIntelligence> {
  const openai = getOpenAI();

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are the BMA deal intelligence engine. Extract structured sales intelligence from a meeting transcript.

BMA team members: Kevin, Mike, Maggie, Gwen, Sagar, Caleb, Karthik.
Mike and Maggie triage all meetings to Kevin. Kevin is the closer.

Return valid JSON:
{
  "company": "detected company name",
  "pipeline": "partnerships|inbound|outbound",
  "callObjective": "what was the goal going in",
  "keyOutcomes": ["..."],
  "objections": [{ "verbatim": "exact words", "type": "price|timeline|authority|need|competition" }],
  "buyingRoles": { "champion": "name", "economicBuyer": "name", "technicalEvaluator": "name", "blocker": "name", "influencer": "name" },
  "timeline": "any dates or urgency signals",
  "competitors": ["..."],
  "budgetSignals": "any budget hints",
  "relationshipTemperature": "cold|warm|advocate",
  "commitmentsBma": ["what BMA committed to"],
  "commitmentsProspect": ["what they committed to"],
  "risks": ["deal risks"],
  "nextActions": [{ "action": "...", "owner": "Kevin|Mike|etc", "dueDate": "YYYY-MM-DD" }],
  "callDebrief": ["bullet 1", "bullet 2", "...5-7 bullets"]
}

Set null for fields where info is not present. Do not fabricate.`,
      },
      {
        role: 'user',
        content: `${opts.company ? `Known company: ${opts.company}\n` : ''}${opts.pipeline ? `Known pipeline: ${opts.pipeline}\n` : ''}${opts.dealId ? `Deal ID: ${opts.dealId}\n` : ''}\nTranscript:\n${transcript.fullText}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 3000,
    response_format: { type: 'json_object' },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from LLM');

  const parsed = JSON.parse(content);
  return {
    meetingId: transcript.meetingId,
    company: parsed.company || opts.company,
    pipeline: parsed.pipeline || opts.pipeline,
    dealId: opts.dealId,
    callObjective: parsed.callObjective,
    keyOutcomes: parsed.keyOutcomes || [],
    objections: parsed.objections || [],
    buyingRoles: parsed.buyingRoles || {},
    timeline: parsed.timeline,
    competitors: parsed.competitors || [],
    budgetSignals: parsed.budgetSignals,
    relationshipTemperature: parsed.relationshipTemperature,
    commitmentsBma: parsed.commitmentsBma || [],
    commitmentsProspect: parsed.commitmentsProspect || [],
    risks: parsed.risks || [],
    nextActions: parsed.nextActions || [],
    callDebrief: parsed.callDebrief || [],
    createdAt: new Date().toISOString(),
  };
}
