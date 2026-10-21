/**
 * Services Export Index
 */

export * as Analytics from './Analytics';
export * as ErrorTracking from './ErrorTracking';
export { getBLEManager, TizzyBLEManager } from './BLEManager';
export { getAudioService, TizzyAudioService } from './AudioService';

// AI & Emotion Analysis Services
export { getModulateService, createModulateService, ModulateService } from './ModulateService';
export type {
  AudioBuffer,
  ProsodyFeatures,
  VoiceEmotionFeatures,
  EmotionResult,
  ProsodyAnalysisResult,
  AudioAnalysisResult,
  ModulateError,
  RateLimitInfo,
} from './ModulateService';

// Offline Support Services
export { networkService, NetworkService, useNetworkStatus } from './NetworkService';
export type { NetworkStatus, NetworkQuality, NetworkChangeListener } from './NetworkService';

export { syncService, SyncService, useSyncStatus, useSyncConflicts, useSyncMetrics } from './SyncService';
export type {
  OperationType,
  QueuedOperation,
  SyncStatus,
  SyncStatusListener,
  SyncConflict,
  SyncConflictListener,
  SyncMetrics,
  ConflictResolutionStrategy,
} from './SyncService';
export { SyncConflictError } from './SyncService';

// Real-time Communication
export { webSocketService, WebSocketService, useWebSocket } from './WebSocketService';
export type { WebSocketEventType, WebSocketMessage } from './WebSocketService';
export { WebSocketState } from './WebSocketService';
