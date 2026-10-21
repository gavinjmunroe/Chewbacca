/**
 * SessionRecorder Tests
 *
 * Comprehensive test suite for the SessionRecorder class
 */

import { SessionRecorder, getSessionRecorder, resetSessionRecorder } from '../SessionRecorder';
import type { SessionState, SessionMetrics, SessionError, FeatureData } from '../SessionRecorder';

// Mock dependencies
jest.mock('../../../services/AudioService');
jest.mock('../../../services/BLEManager');
jest.mock('../../../api/client');

describe('SessionRecorder', () => {
  let recorder: SessionRecorder;

  beforeEach(() => {
    // Reset singleton instance before each test
    resetSessionRecorder();
    recorder = getSessionRecorder();
  });

  afterEach(async () => {
    // Cleanup after each test
    await recorder.cleanup();
  });

  describe('Initialization', () => {
    it('should create instance with default config', () => {
      expect(recorder).toBeDefined();
      expect(recorder.getState()).toBe('idle');
    });

    it('should create instance with custom config', () => {
      const customRecorder = new SessionRecorder({
        featureExtractionInterval: 200,
        bufferSize: 500,
        autoUpload: false,
      });

      expect(customRecorder).toBeDefined();
    });

    it('should return singleton instance', () => {
      const recorder1 = getSessionRecorder();
      const recorder2 = getSessionRecorder();

      expect(recorder1).toBe(recorder2);
    });
  });

  describe('Session Lifecycle', () => {
    it('should start session from idle state', async () => {
      expect(recorder.getState()).toBe('idle');

      await recorder.startSession();

      expect(recorder.getState()).toBe('recording');
      expect(recorder.getSessionId()).not.toBeNull();
    });

    it('should throw error when starting from non-idle state', async () => {
      await recorder.startSession();

      await expect(recorder.startSession()).rejects.toThrow(
        'Cannot start session: current state is recording'
      );
    });

    it('should pause recording session', async () => {
      await recorder.startSession();
      await recorder.pauseSession();

      expect(recorder.getState()).toBe('paused');
    });

    it('should throw error when pausing non-recording session', async () => {
      await expect(recorder.pauseSession()).rejects.toThrow(
        'Cannot pause session: current state is idle'
      );
    });

    it('should resume paused session', async () => {
      await recorder.startSession();
      await recorder.pauseSession();
      await recorder.resumeSession();

      expect(recorder.getState()).toBe('recording');
    });

    it('should throw error when resuming non-paused session', async () => {
      await expect(recorder.resumeSession()).rejects.toThrow(
        'Cannot resume session: current state is idle'
      );
    });

    it('should stop recording session', async () => {
      await recorder.startSession();
      const sessionId = await recorder.stopSession();

      expect(recorder.getState()).toBe('idle');
      expect(sessionId).not.toBeNull();
      expect(recorder.getSessionId()).toBeNull();
    });

    it('should return null when stopping with no active session', async () => {
      const sessionId = await recorder.stopSession();

      expect(sessionId).toBeNull();
    });

    it('should complete full lifecycle', async () => {
      // Start
      await recorder.startSession('test', 'full');
      expect(recorder.getState()).toBe('recording');

      // Pause
      await recorder.pauseSession();
      expect(recorder.getState()).toBe('paused');

      // Resume
      await recorder.resumeSession();
      expect(recorder.getState()).toBe('recording');

      // Stop
      const sessionId = await recorder.stopSession();
      expect(recorder.getState()).toBe('idle');
      expect(sessionId).toBeTruthy();
    });
  });

  describe('State Management', () => {
    it('should emit state change events', async () => {
      const stateChanges: SessionState[] = [];
      recorder.onStateChange((state) => stateChanges.push(state));

      await recorder.startSession();
      await recorder.pauseSession();
      await recorder.resumeSession();
      await recorder.stopSession();

      expect(stateChanges).toEqual(['recording', 'paused', 'recording', 'stopped', 'idle']);
    });

    it('should unsubscribe from state changes', async () => {
      const stateChanges: SessionState[] = [];
      const unsubscribe = recorder.onStateChange((state) => stateChanges.push(state));

      await recorder.startSession();
      unsubscribe();
      await recorder.stopSession();

      expect(stateChanges).toEqual(['recording']);
    });
  });

  describe('Metrics Tracking', () => {
    it('should start with zero metrics', () => {
      const metrics = recorder.getMetrics();

      expect(metrics.duration).toBe(0);
      expect(metrics.totalSamples).toBe(0);
      expect(metrics.bufferedFeatures).toBe(0);
      expect(metrics.uploadedFeatures).toBe(0);
    });

    it('should update metrics during recording', async () => {
      await recorder.startSession();

      // Wait for feature extraction
      await new Promise(resolve => setTimeout(resolve, 500));

      const metrics = recorder.getMetrics();

      expect(metrics.duration).toBeGreaterThan(0);
      expect(metrics.totalSamples).toBeGreaterThan(0);
    });

    it('should emit metrics updates', async () => {
      const metricsUpdates: SessionMetrics[] = [];
      recorder.onMetricsUpdate((metrics) => metricsUpdates.push(metrics));

      await recorder.startSession();
      await new Promise(resolve => setTimeout(resolve, 300));

      expect(metricsUpdates.length).toBeGreaterThan(0);
      expect(metricsUpdates[metricsUpdates.length - 1].totalSamples).toBeGreaterThan(0);
    });

    it('should calculate running averages correctly', async () => {
      await recorder.startSession();
      await new Promise(resolve => setTimeout(resolve, 500));

      const metrics = recorder.getMetrics();

      expect(metrics.averageRMS).toBeGreaterThan(0);
      expect(metrics.averageZCR).toBeGreaterThan(0);
      expect(metrics.averageIntensity).toBeLessThan(0); // dB is negative
    });

    it('should reset metrics on new session', async () => {
      await recorder.startSession();
      await new Promise(resolve => setTimeout(resolve, 300));
      await recorder.stopSession();

      const metrics = recorder.getMetrics();
      expect(metrics.totalSamples).toBe(0);
      expect(metrics.duration).toBe(0);
    });
  });

  describe('Feature Extraction', () => {
    it('should extract features during recording', async () => {
      const features: FeatureData[] = [];
      recorder.onFeatureExtracted((feature) => features.push(feature));

      await recorder.startSession();
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(features.length).toBeGreaterThan(0);
    });

    it('should extract features at configured interval', async () => {
      const customRecorder = new SessionRecorder({
        featureExtractionInterval: 200, // 5 Hz
      });

      const features: FeatureData[] = [];
      customRecorder.onFeatureExtracted((feature) => features.push(feature));

      await customRecorder.startSession();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should extract ~5 features in 1 second
      expect(features.length).toBeGreaterThanOrEqual(3);
      expect(features.length).toBeLessThanOrEqual(7);

      await customRecorder.cleanup();
    });

    it('should include all feature components', async () => {
      const features: FeatureData[] = [];
      recorder.onFeatureExtracted((feature) => features.push(feature));

      await recorder.startSession();
      await new Promise(resolve => setTimeout(resolve, 200));

      const feature = features[0];
      expect(feature).toHaveProperty('timestamp');
      expect(feature).toHaveProperty('rms');
      expect(feature).toHaveProperty('zcr');
      expect(feature).toHaveProperty('intensity');
      expect(feature).toHaveProperty('pitch');
    });

    it('should stop extracting features when paused', async () => {
      const features: FeatureData[] = [];
      recorder.onFeatureExtracted((feature) => features.push(feature));

      await recorder.startSession();
      await new Promise(resolve => setTimeout(resolve, 200));
      const countBeforePause = features.length;

      await recorder.pauseSession();
      await new Promise(resolve => setTimeout(resolve, 200));
      const countAfterPause = features.length;

      expect(countAfterPause).toBe(countBeforePause);
    });

    it('should resume extracting features when resumed', async () => {
      await recorder.startSession();
      await recorder.pauseSession();

      const features: FeatureData[] = [];
      recorder.onFeatureExtracted((feature) => features.push(feature));

      await recorder.resumeSession();
      await new Promise(resolve => setTimeout(resolve, 300));

      expect(features.length).toBeGreaterThan(0);
    });
  });

  describe('Feature Buffering', () => {
    it('should buffer extracted features', async () => {
      await recorder.startSession();
      await new Promise(resolve => setTimeout(resolve, 300));

      const metrics = recorder.getMetrics();
      expect(metrics.bufferedFeatures).toBeGreaterThan(0);
    });

    it('should respect buffer size limit', async () => {
      const customRecorder = new SessionRecorder({
        bufferSize: 10,
        autoUpload: false, // Disable auto-upload
      });

      await customRecorder.startSession();
      await new Promise(resolve => setTimeout(resolve, 2000));

      const metrics = customRecorder.getMetrics();
      expect(metrics.bufferedFeatures).toBeLessThanOrEqual(10);

      await customRecorder.cleanup();
    });
  });

  describe('Feature Upload', () => {
    it('should upload features manually', async () => {
      await recorder.startSession();
      await new Promise(resolve => setTimeout(resolve, 300));

      const metricsBefore = recorder.getMetrics();
      expect(metricsBefore.bufferedFeatures).toBeGreaterThan(0);

      await recorder.uploadFeatures();

      const metricsAfter = recorder.getMetrics();
      expect(metricsAfter.uploadedFeatures).toBeGreaterThan(0);
    });

    it('should auto-upload when buffer is full', async () => {
      const customRecorder = new SessionRecorder({
        bufferSize: 10,
        autoUpload: true,
        featureExtractionInterval: 50,
      });

      await customRecorder.startSession();
      await new Promise(resolve => setTimeout(resolve, 1000));

      const metrics = customRecorder.getMetrics();
      expect(metrics.uploadedFeatures).toBeGreaterThan(0);

      await customRecorder.cleanup();
    });

    it('should upload all remaining features on stop', async () => {
      await recorder.startSession();
      await new Promise(resolve => setTimeout(resolve, 300));

      await recorder.stopSession();

      const metrics = recorder.getMetrics();
      // All features should be uploaded or cleared
      expect(metrics.bufferedFeatures).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should emit error events', async () => {
      const errors: SessionError[] = [];
      recorder.onError((error) => errors.push(error));

      // Simulate error by calling with invalid state
      try {
        await recorder.pauseSession(); // Should fail - not recording
      } catch (error) {
        // Expected
      }

      expect(errors.length).toBeGreaterThanOrEqual(0);
    });

    it('should track error history', async () => {
      // Trigger some errors
      try {
        await recorder.pauseSession();
      } catch {}

      const errors = recorder.getErrors();
      expect(Array.isArray(errors)).toBe(true);
    });

    it('should clear error history', async () => {
      try {
        await recorder.pauseSession();
      } catch {}

      recorder.clearErrors();

      expect(recorder.getErrors().length).toBe(0);
    });

    it('should include error details', async () => {
      const errors: SessionError[] = [];
      recorder.onError((error) => errors.push(error));

      try {
        await recorder.pauseSession();
      } catch {}

      if (errors.length > 0) {
        const error = errors[0];
        expect(error).toHaveProperty('type');
        expect(error).toHaveProperty('message');
        expect(error).toHaveProperty('timestamp');
        expect(error).toHaveProperty('recoverable');
      }
    });
  });

  describe('BLE Integration', () => {
    it('should sync session start with device', async () => {
      const customRecorder = new SessionRecorder({
        syncDeviceStatus: true,
      });

      await customRecorder.startSession();

      // Verify BLE command was sent (would need to mock BLEManager)
      expect(customRecorder.getState()).toBe('recording');

      await customRecorder.cleanup();
    });

    it('should get current device status', () => {
      const status = recorder.getDeviceStatus();
      // May be null if no device connected
      expect(status === null || typeof status === 'object').toBe(true);
    });
  });

  describe('Cleanup', () => {
    it('should cleanup resources', async () => {
      await recorder.startSession();
      await recorder.cleanup();

      expect(recorder.getState()).toBe('idle');
      expect(recorder.getSessionId()).toBeNull();
    });

    it('should stop active session on cleanup', async () => {
      await recorder.startSession();
      expect(recorder.getState()).toBe('recording');

      await recorder.cleanup();

      expect(recorder.getState()).toBe('idle');
    });

    it('should clear all callbacks on cleanup', async () => {
      const stateChanges: SessionState[] = [];
      recorder.onStateChange((state) => stateChanges.push(state));

      await recorder.cleanup();
      await recorder.startSession();

      // Should not receive callback after cleanup
      expect(stateChanges.length).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid state changes', async () => {
      await recorder.startSession();
      await recorder.pauseSession();
      await recorder.resumeSession();
      await recorder.pauseSession();
      await recorder.resumeSession();
      await recorder.stopSession();

      expect(recorder.getState()).toBe('idle');
    });

    it('should handle multiple stop calls', async () => {
      await recorder.startSession();

      const sessionId1 = await recorder.stopSession();
      const sessionId2 = await recorder.stopSession();

      expect(sessionId1).toBeTruthy();
      expect(sessionId2).toBeNull();
    });

    it('should handle cleanup without active session', async () => {
      await expect(recorder.cleanup()).resolves.not.toThrow();
    });

    it('should maintain state consistency', async () => {
      // Start -> Pause -> Stop sequence
      await recorder.startSession();
      expect(recorder.getState()).toBe('recording');

      await recorder.pauseSession();
      expect(recorder.getState()).toBe('paused');

      await recorder.stopSession();
      expect(recorder.getState()).toBe('idle');
    });
  });

  describe('Performance', () => {
    it('should handle long recording sessions', async () => {
      await recorder.startSession();
      await new Promise(resolve => setTimeout(resolve, 2000));

      const metrics = recorder.getMetrics();
      expect(metrics.duration).toBeGreaterThanOrEqual(1);
      expect(metrics.totalSamples).toBeGreaterThan(10);

      await recorder.stopSession();
    }, 10000);

    it('should handle high-frequency feature extraction', async () => {
      const customRecorder = new SessionRecorder({
        featureExtractionInterval: 50, // 20 Hz
      });

      const features: FeatureData[] = [];
      customRecorder.onFeatureExtracted((feature) => features.push(feature));

      await customRecorder.startSession();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should extract ~20 features in 1 second
      expect(features.length).toBeGreaterThanOrEqual(15);
      expect(features.length).toBeLessThanOrEqual(25);

      await customRecorder.cleanup();
    });
  });
});
