/**
 * Type Definitions for Session Recording System
 *
 * Centralized type definitions for better IDE support and type safety
 */

import type { DeviceStatus } from '../../services/BLEManager';

// ============================================================================
// Session Types
// ============================================================================

/**
 * Session state machine states
 */
export type SessionState = 'idle' | 'recording' | 'paused' | 'stopped';

/**
 * Session configuration options
 */
export interface SessionConfig {
  /**
   * Interval between feature extractions in milliseconds
   * @default 100
   * @range 50-500
   */
  featureExtractionInterval: number;

  /**
   * Maximum number of features to buffer before upload
   * @default 1000
   */
  bufferSize: number;

  /**
   * Number of features to upload in each batch
   * @default 100
   */
  uploadBatchSize: number;

  /**
   * Audio sample rate in Hz
   * @default 16000
   */
  sampleRate: number;

  /**
   * Automatically upload features when buffer is full
   * @default true
   */
  autoUpload: boolean;

  /**
   * Synchronize session state with BLE device
   * @default true
   */
  syncDeviceStatus: boolean;
}

// ============================================================================
// Feature Types
// ============================================================================

/**
 * Extracted audio feature data
 */
export interface FeatureData {
  /**
   * ISO timestamp when feature was extracted
   */
  timestamp: string;

  /**
   * Root Mean Square energy (loudness indicator)
   * @range 0.0 - 1.0
   */
  rms: number;

  /**
   * Zero-Crossing Rate (voice activity indicator)
   * @range 0.0 - 1.0
   */
  zcr: number;

  /**
   * Signal intensity in decibels
   * @range -Infinity - 0
   */
  intensity: number;

  /**
   * Estimated fundamental frequency in Hz
   * @range 0 - 500 (0 = no pitch detected)
   */
  pitch: number;
}

// ============================================================================
// Metrics Types
// ============================================================================

/**
 * Real-time session metrics
 */
export interface SessionMetrics {
  /**
   * Active recording duration in seconds (excluding paused time)
   */
  duration: number;

  /**
   * Total number of features extracted
   */
  totalSamples: number;

  /**
   * Number of features currently buffered (waiting for upload)
   */
  bufferedFeatures: number;

  /**
   * Number of features successfully uploaded to backend
   */
  uploadedFeatures: number;

  /**
   * Running average of RMS energy
   * @range 0.0 - 1.0
   */
  averageRMS: number;

  /**
   * Running average of Zero-Crossing Rate
   * @range 0.0 - 1.0
   */
  averageZCR: number;

  /**
   * Running average of intensity in dB
   */
  averageIntensity: number;

  /**
   * Running average of pitch in Hz (0 if no pitch detected)
   */
  averagePitch: number;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Session error type categories
 */
export type SessionErrorType =
  | 'audio'              // Audio service errors (recording, permissions)
  | 'ble'                // BLE device communication errors
  | 'network'            // Network/API errors
  | 'feature_extraction' // Feature calculation errors
  | 'upload';            // Feature upload errors

/**
 * Session error information
 */
export interface SessionError {
  /**
   * Error category
   */
  type: SessionErrorType;

  /**
   * Human-readable error message
   */
  message: string;

  /**
   * ISO timestamp when error occurred
   */
  timestamp: string;

  /**
   * Whether the system can recover from this error automatically
   */
  recoverable: boolean;
}

// ============================================================================
// Callback Types
// ============================================================================

/**
 * Callback for session state changes
 */
export type StateChangeCallback = (state: SessionState) => void;

/**
 * Callback for metrics updates
 */
export type MetricsUpdateCallback = (metrics: SessionMetrics) => void;

/**
 * Callback for session errors
 */
export type ErrorCallback = (error: SessionError) => void;

/**
 * Callback for feature extraction
 */
export type FeatureExtractedCallback = (feature: FeatureData) => void;

/**
 * Unsubscribe function returned by event listeners
 */
export type UnsubscribeFunction = () => void;

// ============================================================================
// Hook Types
// ============================================================================

/**
 * Options for useSessionRecording hook
 */
export interface UseSessionRecordingOptions {
  /**
   * Session recorder configuration
   */
  config?: Partial<SessionConfig>;

  /**
   * Automatically start recording when component mounts
   * @default false
   */
  autoStart?: boolean;

  /**
   * Default environment tag for new sessions
   * @default 'general'
   */
  defaultEnvironmentTag?: string;

  /**
   * Default consent mode for new sessions
   * @default 'full'
   */
  defaultConsentMode?: string;

  /**
   * Callback when session state changes
   */
  onStateChange?: StateChangeCallback;

  /**
   * Callback when metrics are updated
   */
  onMetricsUpdate?: MetricsUpdateCallback;

  /**
   * Callback when an error occurs
   */
  onError?: ErrorCallback;

  /**
   * Callback when a feature is extracted
   */
  onFeatureExtracted?: FeatureExtractedCallback;
}

/**
 * Return type of useSessionRecording hook
 */
export interface UseSessionRecordingReturn {
  // ========== Session Control Methods ==========

  /**
   * Start a new recording session
   * @param environmentTag - Environment identifier (e.g., 'office', 'home')
   * @param consentMode - Consent level ('full', 'minimal')
   * @throws Error if already recording
   */
  startSession: (environmentTag?: string, consentMode?: string) => Promise<void>;

  /**
   * Pause the current recording session
   * @throws Error if not currently recording
   */
  pauseSession: () => Promise<void>;

  /**
   * Resume a paused recording session
   * @throws Error if not currently paused
   */
  resumeSession: () => Promise<void>;

  /**
   * Stop the current recording session
   * @returns Session ID or null if no active session
   */
  stopSession: () => Promise<string | null>;

  /**
   * Manually trigger feature upload
   * @throws Error if no active session
   */
  uploadFeatures: () => Promise<void>;

  // ========== Session State ==========

  /**
   * Current session state
   */
  sessionState: SessionState;

  /**
   * Current session ID (null if no active session)
   */
  sessionId: string | null;

  /**
   * Whether currently recording
   */
  isRecording: boolean;

  /**
   * Whether session is paused
   */
  isPaused: boolean;

  /**
   * Whether session is idle (no active session)
   */
  isIdle: boolean;

  // ========== Session Metrics ==========

  /**
   * Current session metrics
   */
  metrics: SessionMetrics;

  /**
   * Connected BLE device status (null if not connected)
   */
  deviceStatus: DeviceStatus | null;

  // ========== Error Handling ==========

  /**
   * Array of all session errors
   */
  errors: SessionError[];

  /**
   * Most recent error (null if no errors)
   */
  lastError: SessionError | null;

  /**
   * Clear error history
   */
  clearErrors: () => void;

  // ========== Loading States ==========

  /**
   * Whether session is currently starting
   */
  isStarting: boolean;

  /**
   * Whether session is currently stopping
   */
  isStopping: boolean;

  /**
   * Whether session is currently pausing or resuming
   */
  isPausingOrResuming: boolean;

  // ========== Advanced ==========

  /**
   * Direct access to SessionRecorder instance
   * For advanced usage only
   */
  recorder: any; // SessionRecorder type (avoiding circular dependency)
}

// ============================================================================
// Utility Hook Types
// ============================================================================

/**
 * Return type of useSessionState hook
 */
export interface UseSessionStateReturn {
  /**
   * Current session state
   */
  state: SessionState;

  /**
   * Current session ID
   */
  sessionId: string | null;

  /**
   * Whether currently recording
   */
  isRecording: boolean;

  /**
   * Whether session is paused
   */
  isPaused: boolean;

  /**
   * Whether session is idle
   */
  isIdle: boolean;
}

/**
 * Return type of useSessionErrors hook
 */
export interface UseSessionErrorsReturn {
  /**
   * Array of all session errors
   */
  errors: SessionError[];

  /**
   * Most recent error
   */
  lastError: SessionError | null;

  /**
   * Whether there are any errors
   */
  hasErrors: boolean;

  /**
   * Clear error history
   */
  clearErrors: () => void;
}

// ============================================================================
// Internal Types (for implementation)
// ============================================================================

/**
 * Circular buffer interface
 * @internal
 */
export interface CircularBuffer<T> {
  push(item: T): void;
  getAll(): T[];
  clear(): void;
  length(): number;
  isFull(): boolean;
}

/**
 * Pitch estimator interface
 * @internal
 */
export interface PitchEstimator {
  estimatePitch(audioBuffer: Float32Array, sampleRate: number): number;
}

// ============================================================================
// Re-exports from API types
// ============================================================================

export type {
  AudioFeature,
  CreateSessionPayload,
  EndSessionPayload,
  SessionResponse,
} from '../../shared/types/api';

export type { DeviceStatus } from '../../services/BLEManager';

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if value is a valid SessionState
 */
export function isSessionState(value: any): value is SessionState {
  return ['idle', 'recording', 'paused', 'stopped'].includes(value);
}

/**
 * Type guard to check if value is a valid SessionErrorType
 */
export function isSessionErrorType(value: any): value is SessionErrorType {
  return ['audio', 'ble', 'network', 'feature_extraction', 'upload'].includes(value);
}

/**
 * Type guard to check if error is recoverable
 */
export function isRecoverableError(error: SessionError): boolean {
  return error.recoverable === true;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default session configuration
 */
export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  featureExtractionInterval: 100,
  bufferSize: 1000,
  uploadBatchSize: 100,
  sampleRate: 16000,
  autoUpload: true,
  syncDeviceStatus: true,
};

/**
 * Minimum allowed feature extraction interval (ms)
 */
export const MIN_EXTRACTION_INTERVAL = 50;

/**
 * Maximum allowed feature extraction interval (ms)
 */
export const MAX_EXTRACTION_INTERVAL = 500;

/**
 * Minimum buffer size
 */
export const MIN_BUFFER_SIZE = 10;

/**
 * Maximum buffer size
 */
export const MAX_BUFFER_SIZE = 10000;

/**
 * Supported sample rates (Hz)
 */
export const SUPPORTED_SAMPLE_RATES = [8000, 16000, 22050, 44100, 48000] as const;

/**
 * Pitch detection range (Hz)
 */
export const PITCH_RANGE = {
  MIN: 60,
  MAX: 500,
} as const;

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Deep partial type (makes all properties optional recursively)
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Readonly recursive type
 */
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

/**
 * Extract callback types from hooks
 */
export type CallbacksFromOptions<T> = {
  [K in keyof T]: T[K] extends ((...args: any[]) => any) ? T[K] : never;
};
