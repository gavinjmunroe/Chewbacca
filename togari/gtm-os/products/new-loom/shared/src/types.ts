import { z } from 'zod';

// ── Recording Status ──────────────────────────────────────────────────────────

export const RecordingStatusSchema = z.enum([
  'recording',
  'uploading',
  'transcribing',
  'transforming',
  'synthesizing',
  'complete',
  'error',
]);
export type RecordingStatus = z.infer<typeof RecordingStatusSchema>;

// ── Workflow Step ─────────────────────────────────────────────────────────────

export const WorkflowStepSchema = z.enum([
  'record',
  'process',
  'transform',
  'generate',
  'share',
]);
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

// ── Recording ─────────────────────────────────────────────────────────────────

export const RecordingSchema = z.object({
  id: z.string().uuid(),
  title: z.string().default('Untitled Recording'),
  status: RecordingStatusSchema,
  currentStep: WorkflowStepSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  durationMs: z.number().nonnegative().optional(),
  videoUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  transcript: z.lazy(() => TranscriptSchema).optional(),
  transformedScript: z.lazy(() => TransformedScriptSchema).optional(),
  synthesizedAudio: z.lazy(() => SynthesizedAudioSchema).optional(),
  shareUrl: z.string().url().optional(),
});
export type Recording = z.infer<typeof RecordingSchema>;

// ── Transcript ────────────────────────────────────────────────────────────────

export const TranscriptSegmentSchema = z.object({
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  text: z.string(),
  speaker: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const TranscriptSchema = z.object({
  recordingId: z.string().uuid(),
  fullText: z.string(),
  segments: z.array(TranscriptSegmentSchema),
  language: z.string().default('en'),
  durationMs: z.number().nonnegative(),
  wordCount: z.number().nonnegative(),
  createdAt: z.string().datetime(),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

// ── BMA Training Module ───────────────────────────────────────────────────────

export const TrainingModuleTypeSchema = z.enum([
  'mece_framework',
  'pyramid_principle',
  'scr_structure',
  'professional_vocabulary',
  'filler_removal',
  'hedge_strengthening',
  'action_orientation',
]);
export type TrainingModuleType = z.infer<typeof TrainingModuleTypeSchema>;

export const TransformRuleSchema = z.object({
  moduleType: TrainingModuleTypeSchema,
  description: z.string(),
  pattern: z.string().optional(),
  replacement: z.string().optional(),
  instruction: z.string().optional(),
});
export type TransformRule = z.infer<typeof TransformRuleSchema>;

// ── Transformed Script ────────────────────────────────────────────────────────

export const TransformationAppliedSchema = z.object({
  moduleType: TrainingModuleTypeSchema,
  originalSnippet: z.string(),
  transformedSnippet: z.string(),
  explanation: z.string(),
});
export type TransformationApplied = z.infer<typeof TransformationAppliedSchema>;

export const TransformedScriptSchema = z.object({
  recordingId: z.string().uuid(),
  originalText: z.string(),
  transformedText: z.string(),
  transformationsApplied: z.array(TransformationAppliedSchema),
  improvementScore: z.number().min(0).max(100),
  structureUsed: z.string(),
  wordCountOriginal: z.number().nonnegative(),
  wordCountTransformed: z.number().nonnegative(),
  createdAt: z.string().datetime(),
});
export type TransformedScript = z.infer<typeof TransformedScriptSchema>;

// ── Synthesized Audio ─────────────────────────────────────────────────────────

export const SynthesizedAudioSchema = z.object({
  recordingId: z.string().uuid(),
  audioUrl: z.string().url(),
  voiceId: z.string(),
  voiceName: z.string(),
  durationMs: z.number().nonnegative(),
  format: z.enum(['mp3', 'wav', 'ogg']).default('mp3'),
  sampleRate: z.number().default(44100),
  createdAt: z.string().datetime(),
});
export type SynthesizedAudio = z.infer<typeof SynthesizedAudioSchema>;

// ── API Request/Response Types ────────────────────────────────────────────────

export const UploadResponseSchema = z.object({
  recordingId: z.string().uuid(),
  videoUrl: z.string(),
  message: z.string(),
});
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

export const TranscribeRequestSchema = z.object({
  recordingId: z.string().uuid(),
  language: z.string().default('en'),
});
export type TranscribeRequest = z.infer<typeof TranscribeRequestSchema>;

export const TransformRequestSchema = z.object({
  recordingId: z.string().uuid(),
  modules: z.array(TrainingModuleTypeSchema).optional(),
  targetStructure: z.enum(['pyramid', 'scr', 'mece', 'auto']).default('auto'),
});
export type TransformRequest = z.infer<typeof TransformRequestSchema>;

export const SynthesizeRequestSchema = z.object({
  recordingId: z.string().uuid(),
  voiceId: z.string(),
  voiceName: z.string().optional(),
  outputFormat: z.enum(['mp3', 'wav', 'ogg']).default('mp3'),
});
export type SynthesizeRequest = z.infer<typeof SynthesizeRequestSchema>;

export const ErrorResponseSchema = z.object({
  error: z.string(),
  details: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ── Recording List Item ───────────────────────────────────────────────────────

export const RecordingListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: RecordingStatusSchema,
  currentStep: WorkflowStepSchema,
  durationMs: z.number().nonnegative().optional(),
  thumbnailUrl: z.string().url().optional(),
  shareUrl: z.string().url().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RecordingListItem = z.infer<typeof RecordingListItemSchema>;

// ── Vocabulary Mapping ────────────────────────────────────────────────────────

export interface VocabularyMapping {
  casual: string;
  professional: string;
  context?: string;
}

// ── ElevenLabs Types ──────────────────────────────────────────────────────────

export interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  category: string;
  previewUrl?: string;
}

export interface ElevenLabsSynthesisOptions {
  voiceId: string;
  text: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
}
