import { Audio, AVPlaybackStatus } from 'expo-av';
import { Platform } from 'react-native';

export interface AudioConfig {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  format: 'pcm_16bit' | 'pcm_8bit';
}

export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  sampleRate: 16000,    // Standard for speech
  channels: 1,          // Mono
  bitsPerSample: 16,    // PCM16
  format: 'pcm_16bit'
};

export interface RecordingStatus {
  isRecording: boolean;
  duration: number;
  uri: string | null;
}

export class TizzyAudioService {
  private recording: Audio.Recording | null = null;
  private isRecording = false;
  private recordingCallbacks: Set<(status: RecordingStatus) => void> = new Set();
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    // Constructor is now synchronous - initialization happens lazily on first use
  }

  /**
   * Setup audio permissions and configuration (lazy initialization)
   * Called automatically before first use
   */
  private async ensureInitialized(): Promise<void> {
    // If already initialized, return immediately
    if (this.isInitialized) {
      return;
    }

    // If initialization is in progress, wait for it
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Start initialization
    this.initializationPromise = this.setupAudio();

    try {
      await this.initializationPromise;
      this.isInitialized = true;
      console.log('[Audio] Audio service initialized');
    } catch (error) {
      // Reset promise so next call can retry
      this.initializationPromise = null;
      console.error('[Audio] Failed to initialize audio service:', error);
      throw error;
    }
  }

  /**
   * Setup audio permissions and configuration
   */
  private async setupAudio(): Promise<void> {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });
    } catch (error) {
      console.error('[Audio] Failed to setup audio:', error);
      throw error;
    }
  }

  /**
   * Request microphone permissions
   */
  async requestPermissions(): Promise<boolean> {
    try {
      await this.ensureInitialized();
      const { status } = await Audio.requestPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      console.error('[Audio] Permission request failed:', error);
      return false;
    }
  }

  /**
   * Start audio recording
   */
  async startRecording(config: AudioConfig = DEFAULT_AUDIO_CONFIG): Promise<void> {
    try {
      await this.ensureInitialized();

      if (this.isRecording) {
        console.warn('[Audio] Already recording');
        return;
      }

      console.log('[Audio] Starting recording with config:', config);

      // Configure audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });

      // Create and prepare recording
      const { recording } = await Audio.Recording.createAsync(
        {
          isMeteringEnabled: true,
          android: {
            extension: '.m4a',
            outputFormat: Audio.AndroidOutputFormat.MPEG_4,
            audioEncoder: Audio.AndroidAudioEncoder.AAC,
            sampleRate: config.sampleRate,
            numberOfChannels: config.channels,
            bitRate: 128000,
          },
          ios: {
            extension: '.m4a',
            outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
            audioQuality: Audio.IOSAudioQuality.HIGH,
            sampleRate: config.sampleRate,
            numberOfChannels: config.channels,
            bitRate: 128000,
            linearPCMBitDepth: config.bitsPerSample,
            linearPCMIsBigEndian: false,
            linearPCMIsFloat: false,
          },
          web: {
            mimeType: 'audio/webm',
            bitsPerSecond: 128000,
          },
        },
        this.onRecordingStatusUpdate.bind(this)
      );

      this.recording = recording;
      this.isRecording = true;

      console.log('[Audio] Recording started');
    } catch (error) {
      console.error('[Audio] Failed to start recording:', error);
      throw error;
    }
  }

  /**
   * Stop audio recording
   */
  async stopRecording(): Promise<string | null> {
    try {
      await this.ensureInitialized();

      if (!this.isRecording || !this.recording) {
        console.warn('[Audio] Not recording');
        return null;
      }

      console.log('[Audio] Stopping recording');

      await this.recording.stopAndUnloadAsync();
      const uri = this.recording.getURI();

      this.recording = null;
      this.isRecording = false;

      console.log('[Audio] Recording stopped, URI:', uri);

      return uri;
    } catch (error) {
      console.error('[Audio] Failed to stop recording:', error);
      throw error;
    }
  }

  /**
   * Pause recording
   */
  async pauseRecording(): Promise<void> {
    await this.ensureInitialized();

    if (this.recording && this.isRecording) {
      await this.recording.pauseAsync();
      console.log('[Audio] Recording paused');
    }
  }

  /**
   * Resume recording
   */
  async resumeRecording(): Promise<void> {
    await this.ensureInitialized();

    if (this.recording && this.isRecording) {
      await this.recording.startAsync();
      console.log('[Audio] Recording resumed');
    }
  }

  /**
   * Get current recording status
   */
  async getRecordingStatus(): Promise<Audio.RecordingStatus | null> {
    await this.ensureInitialized();

    if (this.recording) {
      return await this.recording.getStatusAsync();
    }
    return null;
  }

  /**
   * Handle recording status updates
   */
  private onRecordingStatusUpdate(status: Audio.RecordingStatus): void {
    if (status.isRecording) {
      const recordingStatus: RecordingStatus = {
        isRecording: true,
        duration: status.durationMillis,
        uri: this.recording?.getURI() || null,
      };

      this.recordingCallbacks.forEach(cb => cb(recordingStatus));
    }
  }

  /**
   * Register callback for recording status updates
   */
  onRecordingStatusChange(callback: (status: RecordingStatus) => void): () => void {
    this.recordingCallbacks.add(callback);
    return () => this.recordingCallbacks.delete(callback);
  }

  /**
   * Check if currently recording
   */
  isCurrentlyRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Get audio file info
   */
  async getAudioInfo(uri: string): Promise<any> {
    await this.ensureInitialized();

    const { sound } = await Audio.Sound.createAsync({ uri });
    const status = await sound.getStatusAsync();
    await sound.unloadAsync();
    return status;
  }

  /**
   * Play audio file
   */
  async playAudio(uri: string): Promise<Audio.Sound> {
    await this.ensureInitialized();

    const { sound } = await Audio.Sound.createAsync({ uri });
    await sound.playAsync();
    return sound;
  }

  /**
   * Cleanup audio service
   */
  async cleanup(): Promise<void> {
    if (this.recording) {
      await this.stopRecording();
    }
    this.recordingCallbacks.clear();
    this.isInitialized = false;
    this.initializationPromise = null;
  }
}

// Singleton instance
let audioServiceInstance: TizzyAudioService | null = null;

export function getAudioService(): TizzyAudioService {
  if (!audioServiceInstance) {
    audioServiceInstance = new TizzyAudioService();
  }
  return audioServiceInstance;
}

/**
 * Audio Feature Extraction Utilities
 * Note: For production, integrate with Meyda for more advanced features
 */
export class AudioFeatureExtractor {
  /**
   * Calculate RMS (Root Mean Square) energy
   */
  static calculateRMS(audioBuffer: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < audioBuffer.length; i++) {
      sum += audioBuffer[i] * audioBuffer[i];
    }
    return Math.sqrt(sum / audioBuffer.length);
  }

  /**
   * Calculate Zero Crossing Rate
   */
  static calculateZCR(audioBuffer: Float32Array): number {
    let crossings = 0;
    for (let i = 1; i < audioBuffer.length; i++) {
      if ((audioBuffer[i] >= 0 && audioBuffer[i - 1] < 0) ||
          (audioBuffer[i] < 0 && audioBuffer[i - 1] >= 0)) {
        crossings++;
      }
    }
    return crossings / audioBuffer.length;
  }

  /**
   * Estimate intensity/loudness in dB
   */
  static calculateIntensityDB(audioBuffer: Float32Array): number {
    const rms = this.calculateRMS(audioBuffer);
    // Convert RMS to dB (reference: 1.0 = 0 dB)
    return 20 * Math.log10(Math.max(rms, 1e-10));
  }

  /**
   * Basic speech detection using energy and ZCR
   */
  static isSpeech(audioBuffer: Float32Array, energyThreshold = 0.01, zcrThreshold = 0.1): boolean {
    const energy = this.calculateRMS(audioBuffer);
    const zcr = this.calculateZCR(audioBuffer);

    // Speech typically has moderate energy and ZCR
    return energy > energyThreshold && zcr > zcrThreshold && zcr < 0.4;
  }
}
