import { z } from 'zod';

// ── Meeting ──────────────────────────────────────────────────────────────────

export interface Meeting {
  id: string;
  title: string;
  status: MeetingStatus;
  source: MeetingSource;
  /** Google Calendar event ID if linked */
  calendarEventId?: string;
  /** Google Meet / Zoom / Teams URL */
  meetingUrl?: string;
  participants: Participant[];
  scheduledAt?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  audioUrl?: string;
  transcript?: Transcript;
  summary?: MeetingSummary;
  actionItems?: ActionItem[];
  dealIntelligence?: DealIntelligence;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type MeetingStatus =
  | 'scheduled'    // Calendar event, not yet started
  | 'recording'    // Bot is in the meeting capturing audio
  | 'processing'   // Audio captured, transcription in progress
  | 'transcribed'  // Transcript ready, analysis pending
  | 'analyzed'     // Full analysis complete
  | 'error';

export type MeetingSource =
  | 'google_meet'
  | 'zoom'
  | 'teams'
  | 'manual_upload'
  | 'phone_call';

// ── Participant ──────────────────────────────────────────────────────────────

export interface Participant {
  name: string;
  email?: string;
  role?: 'host' | 'attendee' | 'external';
  /** Which BMA team member, if any */
  bmaTeamMember?: string;
  speakerLabel?: string;
}

// ── Transcript ───────────────────────────────────────────────────────────────

export interface Transcript {
  meetingId: string;
  fullText: string;
  segments: TranscriptSegment[];
  speakers: SpeakerMap;
  language?: string;
  durationMs: number;
  wordCount: number;
  createdAt: string;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
  confidence?: number;
}

/** Maps speaker labels (Speaker_0, Speaker_1) to participant names */
export type SpeakerMap = Record<string, string>;

// ── Summary ──────────────────────────────────────────────────────────────────

export interface MeetingSummary {
  meetingId: string;
  /** 1-2 sentence overview */
  overview: string;
  /** 5-7 bullet key points */
  keyPoints: string[];
  /** Decisions made during the meeting */
  decisions: string[];
  /** Topics discussed with approximate timestamps */
  topics: TopicSegment[];
  /** Sentiment analysis */
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  createdAt: string;
}

export interface TopicSegment {
  topic: string;
  startMs: number;
  endMs: number;
  summary: string;
}

// ── Action Items ─────────────────────────────────────────────────────────────

export interface ActionItem {
  id: string;
  meetingId: string;
  description: string;
  assignee?: string;
  dueDate?: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  /** Verbatim quote from transcript where this was discussed */
  sourceQuote?: string;
  sourceTimestampMs?: number;
  createdAt: string;
}

// ── Deal Intelligence (BMA-specific) ─────────────────────────────────────────

export interface DealIntelligence {
  meetingId: string;
  company?: string;
  pipeline?: 'partnerships' | 'inbound' | 'outbound';
  dealId?: string;
  callObjective?: string;
  keyOutcomes: string[];
  objections: Array<{ verbatim: string; type: string }>;
  buyingRoles: {
    champion?: string;
    economicBuyer?: string;
    technicalEvaluator?: string;
    blocker?: string;
    influencer?: string;
  };
  timeline?: string;
  competitors: string[];
  budgetSignals?: string;
  relationshipTemperature?: 'cold' | 'warm' | 'advocate';
  commitmentsBma: string[];
  commitmentsProspect: string[];
  risks: string[];
  nextActions: Array<{
    action: string;
    owner?: string;
    dueDate?: string;
  }>;
  callDebrief: string[];
  createdAt: string;
}

// ── API Request Schemas ──────────────────────────────────────────────────────

export const UploadAudioSchema = z.object({
  title: z.string().optional(),
  source: z.enum(['google_meet', 'zoom', 'teams', 'manual_upload', 'phone_call']).default('manual_upload'),
  participants: z.string().optional().describe('Comma-separated participant names'),
  calendarEventId: z.string().optional(),
  meetingUrl: z.string().optional(),
});

export const TranscribeSchema = z.object({
  meetingId: z.string(),
  language: z.string().optional().default('en'),
  diarize: z.boolean().optional().default(true),
});

export const AnalyzeSchema = z.object({
  meetingId: z.string(),
  /** Run deal intelligence extraction (BMA pipeline linking) */
  dealIntelligence: z.boolean().optional().default(false),
  company: z.string().optional(),
  pipeline: z.enum(['partnerships', 'inbound', 'outbound']).optional(),
  dealId: z.string().optional(),
});

export const ScheduleRecordingSchema = z.object({
  calendarEventId: z.string(),
  meetingUrl: z.string(),
  title: z.string().optional(),
  participants: z.string().optional(),
});

export const SearchTranscriptsSchema = z.object({
  query: z.string(),
  limit: z.number().optional().default(20),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  speaker: z.string().optional(),
});

// ── API Response Types ───────────────────────────────────────────────────────

export interface MeetingListItem {
  id: string;
  title: string;
  status: MeetingStatus;
  source: MeetingSource;
  participants: Participant[];
  durationMs?: number;
  scheduledAt?: string;
  startedAt?: string;
  createdAt: string;
}

export interface SearchResult {
  meetingId: string;
  title: string;
  matchedText: string;
  speaker?: string;
  timestampMs?: number;
  createdAt: string;
}

export interface ErrorResponse {
  error: string;
  details?: string;
}
