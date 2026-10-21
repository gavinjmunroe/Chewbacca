# Modulate Service - Quick Reference

## Import & Initialize

```typescript
import { getModulateService, type AudioBuffer, type EmotionResult } from '@/services';

const modulate = getModulateService();
```

## Three Core Methods

### 1. analyzeAudio()
```typescript
const result = await modulate.analyzeAudio({
  data: audioFloatArray,
  sampleRate: 16000,
  duration: 5.2,
  channels: 1,
});

// Returns: AudioAnalysisResult
// - emotion: EmotionResult
// - prosody: ProsodyAnalysisResult
```

### 2. getVoiceEmotion()
```typescript
const emotion = await modulate.getVoiceEmotion({
  features: { f0Mean: 150, intensityMean: -30, ... },
  timestamp: Date.now(),
});

// Returns: EmotionResult
// - emotion: 'happy' | 'sad' | 'angry' | ...
// - confidence: number (0-1)
// - scores: { neutral: 0.1, happy: 0.8, ... }
```

### 3. analyzeProsody()
```typescript
const prosody = await modulate.analyzeProsody({
  f0Mean: 150,
  intensityMean: -30,
  speechRate: 4.5,
  jitter: 0.01,
  // ... more features
});

// Returns: ProsodyAnalysisResult
// - voiceCharacteristics: {
//     pitchVariation: 'low' | 'moderate' | 'high'
//     energyLevel: 'low' | 'moderate' | 'high'
//     speechRate: 'slow' | 'normal' | 'fast'
//     voiceQuality: 'clear' | 'hoarse' | 'breathy' | 'nasal'
//   }
// - confidence: number (0-1)
```

## Supported Emotions

| Emotion | Description |
|---------|-------------|
| `neutral` | Calm, relaxed tone |
| `happy` | Positive, cheerful tone |
| `sad` | Melancholic, gloomy tone |
| `angry` | Frustrated, irritated tone |
| `fearful` | Anxious, worried tone |
| `surprised` | Astonished, shocked tone |
| `disgusted` | Repulsed, disapproving tone |

## Utility Methods

```typescript
// Check if API is available (has valid credentials)
const available = modulate.isAPIAvailable();

// Get rate limit status
const rateLimit = modulate.getRateLimit();
// { requestsRemaining, requestsLimit, resetTime, isLimited }

// Health check
const healthy = await modulate.healthCheck();
```

## Setup (When API Key Available)

```bash
# .env.local
EXPO_PUBLIC_MODULATE_API_KEY=your_api_key_here
EXPO_PUBLIC_MODULATE_ENDPOINT=https://api.modulate.com/v1
```

## Component Usage Pattern

```typescript
import { useState } from 'react';
import { getModulateService, type AudioAnalysisResult } from '@/services';

export function MyComponent() {
  const [result, setResult] = useState<AudioAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async (audioBuffer) => {
    setLoading(true);
    try {
      const modulate = getModulateService();
      const analysis = await modulate.analyzeAudio(audioBuffer);
      setResult(analysis);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View>
      {result?.success && (
        <Text>Emotion: {result.emotion?.emotion} ({(result.emotion?.confidence * 100).toFixed(1)}%)</Text>
      )}
    </View>
  );
}
```

## Hook Pattern

```typescript
import { useState, useCallback } from 'react';
import { getModulateService } from '@/services';

export function useModulateAnalysis() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async (type, data) => {
    setLoading(true);
    setError(null);

    try {
      const modulate = getModulateService();

      switch (type) {
        case 'audio':
          return await modulate.analyzeAudio(data);
        case 'emotion':
          return await modulate.getVoiceEmotion(data);
        case 'prosody':
          return await modulate.analyzeProsody(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  return { analyze, loading, error };
}
```

## Error Handling

```typescript
const modulate = getModulateService();
const result = await modulate.analyzeAudio(audioBuffer);

if (!result.success) {
  // result.errors contains error messages
  const errorMsg = result.errors?.[0] || 'Unknown error';
  console.error('Analysis failed:', errorMsg);

  // Check if it was a rate limit error
  const rateLimit = modulate.getRateLimit();
  if (rateLimit.isLimited) {
    console.log(`Rate limit reset in ${new Date(rateLimit.resetTime)}`);
  }
}
```

## Type Definitions

### AudioBuffer
```typescript
interface AudioBuffer {
  data: Float32Array;
  sampleRate: number;
  duration: number;
  channels?: number;
}
```

### EmotionResult
```typescript
interface EmotionResult {
  emotion: 'neutral' | 'happy' | 'sad' | 'angry' | 'fearful' | 'surprised' | 'disgusted';
  confidence: number;
  scores?: Record<string, number>;
}
```

### ProsodyFeatures
```typescript
interface ProsodyFeatures {
  f0Mean?: number;           // Fundamental frequency mean
  f0Min?: number;            // Fundamental frequency minimum
  f0Max?: number;            // Fundamental frequency maximum
  f0StdDev?: number;         // Fundamental frequency std dev
  intensityMean?: number;    // Intensity/energy mean (dB)
  intensityMin?: number;     // Intensity minimum
  intensityMax?: number;     // Intensity maximum
  intensityStdDev?: number;  // Intensity std dev
  duration?: number;         // Audio duration in seconds
  speechRate?: number;       // Syllables per second
  jitter?: number;           // Pitch perturbation
  shimmer?: number;          // Amplitude perturbation
  harmonicNoiseRatio?: number;
  mfcc?: number[];          // Mel-frequency cepstral coefficients
  spectralCentroid?: number;
  zeroCrossingRate?: number;
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
  mock?: boolean; // true if using development mode
}
```

## Configuration TODOs

When API credentials are available, update in `ModulateService.ts`:

1. **Line 349**: Uncomment fetch implementation
2. **Line 320**: Uncomment rate limit header parsing
3. **Line 376**: Update response parsing for actual API format
4. **Line 256-258**: Update prosody feature parsing
5. **Line 213-214**: Update emotion classification parsing

## Files Reference

| File | Purpose | Size |
|------|---------|------|
| `ModulateService.ts` | Main service implementation | 734 lines |
| `MODULATE_INTEGRATION_GUIDE.md` | Complete usage guide | 12 KB |
| `MODULATE_IMPLEMENTATION_SUMMARY.md` | Implementation details | 7 KB |
| `MODULATE_QUICK_REFERENCE.md` | This file | ~5 KB |

## Development Mode Behavior

When no API key is configured:
- ✅ Returns realistic mock emotion responses
- ✅ Returns realistic mock prosody analysis
- ✅ Maintains same interface as production
- ✅ Logs warnings about development mode
- ✅ Works offline (no API calls)
- ✅ Results include `mock: true` flag

## Common Pitfalls

❌ **Don't**: Use synchronous calls
```typescript
const emotion = modulate.analyzeAudio(buffer); // Wrong! Returns Promise
```

✅ **Do**: Use async/await
```typescript
const emotion = await modulate.analyzeAudio(buffer); // Correct
```

---

❌ **Don't**: Ignore the `success` flag
```typescript
const emotion = result.emotion?.emotion; // Could be undefined if failed
```

✅ **Do**: Check success first
```typescript
if (result.success) {
  const emotion = result.emotion?.emotion; // Safe
}
```

---

❌ **Don't**: Exceed rate limits
```typescript
for (let i = 0; i < 1000; i++) {
  await modulate.analyzeAudio(buffers[i]); // Will hit rate limit!
}
```

✅ **Do**: Check and respect rate limits
```typescript
const rateLimit = modulate.getRateLimit();
if (rateLimit.isLimited) {
  await delay(rateLimit.resetTime - Date.now());
}
```

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `EXPO_PUBLIC_MODULATE_API_KEY` | No | undefined | API authentication |
| `EXPO_PUBLIC_MODULATE_ENDPOINT` | No | `https://api.modulate.com/v1` | API endpoint URL |

## Performance Notes

- **Timeout**: 30 seconds per request
- **Rate Limit**: 100 requests/minute (default)
- **Mock Response Time**: ~100-500ms
- **Real API Time**: ~500ms-2000ms (estimated)
- **Memory**: Minimal (Float32Array only)

## Debugging

Enable logging by setting up Sentry with proper verbosity:

```typescript
import * as ErrorTracking from '@/services/ErrorTracking';

// Initialize with dev mode
ErrorTracking.initializeErrorTracking({ enableInDev: true });

// Service will log breadcrumbs automatically
// Check Sentry dashboard for detailed logs
```

## Next Steps

1. Review `MODULATE_INTEGRATION_GUIDE.md` for complete documentation
2. Check `MODULATE_IMPLEMENTATION_SUMMARY.md` for architecture details
3. Once API credentials available, follow configuration steps
4. Test with sample audio from `AudioService.ts`
5. Integrate into your components using patterns above
