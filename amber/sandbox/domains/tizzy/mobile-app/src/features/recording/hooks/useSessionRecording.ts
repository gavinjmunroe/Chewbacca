/**
 * useSessionRecording Hook
 *
 * React hook for managing session recording with:
 * - Easy-to-use session control methods
 * - Real-time session status and metrics
 * - Error handling and recovery
 * - Automatic cleanup on unmount
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  SessionRecorder,
  getSessionRecorder,
  SessionState,
  SessionMetrics,
  SessionError,
  FeatureData,
  SessionConfig,
} from '../SessionRecorder';
import { DeviceStatus } from '../../../services/BLEManager';

// ============================================================================
// Hook Types
// ============================================================================

export interface UseSessionRecordingOptions {
  /**
   * Configuration for the session recorder
   */
  config?: Partial<SessionConfig>;

  /**
   * Auto-start recording on mount
   */
  autoStart?: boolean;

  /**
   * Default environment tag for sessions
   */
  defaultEnvironmentTag?: string;

  /**
   * Default consent mode for sessions
   */
  defaultConsentMode?: string;

  /**
   * Callback when session state changes
   */
  onStateChange?: (state: SessionState) => void;

  /**
   * Callback when metrics are updated
   */
  onMetricsUpdate?: (metrics: SessionMetrics) => void;

  /**
   * Callback when an error occurs
   */
  onError?: (error: SessionError) => void;

  /**
   * Callback when a feature is extracted
   */
  onFeatureExtracted?: (feature: FeatureData) => void;
}

export interface UseSessionRecordingReturn {
  // Session control methods
  startSession: (environmentTag?: string, consentMode?: string) => Promise<void>;
  pauseSession: () => Promise<void>;
  resumeSession: () => Promise<void>;
  stopSession: () => Promise<string | null>;
  uploadFeatures: () => Promise<void>;

  // Session state
  sessionState: SessionState;
  sessionId: string | null;
  isRecording: boolean;
  isPaused: boolean;
  isIdle: boolean;

  // Session metrics
  metrics: SessionMetrics;
  deviceStatus: DeviceStatus | null;

  // Error handling
  errors: SessionError[];
  lastError: SessionError | null;
  clearErrors: () => void;

  // Loading states
  isStarting: boolean;
  isStopping: boolean;
  isPausingOrResuming: boolean;

  // Session recorder instance (for advanced usage)
  recorder: SessionRecorder;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useSessionRecording(options: UseSessionRecordingOptions = {}): UseSessionRecordingReturn {
  const {
    config,
    autoStart = false,
    defaultEnvironmentTag = 'general',
    defaultConsentMode = 'full',
    onStateChange,
    onMetricsUpdate,
    onError,
    onFeatureExtracted,
  } = options;

  // Get recorder instance
  const recorderRef = useRef<SessionRecorder | null>(null);

  // State
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<SessionMetrics>({
    duration: 0,
    totalSamples: 0,
    bufferedFeatures: 0,
    uploadedFeatures: 0,
    averageRMS: 0,
    averageZCR: 0,
    averageIntensity: 0,
    averagePitch: 0,
  });
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [errors, setErrors] = useState<SessionError[]>([]);
  const [lastError, setLastError] = useState<SessionError | null>(null);

  // Loading states
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isPausingOrResuming, setIsPausingOrResuming] = useState(false);

  // Initialize recorder
  useEffect(() => {
    console.log('[useSessionRecording] Initializing session recorder');
    recorderRef.current = getSessionRecorder(config);

    // Subscribe to state changes
    const unsubscribeState = recorderRef.current.onStateChange((state) => {
      console.log('[useSessionRecording] State changed:', state);
      setSessionState(state);
      setSessionId(recorderRef.current!.getSessionId());
      setDeviceStatus(recorderRef.current!.getDeviceStatus());
      onStateChange?.(state);
    });

    // Subscribe to metrics updates
    const unsubscribeMetrics = recorderRef.current.onMetricsUpdate((newMetrics) => {
      setMetrics(newMetrics);
      onMetricsUpdate?.(newMetrics);
    });

    // Subscribe to errors
    const unsubscribeErrors = recorderRef.current.onError((error) => {
      console.error('[useSessionRecording] Error:', error);
      setErrors(prev => [...prev, error]);
      setLastError(error);
      onError?.(error);
    });

    // Subscribe to feature extraction (if callback provided)
    let unsubscribeFeatures: (() => void) | undefined;
    if (onFeatureExtracted) {
      unsubscribeFeatures = recorderRef.current.onFeatureExtracted(onFeatureExtracted);
    }

    // Auto-start if enabled
    if (autoStart) {
      startSession(defaultEnvironmentTag, defaultConsentMode).catch((error) => {
        console.error('[useSessionRecording] Auto-start failed:', error);
        // Update component state with error so UI can display feedback
        const sessionError: SessionError = {
          type: 'audio',
          message: error.message || 'Failed to auto-start recording session',
          timestamp: new Date().toISOString(),
          recoverable: true,
        };
        setErrors(prev => [...prev, sessionError]);
        setLastError(sessionError);
      });
    }

    // Cleanup on unmount
    return () => {
      console.log('[useSessionRecording] Cleaning up');
      unsubscribeState();
      unsubscribeMetrics();
      unsubscribeErrors();
      unsubscribeFeatures?.();

      // Stop session if still recording - ensure cleanup completes
      if (recorderRef.current?.getState() === 'recording' || recorderRef.current?.getState() === 'paused') {
        recorderRef.current.stopSession().catch((error) => {
          console.error('[useSessionRecording] Error during cleanup stop:', error);
          // Ensure resources are released even if stop fails
          try {
            // Force cleanup of any remaining resources
            recorderRef.current?.clearErrors();
          } catch (cleanupError) {
            console.error('[useSessionRecording] Force cleanup failed:', cleanupError);
          }
        });
      }
    };
  }, []); // Empty deps - only run once on mount

  // ============================================================================
  // Session Control Methods
  // ============================================================================

  /**
   * Start a new recording session
   */
  const startSession = useCallback(async (
    environmentTag: string = defaultEnvironmentTag,
    consentMode: string = defaultConsentMode
  ): Promise<void> => {
    if (!recorderRef.current) {
      throw new Error('Session recorder not initialized');
    }

    try {
      setIsStarting(true);
      console.log('[useSessionRecording] Starting session');
      await recorderRef.current.startSession(environmentTag, consentMode);
      console.log('[useSessionRecording] Session started successfully');
    } catch (error) {
      console.error('[useSessionRecording] Failed to start session:', error);
      throw error;
    } finally {
      setIsStarting(false);
    }
  }, [defaultEnvironmentTag, defaultConsentMode]);

  /**
   * Pause the current recording session
   */
  const pauseSession = useCallback(async (): Promise<void> => {
    if (!recorderRef.current) {
      throw new Error('Session recorder not initialized');
    }

    try {
      setIsPausingOrResuming(true);
      console.log('[useSessionRecording] Pausing session');
      await recorderRef.current.pauseSession();
      console.log('[useSessionRecording] Session paused successfully');
    } catch (error) {
      console.error('[useSessionRecording] Failed to pause session:', error);
      throw error;
    } finally {
      setIsPausingOrResuming(false);
    }
  }, []);

  /**
   * Resume a paused recording session
   */
  const resumeSession = useCallback(async (): Promise<void> => {
    if (!recorderRef.current) {
      throw new Error('Session recorder not initialized');
    }

    try {
      setIsPausingOrResuming(true);
      console.log('[useSessionRecording] Resuming session');
      await recorderRef.current.resumeSession();
      console.log('[useSessionRecording] Session resumed successfully');
    } catch (error) {
      console.error('[useSessionRecording] Failed to resume session:', error);
      throw error;
    } finally {
      setIsPausingOrResuming(false);
    }
  }, []);

  /**
   * Stop the current recording session
   */
  const stopSession = useCallback(async (): Promise<string | null> => {
    if (!recorderRef.current) {
      throw new Error('Session recorder not initialized');
    }

    try {
      setIsStopping(true);
      console.log('[useSessionRecording] Stopping session');
      const sessionId = await recorderRef.current.stopSession();
      console.log('[useSessionRecording] Session stopped successfully:', sessionId);
      return sessionId;
    } catch (error) {
      console.error('[useSessionRecording] Failed to stop session:', error);
      throw error;
    } finally {
      setIsStopping(false);
    }
  }, []);

  /**
   * Manually upload buffered features
   */
  const uploadFeatures = useCallback(async (): Promise<void> => {
    if (!recorderRef.current) {
      throw new Error('Session recorder not initialized');
    }

    try {
      console.log('[useSessionRecording] Manually uploading features');
      await recorderRef.current.uploadFeatures();
      console.log('[useSessionRecording] Features uploaded successfully');
    } catch (error) {
      console.error('[useSessionRecording] Failed to upload features:', error);
      throw error;
    }
  }, []);

  /**
   * Clear error history
   */
  const clearErrors = useCallback((): void => {
    setErrors([]);
    setLastError(null);
    recorderRef.current?.clearErrors();
  }, []);

  // ============================================================================
  // Computed Values
  // ============================================================================

  const isRecording = sessionState === 'recording';
  const isPaused = sessionState === 'paused';
  const isIdle = sessionState === 'idle';

  // ============================================================================
  // Return Hook Interface
  // ============================================================================

  return {
    // Session control methods
    startSession,
    pauseSession,
    resumeSession,
    stopSession,
    uploadFeatures,

    // Session state
    sessionState,
    sessionId,
    isRecording,
    isPaused,
    isIdle,

    // Session metrics
    metrics,
    deviceStatus,

    // Error handling
    errors,
    lastError,
    clearErrors,

    // Loading states
    isStarting,
    isStopping,
    isPausingOrResuming,

    // Recorder instance
    recorder: recorderRef.current!,
  };
}

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Hook for monitoring session metrics
 * Useful when you only need metrics, not full control
 */
export function useSessionMetrics(): SessionMetrics {
  const [metrics, setMetrics] = useState<SessionMetrics>({
    duration: 0,
    totalSamples: 0,
    bufferedFeatures: 0,
    uploadedFeatures: 0,
    averageRMS: 0,
    averageZCR: 0,
    averageIntensity: 0,
    averagePitch: 0,
  });

  useEffect(() => {
    const recorder = getSessionRecorder();
    const unsubscribe = recorder.onMetricsUpdate(setMetrics);
    return unsubscribe;
  }, []);

  return metrics;
}

/**
 * Hook for monitoring session state
 * Useful when you only need state, not full control
 */
export function useSessionState(): {
  state: SessionState;
  sessionId: string | null;
  isRecording: boolean;
  isPaused: boolean;
  isIdle: boolean;
} {
  const [state, setState] = useState<SessionState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const recorder = getSessionRecorder();
    const unsubscribe = recorder.onStateChange((newState) => {
      setState(newState);
      setSessionId(recorder.getSessionId());
    });

    // Set initial state
    setState(recorder.getState());
    setSessionId(recorder.getSessionId());

    return unsubscribe;
  }, []);

  return {
    state,
    sessionId,
    isRecording: state === 'recording',
    isPaused: state === 'paused',
    isIdle: state === 'idle',
  };
}

/**
 * Hook for monitoring session errors
 * Useful for displaying error notifications
 */
export function useSessionErrors(): {
  errors: SessionError[];
  lastError: SessionError | null;
  hasErrors: boolean;
  clearErrors: () => void;
} {
  const [errors, setErrors] = useState<SessionError[]>([]);
  const [lastError, setLastError] = useState<SessionError | null>(null);
  const recorderRef = useRef<SessionRecorder | null>(null);

  useEffect(() => {
    const recorder = getSessionRecorder();
    recorderRef.current = recorder;

    const unsubscribe = recorder.onError((error) => {
      setErrors(prev => [...prev, error]);
      setLastError(error);
    });

    // Get existing errors
    setErrors(recorder.getErrors());

    return unsubscribe;
  }, []);

  const clearErrors = useCallback(() => {
    setErrors([]);
    setLastError(null);
    recorderRef.current?.clearErrors();
  }, []);

  return {
    errors,
    lastError,
    hasErrors: errors.length > 0,
    clearErrors,
  };
}
