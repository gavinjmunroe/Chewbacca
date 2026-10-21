# Modulate API Integration Guide

This guide explains how to use the Modulate API integration service for voice emotion and prosody analysis.

## Overview

The `ModulateService` provides integration with Modulate's Emotional Language Model (ELM) API for analyzing voice emotion, prosody, and voice characteristics. The service is production-ready with fallback mock responses for development.

## Setup

### 1. Environment Configuration

Add your Modulate API credentials to your environment:

```bash
# .env.local or .env.production
EXPO_PUBLIC_MODULATE_API_KEY=your_api_key_here
EXPO_PUBLIC_MODULATE_ENDPOINT=https://api.modulate.com/v1
```

The service looks for these environment variables in order:
- `EXPO_PUBLIC_MODULATE_API_KEY` (recommended for Expo apps)
- `MODULATE_API_KEY`
- `EXPO_PUBLIC_MODULATE_ENDPOINT` (API endpoint, defaults to `https://api.modulate.com/v1`)

### 2. When to Add Credentials

The service gracefully falls back to mock responses when:
- No API key is configured
- API key is missing or invalid
- In development mode

This allows you to develop and test the UI without active API access.

## Basic Usage

### Get the Modulate Service

```typescript
import { getModulateService, type AudioBuffer } from '@/services';

const modulateService = getModulateService();
```

### Analyze Audio

Analyze a recorded audio buffer for emotion and prosody:

```typescript
import { AudioFeatureExtractor } from '@/services/AudioService';
import { getModulateService } from '@/services';

// Assuming you have audio data from TizzyAudioService
const audioUri = await audioService.stopRecording();
const audioInfo = await audioService.getAudioInfo(audioUri);

// Create audio buffer
const audioBuffer: AudioBuffer = {
  data: new Float32Array(audioData),
  sampleRate: 16000,
  duration: audioInfo.durationMillis / 1000,
  channels: 1,
};

// Analyze
const modulateService = getModulateService();
const result = await modulateService.analyzeAudio(audioBuffer);

if (result.success) {
  console.log('Emotion:', result.emotion?.emotion, `(${result.emotion?.confidence})`);
  console.log('Voice Characteristics:', result.prosody?.voiceCharacteristics);
} else {
  console.error('Analysis failed:', result.errors);
}
```

### Get Voice Emotion Classification

Classify voice emotion from extracted features:

```typescript
import { getModulateService, type VoiceEmotionFeatures } from '@/services';

const voiceFeatures: VoiceEmotionFeatures = {
  features: {
    f0Mean: 150,
    intensityMean: -30,
    speechRate: 4.5,
    jitter: 0.01,
    shimmer: 0.03,
  },
  timestamp: Date.now(),
};

const modulateService = getModulateService();
const emotion = await modulateService.getVoiceEmotion(voiceFeatures);

console.log('Detected Emotion:', emotion.emotion);
console.log('Confidence Score:', emotion.confidence);
console.log('All Scores:', emotion.scores);
```

### Analyze Prosody

Get detailed prosody analysis with voice characteristics:

```typescript
import { getModulateService, type ProsodyFeatures } from '@/services';

const prosodyFeatures: ProsodyFeatures = {
  f0Mean: 150,
  f0Min: 100,
  f0Max: 200,
  f0StdDev: 25,
  intensityMean: -30,
  intensityMax: -10,
  intensityStdDev: 8,
  duration: 5.2,
  speechRate: 4.5,
  jitter: 0.01,
  shimmer: 0.03,
  harmonicNoiseRatio: 12,
};

const modulateService = getModulateService();
const prosody = await modulateService.analyzeProsody(prosodyFeatures);

console.log('Pitch Variation:', prosody.voiceCharacteristics.pitchVariation);
console.log('Energy Level:', prosody.voiceCharacteristics.energyLevel);
console.log('Speech Rate:', prosody.voiceCharacteristics.speechRate);
console.log('Voice Quality:', prosody.voiceCharacteristics.voiceQuality);
console.log('Confidence:', prosody.confidence);
```

## Integration Examples

### Example 1: Recording and Emotion Detection in a Component

```typescript
import { useState } from 'react';
import { Text, Pressable, View } from 'react-native';
import { getAudioService } from '@/services/AudioService';
import { getModulateService } from '@/services';
import type { AudioAnalysisResult } from '@/services';

export function EmotionDetectionScreen() {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AudioAnalysisResult | null>(null);

  const recordAndAnalyze = async () => {
    try {
      setAnalyzing(true);
      const audioService = getAudioService();
      const modulateService = getModulateService();

      // Record audio
      await audioService.startRecording();
      // ... wait for user input or timeout ...
      const audioUri = await audioService.stopRecording();

      // Get audio file info
      const audioInfo = await audioService.getAudioInfo(audioUri!);

      // Analyze with Modulate
      const analysisResult = await modulateService.analyzeAudio({
        data: new Float32Array(audioInfo.durationMillis), // Mock data for demo
        sampleRate: 16000,
        duration: audioInfo.durationMillis / 1000,
        channels: 1,
      });

      setResult(analysisResult);
    } catch (error) {
      console.error('Analysis failed:', error);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <View>
      <Pressable onPress={recordAndAnalyze} disabled={analyzing}>
        <Text>{analyzing ? 'Analyzing...' : 'Record & Analyze'}</Text>
      </Pressable>

      {result && (
        <View>
          {result.success ? (
            <>
              <Text>Emotion: {result.emotion?.emotion}</Text>
              <Text>Confidence: {(result.emotion?.confidence ?? 0 * 100).toFixed(1)}%</Text>
              <Text>Voice Quality: {result.prosody?.voiceCharacteristics.voiceQuality}</Text>
            </>
          ) : (
            <Text>Error: {result.errors?.join(', ')}</Text>
          )}
        </View>
      )}
    </View>
  );
}
```

### Example 2: Emotion Analysis in a Hook

```typescript
import { useState, useCallback } from 'react';
import { getModulateService, type AudioAnalysisResult } from '@/services';

export function useEmotionAnalysis() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AudioAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyzeAudio = useCallback(async (audioBuffer) => {
    setLoading(true);
    setError(null);

    try {
      const modulateService = getModulateService();
      const analysisResult = await modulateService.analyzeAudio(audioBuffer);
      setResult(analysisResult);

      if (!analysisResult.success) {
        setError(analysisResult.errors?.[0] || 'Unknown error');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, []);

  return { analyzeAudio, loading, result, error };
}

// Usage
export function MyComponent() {
  const { analyzeAudio, loading, result } = useEmotionAnalysis();

  return (
    <View>
      <Pressable onPress={() => analyzeAudio(audioBuffer)} disabled={loading}>
        <Text>{loading ? 'Analyzing...' : 'Analyze'}</Text>
      </Pressable>
      {result && <Text>Result: {result.emotion?.emotion}</Text>}
    </View>
  );
}
```

## Emotion Types

The service recognizes 7 basic emotions:

- **neutral** - Calm, relaxed tone
- **happy** - Positive, cheerful tone
- **sad** - Melancholic, gloomy tone
- **angry** - Frustrated, irritated tone
- **fearful** - Anxious, worried tone
- **surprised** - Astonished, shocked tone
- **disgusted** - Repulsed, disapproving tone

## Response Types

### EmotionResult

```typescript
interface EmotionResult {
  emotion: 'neutral' | 'happy' | 'sad' | 'angry' | 'fearful' | 'surprised' | 'disgusted';
  confidence: number; // 0-1
  scores?: {
    neutral: number;
    happy: number;
    sad: number;
    angry: number;
    fearful: number;
    surprised: number;
    disgusted: number;
  };
}
```

### ProsodyAnalysisResult

```typescript
interface ProsodyAnalysisResult {
  features: ProsodyFeatures;
  voiceCharacteristics: {
    pitchVariation: 'low' | 'moderate' | 'high';
    energyLevel: 'low' | 'moderate' | 'high';
    speechRate: 'slow' | 'normal' | 'fast';
    voiceQuality: 'clear' | 'hoarse' | 'breathy' | 'nasal';
  };
  confidence: number; // 0-1
}
```

### AudioAnalysisResult

```typescript
interface AudioAnalysisResult {
  success: boolean;
  audioId?: string;
  duration: number;
  sampleRate: number;
  emotion?: EmotionResult;
  prosody?: ProsodyAnalysisResult;
  errors?: string[];
  timestamp: number;
  mock?: boolean; // true if using mock response
}
```

## Rate Limiting

The service tracks API rate limits automatically:

```typescript
const modulateService = getModulateService();

// Check rate limit status
const rateLimit = modulateService.getRateLimit();
console.log(`Requests remaining: ${rateLimit.requestsRemaining}/${rateLimit.requestsLimit}`);
console.log(`Resets at: ${new Date(rateLimit.resetTime)}`);

if (rateLimit.isLimited) {
  console.warn('Rate limit exceeded!');
}
```

Rate limit configuration:
- Default: 100 requests per minute
- Window: 60 seconds
- When limited: Returns error with `code: 'RATE_LIMITED'`

## Error Handling

The service includes comprehensive error handling:

```typescript
const modulateService = getModulateService();

try {
  const result = await modulateService.analyzeAudio(audioBuffer);

  if (!result.success) {
    console.error('Analysis failed:');
    result.errors?.forEach(error => console.error(`  - ${error}`));
  }
} catch (error) {
  console.error('Request failed:', error);
  // Service automatically logs to ErrorTracking (Sentry)
}
```

## Development Mode

When no API key is configured, the service:

1. Returns realistic mock responses
2. Logs a warning to the console
3. Simulates realistic API behavior
4. Maintains the same interface as production

This allows you to:
- Develop the UI without API access
- Test error handling
- Preview emotion classifications
- Prototype voice analysis features

## Monitoring & Debugging

The service integrates with Sentry (ErrorTracking) for monitoring:

```typescript
import { addBreadcrumb } from '@/services/ErrorTracking';

// Custom tracking (if needed)
addBreadcrumb({
  category: 'modulate',
  message: 'Custom event',
  level: 'info',
  data: { customData: 'value' },
});
```

Check Sentry dashboard for:
- Error rates and trends
- API performance metrics
- Rate limit violations
- User session data

## Configuration Checklist

When you get Modulate API access:

- [ ] Obtain API key from Modulate
- [ ] Verify API endpoint URL
- [ ] Add `EXPO_PUBLIC_MODULATE_API_KEY` to .env
- [ ] Add `EXPO_PUBLIC_MODULATE_ENDPOINT` if different
- [ ] Update rate limiting thresholds if needed
- [ ] Implement request signing if required
- [ ] Test with real API responses
- [ ] Update mock data to match real response format
- [ ] Set up Sentry alerting for errors
- [ ] Configure API monitoring dashboard
- [ ] Document your API quota and limits

## Performance Tips

1. **Batch Requests**: Analyze multiple audio samples together when possible
2. **Cache Results**: Store emotion analysis results to avoid re-processing
3. **Async Processing**: Run analysis in background to avoid blocking UI
4. **Monitor Rate Limits**: Check rate limit status before making requests
5. **Error Recovery**: Implement retry logic with exponential backoff

## Troubleshooting

### "API key not configured"

Add `EXPO_PUBLIC_MODULATE_API_KEY` to your `.env.local` file and restart the app.

### "Rate limit exceeded"

Wait until the `resetTime` indicated in the rate limit response. Monitor your request frequency.

### "Analysis failed" with mock data

This is normal in development mode. The service returns realistic mock responses to help test your UI.

### "Request timeout"

The default timeout is 30 seconds. Check your network connection or consider increasing `REQUEST_TIMEOUT` in the service if needed.

## Support

For issues with:
- **Service Integration**: Check this guide and inline code comments
- **Modulate API**: Contact Modulate support team
- **Audio Processing**: See `AudioService.ts` for recording and feature extraction
- **Error Tracking**: Check Sentry dashboard for detailed logs
