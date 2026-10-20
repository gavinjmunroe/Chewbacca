import type { ElevenLabsSynthesisOptions, ElevenLabsVoice } from '../../shared/src/types';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error('ELEVENLABS_API_KEY environment variable is required');
  }
  return key;
}

function headers(): Record<string, string> {
  return {
    'xi-api-key': getApiKey(),
    'Content-Type': 'application/json',
  };
}

/**
 * List available voices from ElevenLabs
 */
export async function listVoices(): Promise<ElevenLabsVoice[]> {
  const response = await fetch(`${ELEVENLABS_BASE_URL}/voices`, {
    method: 'GET',
    headers: headers(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs listVoices failed (${response.status}): ${errorText}`);
  }

  const data = await response.json() as { voices: Array<{
    voice_id: string;
    name: string;
    category: string;
    preview_url?: string;
  }> };

  return data.voices.map((v) => ({
    voiceId: v.voice_id,
    name: v.name,
    category: v.category,
    previewUrl: v.preview_url,
  }));
}

/**
 * Synthesize text to speech using ElevenLabs
 * Returns a Buffer containing the audio data
 */
export async function synthesizeSpeech(options: ElevenLabsSynthesisOptions): Promise<Buffer> {
  const {
    voiceId,
    text,
    modelId = 'eleven_multilingual_v2',
    stability = 0.5,
    similarityBoost = 0.75,
    style = 0.5,
    useSpeakerBoost = true,
  } = options;

  const response = await fetch(
    `${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        ...headers(),
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability,
          similarity_boost: similarityBoost,
          style,
          use_speaker_boost: useSpeakerBoost,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs synthesis failed (${response.status}): ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Get voice details by ID
 */
export async function getVoice(voiceId: string): Promise<ElevenLabsVoice> {
  const response = await fetch(`${ELEVENLABS_BASE_URL}/voices/${voiceId}`, {
    method: 'GET',
    headers: headers(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs getVoice failed (${response.status}): ${errorText}`);
  }

  const v = await response.json() as {
    voice_id: string;
    name: string;
    category: string;
    preview_url?: string;
  };

  return {
    voiceId: v.voice_id,
    name: v.name,
    category: v.category,
    previewUrl: v.preview_url,
  };
}

/**
 * Clone a voice from audio samples
 * Returns the new voice ID
 */
export async function cloneVoice(
  name: string,
  description: string,
  audioFiles: Buffer[]
): Promise<string> {
  const formData = new FormData();
  formData.append('name', name);
  formData.append('description', description);

  for (let i = 0; i < audioFiles.length; i++) {
    const blob = new Blob([audioFiles[i]], { type: 'audio/mpeg' });
    formData.append('files', blob, `sample_${i}.mp3`);
  }

  const response = await fetch(`${ELEVENLABS_BASE_URL}/voices/add`, {
    method: 'POST',
    headers: {
      'xi-api-key': getApiKey(),
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs cloneVoice failed (${response.status}): ${errorText}`);
  }

  const data = await response.json() as { voice_id: string };
  return data.voice_id;
}
