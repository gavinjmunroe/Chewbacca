import type { Recording, Transcript, TransformedScript, SynthesizedAudio } from '../../shared/src/types';

/**
 * In-memory store for recordings and their artifacts.
 * In production, swap this for Firestore or Postgres.
 */
class RecordingStore {
  private recordings: Map<string, Recording> = new Map();

  create(recording: Recording): Recording {
    this.recordings.set(recording.id, recording);
    return recording;
  }

  get(id: string): Recording | undefined {
    return this.recordings.get(id);
  }

  list(): Recording[] {
    return Array.from(this.recordings.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  update(id: string, updates: Partial<Recording>): Recording | undefined {
    const existing = this.recordings.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.recordings.set(id, updated);
    return updated;
  }

  setTranscript(id: string, transcript: Transcript): Recording | undefined {
    return this.update(id, {
      transcript,
      status: 'transcribing',
      currentStep: 'transform',
    });
  }

  setTransformedScript(id: string, script: TransformedScript): Recording | undefined {
    return this.update(id, {
      transformedScript: script,
      status: 'transforming',
      currentStep: 'generate',
    });
  }

  setSynthesizedAudio(id: string, audio: SynthesizedAudio): Recording | undefined {
    return this.update(id, {
      synthesizedAudio: audio,
      status: 'complete',
      currentStep: 'share',
    });
  }

  delete(id: string): boolean {
    return this.recordings.delete(id);
  }
}

export const store = new RecordingStore();
