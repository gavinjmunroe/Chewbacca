/**
 * SessionRecorder - Active Session Recording System
 *
 * Manages the complete lifecycle of a recording session with:
 * - Real-time audio feature extraction
 * - Integration with AudioService and BLEManager
 * - Batch feature upload to backend
 * - Session state management
 * - Memory-efficient circular buffer
 */

import { getAudioService, AudioFeatureExtractor, TizzyAudioService } from '../../services/AudioService';
import { getBLEManager, TizzyBLEManager, DeviceStatus } from '../../services/BLEManager';
import { apiService } from '../../api/client';
import { AudioFeature, CreateSessionPayload, EndSessionPayload } from '../../shared/types/api';

// ============================================================================
// Types and Interfaces
// ============================================================================

export type SessionState = 'idle' | 'recording' | 'paused' | 'stopped';

export interface SessionMetrics {
  duration: number;
  totalSamples: number;
  bufferedFeatures: number;
  uploadedFeatures: number;
  averageRMS: number;
  averageZCR: number;
  averageIntensity: number;
  averagePitch: number;
}

export interface SessionConfig {
  featureExtractionInterval: number; // milliseconds
  bufferSize: number; // max features to buffer before upload
  uploadBatchSize: number; // features per upload batch
  sampleRate: number; // audio sample rate
  autoUpload: boolean; // auto-upload when buffer reaches threshold
  syncDeviceStatus: boolean; // sync status with BLE device
}

export interface FeatureData {
  timestamp: string;
  rms: number;
  zcr: number;
  intensity: number;
  pitch: number;
}

export interface SessionError {
  type: 'audio' | 'ble' | 'network' | 'feature_extraction' | 'upload';
  message: string;
  timestamp: string;
  recoverable: boolean;
}

// ============================================================================
// Circular Buffer for Memory-Efficient Feature Storage
// ============================================================================

class CircularBuffer<T> {
  private buffer: T[];
  private writeIndex = 0;
  private size = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.writeIndex] = item;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
  }

  getAll(): T[] {
    if (this.size < this.capacity) {
      return this.buffer.slice(0, this.size);
    }
    return [...this.buffer.slice(this.writeIndex), ...this.buffer.slice(0, this.writeIndex)];
  }

  clear(): void {
    this.writeIndex = 0;
    this.size = 0;
    this.buffer = new Array(this.capacity);
  }

  length(): number {
    return this.size;
  }

  isFull(): boolean {
    return this.size >= this.capacity;
  }
}

// ============================================================================
// Pitch Estimation Utility
// ============================================================================

class PitchEstimator {
  /**
   * Estimate pitch using autocorrelation method
   * Simple implementation for real-time processing
   */
  static estimatePitch(audioBuffer: Float32Array, sampleRate: number): number {
    const minPeriod = Math.floor(sampleRate / 500); // 500 Hz max
    const maxPeriod = Math.floor(sampleRate / 60);  // 60 Hz min

    let maxCorrelation = 0;
    let bestPeriod = 0;

    // Autocorrelation
    for (let period = minPeriod; period < maxPeriod; period++) {
      let correlation = 0;
      for (let i = 0; i < audioBuffer.length - period; i++) {
        correlation += audioBuffer[i] * audioBuffer[i + period];
      }

      if (correlation > maxCorrelation) {
        maxCorrelation = correlation;
        bestPeriod = period;
      }
    }

    // Convert period to frequency
    if (bestPeriod > 0) {
      return sampleRate / bestPeriod;
    }

    return 0; // No pitch detected
  }
}

// ============================================================================
// SessionRecorder Class
// ============================================================================

export class SessionRecorder {
  private audioService: TizzyAudioService;
  private bleManager: TizzyBLEManager;
  private state: SessionState = 'idle';
  private config: SessionConfig;

  // Session data
  private sessionId: string | null = null;
  private sessionStartTime: Date | null = null;
  private sessionPausedTime: number = 0; // Total paused time in ms
  private lastPauseTime: Date | null = null;

  // Feature extraction
  private featureExtractionTimer: NodeJS.Timeout | null = null;
  private featureBuffer: CircularBuffer<FeatureData>;
  private uploadQueue: AudioFeature[] = [];

  // Metrics tracking
  private metrics: SessionMetrics = {
    duration: 0,
    totalSamples: 0,
    bufferedFeatures: 0,
    uploadedFeatures: 0,
    averageRMS: 0,
    averageZCR: 0,
    averageIntensity: 0,
    averagePitch: 0,
  };

  // Running averages for metrics
  private rmsSum = 0;
  private zcrSum = 0;
  private intensitySum = 0;
  private pitchSum = 0;
  private pitchCount = 0;

  // Error handling
  private errors: SessionError[] = [];
  private maxErrors = 10;

  // Device status
  private currentDeviceStatus: DeviceStatus | null = null;
  private deviceStatusUnsubscribe: (() => void) | null = null;

  // Callbacks
  private stateChangeCallbacks: Set<(state: SessionState) => void> = new Set();
  private metricsUpdateCallbacks: Set<(metrics: SessionMetrics) => void> = new Set();
  private errorCallbacks: Set<(error: SessionError) => void> = new Set();
  private featureExtractedCallbacks: Set<(feature: FeatureData) => void> = new Set();

  constructor(config?: Partial<SessionConfig>) {
    this.audioService = getAudioService();
    this.bleManager = getBLEManager();

    // Default configuration
    this.config = {
      featureExtractionInterval: 100, // 100ms = 10 Hz
      bufferSize: 1000, // Buffer up to 1000 features
      uploadBatchSize: 100, // Upload 100 features at a time
      sampleRate: 16000, // 16 kHz
      autoUpload: true,
      syncDeviceStatus: true,
      ...config,
    };

    this.featureBuffer = new CircularBuffer<FeatureData>(this.config.bufferSize);

    // Setup BLE device status monitoring if enabled
    if (this.config.syncDeviceStatus) {
      this.setupDeviceStatusMonitoring();
    }
  }

  // ============================================================================
  // Session Lifecycle Management
  // ============================================================================

  /**
   * Start a new recording session
   */
  async startSession(environmentTag: string = 'general', consentMode: string = 'full'): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`Cannot start session: current state is ${this.state}`);
    }

    try {
      console.log('[SessionRecorder] Starting new session');
      this.updateState('recording');

      // Reset metrics
      this.resetMetrics();
      this.sessionStartTime = new Date();
      this.sessionPausedTime = 0;
      this.lastPauseTime = null;

      // Create session on backend
      const deviceId = this.currentDeviceStatus?.device_id || 'mobile-app';
      const sessionPayload: CreateSessionPayload = {
        device_id: deviceId,
        start_time: this.sessionStartTime.toISOString(),
        environment_tag: environmentTag,
        consent_mode: consentMode,
      };

      const sessionResponse = await apiService.createSession(sessionPayload);
      this.sessionId = sessionResponse.id;

      console.log('[SessionRecorder] Session created:', this.sessionId);

      // Start audio recording
      await this.audioService.startRecording({
        sampleRate: this.config.sampleRate,
        channels: 1,
        bitsPerSample: 16,
        format: 'pcm_16bit',
      });

      // Start feature extraction
      this.startFeatureExtraction();

      // Sync with BLE device if connected
      if (this.config.syncDeviceStatus && this.currentDeviceStatus) {
        await this.syncSessionWithDevice('start');
      }

      console.log('[SessionRecorder] Session started successfully');
    } catch (error) {
      this.handleError({
        type: 'audio',
        message: error instanceof Error ? error.message : 'Failed to start session',
        timestamp: new Date().toISOString(),
        recoverable: true,
      });
      this.updateState('idle');
      throw error;
    }
  }

  /**
   * Pause the current recording session
   */
  async pauseSession(): Promise<void> {
    if (this.state !== 'recording') {
      throw new Error(`Cannot pause session: current state is ${this.state}`);
    }

    try {
      console.log('[SessionRecorder] Pausing session');
      this.updateState('paused');

      // Track pause time
      this.lastPauseTime = new Date();

      // Pause audio recording
      await this.audioService.pauseRecording();

      // Stop feature extraction
      this.stopFeatureExtraction();

      // Sync with BLE device if connected
      if (this.config.syncDeviceStatus && this.currentDeviceStatus) {
        await this.syncSessionWithDevice('pause');
      }

      console.log('[SessionRecorder] Session paused');
    } catch (error) {
      this.handleError({
        type: 'audio',
        message: error instanceof Error ? error.message : 'Failed to pause session',
        timestamp: new Date().toISOString(),
        recoverable: true,
      });
      throw error;
    }
  }

  /**
   * Resume a paused recording session
   */
  async resumeSession(): Promise<void> {
    if (this.state !== 'paused') {
      throw new Error(`Cannot resume session: current state is ${this.state}`);
    }

    try {
      console.log('[SessionRecorder] Resuming session');
      this.updateState('recording');

      // Calculate paused duration
      if (this.lastPauseTime) {
        const pauseDuration = Date.now() - this.lastPauseTime.getTime();
        this.sessionPausedTime += pauseDuration;
        this.lastPauseTime = null;
      }

      // Resume audio recording
      await this.audioService.resumeRecording();

      // Restart feature extraction
      this.startFeatureExtraction();

      // Sync with BLE device if connected
      if (this.config.syncDeviceStatus && this.currentDeviceStatus) {
        await this.syncSessionWithDevice('resume');
      }

      console.log('[SessionRecorder] Session resumed');
    } catch (error) {
      this.handleError({
        type: 'audio',
        message: error instanceof Error ? error.message : 'Failed to resume session',
        timestamp: new Date().toISOString(),
        recoverable: true,
      });
      throw error;
    }
  }

  /**
   * Stop the current recording session
   */
  async stopSession(): Promise<string | null> {
    if (this.state !== 'recording' && this.state !== 'paused') {
      console.warn('[SessionRecorder] No active session to stop');
      return null;
    }

    try {
      console.log('[SessionRecorder] Stopping session');
      const previousState = this.state;
      this.updateState('stopped');

      // Calculate final paused time if currently paused
      if (previousState === 'paused' && this.lastPauseTime) {
        const pauseDuration = Date.now() - this.lastPauseTime.getTime();
        this.sessionPausedTime += pauseDuration;
        this.lastPauseTime = null;
      }

      // Stop feature extraction
      this.stopFeatureExtraction();

      // Stop audio recording
      await this.audioService.stopRecording();

      // Upload any remaining buffered features
      await this.uploadBufferedFeatures(true);

      // Calculate session duration (excluding paused time)
      const totalElapsedMs = this.sessionStartTime
        ? Date.now() - this.sessionStartTime.getTime()
        : 0;
      const activeDurationMs = totalElapsedMs - this.sessionPausedTime;
      const activeDurationSeconds = Math.floor(activeDurationMs / 1000);

      // End session on backend
      if (this.sessionId) {
        const endPayload: EndSessionPayload = {
          end_time: new Date().toISOString(),
          total_duration_seconds: activeDurationSeconds,
          speaker_count_estimate: 1, // Will be improved with speaker diarization
        };

        await apiService.endSession(this.sessionId, endPayload);

        console.log('[SessionRecorder] Session ended:', this.sessionId);
      }

      // Sync with BLE device if connected
      if (this.config.syncDeviceStatus && this.currentDeviceStatus) {
        await this.syncSessionWithDevice('stop');
      }

      const sessionId = this.sessionId;

      // Reset session data
      this.sessionId = null;
      this.sessionStartTime = null;
      this.sessionPausedTime = 0;
      this.updateState('idle');

      return sessionId;
    } catch (error) {
      this.handleError({
        type: 'network',
        message: error instanceof Error ? error.message : 'Failed to stop session',
        timestamp: new Date().toISOString(),
        recoverable: false,
      });
      throw error;
    }
  }

  // ============================================================================
  // Feature Extraction
  // ============================================================================

  /**
   * Start real-time feature extraction
   */
  private startFeatureExtraction(): void {
    if (this.featureExtractionTimer) {
      return; // Already running
    }

    console.log('[SessionRecorder] Starting feature extraction');

    this.featureExtractionTimer = setInterval(async () => {
      try {
        await this.extractFeatures();
      } catch (error) {
        this.handleError({
          type: 'feature_extraction',
          message: error instanceof Error ? error.message : 'Feature extraction failed',
          timestamp: new Date().toISOString(),
          recoverable: true,
        });
      }
    }, this.config.featureExtractionInterval);
  }

  /**
   * Stop feature extraction
   */
  private stopFeatureExtraction(): void {
    if (this.featureExtractionTimer) {
      clearInterval(this.featureExtractionTimer);
      this.featureExtractionTimer = null;
      console.log('[SessionRecorder] Stopped feature extraction');
    }
  }

  /**
   * Extract audio features from current recording
   */
  private async extractFeatures(): Promise<void> {
    try {
      // Get current recording status
      const status = await this.audioService.getRecordingStatus();
      if (!status || !status.isRecording) {
        return;
      }

      // For this implementation, we'll use metering data from the recording
      // In production, you'd extract actual PCM samples for analysis
      // This is a simplified version using available metering data

      // Simulate feature extraction (in production, get actual PCM data)
      const mockAudioBuffer = this.generateMockAudioBuffer();

      // Calculate features
      const rms = AudioFeatureExtractor.calculateRMS(mockAudioBuffer);
      const zcr = AudioFeatureExtractor.calculateZCR(mockAudioBuffer);
      const intensity = AudioFeatureExtractor.calculateIntensityDB(mockAudioBuffer);
      const pitch = PitchEstimator.estimatePitch(mockAudioBuffer, this.config.sampleRate);

      const feature: FeatureData = {
        timestamp: new Date().toISOString(),
        rms,
        zcr,
        intensity,
        pitch,
      };

      // Update running averages
      this.updateMetricsWithFeature(feature);

      // Buffer the feature
      this.featureBuffer.push(feature);
      this.metrics.bufferedFeatures = this.featureBuffer.length();

      // Notify callbacks
      this.featureExtractedCallbacks.forEach(cb => cb(feature));
      this.metricsUpdateCallbacks.forEach(cb => cb(this.metrics));

      // Auto-upload if buffer is full
      if (this.config.autoUpload && this.featureBuffer.isFull()) {
        await this.uploadBufferedFeatures(false);
      }
    } catch (error) {
      console.error('[SessionRecorder] Feature extraction error:', error);
      throw error;
    }
  }

  /**
   * Generate mock audio buffer (for demonstration)
   * In production, replace with actual PCM data extraction
   */
  private generateMockAudioBuffer(): Float32Array {
    const bufferSize = Math.floor(this.config.sampleRate * this.config.featureExtractionInterval / 1000);
    const buffer = new Float32Array(bufferSize);

    // Generate simple sine wave with noise (placeholder)
    for (let i = 0; i < bufferSize; i++) {
      const t = i / this.config.sampleRate;
      const signal = Math.sin(2 * Math.PI * 440 * t) * 0.5; // 440 Hz tone
      const noise = (Math.random() - 0.5) * 0.1;
      buffer[i] = signal + noise;
    }

    return buffer;
  }

  /**
   * Update metrics with new feature data
   */
  private updateMetricsWithFeature(feature: FeatureData): void {
    this.metrics.totalSamples++;

    this.rmsSum += feature.rms;
    this.zcrSum += feature.zcr;
    this.intensitySum += feature.intensity;

    if (feature.pitch > 0) {
      this.pitchSum += feature.pitch;
      this.pitchCount++;
    }

    this.metrics.averageRMS = this.rmsSum / this.metrics.totalSamples;
    this.metrics.averageZCR = this.zcrSum / this.metrics.totalSamples;
    this.metrics.averageIntensity = this.intensitySum / this.metrics.totalSamples;
    this.metrics.averagePitch = this.pitchCount > 0 ? this.pitchSum / this.pitchCount : 0;

    // Update duration
    if (this.sessionStartTime) {
      const elapsed = Date.now() - this.sessionStartTime.getTime() - this.sessionPausedTime;
      this.metrics.duration = Math.floor(elapsed / 1000);
    }
  }

  // ============================================================================
  // Feature Upload
  // ============================================================================

  /**
   * Upload buffered features to backend
   */
  private async uploadBufferedFeatures(uploadAll: boolean): Promise<void> {
    if (!this.sessionId) {
      console.warn('[SessionRecorder] No active session, skipping upload');
      return;
    }

    const features = this.featureBuffer.getAll();
    if (features.length === 0) {
      return;
    }

    try {
      // Determine how many features to upload
      const featuresToUpload = uploadAll
        ? features
        : features.slice(0, this.config.uploadBatchSize);

      // Convert to API format
      const audioFeatures: AudioFeature[] = featuresToUpload.map(feature => ({
        timestamp: feature.timestamp,
        feature_vector: [feature.rms, feature.zcr, feature.intensity, feature.pitch],
        metadata: {
          rms: feature.rms,
          zcr: feature.zcr,
          intensity: feature.intensity,
          pitch: feature.pitch,
        },
      }));

      console.log(`[SessionRecorder] Uploading ${audioFeatures.length} features`);

      // Upload to backend
      await apiService.uploadFeatures(this.sessionId, audioFeatures);

      this.metrics.uploadedFeatures += audioFeatures.length;

      // Clear buffer if uploading all, otherwise clear uploaded portion
      if (uploadAll) {
        this.featureBuffer.clear();
      } else {
        // For partial uploads, we need to rebuild the buffer
        // This is a simplification - in production, use a proper queue
        const remaining = features.slice(this.config.uploadBatchSize);
        this.featureBuffer.clear();
        remaining.forEach(f => this.featureBuffer.push(f));
      }

      this.metrics.bufferedFeatures = this.featureBuffer.length();
      this.metricsUpdateCallbacks.forEach(cb => cb(this.metrics));

      console.log('[SessionRecorder] Features uploaded successfully');
    } catch (error) {
      this.handleError({
        type: 'upload',
        message: error instanceof Error ? error.message : 'Feature upload failed',
        timestamp: new Date().toISOString(),
        recoverable: true,
      });
      // Don't throw - we'll retry on next upload
    }
  }

  /**
   * Manually trigger feature upload
   */
  async uploadFeatures(): Promise<void> {
    await this.uploadBufferedFeatures(false);
  }

  // ============================================================================
  // Device Integration
  // ============================================================================

  /**
   * Setup BLE device status monitoring
   */
  private setupDeviceStatusMonitoring(): void {
    // Subscribe to device status updates
    this.deviceStatusUnsubscribe = this.bleManager.onDeviceStatus((status) => {
      console.log('[SessionRecorder] Device status updated:', status);
      this.currentDeviceStatus = status;
    });

    // Subscribe to BLE errors
    const bleErrorUnsubscribe = this.bleManager.onError((bleError) => {
      console.error('[SessionRecorder] BLE error detected:', bleError);

      // Map BLE error to SessionError
      const sessionError: SessionError = {
        type: 'ble',
        message: bleError.message,
        timestamp: new Date().toISOString(),
        recoverable: bleError.recoverable,
      };

      this.handleError(sessionError);

      // If error is non-recoverable, pause the session to prevent silent failures
      if (!bleError.recoverable && this.state === 'recording') {
        console.warn('[SessionRecorder] Non-recoverable BLE error, pausing session');
        this.pauseSession().catch((err) => {
          console.error('[SessionRecorder] Failed to pause session after BLE error:', err);
        });
      }
    });

    // Wrap unsubscribe functions to clean up both subscriptions
    const originalUnsubscribe = this.deviceStatusUnsubscribe;
    this.deviceStatusUnsubscribe = () => {
      if (originalUnsubscribe) {
        originalUnsubscribe();
      }
      bleErrorUnsubscribe();
    };
  }

  /**
   * Sync session state with BLE device
   */
  private async syncSessionWithDevice(action: 'start' | 'pause' | 'resume' | 'stop'): Promise<void> {
    try {
      // Check if device is connected before attempting sync
      const connectionState = this.bleManager.getConnectionState();
      if (connectionState !== 'connected') {
        throw new Error(`Cannot sync with device: device is ${connectionState}`);
      }

      // Send appropriate command to device
      switch (action) {
        case 'start':
          await this.bleManager.sendCommand('start_session', {
            session_id: this.sessionId
          });
          break;
        case 'pause':
          await this.bleManager.sendCommand('pause_session', {
            session_id: this.sessionId
          });
          break;
        case 'resume':
          await this.bleManager.sendCommand('resume_session', {
            session_id: this.sessionId
          });
          break;
        case 'stop':
          await this.bleManager.sendCommand('stop_session', {
            session_id: this.sessionId
          });
          break;
      }

      console.log(`[SessionRecorder] Synced '${action}' with device`);
    } catch (error) {
      // Log detailed error information
      console.error('[SessionRecorder] Device sync failed:', {
        action,
        sessionId: this.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });

      this.handleError({
        type: 'ble',
        message: error instanceof Error ? error.message : 'Failed to sync with device',
        timestamp: new Date().toISOString(),
        recoverable: true,
      });

      // Don't throw - allow session to continue even if sync fails
      // User will be notified via error callback
    }
  }

  // ============================================================================
  // State Management
  // ============================================================================

  /**
   * Update session state and notify listeners
   */
  private updateState(newState: SessionState): void {
    const oldState = this.state;
    this.state = newState;
    console.log(`[SessionRecorder] State changed: ${oldState} -> ${newState}`);
    this.stateChangeCallbacks.forEach(cb => cb(newState));
  }

  /**
   * Get current session state
   */
  getState(): SessionState {
    return this.state;
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get current session metrics
   */
  getMetrics(): SessionMetrics {
    return { ...this.metrics };
  }

  /**
   * Get current device status
   */
  getDeviceStatus(): DeviceStatus | null {
    return this.currentDeviceStatus;
  }

  // ============================================================================
  // Error Handling
  // ============================================================================

  /**
   * Handle and log errors
   */
  private handleError(error: SessionError): void {
    console.error(`[SessionRecorder] Error (${error.type}):`, error.message);

    // Add to error list (maintain max size)
    this.errors.push(error);
    if (this.errors.length > this.maxErrors) {
      this.errors.shift();
    }

    // Notify callbacks
    this.errorCallbacks.forEach(cb => cb(error));

    // Auto-recovery for certain error types
    if (error.recoverable && error.type === 'upload') {
      console.log('[SessionRecorder] Will retry upload on next batch');
    }
  }

  /**
   * Get recent errors
   */
  getErrors(): SessionError[] {
    return [...this.errors];
  }

  /**
   * Clear error history
   */
  clearErrors(): void {
    this.errors = [];
  }

  // ============================================================================
  // Callbacks and Event Listeners
  // ============================================================================

  /**
   * Subscribe to state changes
   */
  onStateChange(callback: (state: SessionState) => void): () => void {
    this.stateChangeCallbacks.add(callback);
    return () => this.stateChangeCallbacks.delete(callback);
  }

  /**
   * Subscribe to metrics updates
   */
  onMetricsUpdate(callback: (metrics: SessionMetrics) => void): () => void {
    this.metricsUpdateCallbacks.add(callback);
    // Immediately call with current metrics
    callback(this.metrics);
    return () => this.metricsUpdateCallbacks.delete(callback);
  }

  /**
   * Subscribe to errors
   */
  onError(callback: (error: SessionError) => void): () => void {
    this.errorCallbacks.add(callback);
    return () => this.errorCallbacks.delete(callback);
  }

  /**
   * Subscribe to feature extraction
   */
  onFeatureExtracted(callback: (feature: FeatureData) => void): () => void {
    this.featureExtractedCallbacks.add(callback);
    return () => this.featureExtractedCallbacks.delete(callback);
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Reset metrics to initial state
   */
  private resetMetrics(): void {
    this.metrics = {
      duration: 0,
      totalSamples: 0,
      bufferedFeatures: 0,
      uploadedFeatures: 0,
      averageRMS: 0,
      averageZCR: 0,
      averageIntensity: 0,
      averagePitch: 0,
    };

    this.rmsSum = 0;
    this.zcrSum = 0;
    this.intensitySum = 0;
    this.pitchSum = 0;
    this.pitchCount = 0;

    this.featureBuffer.clear();
    this.errors = [];
  }

  /**
   * Cleanup and release resources
   */
  async cleanup(): Promise<void> {
    console.log('[SessionRecorder] Cleaning up');

    // Stop any active session
    if (this.state === 'recording' || this.state === 'paused') {
      await this.stopSession();
    }

    // Stop feature extraction
    this.stopFeatureExtraction();

    // Unsubscribe from device status
    if (this.deviceStatusUnsubscribe) {
      this.deviceStatusUnsubscribe();
      this.deviceStatusUnsubscribe = null;
    }

    // Clear all callbacks
    this.stateChangeCallbacks.clear();
    this.metricsUpdateCallbacks.clear();
    this.errorCallbacks.clear();
    this.featureExtractedCallbacks.clear();

    // Clear buffers
    this.featureBuffer.clear();
    this.uploadQueue = [];

    console.log('[SessionRecorder] Cleanup complete');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let sessionRecorderInstance: SessionRecorder | null = null;

/**
 * Get singleton SessionRecorder instance
 */
export function getSessionRecorder(config?: Partial<SessionConfig>): SessionRecorder {
  if (!sessionRecorderInstance) {
    sessionRecorderInstance = new SessionRecorder(config);
  }
  return sessionRecorderInstance;
}

/**
 * Reset singleton instance (useful for testing)
 */
export function resetSessionRecorder(): void {
  if (sessionRecorderInstance) {
    sessionRecorderInstance.cleanup();
    sessionRecorderInstance = null;
  }
}
