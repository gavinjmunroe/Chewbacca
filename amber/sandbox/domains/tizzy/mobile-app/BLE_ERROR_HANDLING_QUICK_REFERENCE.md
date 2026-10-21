# BLE Error Handling - Quick Reference Guide

## For UI Developers

### Listen to BLE Errors
```typescript
import { getBLEManager } from '@/services/BLEManager';

const bleManager = getBLEManager();

// Subscribe to errors
const unsubscribe = bleManager.onError((error) => {
  // Show user-facing error message
  Alert.alert('Connection Error', error.message);

  // Check if recoverable
  if (error.recoverable) {
    // Show "Reconnecting..." indicator
  } else {
    // Show "Try Again" button
  }
});

// Clean up when component unmounts
return () => unsubscribe();
```

### Display Reconnection Status
```typescript
const status = bleManager.getReconnectionStatus();

// Show in UI:
// "Reconnecting... (attempt 2 of 5)"
if (status.isReconnecting) {
  return `Reconnecting... (attempt ${status.attempts} of ${status.maxAttempts})`;
}
```

### Manual Reconnection After Failure
```typescript
const handleRetryConnection = async () => {
  // Reset the reconnection state
  bleManager.resetReconnectionState();

  // Start a new scan
  try {
    await bleManager.scanForDevice();
    // Success!
  } catch (error) {
    // Show error to user
  }
};
```

## For SessionRecorder Users

### Listen to Session Errors
```typescript
import { getSessionRecorder } from '@/features/recording/SessionRecorder';

const recorder = getSessionRecorder();

// Subscribe to errors
const unsubscribe = recorder.onError((error) => {
  // Filter for BLE errors
  if (error.type === 'ble') {
    console.log('BLE error during session:', error.message);

    // Show appropriate UI
    if (!error.recoverable) {
      Alert.alert(
        'Device Connection Lost',
        'Your session has been paused. Please reconnect your device.',
        [{ text: 'OK' }]
      );
    }
  }
});

// Clean up
return () => unsubscribe();
```

## Error Types Reference

### BLE Error Types
| Type | User Message | Recoverable | Action |
|------|-------------|-------------|--------|
| `bluetooth_off` | "Bluetooth is turned off" | Yes | Prompt user to enable Bluetooth |
| `permission_denied` | "Bluetooth permission denied" | No | Direct to settings |
| `device_not_found` | "Device not found" | Yes | Show "Retry" button |
| `connection_lost` | "Connection lost" | Yes | Auto-reconnects (show progress) |
| `pairing_failed` | "Device pairing failed" | Yes | Show "Retry" button |
| `unsupported` | "Bluetooth not supported" | No | Show error, disable feature |

### Session Error Types
| Type | Example | Action |
|------|---------|--------|
| `ble` | Device sync failed | Show warning, continue session |
| `audio` | Microphone access denied | Stop session, show error |
| `network` | Upload failed | Retry upload |
| `feature_extraction` | Processing error | Log error, continue |
| `upload` | Server error | Retry with backoff |

## Common Patterns

### Pattern 1: Connection Status Indicator
```typescript
const [connectionState, setConnectionState] = useState('disconnected');
const [connectionError, setConnectionError] = useState<string | null>(null);

useEffect(() => {
  const bleManager = getBLEManager();

  // Listen to state changes
  const stateUnsub = bleManager.onConnectionStateChange((state) => {
    setConnectionState(state);
  });

  // Listen to errors
  const errorUnsub = bleManager.onError((error) => {
    setConnectionError(error.message);
  });

  return () => {
    stateUnsub();
    errorUnsub();
  };
}, []);

// In your component:
{connectionState === 'connected' ? (
  <Text>✓ Connected</Text>
) : connectionError ? (
  <Text>⚠ {connectionError}</Text>
) : (
  <Text>○ Disconnected</Text>
)}
```

### Pattern 2: Auto-Reconnecting with Progress
```typescript
const [reconnectStatus, setReconnectStatus] = useState(null);

useEffect(() => {
  const bleManager = getBLEManager();

  const interval = setInterval(() => {
    const status = bleManager.getReconnectionStatus();
    setReconnectStatus(status);
  }, 500);

  return () => clearInterval(interval);
}, []);

// In your component:
{reconnectStatus?.isReconnecting && (
  <View>
    <ActivityIndicator />
    <Text>
      Reconnecting... (attempt {reconnectStatus.attempts} of {reconnectStatus.maxAttempts})
    </Text>
  </View>
)}
```

### Pattern 3: Manual Retry Button
```typescript
const [isRetrying, setIsRetrying] = useState(false);

const handleRetry = async () => {
  setIsRetrying(true);

  const bleManager = getBLEManager();
  bleManager.resetReconnectionState();

  try {
    await bleManager.scanForDevice(30000);
    // Success!
  } catch (error) {
    Alert.alert('Connection Failed', error.message);
  } finally {
    setIsRetrying(false);
  }
};

// In your component:
<Button
  title={isRetrying ? 'Connecting...' : 'Retry Connection'}
  onPress={handleRetry}
  disabled={isRetrying}
/>
```

### Pattern 4: Session Recording with BLE Error Handling
```typescript
const [sessionState, setSessionState] = useState('idle');
const [sessionError, setSessionError] = useState<string | null>(null);

useEffect(() => {
  const recorder = getSessionRecorder();

  // Listen to state changes
  const stateUnsub = recorder.onStateChange((state) => {
    setSessionState(state);
  });

  // Listen to errors
  const errorUnsub = recorder.onError((error) => {
    if (error.type === 'ble') {
      setSessionError(error.message);

      // Show notification if session was paused
      if (!error.recoverable && sessionState === 'paused') {
        Alert.alert(
          'Device Disconnected',
          'Your session has been paused. Reconnect to continue.',
          [
            { text: 'Stop Session', onPress: () => recorder.stopSession() },
            { text: 'Wait', style: 'cancel' }
          ]
        );
      }
    }
  });

  return () => {
    stateUnsub();
    errorUnsub();
  };
}, [sessionState]);
```

## Best Practices

### DO ✓
- Always subscribe to error callbacks
- Show clear, actionable error messages to users
- Check `recoverable` flag before showing "Retry" option
- Clean up subscriptions when components unmount
- Reset reconnection state before manual retry
- Show reconnection progress to users

### DON'T ✗
- Don't ignore BLE errors silently
- Don't retry indefinitely without user intervention
- Don't show technical error messages to users
- Don't forget to unsubscribe from callbacks
- Don't retry without calling `resetReconnectionState()`
- Don't block UI during automatic reconnection

## Debugging Tips

### Enable Verbose Logging
Check console for detailed BLE logs:
- `[BLE]` prefix for all BLE operations
- `[SessionRecorder]` prefix for session operations

### Check Error Tracking
All errors are sent to ErrorTracking with:
- Breadcrumbs for operation history
- Full context (component, operation, data)
- Error classification

### Common Issues and Solutions

**Issue**: "Device not found" repeatedly
- **Check**: Bluetooth is enabled
- **Check**: Device is powered on and in range
- **Check**: Device is not paired to another phone

**Issue**: Connection drops immediately after connecting
- **Check**: Device battery level
- **Check**: Signal strength (RSSI)
- **Check**: Other Bluetooth devices nearby (interference)

**Issue**: Write operations timeout
- **Check**: Device is responding (may need restart)
- **Check**: Characteristic UUIDs are correct
- **Check**: Connection is actually established

**Issue**: Reconnection never succeeds
- **Check**: Max attempts not exceeded
- **Check**: `shouldAttemptReconnect` is true
- **Action**: Call `resetReconnectionState()` to reset

## API Reference

### BLEManager Methods

```typescript
// Get singleton instance
const bleManager = getBLEManager();

// Connection management
await bleManager.initialize();
await bleManager.scanForDevice(timeoutMs?: number);
await bleManager.disconnect();

// Operations
await bleManager.sendCommand(command: string, parameters?: any);
await bleManager.readDeviceStatus();
await bleManager.sendHaptic(pattern: 'single_pulse' | 'double_pulse' | 'long_pulse');
await bleManager.setMuteState(state: 'unmuted' | 'muted' | 'self_only');

// State queries
bleManager.getConnectionState(); // 'disconnected' | 'connecting' | 'connected' | 'discovering' | 'error'
bleManager.getReconnectionStatus(); // { isReconnecting, attempts, maxAttempts, shouldAttemptReconnect }
bleManager.getLastError(); // BLEError | null
bleManager.getRSSI(); // number | null
bleManager.getSignalStrength(); // 'poor' | 'fair' | 'good' | 'excellent'

// Recovery
bleManager.resetReconnectionState(); // Reset for manual retry
bleManager.clearError(); // Clear last error

// Callbacks (all return unsubscribe function)
bleManager.onConnectionStateChange(callback);
bleManager.onError(callback);
bleManager.onDeviceStatus(callback);
bleManager.onFeatureData(callback);
bleManager.onSignalStrengthChange(callback);

// Cleanup
await bleManager.destroy();
```

### SessionRecorder Methods

```typescript
// Get singleton instance
const recorder = getSessionRecorder(config?: Partial<SessionConfig>);

// Session management
await recorder.startSession(environmentTag?: string, consentMode?: string);
await recorder.pauseSession();
await recorder.resumeSession();
await recorder.stopSession(); // Returns session ID

// State queries
recorder.getState(); // 'idle' | 'recording' | 'paused' | 'stopped'
recorder.getSessionId(); // string | null
recorder.getMetrics(); // SessionMetrics
recorder.getDeviceStatus(); // DeviceStatus | null
recorder.getErrors(); // SessionError[]

// Callbacks (all return unsubscribe function)
recorder.onStateChange(callback);
recorder.onMetricsUpdate(callback);
recorder.onError(callback);
recorder.onFeatureExtracted(callback);

// Cleanup
await recorder.cleanup();
```

## Example: Complete Connection Flow with Error Handling

```typescript
import React, { useState, useEffect } from 'react';
import { View, Text, Button, Alert, ActivityIndicator } from 'react-native';
import { getBLEManager } from '@/services/BLEManager';

export function BLEConnectionManager() {
  const [connectionState, setConnectionState] = useState('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [reconnectStatus, setReconnectStatus] = useState(null);

  useEffect(() => {
    const bleManager = getBLEManager();

    // Subscribe to state changes
    const stateUnsub = bleManager.onConnectionStateChange(setConnectionState);

    // Subscribe to errors
    const errorUnsub = bleManager.onError((bleError) => {
      setError(bleError.message);

      if (!bleError.recoverable) {
        Alert.alert('Connection Error', bleError.message);
      }
    });

    // Poll reconnection status
    const interval = setInterval(() => {
      setReconnectStatus(bleManager.getReconnectionStatus());
    }, 500);

    return () => {
      stateUnsub();
      errorUnsub();
      clearInterval(interval);
    };
  }, []);

  const handleConnect = async () => {
    const bleManager = getBLEManager();
    bleManager.resetReconnectionState();
    setError(null);

    try {
      await bleManager.initialize();
      await bleManager.scanForDevice();
    } catch (err) {
      console.error('Connection failed:', err);
    }
  };

  const handleDisconnect = async () => {
    const bleManager = getBLEManager();
    await bleManager.disconnect();
  };

  return (
    <View style={{ padding: 20 }}>
      <Text>Status: {connectionState}</Text>

      {error && <Text style={{ color: 'red' }}>Error: {error}</Text>}

      {reconnectStatus?.isReconnecting && (
        <View style={{ marginVertical: 10 }}>
          <ActivityIndicator />
          <Text>
            Reconnecting... (attempt {reconnectStatus.attempts} of {reconnectStatus.maxAttempts})
          </Text>
        </View>
      )}

      {connectionState === 'connected' ? (
        <Button title="Disconnect" onPress={handleDisconnect} />
      ) : (
        <Button title="Connect Device" onPress={handleConnect} />
      )}
    </View>
  );
}
```
