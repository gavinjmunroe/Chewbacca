/**
 * @togari/core — Transport-agnostic meeting intelligence
 *
 * Wraps Fireflies.ai API for meeting search and transcript retrieval.
 * Uses Claude-powered transcript resolution instead of string matching
 * for accurate meeting identification.
 */

import { createLogger } from '../../observability/logger';
import { SONNET } from '../../config/models';
import { buildDateContext } from '../identity/date-context';
import { findCompanyByName } from './company-ops';
import { searchCapturesByCompany } from './capture-ops';
import type { Capture, MeetingTranscript } from '../types';

const logger = createLogger('core/meeting-intel');

const FIREFLIES_ENDPOINT = 'https://api.fireflies.ai/graphql';

function getApiKey(): string {
  const key = process.env.FIREFLIES_API_KEY;
  if (!key) throw new Error('FIREFLIES_API_KEY not set');
  return key;
}

async function graphqlQuery(query: string): Promise<any> {
  const apiKey = getApiKey();

  const res = await fetch(FIREFLIES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Fireflies API HTTP ${res.status}: ${errorBody}`);
  }

  const json = await res.json() as any;

  if (json.errors && json.errors.length > 0) {
    const errMsg = json.errors.map((e: any) => e.message).join('; ');
    throw new Error(`Fireflies GraphQL error: ${errMsg}`);
  }

  return json.data;
}

function mapToMeetingTranscript(t: any, sentences?: any[]): MeetingTranscript {
  return {
    id: t.id,
    title: t.title || '',
    date: t.date || '',
    duration: t.duration || 0,
    participants: t.participants || [],
    summary: {
      overview: t.summary?.overview || '',
      action_items: typeof t.summary?.action_items === 'string'
        ? t.summary.action_items.split('\n').filter(Boolean)
        : (t.summary?.action_items || []),
      keywords: t.summary?.keywords || [],
      bullets: typeof t.summary?.shorthand_bullet === 'string'
        ? t.summary.shorthand_bullet.split('\n').filter(Boolean)
        : [],
    },
    sentences: sentences
      ? sentences.map((s: any) => ({ speaker: s.speaker_name || 'Unknown', text: s.text || '' }))
      : undefined,
    fullText: sentences
      ? sentences.map((s: any) => `${s.speaker_name || 'Unknown'}: ${s.text || ''}`).join('\n')
      : undefined,
  };
}

// ── Transcript metadata fetcher ──────────────────────────────────

interface TranscriptMeta {
  id: string;
  title: string;
  date: string;
  participants: string[];
  summary_overview: string;
}

async function fetchRecentTranscriptMeta(limit: number = 30): Promise<TranscriptMeta[]> {
  const data = await graphqlQuery(`
    query {
      transcripts(limit: ${limit}) {
        id
        title
        date
        participants
        summary {
          overview
        }
      }
    }
  `);

  return (data?.transcripts || []).map((t: any) => ({
    id: t.id,
    title: t.title || '',
    date: t.date || '',
    participants: t.participants || [],
    summary_overview: t.summary?.overview || '',
  }));
}

// ── Claude-powered transcript resolver ───────────────────────────

const RESOLVER_SYSTEM_PROMPT = `You are a meeting matcher. Given a user's query and a list of available meeting transcripts, determine which transcript the user is referring to. Consider: meeting titles (fuzzy match — 'standup' matches 'Stand Up', 'BMA standup' matches 'BMA Stand Up'), dates and times ('this morning' means today's earliest meeting, 'yesterday' means yesterday's meetings), participant names ('the call with Carlo' means the meeting where Carlo is a participant), and topics from summary overviews. Return ONLY the transcript ID that best matches, or 'NONE' if no transcript matches. Return nothing else — just the ID string or 'NONE'.`;

const RESOLVER_MULTI_SYSTEM_PROMPT_PREFIX = `You are a meeting matcher. Given a user's query and a list of available meeting transcripts, determine which transcripts match the user's query. Consider: meeting titles (fuzzy match — 'standup' matches 'Stand Up', 'BMA standup' matches 'BMA Stand Up'), dates and times ('this morning' means today's earliest meeting, 'yesterday' means yesterday's meetings), participant names ('the call with Carlo' means the meeting where Carlo is a participant), and topics from summary overviews.`;

function buildTranscriptList(transcripts: TranscriptMeta[]): string {
  return transcripts.map(t => {
    const overview = t.summary_overview.slice(0, 100);
    return `ID: ${t.id} | Title: ${t.title} | Date: ${t.date} | Participants: ${t.participants.join(', ')} | Summary: ${overview}`;
  }).join('\n');
}

function getTodayString(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
}

/**
 * Ask Claude which transcript best matches the user's query.
 * Returns the transcript ID or null if no match.
 */
export async function resolveTranscript(
  userQuery: string,
  transcripts: TranscriptMeta[],
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  if (transcripts.length === 0) return null;

  const validIds = new Set(transcripts.map(t => t.id));
  const userMessage = `User asked: '${userQuery}'\n\nToday's date: ${getTodayString()}\n\nAvailable transcripts:\n${buildTranscriptList(transcripts)}`;

  console.log(`[core/meeting-intel] Resolving transcript via Claude for query: "${userQuery}" (${transcripts.length} candidates)`);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: SONNET,
      max_tokens: 128,
      system: RESOLVER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${errorBody}`);
  }

  const data = await response.json() as any;
  const raw = data.content
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('')
    .trim();

  console.log(`[core/meeting-intel] Claude resolver returned: "${raw}"`);

  if (raw === 'NONE') return null;
  if (validIds.has(raw)) return raw;

  // Try to extract an ID from the response (Claude might add extra text)
  for (const id of validIds) {
    if (raw.includes(id)) return id;
  }

  console.log(`[core/meeting-intel] Claude returned unrecognized ID: "${raw}" — treating as no match`);
  return null;
}

/**
 * Ask Claude which transcripts match the user's query (up to limit).
 * Returns an array of transcript IDs ranked by relevance.
 */
async function resolveTranscriptMulti(
  userQuery: string,
  transcripts: TranscriptMeta[],
  limit: number,
): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  if (transcripts.length === 0) return [];

  const validIds = new Set(transcripts.map(t => t.id));
  const systemPrompt = `${RESOLVER_MULTI_SYSTEM_PROMPT_PREFIX} Return up to ${limit} transcript IDs that match the query, as a comma-separated list. Most relevant first. Return 'NONE' if no transcripts match.`;
  const userMessage = `User asked: '${userQuery}'\n\nToday's date: ${getTodayString()}\n\nAvailable transcripts:\n${buildTranscriptList(transcripts)}`;

  console.log(`[core/meeting-intel] Resolving multiple transcripts via Claude for query: "${userQuery}" (limit: ${limit})`);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: SONNET,
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${errorBody}`);
  }

  const data = await response.json() as any;
  const raw = data.content
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('')
    .trim();

  console.log(`[core/meeting-intel] Claude multi-resolver returned: "${raw}"`);

  if (raw === 'NONE') return [];

  // Parse comma-separated IDs, keep only valid ones
  const ids = raw.split(',').map((s: string) => s.trim()).filter((id: string) => validIds.has(id));
  return ids.slice(0, limit);
}

// ── Public API ───────────────────────────────────────────────────

function captureToMeetingTranscript(capture: Capture): MeetingTranscript {
  const metadata = capture.metadata ?? {};
  const duration = typeof metadata.duration === 'number' ? metadata.duration : 0;
  return {
    id: capture.capture_id,
    title: capture.title ?? '',
    date: capture.captured_at,
    duration,
    participants: capture.attendees ?? [],
    summary: {
      overview: '',
      action_items: [],
      keywords: [],
      bullets: [],
    },
    fullText: capture.raw_blob,
  };
}

/**
 * Find the best matching meeting for a user query using Claude resolution.
 *
 * Patch L — When the query names a company we know, we look in
 * togari_captures first (already-ingested Fireflies transcripts) and
 * return the most recent matching capture. This is faster than the
 * Fireflies API and stays accurate even when the Fireflies UI is rate-
 * limiting us. If no captures match (transition period, before the
 * backfill catches up), we fall back to the live Fireflies API path.
 */
export async function findMeeting(userQuery: string): Promise<MeetingTranscript | null> {
  console.log(`[core/meeting-intel] Finding meeting via Claude resolver: "${userQuery}"`);

  try {
    // Captures-first lookup. We use the query string as a company-name
    // probe; findCompanyByName already does normalized + fuzzy matching.
    try {
      const company = await findCompanyByName(userQuery);
      if (company) {
        const captures = await searchCapturesByCompany(company.company_id, 10);
        if (captures.length > 0) {
          console.log(`[core/meeting-intel] captures hit: ${captures.length} for ${company.name}; returning most recent`);
          logger.info('findMeeting captures-first hit', {
            userQuery,
            companyId: company.company_id,
            captureCount: captures.length,
          });
          return captureToMeetingTranscript(captures[0]);
        }
      }
    } catch (err) {
      // Don't block the Fireflies fallback on an entity-graph failure.
      logger.warn('findMeeting captures-first pre-pass failed', {
        userQuery,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const transcripts = await fetchRecentTranscriptMeta(30);
    if (transcripts.length === 0) {
      console.log('[core/meeting-intel] No transcripts available');
      return null;
    }

    const matchedId = await resolveTranscript(userQuery, transcripts);
    if (!matchedId) {
      console.log(`[core/meeting-intel] Claude found no match for: "${userQuery}"`);
      return null;
    }

    console.log(`[core/meeting-intel] Claude resolved to transcript: ${matchedId}`);

    // Fetch full transcript with sentences
    const data = await graphqlQuery(`
      query {
        transcript(id: "${matchedId}") {
          id
          title
          date
          duration
          participants
          sentences {
            speaker_name
            text
          }
          summary {
            overview
            action_items
            shorthand_bullet
            keywords
          }
        }
      }
    `);

    const t = data?.transcript;
    if (!t) {
      console.log(`[core/meeting-intel] Could not fetch transcript: ${matchedId}`);
      return null;
    }

    return mapToMeetingTranscript(t, t.sentences);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[core/meeting-intel] findMeeting failed:', errMsg);
    logger.error('findMeeting failed', err instanceof Error ? err : new Error(errMsg), { userQuery });
    return null;
  }
}

/**
 * Search meetings matching a user query. Uses Claude to resolve which
 * transcripts match, then fetches summary data for each.
 */
export async function searchMeetings(query: string, limit: number = 10): Promise<MeetingTranscript[]> {
  console.log(`[core/meeting-intel] Searching meetings via Claude resolver | query: "${query}" (limit: ${limit})`);

  try {
    const transcripts = await fetchRecentTranscriptMeta(30);
    if (transcripts.length === 0) {
      console.log('[core/meeting-intel] No transcripts available');
      return [];
    }

    const matchedIds = await resolveTranscriptMulti(query, transcripts, limit);
    if (matchedIds.length === 0) {
      console.log(`[core/meeting-intel] Claude found no matches for: "${query}"`);
      logger.info('Meeting search complete — no matches', { query, totalFetched: transcripts.length });
      return [];
    }

    // Fetch full summary data for each matched transcript IN PARALLEL.
    // Previously this looped sequentially — with limit=10 that's ~3s of
    // wall-clock latency for no reason. Promise.all preserves match
    // ordering (results map 1:1 to matchedIds) and the surrounding
    // try/catch handles any single-fetch failure the same way it always
    // did (one rejected promise → outer catch → return []).
    const fetched = await Promise.all(
      matchedIds.map((id) =>
        graphqlQuery(`
          query {
            transcript(id: "${id}") {
              id
              title
              date
              duration
              participants
              summary {
                overview
                action_items
                shorthand_bullet
                keywords
              }
            }
          }
        `),
      ),
    );
    const results: MeetingTranscript[] = [];
    for (const data of fetched) {
      const t = data?.transcript;
      if (t) {
        results.push(mapToMeetingTranscript(t));
      }
    }

    console.log(`[core/meeting-intel] Claude resolved ${results.length} matches for: "${query}"`);
    logger.info('Meeting search complete', { query, matchCount: results.length, totalFetched: transcripts.length, strategy: 'claude_resolver' });
    return results;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[core/meeting-intel] Search failed:', errMsg);
    logger.error('Meeting search failed', err instanceof Error ? err : new Error(errMsg), { query });
    return [];
  }
}

/**
 * Analyze a meeting transcript using Claude.
 */
export async function analyzeMeeting(
  transcript: MeetingTranscript,
  analysisType: string,
  additionalContext?: string,
  // TODO: thread the requester's timezone through from the caller; defaults to Chicago today.
  timezone: string = 'America/Chicago',
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const analysisPrompts: Record<string, string> = {
    next_steps: 'Based on this meeting transcript and deal context, suggest 3-5 specific next steps for the sales team. Be concrete and actionable. Format as a numbered list.',
    action_items: 'Extract all action items mentioned in this meeting. Format as a numbered list with owner and deadline if mentioned.',
    summary: 'Provide a concise summary of this meeting including: key topics discussed, decisions made, concerns raised, and overall sentiment.',
    table: 'Extract any numerical data, metrics, pricing, timelines, or figures discussed in this meeting and format them as a markdown table. If no numerical data was discussed, note that and provide key qualitative takeaways instead.',
    general: 'Analyze this meeting and provide insights relevant to the sales process. Include: key discussion points, client sentiment, potential objections, and recommended approach.',
  };

  const systemPrompt = `${buildDateContext(timezone)}\n\n${analysisPrompts[analysisType] || analysisPrompts.general}`;

  const transcriptText = transcript.fullText
    || transcript.sentences?.map(s => `${s.speaker}: ${s.text}`).join('\n')
    || transcript.summary.overview;

  // Truncate to fit context
  const truncated = transcriptText.slice(0, 6000);

  const userPrompt = [
    `Meeting: "${transcript.title}" (${transcript.date})`,
    `Participants: ${transcript.participants.join(', ')}`,
    additionalContext ? `Deal context: ${additionalContext}` : '',
    `Transcript:\n${truncated}`,
  ].filter(Boolean).join('\n\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: SONNET,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${errorBody}`);
  }

  const data = await response.json() as any;
  return data.content
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('')
    .trim();
}
