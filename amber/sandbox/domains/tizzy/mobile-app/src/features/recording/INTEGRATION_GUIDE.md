# Session Recording Integration Guide

Quick guide for integrating the Session Recording system into your Tizzy mobile app screens.

## Table of Contents

1. [Simple Integration](#simple-integration)
2. [Screen Examples](#screen-examples)
3. [Common Patterns](#common-patterns)
4. [API Reference](#api-reference)

## Simple Integration

### Step 1: Import the Hook

```typescript
import { useSessionRecording } from '@/features/recording';
```

### Step 2: Use in Component

```typescript
function MyRecordingScreen() {
  const {
    startSession,
    stopSession,
    isRecording,
    metrics,
  } = useSessionRecording();

  return (
    <View>
      <Button
        title={isRecording ? 'Stop' : 'Start'}
        onPress={isRecording ? stopSession : () => startSession()}
      />
      <Text>Duration: {metrics.duration}s</Text>
    </View>
  );
}
```

### Step 3: That's it!

The hook handles:
- ✅ Session lifecycle
- ✅ Feature extraction
- ✅ Backend synchronization
- ✅ BLE device sync
- ✅ Error handling
- ✅ Cleanup on unmount

## Screen Examples

### Practice Session Screen

```typescript
import React from 'react';
import { View, Text, Button } from 'react-native';
import { useSessionRecording } from '@/features/recording';

export function PracticeSessionScreen() {
  const {
    startSession,
    pauseSession,
    resumeSession,
    stopSession,
    isRecording,
    isPaused,
    metrics,
  } = useSessionRecording({
    defaultEnvironmentTag: 'practice',
  });

  const handleToggleRecording = async () => {
    if (isRecording) {
      await pauseSession();
    } else if (isPaused) {
      await resumeSession();
    } else {
      await startSession('practice', 'full');
    }
  };

  const handleEndSession = async () => {
    const sessionId = await stopSession();
    // Navigate to session summary
    navigation.navigate('SessionSummary', { sessionId });
  };

  return (
    <View>
      <Text>Recording: {isRecording ? 'Yes' : 'No'}</Text>
      <Text>Duration: {formatDuration(metrics.duration)}</Text>

      <Button
        title={isRecording ? 'Pause' : isPaused ? 'Resume' : 'Start'}
        onPress={handleToggleRecording}
      />

      {(isRecording || isPaused) && (
        <Button
          title="End Session"
          onPress={handleEndSession}
        />
      )}
    </View>
  );
}
```

### Dashboard Widget

```typescript
import { useSessionState, useSessionMetrics } from '@/features/recording';

export function RecordingWidget() {
  const { isRecording, sessionId } = useSessionState();
  const metrics = useSessionMetrics();

  if (!isRecording) {
    return null;
  }

  return (
    <View style={styles.widget}>
      <View style={styles.indicator} />
      <Text>Recording: {formatDuration(metrics.duration)}</Text>
      <Text style={styles.sessionId}>{sessionId}</Text>
    </View>
  );
}
```

### Settings Screen

```typescript
export function RecordingSettingsScreen() {
  const [config, setConfig] = useState({
    featureExtractionInterval: 100,
    autoUpload: true,
    syncDeviceStatus: true,
  });

  const recording = useSessionRecording({ config });

  return (
    <View>
      <Text>Feature Extraction Rate</Text>
      <Slider
        value={config.featureExtractionInterval}
        onValueChange={(val) =>
          setConfig({ ...config, featureExtractionInterval: val })
        }
        minimumValue={50}
        maximumValue={500}
      />

      <Switch
        value={config.autoUpload}
        onValueChange={(val) =>
          setConfig({ ...config, autoUpload: val })
        }
      />
      <Text>Auto-upload features</Text>

      <Switch
        value={config.syncDeviceStatus}
        onValueChange={(val) =>
          setConfig({ ...config, syncDeviceStatus: val })
        }
      />
      <Text>Sync with BLE device</Text>
    </View>
  );
}
```

## Common Patterns

### Auto-Start on Mount

```typescript
const recording = useSessionRecording({
  autoStart: true,
  defaultEnvironmentTag: 'background',
});
```

### Show Recording Indicator

```typescript
function RecordingIndicator() {
  const { isRecording } = useSessionState();

  if (!isRecording) return null;

  return (
    <View style={styles.recordingBadge}>
      <View style={styles.recordingDot} />
      <Text>REC</Text>
    </View>
  );
}
```

### Error Toast Notifications

```typescript
function SessionRecordingWithErrors() {
  const { lastError, clearErrors } = useSessionRecording({
    onError: (error) => {
      Toast.show({
        type: 'error',
        text1: 'Recording Error',
        text2: error.message,
      });
    },
  });

  return null;
}
```

### Real-Time Feature Visualization

```typescript
function FeatureVisualizer() {
  const [latestFeature, setLatestFeature] = useState<FeatureData | null>(null);

  useSessionRecording({
    onFeatureExtracted: (feature) => {
      setLatestFeature(feature);
    },
  });

  return (
    <View>
      <Text>RMS: {latestFeature?.rms.toFixed(4)}</Text>
      <Text>Pitch: {latestFeature?.pitch.toFixed(2)} Hz</Text>
      {/* Add charts/visualizations here */}
    </View>
  );
}
```

### Background Recording

```typescript
import BackgroundFetch from 'react-native-background-fetch';

function BackgroundRecordingService() {
  const { startSession, stopSession } = useSessionRecording();

  useEffect(() => {
    BackgroundFetch.configure({
      minimumFetchInterval: 15,
    }, async (taskId) => {
      // Start background session
      await startSession('background', 'minimal');

      // Stop after 10 minutes
      setTimeout(async () => {
        await stopSession();
        BackgroundFetch.finish(taskId);
      }, 600000);
    });
  }, []);

  return null;
}
```

### Session Queue Manager

```typescript
function SessionQueueManager() {
  const [sessionQueue, setSessionQueue] = useState<string[]>([]);

  const { stopSession } = useSessionRecording({
    onStateChange: async (state) => {
      if (state === 'stopped') {
        // Add to queue for processing
        const sessionId = await stopSession();
        if (sessionId) {
          setSessionQueue(prev => [...prev, sessionId]);
        }
      }
    },
  });

  useEffect(() => {
    // Process queue
    if (sessionQueue.length > 0) {
      const sessionId = sessionQueue[0];
      processSession(sessionId).then(() => {
        setSessionQueue(prev => prev.slice(1));
      });
    }
  }, [sessionQueue]);

  return null;
}
```

### Metrics Dashboard

```typescript
import { LineChart } from 'react-native-chart-kit';

function MetricsDashboard() {
  const metrics = useSessionMetrics();
  const [rmsHistory, setRmsHistory] = useState<number[]>([]);

  useEffect(() => {
    if (metrics.averageRMS > 0) {
      setRmsHistory(prev => [...prev.slice(-50), metrics.averageRMS]);
    }
  }, [metrics.averageRMS]);

  return (
    <View>
      <Text>Live Metrics</Text>

      <View style={styles.metricRow}>
        <Text>Duration: {formatDuration(metrics.duration)}</Text>
        <Text>Samples: {metrics.totalSamples}</Text>
      </View>

      <LineChart
        data={{
          labels: [],
          datasets: [{ data: rmsHistory }],
        }}
        width={300}
        height={150}
        chartConfig={{
          color: () => '#4CAF50',
        }}
      />

      <View style={styles.uploadProgress}>
        <Text>Buffered: {metrics.bufferedFeatures}</Text>
        <Text>Uploaded: {metrics.uploadedFeatures}</Text>
        <ProgressBar
          progress={metrics.uploadedFeatures / (metrics.uploadedFeatures + metrics.bufferedFeatures)}
        />
      </View>
    </View>
  );
}
```

## API Reference

### useSessionRecording

```typescript
const {
  // Control methods
  startSession,          // (env?, consent?) => Promise<void>
  pauseSession,          // () => Promise<void>
  resumeSession,         // () => Promise<void>
  stopSession,           // () => Promise<string | null>
  uploadFeatures,        // () => Promise<void>

  // State
  sessionState,          // SessionState
  sessionId,             // string | null
  isRecording,           // boolean
  isPaused,              // boolean
  isIdle,                // boolean

  // Metrics
  metrics,               // SessionMetrics
  deviceStatus,          // DeviceStatus | null

  // Errors
  errors,                // SessionError[]
  lastError,             // SessionError | null
  clearErrors,           // () => void

  // Loading
  isStarting,            // boolean
  isStopping,            // boolean
  isPausingOrResuming,   // boolean

  // Instance
  recorder,              // SessionRecorder
} = useSessionRecording(options);
```

### Options

```typescript
interface UseSessionRecordingOptions {
  config?: Partial<SessionConfig>;
  autoStart?: boolean;
  defaultEnvironmentTag?: string;
  defaultConsentMode?: string;
  onStateChange?: (state: SessionState) => void;
  onMetricsUpdate?: (metrics: SessionMetrics) => void;
  onError?: (error: SessionError) => void;
  onFeatureExtracted?: (feature: FeatureData) => void;
}
```

### SessionConfig

```typescript
interface SessionConfig {
  featureExtractionInterval: number;  // default: 100
  bufferSize: number;                 // default: 1000
  uploadBatchSize: number;            // default: 100
  sampleRate: number;                 // default: 16000
  autoUpload: boolean;                // default: true
  syncDeviceStatus: boolean;          // default: true
}
```

### SessionMetrics

```typescript
interface SessionMetrics {
  duration: number;              // seconds
  totalSamples: number;          // count
  bufferedFeatures: number;      // count
  uploadedFeatures: number;      // count
  averageRMS: number;            // 0.0 - 1.0
  averageZCR: number;            // 0.0 - 1.0
  averageIntensity: number;      // dB
  averagePitch: number;          // Hz
}
```

## Helper Utilities

### Format Duration

```typescript
function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
```

### Format File Size

```typescript
function formatFeatureSize(featureCount: number): string {
  const bytes = featureCount * 4; // ~4 bytes per feature
  const kb = bytes / 1024;
  const mb = kb / 1024;

  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  if (kb >= 1) return `${kb.toFixed(2)} KB`;
  return `${bytes} bytes`;
}
```

### Get State Color

```typescript
function getStateColor(state: SessionState): string {
  switch (state) {
    case 'recording': return '#4CAF50';  // Green
    case 'paused': return '#FF9800';     // Orange
    case 'stopped': return '#F44336';    // Red
    default: return '#9E9E9E';           // Gray
  }
}
```

## Testing Your Integration

### Manual Testing Checklist

- [ ] Start session from UI
- [ ] Verify recording indicator appears
- [ ] Check real-time metrics update
- [ ] Pause and resume session
- [ ] Stop session and verify ID returned
- [ ] Check features uploaded to backend
- [ ] Test error handling (airplane mode)
- [ ] Verify cleanup on screen unmount
- [ ] Test BLE device synchronization
- [ ] Verify battery usage acceptable

### Automated Testing

```typescript
import { renderHook, act } from '@testing-library/react-hooks';
import { useSessionRecording } from '@/features/recording';

describe('useSessionRecording', () => {
  it('should start and stop session', async () => {
    const { result } = renderHook(() => useSessionRecording());

    expect(result.current.isIdle).toBe(true);

    await act(async () => {
      await result.current.startSession();
    });

    expect(result.current.isRecording).toBe(true);

    await act(async () => {
      await result.current.stopSession();
    });

    expect(result.current.isIdle).toBe(true);
  });
});
```

## Troubleshooting Integration

### Issue: Hook not updating

**Solution**: Ensure you're not recreating the recorder instance

```typescript
// ❌ Wrong - creates new instance each render
const recorder = new SessionRecorder();

// ✅ Correct - uses singleton
const { recorder } = useSessionRecording();
```

### Issue: Session not starting

**Solution**: Check permissions

```typescript
import { getAudioService } from '@/services/AudioService';

const audioService = getAudioService();
const hasPermission = await audioService.requestPermissions();

if (!hasPermission) {
  Alert.alert('Permission Required');
}
```

### Issue: Features not uploading

**Solution**: Verify network and API connectivity

```typescript
import { apiService } from '@/api/client';

// Test API connection
try {
  await apiService.getUserProfile(userId);
  console.log('API connected');
} catch (error) {
  console.error('API connection failed:', error);
}
```

## Best Practices

1. **Always handle async operations**
   ```typescript
   const handleStart = async () => {
     try {
       await startSession();
     } catch (error) {
       Alert.alert('Error', error.message);
     }
   };
   ```

2. **Show loading states**
   ```typescript
   <Button
     title={isStarting ? 'Starting...' : 'Start'}
     disabled={isStarting}
     onPress={handleStart}
   />
   ```

3. **Provide user feedback**
   ```typescript
   useEffect(() => {
     if (lastError) {
       Toast.show({
         type: 'error',
         text1: lastError.message,
       });
     }
   }, [lastError]);
   ```

4. **Clean up properly**
   ```typescript
   // The hook handles cleanup automatically
   // Just make sure to use it at component level, not conditionally
   ```

5. **Monitor performance**
   ```typescript
   useEffect(() => {
     const interval = setInterval(() => {
       console.log('Metrics:', metrics);
       // Monitor battery, memory, network
     }, 5000);

     return () => clearInterval(interval);
   }, [metrics]);
   ```

## Need Help?

- Check the [main README](./README.md) for detailed API documentation
- See [RecordingExample.tsx](./examples/RecordingExample.tsx) for a complete working example
- Review [SessionRecorder.ts](./SessionRecorder.ts) source code
- Contact the Tizzy development team

---

Happy Recording! 🎙️
