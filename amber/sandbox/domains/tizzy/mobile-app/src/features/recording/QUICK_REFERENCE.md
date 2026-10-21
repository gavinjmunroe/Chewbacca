# Session Recording - Quick Reference Card

## Import

```typescript
import { useSessionRecording } from '@/features/recording';
```

## Basic Usage

```typescript
const {
  startSession,
  stopSession,
  isRecording,
  metrics
} = useSessionRecording();
```

## Common Operations

### Start Recording
```typescript
await startSession('environment_tag', 'consent_mode');
// or with defaults
await startSession();
```

### Pause Recording
```typescript
await pauseSession();
```

### Resume Recording
```typescript
await resumeSession();
```

### Stop Recording
```typescript
const sessionId = await stopSession();
```

### Upload Features Manually
```typescript
await uploadFeatures();
```

## State Checks

```typescript
if (isRecording) { /* ... */ }
if (isPaused) { /* ... */ }
if (isIdle) { /* ... */ }
```

## Session States

- `idle` - No active session
- `recording` - Currently recording
- `paused` - Recording paused
- `stopped` - Recording stopped (transitional)

## Metrics

```typescript
metrics.duration              // seconds
metrics.totalSamples          // feature count
metrics.bufferedFeatures      // waiting to upload
metrics.uploadedFeatures      // uploaded count
metrics.averageRMS            // 0.0 - 1.0
metrics.averageZCR            // 0.0 - 1.0
metrics.averageIntensity      // dB
metrics.averagePitch          // Hz
```

## Configuration

```typescript
useSessionRecording({
  config: {
    featureExtractionInterval: 100,  // ms
    bufferSize: 1000,                // features
    uploadBatchSize: 100,            // features
    sampleRate: 16000,               // Hz
    autoUpload: true,
    syncDeviceStatus: true,
  }
});
```

## Event Callbacks

```typescript
useSessionRecording({
  onStateChange: (state) => { },
  onMetricsUpdate: (metrics) => { },
  onError: (error) => { },
  onFeatureExtracted: (feature) => { },
});
```

## Error Handling

```typescript
try {
  await startSession();
} catch (error) {
  console.error('Failed:', error);
}

// Or via callback
const { lastError, clearErrors } = useSessionRecording({
  onError: (error) => {
    Alert.alert('Error', error.message);
  }
});
```

## Loading States

```typescript
if (isStarting) { /* show loading */ }
if (isStopping) { /* show loading */ }
if (isPausingOrResuming) { /* show loading */ }
```

## Device Status

```typescript
const { deviceStatus } = useSessionRecording();

deviceStatus?.battery_level
deviceStatus?.firmware_version
deviceStatus?.mute_state
```

## Utility Hooks

### Metrics Only
```typescript
const metrics = useSessionMetrics();
```

### State Only
```typescript
const { state, isRecording } = useSessionState();
```

### Errors Only
```typescript
const { errors, lastError, clearErrors } = useSessionErrors();
```

## Format Helpers

### Duration
```typescript
const formatDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};
```

### State Color
```typescript
const getStateColor = (state: SessionState) => {
  switch (state) {
    case 'recording': return '#4CAF50';
    case 'paused': return '#FF9800';
    default: return '#9E9E9E';
  }
};
```

## Complete Example

```typescript
function RecordingScreen() {
  const {
    startSession,
    pauseSession,
    stopSession,
    isRecording,
    isPaused,
    metrics,
    lastError,
  } = useSessionRecording({
    onError: (error) => Alert.alert('Error', error.message),
  });

  return (
    <View>
      <Text>State: {isRecording ? 'Recording' : 'Idle'}</Text>
      <Text>Duration: {metrics.duration}s</Text>

      {!isRecording && !isPaused && (
        <Button title="Start" onPress={() => startSession()} />
      )}

      {isRecording && (
        <Button title="Pause" onPress={pauseSession} />
      )}

      {isPaused && (
        <Button title="Resume" onPress={resumeSession} />
      )}

      {(isRecording || isPaused) && (
        <Button title="Stop" onPress={stopSession} />
      )}
    </View>
  );
}
```

## Performance Tips

1. **Battery Optimization**
   ```typescript
   config: {
     featureExtractionInterval: 200,  // Lower frequency
     sampleRate: 8000,                // Lower sample rate
   }
   ```

2. **Memory Optimization**
   ```typescript
   config: {
     bufferSize: 500,      // Smaller buffer
     autoUpload: true,     // Upload frequently
   }
   ```

3. **Network Optimization**
   ```typescript
   config: {
     uploadBatchSize: 50,  // Smaller batches
     autoUpload: false,    // Manual control
   }
   ```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No features extracted | Check microphone permissions |
| Features not uploading | Check network connection |
| High memory usage | Reduce buffer size, enable auto-upload |
| High battery usage | Increase extraction interval |
| BLE sync not working | Verify device is connected |

## File Locations

```
src/features/recording/
├── SessionRecorder.ts           # Core engine
├── hooks/useSessionRecording.ts # React hook
├── examples/RecordingExample.tsx # Demo
├── index.ts                     # Exports
├── README.md                    # Full docs
├── INTEGRATION_GUIDE.md         # Integration help
└── QUICK_REFERENCE.md           # This file
```

## More Information

- See **README.md** for complete documentation
- See **INTEGRATION_GUIDE.md** for integration examples
- See **RecordingExample.tsx** for working demo
- See **SessionRecorder.test.ts** for test examples

---

**Version:** 1.0.0
**Last Updated:** 2024-02-13
