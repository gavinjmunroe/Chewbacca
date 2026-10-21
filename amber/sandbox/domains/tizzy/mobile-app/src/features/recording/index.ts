/**
 * Recording Feature Module
 *
 * Export all recording-related functionality
 */

// Core SessionRecorder
export {
  SessionRecorder,
  getSessionRecorder,
  resetSessionRecorder,
} from './SessionRecorder';

// Types
export type {
  SessionState,
  SessionMetrics,
  SessionConfig,
  FeatureData,
  SessionError,
} from './SessionRecorder';

// Hooks
export {
  useSessionRecording,
  useSessionMetrics,
  useSessionState,
  useSessionErrors,
} from './hooks/useSessionRecording';

export type {
  UseSessionRecordingOptions,
  UseSessionRecordingReturn,
} from './hooks/useSessionRecording';
