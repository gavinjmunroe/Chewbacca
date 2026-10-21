import { useEffect, useState, useCallback } from 'react';
import { getBLEManager, DeviceStatus, ConnectionState, SignalStrength } from '../../../services/BLEManager';
import { useDeviceStore } from '../../../store/deviceStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../../../shared/constants';

interface UseDeviceReturn {
  // Connection management
  scanForDevice: () => Promise<void>;
  disconnect: () => Promise<void>;

  // Device operations
  sendHaptic: (pattern: 'single_pulse' | 'double_pulse' | 'long_pulse') => Promise<void>;
  setMuteState: (state: 'unmuted' | 'muted' | 'self_only') => Promise<void>;
  readDeviceStatus: () => Promise<DeviceStatus | null>;

  // State
  isScanning: boolean;
  error: string | null;

  // BLE Manager instance (for advanced usage)
  bleManager: ReturnType<typeof getBLEManager> | null;
}

export function useDevice(): UseDeviceReturn {
  const [bleManager, setBleManager] = useState<ReturnType<typeof getBLEManager> | null>(null);
  const {
    setConnectionState,
    setDeviceStatus,
    setSignalStrength,
    reset,
  } = useDeviceStore();

  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize BLE Manager and setup listeners
  useEffect(() => {
    let isMounted = true;

    const initializeBLE = async () => {
      try {
        // Check for demo mode first
        const isDemoMode = await AsyncStorage.getItem(STORAGE_KEYS.DEMO_MODE);
        if (isDemoMode === 'true') {
          console.log('[useDevice] Demo mode detected, skipping BLE initialization');
          return;
        }

        console.log('[useDevice] Initializing BLE Manager');
        const manager = getBLEManager();
        setBleManager(manager);

        // Request permissions
        const hasPermissions = await manager.requestPermissions();
        if (!hasPermissions) {
          setError('Bluetooth permissions not granted');
          return;
        }

        // Initialize BLE
        await manager.initialize();

        if (isMounted) {
          console.log('[useDevice] BLE Manager initialized successfully');
        }
      } catch (err) {
        console.error('[useDevice] BLE initialization error:', err);
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to initialize Bluetooth');
        }
      }
    };

    initializeBLE();

    // Cleanup on unmount
    return () => {
      isMounted = false;
    };
  }, [setConnectionState, setDeviceStatus, setSignalStrength]);

  // Setup listeners when bleManager is available
  useEffect(() => {
    if (!bleManager) return;

    // Setup connection state listener
    const unsubscribeConnectionState = bleManager.onConnectionStateChange((state: ConnectionState) => {
      console.log('[useDevice] Connection state changed:', state);
      setConnectionState(state);

      // Clear error when successfully connected
      if (state === 'connected') {
        setError(null);
      }
    });

    // Setup device status listener
    const unsubscribeDeviceStatus = bleManager.onDeviceStatus((status: DeviceStatus) => {
      console.log('[useDevice] Device status updated:', status);
      setDeviceStatus(status);
    });

    // Setup signal strength listener
    const unsubscribeSignalStrength = bleManager.onSignalStrengthChange((rssi: number, strength: SignalStrength) => {
      console.log('[useDevice] Signal strength updated:', strength, 'RSSI:', rssi);
      setSignalStrength(rssi, strength);
    });

    // Cleanup on unmount or when bleManager changes
    return () => {
      unsubscribeConnectionState();
      unsubscribeDeviceStatus();
      unsubscribeSignalStrength();
    };
  }, [bleManager, setConnectionState, setDeviceStatus, setSignalStrength]);

  // Scan for and connect to device
  const scanForDevice = useCallback(async () => {
    if (!bleManager) {
      setError('BLE not available in demo mode');
      return;
    }

    try {
      setIsScanning(true);
      setError(null);

      console.log('[useDevice] Starting device scan');
      await bleManager.scanForDevice(30000); // 30 second timeout

      console.log('[useDevice] Device scan completed successfully');
    } catch (err) {
      console.error('[useDevice] Scan error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect to device';
      setError(errorMessage);
      throw err;
    } finally {
      setIsScanning(false);
    }
  }, [bleManager]);

  // Disconnect from device
  const disconnect = useCallback(async () => {
    if (!bleManager) {
      setError('BLE not available in demo mode');
      return;
    }

    try {
      setError(null);
      console.log('[useDevice] Disconnecting from device');

      await bleManager.disconnect();
      reset(); // Reset store state

      console.log('[useDevice] Disconnected successfully');
    } catch (err) {
      console.error('[useDevice] Disconnect error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to disconnect';
      setError(errorMessage);
      throw err;
    }
  }, [bleManager, reset]);

  // Send haptic feedback
  const sendHaptic = useCallback(
    async (pattern: 'single_pulse' | 'double_pulse' | 'long_pulse') => {
      if (!bleManager) {
        setError('BLE not available in demo mode');
        return;
      }

      try {
        setError(null);
        console.log('[useDevice] Sending haptic:', pattern);

        await bleManager.sendHaptic(pattern);

        console.log('[useDevice] Haptic sent successfully');
      } catch (err) {
        console.error('[useDevice] Haptic error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to send haptic feedback';
        setError(errorMessage);
        throw err;
      }
    },
    [bleManager]
  );

  // Set mute state
  const setMuteState = useCallback(
    async (state: 'unmuted' | 'muted' | 'self_only') => {
      if (!bleManager) {
        setError('BLE not available in demo mode');
        return;
      }

      try {
        setError(null);
        console.log('[useDevice] Setting mute state:', state);

        await bleManager.setMuteState(state);

        console.log('[useDevice] Mute state set successfully');
      } catch (err) {
        console.error('[useDevice] Mute state error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to set mute state';
        setError(errorMessage);
        throw err;
      }
    },
    [bleManager]
  );

  // Read device status
  const readDeviceStatus = useCallback(async (): Promise<DeviceStatus | null> => {
    if (!bleManager) {
      setError('BLE not available in demo mode');
      return null;
    }

    try {
      setError(null);
      console.log('[useDevice] Reading device status');

      const status = await bleManager.readDeviceStatus();
      setDeviceStatus(status);

      console.log('[useDevice] Device status read successfully');
      return status;
    } catch (err) {
      console.error('[useDevice] Read status error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to read device status';
      setError(errorMessage);
      return null;
    }
  }, [bleManager, setDeviceStatus]);

  return {
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

    // BLE Manager
    bleManager,
  };
}
