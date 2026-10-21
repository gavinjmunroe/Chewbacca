import { BleManager, Device, State, Characteristic, BleError } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { classifyError, logError } from '../shared/utils/errorHandling';
import * as ErrorTracking from './ErrorTracking';

// Tizzy BLE Service and Characteristics UUIDs (from technical spec)
// Timeout constants
const BLE_SCAN_TIMEOUT = 30000; // 30 seconds
const BLE_CONNECT_TIMEOUT = 10000; // 10 seconds

/**
 * Utility function to wrap promises with timeout protection
 */
const withTimeout = <T>(promise: Promise<T>, ms: number, operation: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timeout after ${ms}ms`)), ms)
    )
  ]);
};

const TIZZY_SERVICE_UUID = '0000TIZZ-0000-1000-8000-00805F9B34FB';

const CHARACTERISTICS = {
  DEVICE_STATUS: '0001TIZZ-0000-1000-8000-00805F9B34FB',  // Read, Notify
  COMMAND: '0002TIZZ-0000-1000-8000-00805F9B34FB',        // Write
  FEATURE_DATA: '0003TIZZY-0000-1000-8000-00805F9B34FB',  // Notify (primary data stream)
  AUDIO_CLIP: '0004TIZZ-0000-1000-8000-00805F9B34FB',    // Read (optional)
  SETTINGS: '0005TIZZ-0000-1000-8000-00805F9B34FB'       // Read, Write
};

export interface DeviceStatus {
  device_id: string;
  firmware_version: string;
  battery_level: number;
  battery_charging: boolean;
  storage_used_mb: number;
  storage_total_mb: number;
  uptime_seconds: number;
  current_session_id: string | null;
  mute_state: 'unmuted' | 'muted' | 'self_only';
  haptics_enabled: boolean;
  last_sync_timestamp: string;
}

export interface FeatureData {
  turn_id: string;
  session_id: string;
  timestamp: string;
  speaker_role: 'WEARER' | 'OTHER_SPEAKER';
  prosody: {
    mean_pitch_hz: number;
    speech_rate_sps: number;
    mean_intensity_db: number;
    pitch_variance: number;
  };
  timing: {
    duration_seconds: number;
    inter_turn_gap_seconds: number;
  };
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'discovering' | 'error';
export type SignalStrength = 'poor' | 'fair' | 'good' | 'excellent';

export interface BLEError {
  type: 'bluetooth_off' | 'permission_denied' | 'device_not_found' | 'connection_lost' | 'pairing_failed' | 'unsupported' | 'unknown';
  message: string;
  recoverable: boolean;
  originalError?: Error;
}

export class TizzyBLEManager {
  private manager: BleManager;
  private device: Device | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly baseReconnectDelay = 1000; // 1 second
  private readonly maxReconnectDelay = 30000; // 30 seconds
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private rssi: number | null = null;
  private signalStrength: SignalStrength = 'poor';
  private rssiMonitorInterval: ReturnType<typeof setInterval> | null = null;
  private stateCallbacks: Set<(state: ConnectionState) => void> = new Set();
  private featureDataCallbacks: Set<(data: FeatureData) => void> = new Set();
  private deviceStatusCallbacks: Set<(status: DeviceStatus) => void> = new Set();
  private signalStrengthCallbacks: Set<(rssi: number, strength: SignalStrength) => void> = new Set();
  private errorCallbacks: Set<(error: BLEError) => void> = new Set();
  private lastError: BLEError | null = null;
  private isReconnecting = false;
  private shouldAttemptReconnect = true;

  constructor() {
    this.manager = new BleManager({
      restoreStateIdentifier: 'TizzyBLEState',
      restoreStateFunction: this.handleStateRestore.bind(this),
    });
  }

  /**
   * Initialize BLE manager and start monitoring Bluetooth state
   */
  async initialize(): Promise<void> {
    console.log('[BLE] Initializing BLE Manager');

    try {
      // Request permissions first
      const hasPermissions = await this.requestPermissions();
      if (!hasPermissions) {
        const error = this.createBLEError('permission_denied', 'Bluetooth permissions not granted');
        this.handleBLEError(error);
        throw new Error(error.message);
      }

      const subscription = this.manager.onStateChange((state) => {
        console.log('[BLE] Bluetooth state changed:', state);

        ErrorTracking.addBreadcrumb({
          category: 'ble',
          message: `Bluetooth state changed: ${state}`,
          level: 'info',
        });

        if (state === State.PoweredOn) {
          // Clear any previous bluetooth_off errors
          if (this.lastError?.type === 'bluetooth_off') {
            this.lastError = null;
          }
        } else if (state === State.PoweredOff) {
          this.updateConnectionState('disconnected');
          const error = this.createBLEError('bluetooth_off', 'Bluetooth is turned off');
          this.handleBLEError(error);
        } else if (state === State.Unsupported) {
          const error = this.createBLEError('unsupported', 'Bluetooth is not supported on this device');
          this.handleBLEError(error);
        }
      }, true);

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          subscription.remove();
          const error = new Error('BLE initialization timeout');
          logError(error, { component: 'BLEManager' });
          reject(error);
        }, 10000);

        this.manager.state().then((state) => {
          clearTimeout(timeout);
          subscription.remove();

          if (state === State.PoweredOn) {
            console.log('[BLE] BLE Manager initialized successfully');
            resolve();
          } else if (state === State.Unsupported) {
            const error = this.createBLEError('unsupported', 'Bluetooth is not supported on this device');
            this.handleBLEError(error);
            reject(new Error(error.message));
          } else if (state === State.PoweredOff) {
            const error = this.createBLEError('bluetooth_off', 'Bluetooth is turned off');
            this.handleBLEError(error);
            reject(new Error(error.message));
          } else {
            const error = new Error(`Bluetooth is ${state}`);
            logError(error, { component: 'BLEManager', state });
            reject(error);
          }
        });
      });
    } catch (error) {
      logError(error, { component: 'BLEManager', operation: 'initialize' });
      throw error;
    }
  }

  /**
   * Request necessary permissions for BLE on Android
   */
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'android') {
      try {
        if (Platform.Version >= 31) {
          // Android 12+ requires BLUETOOTH_SCAN and BLUETOOTH_CONNECT
          const scanGranted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            {
              title: 'Bluetooth Scan Permission',
              message: 'Tizzy needs permission to scan for your device',
              buttonPositive: 'OK',
            }
          );

          const connectGranted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            {
              title: 'Bluetooth Connect Permission',
              message: 'Tizzy needs permission to connect to your device',
              buttonPositive: 'OK',
            }
          );

          const granted = scanGranted === PermissionsAndroid.RESULTS.GRANTED &&
                         connectGranted === PermissionsAndroid.RESULTS.GRANTED;

          if (!granted) {
            ErrorTracking.addBreadcrumb({
              category: 'ble',
              message: 'Bluetooth permissions denied',
              level: 'warning',
            });
          }

          return granted;
        } else {
          // Android 11 and below - permissions requested automatically
          return true;
        }
      } catch (error) {
        console.error('[BLE] Error requesting permissions:', error);
        logError(error, { component: 'BLEManager', operation: 'requestPermissions' });
        return false;
      }
    }
    return true;
  }

  /**
   * Scan for Tizzy wearable device
   */
  async scanForDevice(timeoutMs = 30000): Promise<void> {
    console.log('[BLE] Starting device scan');
    this.updateConnectionState('connecting');

    ErrorTracking.addBreadcrumb({
      category: 'ble',
      message: 'Starting device scan',
      level: 'info',
      data: { timeout: timeoutMs },
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.manager.stopDeviceScan();
        const error = this.createBLEError('device_not_found', 'Device scan timeout - device not found');
        this.handleBLEError(error);
        reject(new Error(error.message));
      }, timeoutMs);

      this.manager.startDeviceScan(
        [TIZZY_SERVICE_UUID],
        { allowDuplicates: false },
        (error, device) => {
          if (error) {
            console.error('[BLE] Scan error:', error);
            clearTimeout(timeout);
            this.manager.stopDeviceScan();

            const bleError = this.classifyScanError(error);
            this.handleBLEError(bleError);

            reject(new Error(bleError.message));
            return;
          }

          if (device && device.name?.startsWith('Tizzy')) {
            console.log('[BLE] Found Tizzy device:', device.name, device.id);

            ErrorTracking.addBreadcrumb({
              category: 'ble',
              message: `Found device: ${device.name}`,
              level: 'info',
              data: { deviceId: device.id },
            });

            clearTimeout(timeout);
            this.manager.stopDeviceScan();
            this.connectToDevice(device).then(resolve).catch(reject);
          }
        }
      );
    });
  }

  /**
   * Connect to a specific device
   */
  async connectToDevice(device: Device): Promise<void> {
    try {
      console.log('[BLE] Connecting to device:', device.id);
      this.updateConnectionState('connecting');

      ErrorTracking.addBreadcrumb({
        category: 'ble',
        message: 'Connecting to device',
        level: 'info',
        data: { deviceId: device.id },
      });

      const connectedDevice = await withTimeout(
        device.connect({
        autoConnect: true, // iOS auto-reconnect
        requestMTU: 512,   // Request larger MTU for better throughput
      }),
        BLE_CONNECT_TIMEOUT,
        'BLE device connection'
      );

      console.log('[BLE] Connected, discovering services');
      this.updateConnectionState('discovering');

      await withTimeout(
        connectedDevice.discoverAllServicesAndCharacteristics(),
        BLE_CONNECT_TIMEOUT,
        'BLE service discovery'
      );

      this.device = connectedDevice;
      this.reconnectAttempts = 0;
      this.updateConnectionState('connected');

      // Setup disconnection handler
      this.setupDisconnectionHandler(connectedDevice);

      // Subscribe to real-time data streams
      await this.subscribeToCharacteristics(connectedDevice);

      // Start monitoring signal strength
      this.monitorSignalStrength();

      console.log('[BLE] Device fully connected and ready');

      ErrorTracking.addBreadcrumb({
        category: 'ble',
        message: 'Device fully connected',
        level: 'info',
      });
    } catch (error) {
      console.error('[BLE] Connection error:', error);

      const bleError = this.classifyConnectionError(error);
      this.handleBLEError(bleError);

      this.updateConnectionState('disconnected');
      this.handleReconnection();

      throw error;
    }
  }

  /**
   * Setup handler for unexpected disconnections
   */
  private setupDisconnectionHandler(device: Device): void {
    device.onDisconnected((error, disconnectedDevice) => {
      console.log('[BLE] Device disconnected:', error?.message || 'Unknown reason');

      // Classify disconnection error
      const bleError = this.createBLEError(
        'connection_lost',
        error?.message || 'Device disconnected unexpectedly',
        error || undefined
      );
      this.handleBLEError(bleError);

      // Clean up device state
      this.device = null;
      this.stopSignalStrengthMonitoring();
      this.updateConnectionState('disconnected');

      // Attempt reconnection if enabled
      if (this.shouldAttemptReconnect) {
        this.handleReconnection();
      } else {
        console.log('[BLE] Auto-reconnect disabled, not attempting reconnection');
      }
    });
  }

  /**
   * Monitor signal strength (RSSI) periodically
   */
  private monitorSignalStrength(): void {
    // Clear any existing interval
    this.stopSignalStrengthMonitoring();

    // Read RSSI immediately
    this.readRSSI();

    // Set up periodic RSSI monitoring (every 2 seconds)
    this.rssiMonitorInterval = setInterval(() => {
      this.readRSSI();
    }, 2000);

    console.log('[BLE] Started signal strength monitoring');
  }

  /**
   * Stop signal strength monitoring
   */
  private stopSignalStrengthMonitoring(): void {
    if (this.rssiMonitorInterval) {
      clearInterval(this.rssiMonitorInterval);
      this.rssiMonitorInterval = null;
      console.log('[BLE] Stopped signal strength monitoring');
    }
  }

  /**
   * Read RSSI value and update signal strength
   */
  private async readRSSI(): Promise<void> {
    if (!this.device) {
      return;
    }

    // Skip if not connected
    if (this.connectionState !== 'connected') {
      return;
    }

    try {
      const device = await this.device.readRSSI();
      const rssi = device.rssi;

      if (rssi === null || rssi === undefined) {
        return;
      }

      this.rssi = rssi;

      // Convert RSSI to signal strength
      const previousStrength = this.signalStrength;
      this.signalStrength = this.rssiToSignalStrength(rssi);

      // Notify callbacks if signal strength changed
      if (previousStrength !== this.signalStrength) {
        console.log(`[BLE] Signal strength changed: ${previousStrength} -> ${this.signalStrength} (RSSI: ${rssi})`);
      }

      // Always notify callbacks with current values
      this.signalStrengthCallbacks.forEach(cb => {
        try {
          cb(rssi, this.signalStrength);
        } catch (callbackError) {
          console.error('[BLE] Error in signal strength callback:', callbackError);
          logError(callbackError, { component: 'BLEManager', context: 'signalStrengthCallback' });
        }
      });
    } catch (error) {
      console.error('[BLE] Error reading RSSI:', error);
      // Don't create a BLE error for RSSI read failures - they're expected occasionally
      // Just log for debugging purposes
      logError(error, { component: 'BLEManager', operation: 'readRSSI' });
    }
  }

  /**
   * Convert RSSI value to signal strength category
   */
  private rssiToSignalStrength(rssi: number): SignalStrength {
    if (rssi > -50) {
      return 'excellent';
    } else if (rssi > -60) {
      return 'good';
    } else if (rssi > -70) {
      return 'fair';
    } else {
      return 'poor';
    }
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private async handleReconnection(): Promise<void> {
    // Prevent multiple concurrent reconnection attempts
    if (this.isReconnecting) {
      console.log('[BLE] Reconnection already in progress');
      return;
    }

    // Check if max attempts reached
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[BLE] Max reconnection attempts reached');

      const error = this.createBLEError(
        'connection_lost',
        `Failed to reconnect after ${this.maxReconnectAttempts} attempts. Please check device and try manually.`,
        undefined
      );
      error.recoverable = false; // Mark as non-recoverable after max attempts
      this.handleBLEError(error);

      // Reset for future manual reconnection attempts
      this.isReconnecting = false;
      this.shouldAttemptReconnect = false;

      return;
    }

    this.isReconnecting = true;

    // Calculate exponential backoff delay
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );
    this.reconnectAttempts++;

    console.log(`[BLE] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    ErrorTracking.addBreadcrumb({
      category: 'ble',
      message: `Reconnection attempt ${this.reconnectAttempts}`,
      level: 'info',
      data: { delay, maxAttempts: this.maxReconnectAttempts },
    });

    // Clear any existing reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.scanForDevice(10000); // Shorter timeout for reconnection attempts
        // Success - reset counters
        this.isReconnecting = false;
        console.log('[BLE] Reconnection successful');
      } catch (error) {
        console.error('[BLE] Reconnection scan failed:', error);
        this.isReconnecting = false;

        // Track reconnection failure
        ErrorTracking.addBreadcrumb({
          category: 'ble',
          message: 'Reconnection attempt failed',
          level: 'warning',
          data: { attempt: this.reconnectAttempts, error: error instanceof Error ? error.message : String(error) },
        });

        // Try again if we haven't reached max attempts
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.handleReconnection();
        } else {
          // Max attempts reached - handled by check at start of function
          this.handleReconnection();
        }
      }
    }, delay);
  }

  /**
   * Subscribe to all relevant characteristics
   */
  private async subscribeToCharacteristics(device: Device): Promise<void> {
    try {
      // Subscribe to device status updates
      device.monitorCharacteristicForService(
        TIZZY_SERVICE_UUID,
        CHARACTERISTICS.DEVICE_STATUS,
        (error, characteristic) => {
          if (error) {
            console.error('[BLE] Device status monitor error:', error);

            // Create and handle error
            const bleError = this.createBLEError(
              'connection_lost',
              `Device status monitoring failed: ${error.message}`,
              error
            );
            this.handleBLEError(bleError);

            // Track error in monitoring
            ErrorTracking.addBreadcrumb({
              category: 'ble',
              message: 'Device status monitor error',
              level: 'error',
              data: { error: error.message },
            });

            return;
          }

          if (characteristic?.value) {
            try {
              const status = this.decodeDeviceStatus(characteristic.value);
              this.deviceStatusCallbacks.forEach(cb => {
                try {
                  cb(status);
                } catch (callbackError) {
                  console.error('[BLE] Error in device status callback:', callbackError);
                  logError(callbackError, { component: 'BLEManager', context: 'deviceStatusCallback' });
                }
              });
            } catch (decodeError) {
              console.error('[BLE] Error decoding device status:', decodeError);
              logError(decodeError, { component: 'BLEManager', operation: 'decodeDeviceStatus' });
            }
          }
        }
      );

      // Subscribe to feature data stream (primary data stream)
      device.monitorCharacteristicForService(
        TIZZY_SERVICE_UUID,
        CHARACTERISTICS.FEATURE_DATA,
        (error, characteristic) => {
          if (error) {
            console.error('[BLE] Feature data monitor error:', error);

            // Create and handle error
            const bleError = this.createBLEError(
              'connection_lost',
              `Feature data monitoring failed: ${error.message}`,
              error
            );
            this.handleBLEError(bleError);

            // Track error in monitoring
            ErrorTracking.addBreadcrumb({
              category: 'ble',
              message: 'Feature data monitor error',
              level: 'error',
              data: { error: error.message },
            });

            return;
          }

          if (characteristic?.value) {
            try {
              const featureData = this.decodeFeatureData(characteristic.value);
              this.featureDataCallbacks.forEach(cb => {
                try {
                  cb(featureData);
                } catch (callbackError) {
                  console.error('[BLE] Error in feature data callback:', callbackError);
                  logError(callbackError, { component: 'BLEManager', context: 'featureDataCallback' });
                }
              });
            } catch (decodeError) {
              console.error('[BLE] Error decoding feature data:', decodeError);
              logError(decodeError, { component: 'BLEManager', operation: 'decodeFeatureData' });
            }
          }
        }
      );

      console.log('[BLE] Successfully subscribed to all characteristics');
    } catch (error) {
      console.error('[BLE] Error subscribing to characteristics:', error);
      logError(error, { component: 'BLEManager', operation: 'subscribeToCharacteristics' });
      throw error;
    }
  }

  /**
   * Send a command to the device (e.g., trigger haptic feedback)
   */
  async sendCommand(command: string, parameters?: any): Promise<void> {
    if (!this.device) {
      const error = this.createBLEError(
        'connection_lost',
        'Cannot send command: device not connected'
      );
      this.handleBLEError(error);
      throw new Error(error.message);
    }

    // Verify connection state
    if (this.connectionState !== 'connected') {
      const error = this.createBLEError(
        'connection_lost',
        `Cannot send command: device is ${this.connectionState}`
      );
      this.handleBLEError(error);
      throw new Error(error.message);
    }

    try {
      const commandPayload = {
        command,
        parameters: parameters || {},
        timestamp: new Date().toISOString(),
      };

      const encoded = Buffer.from(JSON.stringify(commandPayload)).toString('base64');

      // Add timeout for write operation
      const writePromise = this.device.writeCharacteristicWithResponseForService(
        TIZZY_SERVICE_UUID,
        CHARACTERISTICS.COMMAND,
        encoded
      );

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Write operation timeout')), 5000);
      });

      await Promise.race([writePromise, timeoutPromise]);

      console.log('[BLE] Command sent:', command);

      ErrorTracking.addBreadcrumb({
        category: 'ble',
        message: `Command sent: ${command}`,
        level: 'info',
        data: { command, parameters },
      });
    } catch (error) {
      console.error('[BLE] Error sending command:', error);

      // Classify write error
      const bleError = this.createBLEError(
        'connection_lost',
        `Failed to send command '${command}': ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
      this.handleBLEError(bleError);

      // Log detailed error
      logError(error, {
        component: 'BLEManager',
        operation: 'sendCommand',
        command,
        parameters,
      });

      throw error;
    }
  }

  /**
   * Send haptic feedback command
   */
  async sendHaptic(pattern: 'single_pulse' | 'double_pulse' | 'long_pulse'): Promise<void> {
    return this.sendCommand('send_haptic', { pattern });
  }

  /**
   * Set device mute state
   */
  async setMuteState(state: 'unmuted' | 'muted' | 'self_only'): Promise<void> {
    return this.sendCommand('set_mode', { mode: state });
  }

  /**
   * Read device status
   */
  async readDeviceStatus(): Promise<DeviceStatus> {
    if (!this.device) {
      const error = this.createBLEError(
        'connection_lost',
        'Cannot read device status: device not connected'
      );
      this.handleBLEError(error);
      throw new Error(error.message);
    }

    // Verify connection state
    if (this.connectionState !== 'connected') {
      const error = this.createBLEError(
        'connection_lost',
        `Cannot read device status: device is ${this.connectionState}`
      );
      this.handleBLEError(error);
      throw new Error(error.message);
    }

    try {
      // Add timeout for read operation
      const readPromise = this.device.readCharacteristicForService(
        TIZZY_SERVICE_UUID,
        CHARACTERISTICS.DEVICE_STATUS
      );

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Read operation timeout')), 5000);
      });

      const characteristic = await Promise.race([readPromise, timeoutPromise]);

      if (!characteristic.value) {
        throw new Error('Failed to read device status: no data received');
      }

      return this.decodeDeviceStatus(characteristic.value);
    } catch (error) {
      console.error('[BLE] Error reading device status:', error);

      const bleError = this.createBLEError(
        'connection_lost',
        `Failed to read device status: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
      this.handleBLEError(bleError);

      logError(error, {
        component: 'BLEManager',
        operation: 'readDeviceStatus',
      });

      throw error;
    }
  }

  /**
   * Decode base64 device status
   */
  private decodeDeviceStatus(base64Value: string): DeviceStatus {
    const jsonString = Buffer.from(base64Value, 'base64').toString();
    return JSON.parse(jsonString);
  }

  /**
   * Decode base64 feature data
   */
  private decodeFeatureData(base64Value: string): FeatureData {
    const jsonString = Buffer.from(base64Value, 'base64').toString();
    return JSON.parse(jsonString);
  }

  /**
   * Handle state restoration (for background support)
   */
  private handleStateRestore(restoredState: any): void {
    console.log('[BLE] State restored:', restoredState);
    // Handle restored state if needed
  }

  /**
   * Update connection state and notify listeners
   */
  private updateConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    this.stateCallbacks.forEach(cb => cb(state));
  }

  /**
   * Register callback for connection state changes
   */
  onConnectionStateChange(callback: (state: ConnectionState) => void): () => void {
    this.stateCallbacks.add(callback);
    // Return unsubscribe function
    return () => this.stateCallbacks.delete(callback);
  }

  /**
   * Register callback for feature data updates
   */
  onFeatureData(callback: (data: FeatureData) => void): () => void {
    this.featureDataCallbacks.add(callback);
    return () => this.featureDataCallbacks.delete(callback);
  }

  /**
   * Register callback for device status updates
   */
  onDeviceStatus(callback: (status: DeviceStatus) => void): () => void {
    this.deviceStatusCallbacks.add(callback);
    return () => this.deviceStatusCallbacks.delete(callback);
  }

  /**
   * Register callback for signal strength updates
   */
  onSignalStrengthChange(callback: (rssi: number, strength: SignalStrength) => void): () => void {
    this.signalStrengthCallbacks.add(callback);
    // Immediately call with current values if available
    if (this.rssi !== null) {
      callback(this.rssi, this.signalStrength);
    }
    return () => this.signalStrengthCallbacks.delete(callback);
  }

  /**
   * Register callback for BLE errors
   */
  onError(callback: (error: BLEError) => void): () => void {
    this.errorCallbacks.add(callback);
    // Immediately call with last error if available
    if (this.lastError) {
      callback(this.lastError);
    }
    return () => this.errorCallbacks.delete(callback);
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Get current RSSI value
   */
  getRSSI(): number | null {
    return this.rssi;
  }

  /**
   * Get current signal strength
   */
  getSignalStrength(): SignalStrength {
    return this.signalStrength;
  }

  /**
   * Get connected device
   */
  getDevice(): Device | null {
    return this.device;
  }

  /**
   * Disconnect from device
   */
  async disconnect(): Promise<void> {
    if (this.device) {
      console.log('[BLE] Disconnecting from device');

      try {
        // Disable auto-reconnect before disconnecting
        this.shouldAttemptReconnect = false;

        // Clear any pending reconnection timeout
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = null;
        }

        // Stop signal strength monitoring
        this.stopSignalStrengthMonitoring();

        // Cancel connection
        await this.device.cancelConnection();
      } catch (error) {
        console.error('[BLE] Error during disconnect:', error);
        logError(error, { component: 'BLEManager', operation: 'disconnect' });
      } finally {
        // Clean up state regardless of errors
        this.device = null;
        this.rssi = null;
        this.signalStrength = 'poor';
        this.isReconnecting = false;
        this.updateConnectionState('disconnected');
      }
    }
  }

  /**
   * Cleanup and destroy manager
   */
  async destroy(): Promise<void> {
    console.log('[BLE] Destroying BLE Manager');

    try {
      // Stop all monitoring
      this.stopSignalStrengthMonitoring();

      // Clear reconnection timeout
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }

      // Disconnect from device
      await this.disconnect();

      // Destroy the manager
      this.manager.destroy();

      // Clear all callbacks
      this.stateCallbacks.clear();
      this.featureDataCallbacks.clear();
      this.deviceStatusCallbacks.clear();
      this.signalStrengthCallbacks.clear();
      this.errorCallbacks.clear();

      // Reset state
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      this.shouldAttemptReconnect = true;
      this.lastError = null;

      console.log('[BLE] BLE Manager destroyed successfully');
    } catch (error) {
      console.error('[BLE] Error during destroy:', error);
      logError(error, { component: 'BLEManager', operation: 'destroy' });
      throw error;
    }
  }

  /**
   * Get last error
   */
  getLastError(): BLEError | null {
    return this.lastError;
  }

  /**
   * Clear last error
   */
  clearError(): void {
    this.lastError = null;
  }

  /**
   * Reset reconnection state and enable auto-reconnect
   * Use this when user manually initiates a connection after failures
   */
  resetReconnectionState(): void {
    console.log('[BLE] Resetting reconnection state');

    // Clear any pending reconnection timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Reset counters and flags
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    this.shouldAttemptReconnect = true;
    this.lastError = null;

    console.log('[BLE] Reconnection state reset, auto-reconnect enabled');
  }

  /**
   * Get reconnection status
   */
  getReconnectionStatus(): {
    isReconnecting: boolean;
    attempts: number;
    maxAttempts: number;
    shouldAttemptReconnect: boolean;
  } {
    return {
      isReconnecting: this.isReconnecting,
      attempts: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      shouldAttemptReconnect: this.shouldAttemptReconnect,
    };
  }

  /**
   * Create a BLE error object
   */
  private createBLEError(
    type: BLEError['type'],
    message: string,
    originalError?: Error
  ): BLEError {
    const recoverable = type !== 'unsupported' && type !== 'permission_denied';

    return {
      type,
      message,
      recoverable,
      originalError,
    };
  }

  /**
   * Handle BLE error and notify callbacks
   */
  private handleBLEError(error: BLEError): void {
    this.lastError = error;

    // Track in error monitoring
    ErrorTracking.trackBLEError(
      error.originalError || new Error(error.message),
      {
        errorType: error.type,
        recoverable: error.recoverable,
      }
    );

    // Log error
    logError(error.originalError || new Error(error.message), {
      component: 'BLEManager',
      bleErrorType: error.type,
      recoverable: error.recoverable,
    });

    // Notify callbacks
    this.errorCallbacks.forEach(cb => cb(error));

    // Update connection state to error if not recoverable
    if (!error.recoverable) {
      this.updateConnectionState('error');
    }
  }

  /**
   * Classify scan errors
   */
  private classifyScanError(error: any): BLEError {
    const errorCode = error?.errorCode;
    const message = error?.message || '';

    // Check for specific BLE error codes
    if (errorCode === 102 || message.includes('PoweredOff')) {
      return this.createBLEError('bluetooth_off', 'Bluetooth is turned off', error);
    }

    if (errorCode === 600 || message.includes('permission')) {
      return this.createBLEError('permission_denied', 'Bluetooth permission denied', error);
    }

    if (message.includes('timeout')) {
      return this.createBLEError('device_not_found', 'Device not found - scan timeout', error);
    }

    return this.createBLEError('unknown', `Scan failed: ${message}`, error);
  }

  /**
   * Classify connection errors
   */
  private classifyConnectionError(error: any): BLEError {
    const errorCode = error?.errorCode;
    const message = error?.message || '';

    if (errorCode === 2 || message.includes('disconnected')) {
      return this.createBLEError('connection_lost', 'Connection to device lost', error);
    }

    if (errorCode === 102 || message.includes('PoweredOff')) {
      return this.createBLEError('bluetooth_off', 'Bluetooth is turned off', error);
    }

    if (message.includes('pairing') || message.includes('bonding')) {
      return this.createBLEError('pairing_failed', 'Device pairing failed', error);
    }

    if (message.includes('timeout')) {
      return this.createBLEError('connection_lost', 'Connection timeout', error);
    }

    return this.createBLEError('unknown', `Connection failed: ${message}`, error);
  }
}

// Singleton instance
let bleManagerInstance: TizzyBLEManager | null = null;

export function getBLEManager(): TizzyBLEManager {
  if (!bleManagerInstance) {
    bleManagerInstance = new TizzyBLEManager();
  }
  return bleManagerInstance;
}
