# Devices Feature - Tizzy Mobile App

This directory contains all the UI components and logic for device pairing, connection management, and device status monitoring in the Tizzy mobile app.

## Overview

The devices feature provides a complete interface for:
- Scanning and connecting to Tizzy wearable devices via Bluetooth
- Displaying real-time device status and battery levels
- Managing device connections
- Monitoring connection state and signal strength
- Displaying device settings and configuration

## File Structure

```
src/features/devices/
├── components/
│   ├── BatteryIndicator.tsx    # Battery level indicator with charging state
│   ├── ConnectionStatus.tsx    # Connection state badge/indicator
│   ├── DeviceCard.tsx          # Main device information card
│   └── index.ts                # Component exports
├── hooks/
│   ├── useDevice.ts            # Main device management hook
│   └── index.ts                # Hook exports
└── README.md                   # This file
```

## Main Screen

**Location:** `/app/(tabs)/devices.tsx`

The main devices screen provides:
- Connection status overview
- Device card with detailed information
- Connect/disconnect buttons
- Pull-to-refresh functionality
- Error handling and user feedback
- Troubleshooting help section

## Components

### DeviceCard

A comprehensive card component that displays all device information.

**Props:**
```typescript
interface DeviceCardProps {
  deviceStatus: DeviceStatus;      // Device status from BLEManager
  connectionState: ConnectionState; // Current connection state
  onPress?: () => void;             // Optional press handler
}
```

**Features:**
- Device name and ID
- Battery indicator with charging state
- Firmware version
- Storage usage with progress bar
- Device uptime
- Last sync timestamp
- Mute state and haptics status
- Recording session indicator
- Signal strength visualization

### ConnectionStatus

A status badge showing the current connection state.

**Props:**
```typescript
interface ConnectionStatusProps {
  state: ConnectionState;  // Connection state from BLEManager
  compact?: boolean;       // Use compact layout (default: false)
}
```

**States:**
- `connected` - Green badge with checkmark
- `connecting` - Yellow badge with spinner
- `discovering` - Blue badge with spinner
- `disconnected` - Gray badge with X

### BatteryIndicator

A visual battery level indicator with charging state support.

**Props:**
```typescript
interface BatteryIndicatorProps {
  level: number;           // Battery level 0-100
  charging?: boolean;      // Is device charging
  size?: 'small' | 'medium' | 'large';
  showPercentage?: boolean; // Show percentage text
}
```

**Features:**
- Color-coded battery levels (green > 50%, yellow > 20%, red ≤ 20%)
- Charging indicator with lightning bolt icon
- Low battery warning indicator
- Customizable sizes
- Optional percentage display

## Hooks

### useDevice

The main hook for device management and BLE operations.

**Usage:**
```typescript
const {
  // Connection management
  scanForDevice,
  disconnect,

  // Device operations
  sendHaptic,
  setMuteState,
  readDeviceStatus,

  // State
  isScanning,
  error,

  // BLE Manager instance
  bleManager,
} = useDevice();
```

**Features:**
- Automatic BLE initialization
- Permission handling
- Connection state management
- Device status synchronization
- Error handling
- Real-time updates via Zustand store

**Methods:**

- `scanForDevice(): Promise<void>` - Scan for and connect to Tizzy device
- `disconnect(): Promise<void>` - Disconnect from current device
- `sendHaptic(pattern): Promise<void>` - Send haptic feedback command
- `setMuteState(state): Promise<void>` - Set device mute state
- `readDeviceStatus(): Promise<DeviceStatus>` - Read current device status

## State Management

The devices feature uses Zustand for state management via `useDeviceStore`:

```typescript
const {
  connectionState,   // Current connection state
  deviceStatus,      // Latest device status
  deviceId,          // Connected device ID
  batteryLevel,      // Battery level
  muteState,         // Mute state
  hapticsEnabled,    // Haptics enabled
  currentSessionId,  // Active session ID
} = useDeviceStore();
```

## Integration with BLEManager

All Bluetooth operations are handled through the `TizzyBLEManager` service:

- Singleton instance accessed via `getBLEManager()`
- Handles scanning, connection, and data transfer
- Provides callbacks for real-time updates
- Manages reconnection logic
- Implements proper cleanup

## User Experience Features

### Loading States
- Scanning spinner while searching for devices
- Discovering spinner during service discovery
- Button loading indicators

### Empty States
- "No Device Connected" when disconnected
- Helpful icon and message
- Clear call-to-action button

### Error Handling
- Alert dialogs for connection errors
- Inline error messages
- User-friendly error text

### Real-time Updates
- Connection state changes
- Battery level updates
- Device status synchronization
- Session recording indicators

### Pull-to-Refresh
- Refresh device list by pulling down
- Re-scan for devices
- Update connection status

### Disconnect Confirmation
- Alert dialog before disconnecting
- Prevents accidental disconnections
- Clear destructive action styling

## Troubleshooting Section

The devices screen includes a built-in troubleshooting guide with:
1. Bluetooth permission check
2. Device power and charging reminder
3. Range requirements (30 feet)
4. Restart suggestions

## Styling

All components use a consistent design system:
- **Colors:**
  - Connected: #4CAF50 (Green)
  - Connecting: #FFC107 (Yellow/Orange)
  - Discovering: #2196F3 (Blue)
  - Disconnected: #9E9E9E (Gray)
  - Error: #F44336 (Red)
  - Background: #f5f5f5 (Light Gray)

- **Spacing:** Consistent 16px padding and margins
- **Shadows:** Subtle elevation for cards
- **Typography:** System fonts with clear hierarchy

## Testing Considerations

When testing the devices feature:

1. **Bluetooth Permissions:** Ensure permissions are granted
2. **Device Availability:** Have a Tizzy device powered on and nearby
3. **Connection States:** Test all connection state transitions
4. **Error Cases:** Test timeout, permission denied, Bluetooth off
5. **Reconnection:** Test automatic reconnection after disconnect
6. **Battery States:** Test various battery levels and charging states
7. **Pull-to-Refresh:** Verify refresh functionality
8. **Long Device Names/IDs:** Test UI with edge cases

## Future Enhancements

Potential improvements:
- Device pairing history
- Multiple device support
- Device nickname/customization
- Connection quality metrics
- Firmware update UI
- Advanced device diagnostics
- Battery usage graphs
- Connection stability indicators

## Dependencies

- `react-native-ble-plx` - Bluetooth Low Energy library
- `zustand` - State management
- `expo-router` - Navigation (tabs)
- React Native core components

## Related Files

- `/src/services/BLEManager.ts` - BLE service implementation
- `/src/store/deviceStore.ts` - Zustand device state store
- `/app/(tabs)/devices.tsx` - Main devices screen
