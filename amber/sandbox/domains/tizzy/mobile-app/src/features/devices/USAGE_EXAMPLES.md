# Usage Examples - Device Components

This document provides practical examples of how to use the device components and hooks.

## Basic Usage

### Using the Devices Screen

The main devices screen is automatically routed via Expo Router at `/devices` when placed in `app/(tabs)/devices.tsx`. No additional setup required!

```tsx
// The screen is accessible via tab navigation
// Users can tap the "Devices" tab to access the screen
```

### Using the useDevice Hook

```tsx
import { useDevice } from '@/features/devices/hooks';

function MyComponent() {
  const {
    scanForDevice,
    disconnect,
    sendHaptic,
    setMuteState,
    isScanning,
    error,
  } = useDevice();

  // Scan for devices
  const handleConnect = async () => {
    try {
      await scanForDevice();
      console.log('Connected successfully!');
    } catch (err) {
      console.error('Connection failed:', err);
    }
  };

  // Disconnect
  const handleDisconnect = async () => {
    await disconnect();
  };

  // Send haptic feedback
  const handleHaptic = async () => {
    await sendHaptic('double_pulse');
  };

  // Set mute state
  const handleMute = async () => {
    await setMuteState('muted');
  };

  return (
    <View>
      <Button onPress={handleConnect} disabled={isScanning}>
        {isScanning ? 'Scanning...' : 'Connect'}
      </Button>
      {error && <Text style={{ color: 'red' }}>{error}</Text>}
    </View>
  );
}
```

### Using DeviceCard

```tsx
import { DeviceCard } from '@/features/devices/components';
import { useDeviceStore } from '@/store/deviceStore';

function MyDeviceView() {
  const { deviceStatus, connectionState } = useDeviceStore();

  if (!deviceStatus) return null;

  return (
    <DeviceCard
      deviceStatus={deviceStatus}
      connectionState={connectionState}
      onPress={() => console.log('Device card pressed')}
    />
  );
}
```

### Using BatteryIndicator

```tsx
import { BatteryIndicator } from '@/features/devices/components';

function BatteryDisplay() {
  return (
    <View>
      {/* Small size, no percentage */}
      <BatteryIndicator
        level={85}
        charging={false}
        size="small"
        showPercentage={false}
      />

      {/* Medium size with percentage (default) */}
      <BatteryIndicator
        level={45}
        charging={true}
      />

      {/* Large size with percentage */}
      <BatteryIndicator
        level={15}
        charging={false}
        size="large"
        showPercentage={true}
      />

      {/* Low battery warning */}
      <BatteryIndicator
        level={10}
        charging={false}
      />
    </View>
  );
}
```

### Using ConnectionStatus

```tsx
import { ConnectionStatus } from '@/features/devices/components';
import { useDeviceStore } from '@/store/deviceStore';

function StatusDisplay() {
  const { connectionState } = useDeviceStore();

  return (
    <View>
      {/* Full display mode */}
      <ConnectionStatus state={connectionState} />

      {/* Compact mode */}
      <ConnectionStatus state={connectionState} compact />
    </View>
  );
}
```

## Advanced Usage

### Custom Device List with DeviceCard

```tsx
import { DeviceCard } from '@/features/devices/components';
import { ScrollView } from 'react-native';

function DeviceList({ devices }) {
  return (
    <ScrollView>
      {devices.map((device) => (
        <DeviceCard
          key={device.device_id}
          deviceStatus={device}
          connectionState="connected"
          onPress={() => handleDevicePress(device)}
        />
      ))}
    </ScrollView>
  );
}
```

### Real-time Battery Monitoring

```tsx
import { useEffect } from 'react';
import { useDeviceStore } from '@/store/deviceStore';
import { BatteryIndicator } from '@/features/devices/components';

function BatteryMonitor() {
  const { batteryLevel, deviceStatus } = useDeviceStore();

  useEffect(() => {
    if (batteryLevel < 20 && !deviceStatus?.battery_charging) {
      // Show low battery alert
      Alert.alert(
        'Low Battery',
        'Your Tizzy device battery is below 20%. Please charge soon.',
        [{ text: 'OK' }]
      );
    }
  }, [batteryLevel, deviceStatus]);

  return (
    <BatteryIndicator
      level={batteryLevel}
      charging={deviceStatus?.battery_charging}
    />
  );
}
```

### Connection State Monitoring

```tsx
import { useEffect } from 'react';
import { useDeviceStore } from '@/store/deviceStore';
import { ConnectionStatus } from '@/features/devices/components';

function ConnectionMonitor() {
  const { connectionState } = useDeviceStore();

  useEffect(() => {
    console.log('Connection state changed:', connectionState);

    if (connectionState === 'connected') {
      // Device connected - enable features
      enableRecordingFeatures();
    } else if (connectionState === 'disconnected') {
      // Device disconnected - disable features
      disableRecordingFeatures();
    }
  }, [connectionState]);

  return <ConnectionStatus state={connectionState} compact />;
}
```

### Custom Haptic Patterns

```tsx
import { useDevice } from '@/features/devices/hooks';

function HapticControls() {
  const { sendHaptic } = useDevice();

  const patterns = [
    { id: 'single', label: 'Single Tap', pattern: 'single_pulse' },
    { id: 'double', label: 'Double Tap', pattern: 'double_pulse' },
    { id: 'long', label: 'Long Press', pattern: 'long_pulse' },
  ];

  return (
    <View>
      {patterns.map(({ id, label, pattern }) => (
        <Button
          key={id}
          title={label}
          onPress={() => sendHaptic(pattern)}
        />
      ))}
    </View>
  );
}
```

### Mute State Controls

```tsx
import { useDevice } from '@/features/devices/hooks';
import { useDeviceStore } from '@/store/deviceStore';

function MuteControls() {
  const { setMuteState } = useDevice();
  const { muteState } = useDeviceStore();

  const handleMuteChange = async (newState) => {
    try {
      await setMuteState(newState);
      console.log('Mute state updated:', newState);
    } catch (err) {
      console.error('Failed to update mute state:', err);
    }
  };

  return (
    <View>
      <Button
        title="Unmuted"
        onPress={() => handleMuteChange('unmuted')}
        disabled={muteState === 'unmuted'}
      />
      <Button
        title="Muted"
        onPress={() => handleMuteChange('muted')}
        disabled={muteState === 'muted'}
      />
      <Button
        title="Self Only"
        onPress={() => handleMuteChange('self_only')}
        disabled={muteState === 'self_only'}
      />
    </View>
  );
}
```

### Device Status Polling

```tsx
import { useEffect } from 'react';
import { useDevice } from '@/features/devices/hooks';
import { useDeviceStore } from '@/store/deviceStore';

function DeviceStatusMonitor() {
  const { readDeviceStatus } = useDevice();
  const { connectionState, deviceStatus } = useDeviceStore();

  // Poll device status every 30 seconds when connected
  useEffect(() => {
    if (connectionState !== 'connected') return;

    const interval = setInterval(() => {
      readDeviceStatus();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [connectionState, readDeviceStatus]);

  return (
    <View>
      {deviceStatus && (
        <>
          <Text>Firmware: {deviceStatus.firmware_version}</Text>
          <Text>Uptime: {deviceStatus.uptime_seconds}s</Text>
          <Text>Storage: {deviceStatus.storage_used_mb}MB used</Text>
        </>
      )}
    </View>
  );
}
```

### Conditional Rendering Based on Connection State

```tsx
import { useDeviceStore } from '@/store/deviceStore';
import { ConnectionStatus, DeviceCard } from '@/features/devices/components';

function ConditionalDeviceView() {
  const { connectionState, deviceStatus } = useDeviceStore();

  if (connectionState === 'disconnected') {
    return (
      <View>
        <ConnectionStatus state="disconnected" />
        <Text>Please connect your Tizzy device</Text>
        <Button title="Connect" onPress={handleConnect} />
      </View>
    );
  }

  if (connectionState === 'connecting' || connectionState === 'discovering') {
    return (
      <View>
        <ConnectionStatus state={connectionState} />
        <Text>Connecting to your device...</Text>
      </View>
    );
  }

  if (connectionState === 'connected' && deviceStatus) {
    return (
      <View>
        <ConnectionStatus state="connected" compact />
        <DeviceCard
          deviceStatus={deviceStatus}
          connectionState="connected"
        />
      </View>
    );
  }

  return null;
}
```

## Integration Examples

### Using in a Settings Screen

```tsx
import { View, Text, Switch } from 'react-native';
import { useDevice } from '@/features/devices/hooks';
import { useDeviceStore } from '@/store/deviceStore';
import { BatteryIndicator } from '@/features/devices/components';

function SettingsScreen() {
  const { setMuteState } = useDevice();
  const { deviceStatus, muteState } = useDeviceStore();

  if (!deviceStatus) {
    return <Text>No device connected</Text>;
  }

  return (
    <View>
      <View style={styles.row}>
        <Text>Battery</Text>
        <BatteryIndicator
          level={deviceStatus.battery_level}
          charging={deviceStatus.battery_charging}
        />
      </View>

      <View style={styles.row}>
        <Text>Mute Device</Text>
        <Switch
          value={muteState === 'muted'}
          onValueChange={(value) =>
            setMuteState(value ? 'muted' : 'unmuted')
          }
        />
      </View>

      <View style={styles.row}>
        <Text>Haptics</Text>
        <Switch value={deviceStatus.haptics_enabled} />
      </View>
    </View>
  );
}
```

### Using in a Header

```tsx
import { View } from 'react-native';
import { ConnectionStatus } from '@/features/devices/components';
import { useDeviceStore } from '@/store/deviceStore';

function AppHeader() {
  const { connectionState } = useDeviceStore();

  return (
    <View style={styles.header}>
      <Text style={styles.title}>Tizzy</Text>
      <ConnectionStatus state={connectionState} compact />
    </View>
  );
}
```

### Using with Navigation

```tsx
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useDeviceStore } from '@/store/deviceStore';

function RequireDevice({ children }) {
  const router = useRouter();
  const { connectionState } = useDeviceStore();

  useEffect(() => {
    if (connectionState === 'disconnected') {
      // Redirect to devices screen if not connected
      router.push('/devices');
    }
  }, [connectionState, router]);

  if (connectionState !== 'connected') {
    return null;
  }

  return children;
}

// Usage
function RecordingScreen() {
  return (
    <RequireDevice>
      <RecordingInterface />
    </RequireDevice>
  );
}
```

## Error Handling Examples

### Handling Connection Errors

```tsx
import { useState } from 'react';
import { useDevice } from '@/features/devices/hooks';

function ConnectWithErrorHandling() {
  const { scanForDevice, error } = useDevice();
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await scanForDevice();
      Alert.alert('Success', 'Connected to your Tizzy device!');
    } catch (err) {
      // Error is already set in the hook's state
      Alert.alert(
        'Connection Failed',
        error || 'Could not connect to device',
        [
          { text: 'Retry', onPress: handleConnect },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Button
      title={isConnecting ? 'Connecting...' : 'Connect'}
      onPress={handleConnect}
      disabled={isConnecting}
    />
  );
}
```

### Retry Logic

```tsx
import { useState } from 'react';
import { useDevice } from '@/features/devices/hooks';

function ConnectWithRetry() {
  const { scanForDevice } = useDevice();
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;

  const handleConnectWithRetry = async () => {
    for (let i = 0; i < maxRetries; i++) {
      try {
        setRetryCount(i + 1);
        await scanForDevice();
        setRetryCount(0);
        return; // Success
      } catch (err) {
        if (i === maxRetries - 1) {
          Alert.alert('Error', 'Could not connect after 3 attempts');
        }
        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  };

  return (
    <View>
      <Button title="Connect" onPress={handleConnectWithRetry} />
      {retryCount > 0 && (
        <Text>Attempt {retryCount} of {maxRetries}...</Text>
      )}
    </View>
  );
}
```

## Testing Examples

### Component Testing

```tsx
import { render } from '@testing-library/react-native';
import { BatteryIndicator } from '@/features/devices/components';

describe('BatteryIndicator', () => {
  it('shows correct color for different battery levels', () => {
    // High battery - green
    const { rerender } = render(<BatteryIndicator level={75} />);
    // Check for green color

    // Medium battery - yellow
    rerender(<BatteryIndicator level={35} />);
    // Check for yellow color

    // Low battery - red
    rerender(<BatteryIndicator level={15} />);
    // Check for red color
  });

  it('shows charging indicator when charging', () => {
    const { getByText } = render(
      <BatteryIndicator level={50} charging={true} />
    );
    expect(getByText('⚡')).toBeTruthy();
  });
});
```

### Hook Testing

```tsx
import { renderHook, waitFor } from '@testing-library/react-native';
import { useDevice } from '@/features/devices/hooks';

describe('useDevice', () => {
  it('initializes BLE on mount', async () => {
    const { result } = renderHook(() => useDevice());

    await waitFor(() => {
      expect(result.current.isScanning).toBe(false);
    });
  });

  it('handles scan errors', async () => {
    const { result } = renderHook(() => useDevice());

    await expect(result.current.scanForDevice()).rejects.toThrow();
    expect(result.current.error).toBeTruthy();
  });
});
```

## Best Practices

1. **Always check connection state before device operations**
2. **Use error boundaries for component-level error handling**
3. **Implement retry logic for critical operations**
4. **Clean up subscriptions and intervals on unmount**
5. **Provide user feedback for all async operations**
6. **Handle edge cases (low battery, disconnection, etc.)**
7. **Use TypeScript for type safety**
8. **Test all connection states and error scenarios**
