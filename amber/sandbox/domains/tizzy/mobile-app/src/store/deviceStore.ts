import { create } from 'zustand';
import { DeviceStatus, ConnectionState, SignalStrength } from '../services/BLEManager';

interface DeviceStore {
  // Connection state
  connectionState: ConnectionState;
  setConnectionState: (state: ConnectionState) => void;

  // Device status
  deviceStatus: DeviceStatus | null;
  setDeviceStatus: (status: DeviceStatus) => void;

  // Device info
  deviceId: string | null;
  setDeviceId: (id: string | null) => void;

  // Battery
  batteryLevel: number;
  setBatteryLevel: (level: number) => void;

  // Mute state
  muteState: 'unmuted' | 'muted' | 'self_only';
  setMuteState: (state: 'unmuted' | 'muted' | 'self_only') => void;

  // Haptics
  hapticsEnabled: boolean;
  setHapticsEnabled: (enabled: boolean) => void;

  // Session
  currentSessionId: string | null;
  setCurrentSessionId: (id: string | null) => void;

  // Signal strength
  rssi: number | null;
  signalStrength: SignalStrength;
  setSignalStrength: (rssi: number, strength: SignalStrength) => void;

  // Reset store
  reset: () => void;
}

const initialState = {
  connectionState: 'disconnected' as ConnectionState,
  deviceStatus: null,
  deviceId: null,
  batteryLevel: 100,
  muteState: 'unmuted' as 'unmuted' | 'muted' | 'self_only',
  hapticsEnabled: true,
  currentSessionId: null,
  rssi: null,
  signalStrength: 'poor' as SignalStrength,
};

export const useDeviceStore = create<DeviceStore>((set) => ({
  ...initialState,

  setConnectionState: (state) => set({ connectionState: state }),

  setDeviceStatus: (status) => set({
    deviceStatus: status,
    deviceId: status.device_id,
    batteryLevel: status.battery_level,
    muteState: status.mute_state,
    hapticsEnabled: status.haptics_enabled,
    currentSessionId: status.current_session_id,
  }),

  setDeviceId: (id) => set({ deviceId: id }),

  setBatteryLevel: (level) => set({ batteryLevel: level }),

  setMuteState: (state) => set({ muteState: state }),

  setHapticsEnabled: (enabled) => set({ hapticsEnabled: enabled }),

  setCurrentSessionId: (id) => set({ currentSessionId: id }),

  setSignalStrength: (rssi, strength) => set({ rssi, signalStrength: strength }),

  reset: () => set(initialState),
}));
