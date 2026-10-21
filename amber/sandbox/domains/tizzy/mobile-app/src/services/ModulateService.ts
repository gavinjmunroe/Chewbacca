/**
 * Modulate ELM API Integration Service
 *
 * Provides integration with Modulate's Emotional Language Model (ELM) API for voice emotion detection.
 *
 * Features:
 * - Audio analysis for emotional prosody
 * - Voice feature extraction
 * - Emotion classification
 * - Rate limiting support
 * - Graceful fallbacks for development mode
 * - Comprehensive error handling
 *
 * TODO: Configure the following when Modulate API access is available:
 * 1. Set MODULATE_API_KEY in your environment variables (.env.local or app config)
 * 2. Verify API endpoint (https://api.modulate.com/v1 or your specific endpoint)
 * 3. Test with actual API responses and update mock data accordingly
 * 4. Implement request signing if required by Modulate API
 * 5. Configure rate limiting thresholds based on your API plan
 * 6. Set up monitoring and alerting for API errors
 */

import { captureException, addBreadcrumb } from './ErrorTracking';

// ==================== Types & Interfaces ====================

/**
 * Audio buffer input for analysis
 */
export interface AudioBuffer {
  data: Float32Array;
  sampleRate: number;
  duration: number;
  channels?: number;
}

/**
 * Prosody features extracted from audio
 */
export interface ProsodyFeatures {
  // Fundamental frequency (pitch)
  f0Mean?: number;
  f0Min?: number;
  f0Max?: number;
  f0StdDev?: number;

  // Intensity/Energy
  intensityMean?: number;
  intensityMin?: number;
  intensityMax?: number;
  intensityStdDev?: number;

  // Duration and timing
  duration?: number;
  speechRate?: number;

  // Voice quality
  jitter?: number;
  shimmer?: number;
  harmonicNoiseRatio?: number;

  // Additional features
  mfcc?: number[];
  spectralCentroid?: number;
  zeroCrossingRate?: number;
}

/**
 * Emotional voice features
 */
export interface VoiceEmotionFeatures {
  features: ProsodyFeatures;
  timestamp?: number;
  audioUri?: string;
  confidence?: number;
}

/**
 * Emotion classification result
 */
export interface EmotionResult {
  emotion: 'neutral' | 'happy' | 'sad' | 'angry' | 'fearful' | 'surprised' | 'disgusted';
  confidence: number;
  scores?: {
    neutral: number;
    happy: number;
    sad: number;
    angry: number;
    fearful: number;
    surprised: number;
    disgusted: number;
  };
}

/**
 * Prosody analysis result
 */
export interface ProsodyAnalysisResult {
  features: ProsodyFeatures;
  voiceCharacteristics: {
    pitchVariation: 'low' | 'moderate' | 'high';
    energyLevel: 'low' | 'moderate' | 'high';
    speechRate: 'slow' | 'normal' | 'fast';
    voiceQuality: 'clear' | 'hoarse' | 'breathy' | 'nasal';
  };
  confidence: number;
}

/**
 * Audio analysis result
 */
export interface AudioAnalysisResult {
  success: boolean;
  audioId?: string;
  duration: number;
  sampleRate: number;
  emotion?: EmotionResult;
  prosody?: ProsodyAnalysisResult;
  errors?: string[];
  timestamp: number;
  mock?: boolean;
}

/**
 * Modulate API error response
 */
export interface ModulateError {
  code: string;
  message: string;
  details?: Record<string, any>;
  statusCode?: number;
}

/**
 * Rate limit information
 */
export interface RateLimitInfo {
  requestsRemaining: number;
  requestsLimit: number;
  resetTime: number;
  isLimited: boolean;
}

/**
 * API request wrapper
 */
interface ModulateRequest {
  method: 'POST' | 'GET';
  endpoint: string;
  body?: Record<string, any>;
  timeout?: number;
}

/**
 * API response wrapper
 */
interface ModulateResponse<T> {
  success: boolean;
  data?: T;
  error?: ModulateError;
  rateLimit?: RateLimitInfo;
}

// ==================== Configuration ====================

/**
 * API Configuration
 *
 * Current Status: MOCK MODE (API key not configured)
 *
 * TODO: To enable real Modulate API integration:
 * 1. Obtain API key from Modulate (https://modulate.com)
 * 2. Set environment variable EXPO_PUBLIC_MODULATE_API_KEY in .env.local
 * 3. Verify the API endpoint URL with Modulate documentation
 * 4. Test with small audio samples first
 * 5. Update rate limits based on your API plan tier
 *
 * Mock Behavior (when API key is not set):
 * - All methods return simulated data for development/testing
 * - Emotion results use pseudo-random values
 * - Prosody features are generated with realistic ranges
 * - No actual API calls are made
 * - Rate limiting is simulated locally
 */
const MODULATE_API_KEY = process.env.EXPO_PUBLIC_MODULATE_API_KEY || process.env.MODULATE_API_KEY;

/**
 * API Endpoint Configuration
 *
 * TODO: Update with actual Modulate API endpoint when available
 * Default: https://api.modulate.com/v1 (verify with Modulate docs)
 *
 * Set EXPO_PUBLIC_MODULATE_ENDPOINT to override
 */
const MODULATE_API_ENDPOINT = process.env.EXPO_PUBLIC_MODULATE_ENDPOINT || 'https://api.modulate.com/v1';

// Rate limiting constants
const DEFAULT_RATE_LIMIT = 100; // requests per minute
const RATE_LIMIT_WINDOW = 60000; // 1 minute in ms
const REQUEST_TIMEOUT = 30000; // 30 seconds

// Session tracking for warnings
let hasShownApiWarning = false;

// ==================== Mock Responses ====================
//
// These functions provide simulated responses when the Modulate API is not configured.
// They generate realistic but random data for development and testing purposes.
//
// IMPORTANT: Mock data should NOT be used for actual emotion detection or analysis.
// Configure the API key to get real emotion detection results.
//
// Mock data characteristics:
// - Pseudo-random but deterministic within reasonable ranges
// - Matches expected data structures and value ranges
// - Useful for UI development, testing, and demonstrations
// - No actual audio analysis is performed
//
// ======================================================================

/**
 * Generate mock emotion result for development
 *
 * Returns pseudo-random emotion classification with realistic confidence scores.
 */
function generateMockEmotionResult(audioBuffer?: AudioBuffer): EmotionResult {
  // Simulate emotion detection with pseudo-random scores
  const emotions = ['neutral', 'happy', 'sad', 'angry', 'fearful', 'surprised', 'disgusted'] as const;
  const randomEmotion = emotions[Math.floor(Math.random() * emotions.length)];

  const baseScore = Math.random() * 0.3 + 0.4; // 0.4-0.7
  const scores = emotions.reduce((acc, emotion) => {
    if (emotion === randomEmotion) {
      acc[emotion] = baseScore + Math.random() * 0.3;
    } else {
      acc[emotion] = Math.random() * 0.3;
    }
    return acc;
  }, {} as Record<string, number>);

  // Normalize scores to sum to 1
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  Object.keys(scores).forEach(key => {
    scores[key as typeof emotions[number]] = scores[key as typeof emotions[number]] / total;
  });

  return {
    emotion: randomEmotion,
    confidence: scores[randomEmotion],
    scores: scores as any,
  };
}

/**
 * Generate mock prosody features for development
 *
 * Returns simulated prosody features (pitch, intensity, timing, quality)
 * with values in realistic ranges for human voice.
 */
function generateMockProsodyFeatures(audioBuffer?: AudioBuffer): ProsodyFeatures {
  return {
    f0Mean: Math.random() * 100 + 100, // 100-200 Hz
    f0Min: Math.random() * 50 + 70,
    f0Max: Math.random() * 100 + 200,
    f0StdDev: Math.random() * 30,
    intensityMean: Math.random() * 20 - 40, // -40 to -20 dB
    intensityMin: Math.random() * 20 - 60,
    intensityMax: Math.random() * 10,
    intensityStdDev: Math.random() * 10,
    duration: audioBuffer?.duration || 5,
    speechRate: Math.random() * 2 + 3, // 3-5 syllables per second
    jitter: Math.random() * 0.02,
    shimmer: Math.random() * 0.05,
    harmonicNoiseRatio: Math.random() * 20 + 10,
    spectralCentroid: Math.random() * 4000 + 2000,
    zeroCrossingRate: Math.random() * 0.2,
  };
}

/**
 * Generate mock prosody analysis result
 *
 * Returns complete prosody analysis with features and categorical
 * voice characteristics (pitch variation, energy, rate, quality).
 */
function generateMockProsodyAnalysis(audioBuffer?: AudioBuffer): ProsodyAnalysisResult {
  const features = generateMockProsodyFeatures(audioBuffer);
  const pitchVariations = ['low', 'moderate', 'high'] as const;
  const energyLevels = ['low', 'moderate', 'high'] as const;
  const speechRates = ['slow', 'normal', 'fast'] as const;
  const voiceQualities = ['clear', 'hoarse', 'breathy', 'nasal'] as const;

  return {
    features,
    voiceCharacteristics: {
      pitchVariation: pitchVariations[Math.floor(Math.random() * pitchVariations.length)],
      energyLevel: energyLevels[Math.floor(Math.random() * energyLevels.length)],
      speechRate: speechRates[Math.floor(Math.random() * speechRates.length)],
      voiceQuality: voiceQualities[Math.floor(Math.random() * voiceQualities.length)],
    },
    confidence: Math.random() * 0.2 + 0.7, // 0.7-0.9
  };
}

// ==================== Modulate ELM API Client ====================

/**
 * Main Modulate API service for voice emotion and prosody analysis
 */
export class ModulateService {
  private apiKey: string | undefined;
  private apiEndpoint: string;
  private isAvailable: boolean;
  private requestCount = 0;
  private windowStartTime = Date.now();
  private currentRateLimit: RateLimitInfo;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || MODULATE_API_KEY;
    this.apiEndpoint = MODULATE_API_ENDPOINT;
    this.isAvailable = !!this.apiKey;

    this.currentRateLimit = {
      requestsRemaining: DEFAULT_RATE_LIMIT,
      requestsLimit: DEFAULT_RATE_LIMIT,
      resetTime: Date.now() + RATE_LIMIT_WINDOW,
      isLimited: false,
    };

    if (!this.isAvailable) {
      // Show warning only once per session to avoid log spam
      if (!hasShownApiWarning) {
        console.warn('┌─────────────────────────────────────────────────────────────────┐');
        console.warn('│ Modulate API - Running in MOCK MODE                            │');
        console.warn('├─────────────────────────────────────────────────────────────────┤');
        console.warn('│ API key not configured. All responses are simulated.            │');
        console.warn('│                                                                 │');
        console.warn('│ To enable real Modulate API integration:                       │');
        console.warn('│ 1. Get API key from https://modulate.com                       │');
        console.warn('│ 2. Add to .env.local:                                          │');
        console.warn('│    EXPO_PUBLIC_MODULATE_API_KEY=your_key_here                  │');
        console.warn('│ 3. Restart the development server                              │');
        console.warn('│                                                                 │');
        console.warn('│ Mock behavior: Generates realistic but fake emotion/prosody    │');
        console.warn('│ data for development and testing purposes.                     │');
        console.warn('└─────────────────────────────────────────────────────────────────┘');
        hasShownApiWarning = true;
      }
    } else {
      console.log('[Modulate] Service initialized with API key');
    }
  }

  /**
   * Check if the API is available
   */
  isAPIAvailable(): boolean {
    return this.isAvailable;
  }

  /**
   * Get current rate limit status
   */
  getRateLimit(): RateLimitInfo {
    return { ...this.currentRateLimit };
  }

  /**
   * Update rate limit tracking
   */
  private updateRateLimit(response?: any): void {
    const now = Date.now();

    // Reset window if expired
    if (now - this.windowStartTime > RATE_LIMIT_WINDOW) {
      this.requestCount = 0;
      this.windowStartTime = now;
      this.currentRateLimit.requestsRemaining = DEFAULT_RATE_LIMIT;
      this.currentRateLimit.resetTime = now + RATE_LIMIT_WINDOW;
    }

    // Increment request count
    this.requestCount++;
    this.currentRateLimit.requestsRemaining = Math.max(0, DEFAULT_RATE_LIMIT - this.requestCount);
    this.currentRateLimit.isLimited = this.currentRateLimit.requestsRemaining === 0;

    /**
     * TODO: Parse actual rate limit headers from Modulate API response
     *
     * When API is enabled, uncomment and configure:
     * - Check Modulate API documentation for exact header names
     * - Common patterns: x-ratelimit-*, x-rate-limit-*, ratelimit-*
     * - Adjust header names based on actual Modulate API response
     *
     * if (response?.headers) {
     *   const remaining = parseInt(response.headers['x-ratelimit-remaining'] || '');
     *   const limit = parseInt(response.headers['x-ratelimit-limit'] || '');
     *   const reset = parseInt(response.headers['x-ratelimit-reset'] || '');
     *   if (!isNaN(remaining) && !isNaN(limit)) {
     *     this.currentRateLimit.requestsRemaining = remaining;
     *     this.currentRateLimit.requestsLimit = limit;
     *     this.currentRateLimit.resetTime = reset * 1000;
     *   }
     * }
     */
  }

  /**
   * Make a request to the Modulate API
   */
  private async makeRequest<T>(request: ModulateRequest): Promise<ModulateResponse<T>> {
    if (this.currentRateLimit.isLimited) {
      const error: ModulateError = {
        code: 'RATE_LIMITED',
        message: `Rate limit exceeded. Resets at ${new Date(this.currentRateLimit.resetTime).toISOString()}`,
        statusCode: 429,
      };
      return { success: false, error };
    }

    try {
      this.updateRateLimit();

      /**
       * TODO: Implement actual API request when credentials are available
       *
       * Steps to enable:
       * 1. Verify authentication method with Modulate API docs
       *    - Bearer token auth vs API key header
       *    - May need both or just one
       * 2. Test with curl first to verify headers work
       * 3. Uncomment and adjust the fetch call below
       * 4. Update error handling based on actual API error responses
       * 5. Add retry logic for transient failures if needed
       *
       * Example implementation:
       * const headers = {
       *   'Authorization': `Bearer ${this.apiKey}`,
       *   'Content-Type': 'application/json',
       *   'X-API-Key': this.apiKey,  // May not need both - verify with docs
       * };
       *
       * const response = await fetch(
       *   `${this.apiEndpoint}${request.endpoint}`,
       *   {
       *     method: request.method,
       *     headers,
       *     body: request.body ? JSON.stringify(request.body) : undefined,
       *     signal: AbortSignal.timeout(request.timeout || REQUEST_TIMEOUT),
       *   }
       * );
       *
       * if (!response.ok) {
       *   const errorData = await response.json();
       *   throw new Error(`API error: ${response.status} - ${errorData.message}`);
       * }
       *
       * return await response.json();
       */

      const mockResponse: ModulateResponse<T> = {
        success: true,
        rateLimit: this.currentRateLimit,
      };
      return mockResponse;
    } catch (error) {
      const modulateError: ModulateError = {
        code: 'REQUEST_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
        statusCode: 500,
      };

      captureException(
        error instanceof Error ? error : new Error(String(error)),
        { service: 'ModulateService', request },
        'error'
      );

      return { success: false, error: modulateError };
    }
  }

  /**
   * Analyze audio for emotional content
   *
   * @param audioBuffer The audio data to analyze
   * @returns Analysis result with emotion and prosody data
   */
  async analyzeAudio(audioBuffer: AudioBuffer): Promise<AudioAnalysisResult> {
    const startTime = Date.now();

    addBreadcrumb({
      category: 'modulate',
      message: 'Starting audio analysis',
      level: 'info',
      data: {
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        channels: audioBuffer.channels || 1,
      },
    });

    try {
      // Validate input
      if (!audioBuffer.data || audioBuffer.data.length === 0) {
        throw new Error('Audio buffer is empty');
      }

      if (!this.isAvailable) {
        // MOCK MODE: Return simulated response for development
        // This generates random but realistic emotion and prosody data
        return this.generateMockAudioAnalysis(audioBuffer);
      }

      /**
       * TODO: When API is available, implement real audio analysis
       *
       * Integration steps:
       * 1. Audio Format Conversion:
       *    - Check Modulate API docs for required audio format
       *    - May need: Base64, WAV, raw PCM, or other format
       *    - Convert Float32Array to required format
       *    - Example: base64Encode(float32ToWav(audioBuffer.data))
       *
       * 2. API Endpoint:
       *    - Verify endpoint: /analyze, /emotion, or /voice-analysis
       *    - Check request body structure in API docs
       *
       * 3. Response Mapping:
       *    - Map API response to AudioAnalysisResult interface
       *    - Extract emotion scores and prosody features
       *    - Handle partial results gracefully
       */

      const request: ModulateRequest = {
        method: 'POST',
        endpoint: '/analyze',
        body: {
          audio: Array.from(audioBuffer.data),
          sampleRate: audioBuffer.sampleRate,
          duration: audioBuffer.duration,
        },
        timeout: REQUEST_TIMEOUT,
      };

      const response = await this.makeRequest<any>(request);

      if (!response.success) {
        throw new Error(response.error?.message || 'Analysis failed');
      }

      /**
       * TODO: Parse actual API response and map to AudioAnalysisResult
       *
       * When implementing:
       * - Extract emotion data from response.data.emotion or similar
       * - Extract prosody features from response.data.prosody or similar
       * - Map confidence scores to 0-1 range if needed
       * - Handle missing fields with defaults
       * - Add audioId from response if available
       *
       * Example mapping:
       * const result: AudioAnalysisResult = {
       *   success: true,
       *   audioId: response.data.id,
       *   duration: audioBuffer.duration,
       *   sampleRate: audioBuffer.sampleRate,
       *   emotion: {
       *     emotion: response.data.emotion.primary,
       *     confidence: response.data.emotion.confidence,
       *     scores: response.data.emotion.all_scores,
       *   },
       *   prosody: response.data.prosody,
       *   timestamp: startTime,
       * };
       */
      // MOCK: Using generated data until API is configured
      const result: AudioAnalysisResult = {
        success: true,
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        emotion: generateMockEmotionResult(audioBuffer),
        prosody: generateMockProsodyAnalysis(audioBuffer),
        timestamp: startTime,
        mock: true, // Flag indicating this is mock data
      };

      addBreadcrumb({
        category: 'modulate',
        message: 'Audio analysis completed',
        level: 'info',
        data: {
          emotion: result.emotion?.emotion,
          confidence: result.emotion?.confidence,
          duration: Date.now() - startTime,
        },
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during audio analysis';
      captureException(
        error instanceof Error ? error : new Error(errorMessage),
        { service: 'ModulateService', method: 'analyzeAudio' },
        'error'
      );

      return {
        success: false,
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        errors: [errorMessage],
        timestamp: startTime,
      };
    }
  }

  /**
   * Get voice emotion classification from extracted features
   *
   * @param voiceFeatures Extracted voice features
   * @returns Emotion classification result
   */
  async getVoiceEmotion(voiceFeatures: VoiceEmotionFeatures): Promise<EmotionResult> {
    const startTime = Date.now();

    addBreadcrumb({
      category: 'modulate',
      message: 'Getting voice emotion classification',
      level: 'info',
      data: {
        timestamp: voiceFeatures.timestamp,
      },
    });

    try {
      // Validate input
      if (!voiceFeatures.features) {
        throw new Error('Voice features are required');
      }

      if (!this.isAvailable) {
        // MOCK MODE: Return simulated emotion classification
        return generateMockEmotionResult();
      }

      /**
       * TODO: When API is available, implement real emotion classification
       *
       * Integration steps:
       * 1. Feature Submission:
       *    - Send prosody features to /emotion or /classify endpoint
       *    - Include all available features for best accuracy
       *    - May need to normalize features to specific ranges
       *
       * 2. Response Processing:
       *    - Parse emotion scores from response
       *    - Identify primary emotion (highest score)
       *    - Return all scores for confidence analysis
       */

      const request: ModulateRequest = {
        method: 'POST',
        endpoint: '/emotion',
        body: {
          features: voiceFeatures.features,
        },
        timeout: REQUEST_TIMEOUT,
      };

      const response = await this.makeRequest<any>(request);

      if (!response.success) {
        throw new Error(response.error?.message || 'Emotion classification failed');
      }

      /**
       * TODO: Parse actual API response and map to EmotionResult
       *
       * When implementing:
       * - Map response emotion labels to our enum values
       * - Ensure confidence is in 0-1 range
       * - Populate scores object with all emotion probabilities
       *
       * Example:
       * const result: EmotionResult = {
       *   emotion: response.data.primary_emotion,
       *   confidence: response.data.confidence,
       *   scores: response.data.emotion_scores,
       * };
       */
      // MOCK: Using generated data until API is configured
      const result = generateMockEmotionResult();

      addBreadcrumb({
        category: 'modulate',
        message: 'Voice emotion classified',
        level: 'info',
        data: {
          emotion: result.emotion,
          confidence: result.confidence,
          duration: Date.now() - startTime,
        },
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during emotion classification';
      captureException(
        error instanceof Error ? error : new Error(errorMessage),
        { service: 'ModulateService', method: 'getVoiceEmotion' },
        'error'
      );

      // Return neutral as fallback
      return {
        emotion: 'neutral',
        confidence: 0,
        scores: {
          neutral: 1,
          happy: 0,
          sad: 0,
          angry: 0,
          fearful: 0,
          surprised: 0,
          disgusted: 0,
        },
      };
    }
  }

  /**
   * Analyze prosody features (pitch, energy, timing)
   *
   * @param features Voice features to analyze
   * @returns Detailed prosody analysis result
   */
  async analyzeProsody(features: ProsodyFeatures): Promise<ProsodyAnalysisResult> {
    const startTime = Date.now();

    addBreadcrumb({
      category: 'modulate',
      message: 'Starting prosody analysis',
      level: 'info',
    });

    try {
      // Validate input
      if (!features || Object.keys(features).length === 0) {
        throw new Error('Prosody features are required');
      }

      if (!this.isAvailable) {
        // MOCK MODE: Return simulated prosody analysis
        return generateMockProsodyAnalysis();
      }

      /**
       * TODO: When API is available, implement real prosody analysis
       *
       * Integration steps:
       * 1. Feature Submission:
       *    - Send raw prosody features to /prosody endpoint
       *    - Include f0, intensity, timing, and quality features
       *
       * 2. Response Processing:
       *    - Parse voice characteristics interpretation
       *    - Get categorized pitch, energy, rate, quality
       *    - Extract confidence scores
       *
       * 3. Interpretation:
       *    - Map numeric features to categorical descriptions
       *    - Provide actionable voice quality feedback
       */

      const request: ModulateRequest = {
        method: 'POST',
        endpoint: '/prosody',
        body: { features },
        timeout: REQUEST_TIMEOUT,
      };

      const response = await this.makeRequest<any>(request);

      if (!response.success) {
        throw new Error(response.error?.message || 'Prosody analysis failed');
      }

      /**
       * TODO: Parse actual API response and map to ProsodyAnalysisResult
       *
       * When implementing:
       * - Map response features to ProsodyFeatures interface
       * - Extract voice characteristics interpretations
       * - Ensure all categorical values match our types
       *
       * Example:
       * const result: ProsodyAnalysisResult = {
       *   features: response.data.features,
       *   voiceCharacteristics: {
       *     pitchVariation: response.data.characteristics.pitch,
       *     energyLevel: response.data.characteristics.energy,
       *     speechRate: response.data.characteristics.rate,
       *     voiceQuality: response.data.characteristics.quality,
       *   },
       *   confidence: response.data.confidence,
       * };
       */
      // MOCK: Using generated data until API is configured
      const result = generateMockProsodyAnalysis();

      addBreadcrumb({
        category: 'modulate',
        message: 'Prosody analysis completed',
        level: 'info',
        data: {
          pitchVariation: result.voiceCharacteristics.pitchVariation,
          energyLevel: result.voiceCharacteristics.energyLevel,
          duration: Date.now() - startTime,
        },
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during prosody analysis';
      captureException(
        error instanceof Error ? error : new Error(errorMessage),
        { service: 'ModulateService', method: 'analyzeProsody' },
        'error'
      );

      // Return default prosody result on error
      return {
        features,
        voiceCharacteristics: {
          pitchVariation: 'moderate',
          energyLevel: 'moderate',
          speechRate: 'normal',
          voiceQuality: 'clear',
        },
        confidence: 0,
      };
    }
  }

  /**
   * Generate mock audio analysis result for development
   *
   * MOCK BEHAVIOR:
   * - Generates pseudo-random emotion classifications
   * - Creates realistic prosody feature values
   * - Returns immediately without network calls
   * - Useful for UI development and testing
   * - Should NOT be used for actual emotion detection
   */
  private generateMockAudioAnalysis(audioBuffer: AudioBuffer): AudioAnalysisResult {
    return {
      success: true,
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      emotion: generateMockEmotionResult(audioBuffer),
      prosody: generateMockProsodyAnalysis(audioBuffer),
      timestamp: Date.now(),
      mock: true, // Flag indicating this is simulated data
    };
  }

  /**
   * Health check to verify API connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.isAvailable) {
        console.warn('[Modulate] API not configured. Health check skipped.');
        return false;
      }

      /**
       * TODO: When API is available, implement actual health check
       *
       * Integration steps:
       * 1. Verify health check endpoint with Modulate docs
       *    - May be /health, /status, /ping, or similar
       * 2. Implement periodic health checks for monitoring
       * 3. Consider caching health status to reduce API calls
       *
       * Example:
       * const response = await this.makeRequest({
       *   method: 'GET',
       *   endpoint: '/health',
       * });
       * return response.success && response.data?.status === 'ok';
       */

      addBreadcrumb({
        category: 'modulate',
        message: 'Health check passed',
        level: 'info',
      });

      return true;
    } catch (error) {
      captureException(
        error instanceof Error ? error : new Error('Health check failed'),
        { service: 'ModulateService', method: 'healthCheck' },
        'error'
      );
      return false;
    }
  }
}

// ==================== Singleton Instance ====================

let modulateServiceInstance: ModulateService | null = null;

/**
 * Get or create the Modulate service singleton
 */
export function getModulateService(): ModulateService {
  if (!modulateServiceInstance) {
    modulateServiceInstance = new ModulateService();
  }
  return modulateServiceInstance;
}

/**
 * Create a new instance (useful for testing or multiple API keys)
 */
export function createModulateService(apiKey?: string): ModulateService {
  return new ModulateService(apiKey);
}

// ==================== Exports ====================

export default {
  getService: getModulateService,
  createService: createModulateService,
  ModulateService,
};
