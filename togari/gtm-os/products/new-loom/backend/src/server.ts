import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { OpenAI } from 'openai';

import type {
  Recording,
  Transcript,
  TranscriptSegment,
  TransformedScript,
  TransformationApplied,
  SynthesizedAudio,
  RecordingListItem,
  ErrorResponse,
} from '../../shared/src/types';
import {
  TranscribeRequestSchema,
  TransformRequestSchema,
  SynthesizeRequestSchema,
} from '../../shared/src/types';
import { buildTransformPrompt, quickLocalTransform, getAllTransformRules } from './bma-training-modules';
import { synthesizeSpeech, listVoices } from './elevenlabs';
import { store } from './store';

// ── Configuration ─────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '4200', 10);
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const AUDIO_OUTPUT_DIR = process.env.AUDIO_OUTPUT_DIR || path.join(process.cwd(), 'audio-output');

// Ensure directories exist
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(AUDIO_OUTPUT_DIR, { recursive: true });

// ── Express Setup ─────────────────────────────────────────────────────────────

const app: express.Express = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/audio-output', express.static(AUDIO_OUTPUT_DIR));

// Multer for video uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.webm';
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['video/webm', 'video/mp4', 'video/quicktime', 'audio/webm', 'audio/mp4', 'audio/mpeg'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

// ── Helper: create OpenAI client ──────────────────────────────────────────────

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required for transcription and transformation');
  }
  return new OpenAI({ apiKey });
}

// ── Health Check ──────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'new-loom',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

// ── POST /api/upload — Upload recorded video ──────────────────────────────────

app.post('/api/upload', upload.single('video'), (req, res) => {
  try {
    if (!req.file) {
      const error: ErrorResponse = { error: 'No video file provided' };
      res.status(400).json(error);
      return;
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const videoUrl = `/uploads/${req.file.filename}`;
    const title = (req.body?.title as string) || 'Untitled Recording';

    const recording: Recording = {
      id,
      title,
      status: 'uploading',
      currentStep: 'process',
      createdAt: now,
      updatedAt: now,
      videoUrl,
    };

    store.create(recording);

    res.status(201).json({
      recordingId: id,
      videoUrl,
      message: 'Video uploaded successfully. Ready for transcription.',
    });
  } catch (err) {
    const error: ErrorResponse = {
      error: 'Upload failed',
      details: err instanceof Error ? err.message : String(err),
    };
    res.status(500).json(error);
  }
});

// ── POST /api/transcribe — Transcribe audio using Whisper API ─────────────────

app.post('/api/transcribe', async (req, res) => {
  try {
    const parsed = TranscribeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const error: ErrorResponse = { error: 'Invalid request', details: parsed.error.message };
      res.status(400).json(error);
      return;
    }

    const { recordingId, language } = parsed.data;
    const recording = store.get(recordingId);
    if (!recording) {
      const error: ErrorResponse = { error: 'Recording not found' };
      res.status(404).json(error);
      return;
    }

    if (!recording.videoUrl) {
      const error: ErrorResponse = { error: 'No video file associated with this recording' };
      res.status(400).json(error);
      return;
    }

    // Update status
    store.update(recordingId, { status: 'transcribing', currentStep: 'process' });

    const openai = getOpenAI();
    const videoPath = path.join(process.cwd(), recording.videoUrl);

    if (!fs.existsSync(videoPath)) {
      const error: ErrorResponse = { error: 'Video file not found on disk' };
      res.status(404).json(error);
      return;
    }

    // Transcribe with Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(videoPath),
      model: 'whisper-1',
      language,
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });

    const segments: TranscriptSegment[] = (transcription.segments || []).map((seg) => ({
      startMs: Math.round((seg.start || 0) * 1000),
      endMs: Math.round((seg.end || 0) * 1000),
      text: seg.text || '',
      confidence: seg.avg_logprob ? Math.exp(seg.avg_logprob) : undefined,
    }));

    const fullText = transcription.text || segments.map(s => s.text).join(' ');
    const durationMs = segments.length > 0 ? segments[segments.length - 1].endMs : 0;

    const transcript: Transcript = {
      recordingId,
      fullText,
      segments,
      language,
      durationMs,
      wordCount: fullText.split(/\s+/).filter(Boolean).length,
      createdAt: new Date().toISOString(),
    };

    store.setTranscript(recordingId, transcript);

    res.json(transcript);
  } catch (err) {
    const error: ErrorResponse = {
      error: 'Transcription failed',
      details: err instanceof Error ? err.message : String(err),
    };
    res.status(500).json(error);
  }
});

// ── POST /api/transform — Transform transcript using BMA training modules ────

app.post('/api/transform', async (req, res) => {
  try {
    const parsed = TransformRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const error: ErrorResponse = { error: 'Invalid request', details: parsed.error.message };
      res.status(400).json(error);
      return;
    }

    const { recordingId, targetStructure } = parsed.data;
    const recording = store.get(recordingId);
    if (!recording) {
      const error: ErrorResponse = { error: 'Recording not found' };
      res.status(404).json(error);
      return;
    }

    if (!recording.transcript) {
      const error: ErrorResponse = { error: 'Recording has not been transcribed yet' };
      res.status(400).json(error);
      return;
    }

    store.update(recordingId, { status: 'transforming', currentStep: 'transform' });

    const originalText = recording.transcript.fullText;

    // Step 1: Quick local transform for deterministic replacements
    const localResult = quickLocalTransform(originalText);

    // Step 2: LLM-powered structural transformation
    let transformedText: string;
    let structureUsed: string;
    let transformationsApplied: TransformationApplied[];
    let improvementScore: number;

    try {
      const openai = getOpenAI();
      const prompt = buildTransformPrompt(originalText, targetStructure);

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a McKinsey-trained communication transformation engine. Return only valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from LLM');
      }

      const llmResult = JSON.parse(content) as {
        transformedText: string;
        structureUsed: string;
        transformationsApplied: TransformationApplied[];
        improvementScore: number;
      };

      transformedText = llmResult.transformedText;
      structureUsed = llmResult.structureUsed;
      transformationsApplied = llmResult.transformationsApplied || [];
      improvementScore = llmResult.improvementScore || 0;
    } catch (llmErr) {
      // Fallback: use local-only transform if LLM fails
      console.warn('LLM transform failed, using local transform:', llmErr);
      transformedText = localResult.transformed;
      structureUsed = 'local_rules_only';
      transformationsApplied = localResult.changes.map(c => ({
        moduleType: c.type as TransformationApplied['moduleType'],
        originalSnippet: c.original,
        transformedSnippet: c.replacement,
        explanation: `Local rule: ${c.type}`,
      }));
      improvementScore = Math.min(localResult.changes.length * 5, 60);
    }

    const transformedScript: TransformedScript = {
      recordingId,
      originalText,
      transformedText,
      transformationsApplied,
      improvementScore,
      structureUsed,
      wordCountOriginal: originalText.split(/\s+/).filter(Boolean).length,
      wordCountTransformed: transformedText.split(/\s+/).filter(Boolean).length,
      createdAt: new Date().toISOString(),
    };

    store.setTransformedScript(recordingId, transformedScript);

    res.json(transformedScript);
  } catch (err) {
    const error: ErrorResponse = {
      error: 'Transform failed',
      details: err instanceof Error ? err.message : String(err),
    };
    res.status(500).json(error);
  }
});

// ── POST /api/synthesize — Generate audio via ElevenLabs ──────────────────────

app.post('/api/synthesize', async (req, res) => {
  try {
    const parsed = SynthesizeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const error: ErrorResponse = { error: 'Invalid request', details: parsed.error.message };
      res.status(400).json(error);
      return;
    }

    const { recordingId, voiceId, voiceName, outputFormat } = parsed.data;
    const recording = store.get(recordingId);
    if (!recording) {
      const error: ErrorResponse = { error: 'Recording not found' };
      res.status(404).json(error);
      return;
    }

    if (!recording.transformedScript) {
      const error: ErrorResponse = { error: 'Recording has not been transformed yet' };
      res.status(400).json(error);
      return;
    }

    store.update(recordingId, { status: 'synthesizing', currentStep: 'generate' });

    const audioBuffer = await synthesizeSpeech({
      voiceId,
      text: recording.transformedScript.transformedText,
    });

    // Save audio file
    const audioFilename = `${recordingId}.${outputFormat}`;
    const audioPath = path.join(AUDIO_OUTPUT_DIR, audioFilename);
    fs.writeFileSync(audioPath, audioBuffer);

    const audioUrl = `/audio-output/${audioFilename}`;

    // Estimate duration (rough: ~150 words per minute)
    const wordCount = recording.transformedScript.wordCountTransformed;
    const estimatedDurationMs = Math.round((wordCount / 150) * 60 * 1000);

    const synthesizedAudio: SynthesizedAudio = {
      recordingId,
      audioUrl,
      voiceId,
      voiceName: voiceName || voiceId,
      durationMs: estimatedDurationMs,
      format: outputFormat,
      sampleRate: 44100,
      createdAt: new Date().toISOString(),
    };

    store.setSynthesizedAudio(recordingId, synthesizedAudio);

    // Generate share URL
    const shareUrl = `${req.protocol}://${req.get('host')}/api/recordings/${recordingId}`;
    store.update(recordingId, { shareUrl });

    res.json(synthesizedAudio);
  } catch (err) {
    const error: ErrorResponse = {
      error: 'Synthesis failed',
      details: err instanceof Error ? err.message : String(err),
    };
    res.status(500).json(error);
  }
});

// ── GET /api/recordings/:id — Get recording with all artifacts ────────────────

app.get('/api/recordings/:id', (req, res) => {
  const recording = store.get(req.params.id);
  if (!recording) {
    const error: ErrorResponse = { error: 'Recording not found' };
    res.status(404).json(error);
    return;
  }
  res.json(recording);
});

// ── GET /api/recordings — List all recordings ─────────────────────────────────

app.get('/api/recordings', (_req, res) => {
  const recordings = store.list();
  const items: RecordingListItem[] = recordings.map(r => ({
    id: r.id,
    title: r.title,
    status: r.status,
    currentStep: r.currentStep,
    durationMs: r.durationMs,
    thumbnailUrl: r.thumbnailUrl,
    shareUrl: r.shareUrl,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
  res.json({ recordings: items, total: items.length });
});

// ── GET /api/voices — List ElevenLabs voices ──────────────────────────────────

app.get('/api/voices', async (_req, res) => {
  try {
    const voices = await listVoices();
    res.json({ voices });
  } catch (err) {
    const error: ErrorResponse = {
      error: 'Failed to fetch voices',
      details: err instanceof Error ? err.message : String(err),
    };
    res.status(500).json(error);
  }
});

// ── GET /api/training-modules — List BMA training module rules ────────────────

app.get('/api/training-modules', (_req, res) => {
  const rules = getAllTransformRules();
  res.json({
    totalRules: rules.length,
    modules: {
      professional_vocabulary: rules.filter(r => r.moduleType === 'professional_vocabulary').length,
      filler_removal: rules.filter(r => r.moduleType === 'filler_removal').length,
      hedge_strengthening: rules.filter(r => r.moduleType === 'hedge_strengthening').length,
      mece_framework: 1,
      pyramid_principle: 1,
      scr_structure: 1,
      action_orientation: 1,
    },
    rules,
  });
});

// ── DELETE /api/recordings/:id — Delete a recording ───────────────────────────

app.delete('/api/recordings/:id', (req, res) => {
  const recording = store.get(req.params.id);
  if (!recording) {
    const error: ErrorResponse = { error: 'Recording not found' };
    res.status(404).json(error);
    return;
  }

  // Clean up files
  if (recording.videoUrl) {
    const videoPath = path.join(process.cwd(), recording.videoUrl);
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
  }
  if (recording.synthesizedAudio?.audioUrl) {
    const audioPath = path.join(process.cwd(), recording.synthesizedAudio.audioUrl);
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  }

  store.delete(req.params.id);
  res.json({ message: 'Recording deleted' });
});

// ── Error Handler ─────────────────────────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  const error: ErrorResponse = {
    error: 'Internal server error',
    details: err.message,
  };
  res.status(500).json(error);
});

// ── Start Server ──────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`New Loom backend running on http://localhost:${PORT}`);
  console.log(`  Upload dir: ${UPLOAD_DIR}`);
  console.log(`  Audio output dir: ${AUDIO_OUTPUT_DIR}`);
  console.log(`  OpenAI API: ${process.env.OPENAI_API_KEY ? 'configured' : 'NOT SET'}`);
  console.log(`  ElevenLabs API: ${process.env.ELEVENLABS_API_KEY ? 'configured' : 'NOT SET'}`);
});

export default app;
