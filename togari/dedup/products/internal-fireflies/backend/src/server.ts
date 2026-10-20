/**
 * Internal Fireflies — Meeting Intelligence Platform
 *
 * Records meetings (Google Meet, Zoom, Teams), transcribes with speaker
 * diarization, extracts summaries + action items, and optionally runs
 * BMA deal intelligence via the GTM OS pipeline.
 *
 * Port: 4300
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { OpenAI } from 'openai';

import type {
  Meeting,
  Participant,
  MeetingListItem,
  ErrorResponse,
  SearchResult,
} from '../../shared/src/types';
import {
  UploadAudioSchema,
  TranscribeSchema,
  AnalyzeSchema,
  SearchTranscriptsSchema,
} from '../../shared/src/types';
import { store } from './store';
import { summarizeMeeting, extractActionItems, extractDealIntelligence } from './analyzer';
import { startCalendarWatcher } from './calendar-watcher';

// ── Configuration ────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '4300', 10);
const AUDIO_DIR = process.env.AUDIO_DIR || path.join(process.cwd(), 'recordings');

fs.mkdirSync(AUDIO_DIR, { recursive: true });

// ── Express Setup ────────────────────────────────────────────────────────────

const app: express.Express = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use('/recordings', express.static(AUDIO_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AUDIO_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.webm';
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB (meetings can be long)
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg',
      'video/webm', 'video/mp4', 'video/quicktime',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY required');
  return new OpenAI({ apiKey });
}

// ── Health Check ─────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'internal-fireflies',
    version: '0.1.0',
    meetings: store.list().length,
    timestamp: new Date().toISOString(),
  });
});

// ── POST /api/meetings/upload — Upload meeting audio ─────────────────────────

app.post('/api/meetings/upload', upload.single('audio'), (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No audio file provided' } as ErrorResponse);
      return;
    }

    const parsed = UploadAudioSchema.safeParse(req.body);
    const meta = parsed.success ? parsed.data : { source: 'manual_upload' as const };

    const id = uuidv4();
    const now = new Date().toISOString();
    const audioUrl = `/recordings/${req.file.filename}`;

    const participants: Participant[] = meta.participants
      ? meta.participants.split(',').map((name) => ({ name: name.trim(), role: 'attendee' as const }))
      : [];

    const meeting: Meeting = {
      id,
      title: meta.title || 'Uploaded Meeting',
      status: 'processing',
      source: meta.source || 'manual_upload',
      calendarEventId: meta.calendarEventId,
      meetingUrl: meta.meetingUrl,
      participants,
      audioUrl,
      tags: [],
      createdAt: now,
      updatedAt: now,
    };

    store.create(meeting);

    res.status(201).json({
      meetingId: id,
      audioUrl,
      message: 'Audio uploaded. Call POST /api/meetings/transcribe to process.',
    });
  } catch (err) {
    res.status(500).json({
      error: 'Upload failed',
      details: err instanceof Error ? err.message : String(err),
    } as ErrorResponse);
  }
});

// ── POST /api/meetings/transcribe — Whisper transcription w/ diarization ─────

app.post('/api/meetings/transcribe', async (req, res) => {
  try {
    const parsed = TranscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.message } as ErrorResponse);
      return;
    }

    const { meetingId, language } = parsed.data;
    const meeting = store.get(meetingId);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' } as ErrorResponse);
      return;
    }

    if (!meeting.audioUrl) {
      res.status(400).json({ error: 'No audio file for this meeting' } as ErrorResponse);
      return;
    }

    store.update(meetingId, { status: 'processing' });

    const openai = getOpenAI();
    const audioPath = path.join(process.cwd(), meeting.audioUrl);

    if (!fs.existsSync(audioPath)) {
      res.status(404).json({ error: 'Audio file not found on disk' } as ErrorResponse);
      return;
    }

    // Transcribe with Whisper (verbose JSON for timestamps)
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1',
      language,
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });

    const segments = (transcription.segments || []).map((seg) => ({
      startMs: Math.round((seg.start || 0) * 1000),
      endMs: Math.round((seg.end || 0) * 1000),
      text: seg.text || '',
      confidence: seg.avg_logprob ? Math.exp(seg.avg_logprob) : undefined,
    }));

    const fullText = transcription.text || segments.map((s) => s.text).join(' ');
    const durationMs = segments.length > 0 ? segments[segments.length - 1].endMs : 0;

    const transcript = {
      meetingId,
      fullText,
      segments,
      speakers: {} as Record<string, string>,
      language,
      durationMs,
      wordCount: fullText.split(/\s+/).filter(Boolean).length,
      createdAt: new Date().toISOString(),
    };

    store.setTranscript(meetingId, transcript);
    store.update(meetingId, { startedAt: meeting.startedAt, endedAt: new Date().toISOString() });

    res.json(transcript);
  } catch (err) {
    res.status(500).json({
      error: 'Transcription failed',
      details: err instanceof Error ? err.message : String(err),
    } as ErrorResponse);
  }
});

// ── POST /api/meetings/analyze — Summary + action items + deal intel ─────────

app.post('/api/meetings/analyze', async (req, res) => {
  try {
    const parsed = AnalyzeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.message } as ErrorResponse);
      return;
    }

    const { meetingId, dealIntelligence: runDealIntel, company, pipeline, dealId } = parsed.data;
    const meeting = store.get(meetingId);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' } as ErrorResponse);
      return;
    }
    if (!meeting.transcript) {
      res.status(400).json({ error: 'Meeting not yet transcribed' } as ErrorResponse);
      return;
    }

    // Run summary + action items in parallel
    const [summary, actionItems] = await Promise.all([
      summarizeMeeting(meeting.transcript),
      extractActionItems(meeting.transcript),
    ]);

    store.setSummary(meetingId, summary);
    store.setActionItems(meetingId, actionItems);

    // Optionally run deal intelligence
    let dealIntel = null;
    if (runDealIntel) {
      dealIntel = await extractDealIntelligence(meeting.transcript, { company, pipeline, dealId });
      store.setDealIntelligence(meetingId, dealIntel);
    } else {
      store.update(meetingId, { status: 'analyzed' });
    }

    res.json({
      meetingId,
      summary,
      actionItems,
      dealIntelligence: dealIntel,
    });
  } catch (err) {
    res.status(500).json({
      error: 'Analysis failed',
      details: err instanceof Error ? err.message : String(err),
    } as ErrorResponse);
  }
});

// ── GET /api/meetings — List all meetings ────────────────────────────────────

app.get('/api/meetings', (_req, res) => {
  const meetings = store.list();
  const items: MeetingListItem[] = meetings.map((m) => ({
    id: m.id,
    title: m.title,
    status: m.status,
    source: m.source,
    participants: m.participants,
    durationMs: m.durationMs,
    scheduledAt: m.scheduledAt,
    startedAt: m.startedAt,
    createdAt: m.createdAt,
  }));
  res.json({ meetings: items, total: items.length });
});

// ── GET /api/meetings/:id — Full meeting with all artifacts ──────────────────

app.get('/api/meetings/:id', (req, res) => {
  const meeting = store.get(req.params.id);
  if (!meeting) {
    res.status(404).json({ error: 'Meeting not found' } as ErrorResponse);
    return;
  }
  res.json(meeting);
});

// ── GET /api/meetings/:id/transcript — Just the transcript ───────────────────

app.get('/api/meetings/:id/transcript', (req, res) => {
  const meeting = store.get(req.params.id);
  if (!meeting) {
    res.status(404).json({ error: 'Meeting not found' } as ErrorResponse);
    return;
  }
  if (!meeting.transcript) {
    res.status(404).json({ error: 'No transcript available' } as ErrorResponse);
    return;
  }
  res.json(meeting.transcript);
});

// ── GET /api/meetings/:id/summary — Just the summary ────────────────────────

app.get('/api/meetings/:id/summary', (req, res) => {
  const meeting = store.get(req.params.id);
  if (!meeting) {
    res.status(404).json({ error: 'Meeting not found' } as ErrorResponse);
    return;
  }
  if (!meeting.summary) {
    res.status(404).json({ error: 'No summary available' } as ErrorResponse);
    return;
  }
  res.json(meeting.summary);
});

// ── GET /api/meetings/:id/action-items — Action items ────────────────────────

app.get('/api/meetings/:id/action-items', (req, res) => {
  const meeting = store.get(req.params.id);
  if (!meeting) {
    res.status(404).json({ error: 'Meeting not found' } as ErrorResponse);
    return;
  }
  res.json({ actionItems: meeting.actionItems || [], total: (meeting.actionItems || []).length });
});

// ── POST /api/search — Search across all transcripts ─────────────────────────

app.post('/api/search', (req, res) => {
  try {
    const parsed = SearchTranscriptsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.message } as ErrorResponse);
      return;
    }

    const { query, limit } = parsed.data;
    const results = store.search(query, limit);

    const searchResults: SearchResult[] = results.flatMap(({ meeting, matches }) =>
      matches.map((m) => ({
        meetingId: meeting.id,
        title: meeting.title,
        matchedText: m.text,
        speaker: m.speaker,
        timestampMs: m.timestampMs,
        createdAt: meeting.createdAt,
      }))
    );

    res.json({ results: searchResults, total: searchResults.length });
  } catch (err) {
    res.status(500).json({
      error: 'Search failed',
      details: err instanceof Error ? err.message : String(err),
    } as ErrorResponse);
  }
});

// ── DELETE /api/meetings/:id — Delete a meeting ──────────────────────────────

app.delete('/api/meetings/:id', (req, res) => {
  const meeting = store.get(req.params.id);
  if (!meeting) {
    res.status(404).json({ error: 'Meeting not found' } as ErrorResponse);
    return;
  }

  if (meeting.audioUrl) {
    const audioPath = path.join(process.cwd(), meeting.audioUrl);
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  }

  store.delete(req.params.id);
  res.json({ message: 'Meeting deleted' });
});

// ── Error Handler ────────────────────────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message } as ErrorResponse);
});

// ── Start Server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🎙️  Internal Fireflies running on http://localhost:${PORT}`);
  console.log(`  Recordings dir: ${AUDIO_DIR}`);
  console.log(`  OpenAI API: ${process.env.OPENAI_API_KEY ? 'configured' : 'NOT SET'}`);
  console.log(`  Calendar watcher: ${process.env.GOOGLE_CALENDAR_CREDENTIALS ? 'enabled' : 'disabled (no credentials)'}`);
  console.log();
  console.log('  Endpoints:');
  console.log('    POST /api/meetings/upload      — Upload meeting audio');
  console.log('    POST /api/meetings/transcribe   — Transcribe with Whisper');
  console.log('    POST /api/meetings/analyze      — Summary + action items + deal intel');
  console.log('    GET  /api/meetings              — List all meetings');
  console.log('    GET  /api/meetings/:id          — Full meeting detail');
  console.log('    GET  /api/meetings/:id/transcript');
  console.log('    GET  /api/meetings/:id/summary');
  console.log('    GET  /api/meetings/:id/action-items');
  console.log('    POST /api/search                — Search across transcripts');
  console.log('    DELETE /api/meetings/:id');
  console.log();

  // Start calendar watcher if credentials present
  startCalendarWatcher();
});

export default app;
