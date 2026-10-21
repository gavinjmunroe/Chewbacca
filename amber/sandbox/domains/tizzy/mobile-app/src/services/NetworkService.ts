/**
 * Network Service
 * Monitors network connectivity and quality
 */

import NetInfo, {
  NetInfoState,
  NetInfoStateType,
  NetInfoSubscription
} from '@react-native-community/netinfo';

export type NetworkStatus = 'online' | 'offline' | 'poor';

export interface NetworkQuality {
  isConnected: boolean;
  type: NetInfoStateType;
  isInternetReachable: boolean | null;
  effectiveType: string | null;
  quality: 'excellent' | 'good' | 'fair' | 'poor';
}

export type NetworkChangeListener = (status: NetworkStatus, quality: NetworkQuality) => void;

/**
 * Network Service Class
 * Provides network monitoring and quality detection
 */
export class NetworkService {
  private listeners: Set<NetworkChangeListener> = new Set();
  private unsubscribe: NetInfoSubscription | null = null;
  private currentStatus: NetworkStatus = 'offline';
  private currentQuality: NetworkQuality | null = null;
  private initialized: boolean = false;

  /**
   * Initialize network monitoring
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Get initial state
      const state = await NetInfo.fetch();
      this.handleNetworkChange(state);

      // Subscribe to network changes
      this.unsubscribe = NetInfo.addEventListener(this.handleNetworkChange.bind(this));

      this.initialized = true;
      console.log('[NetworkService] Initialized successfully');
    } catch (error) {
      console.error('[NetworkService] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Handle network state changes
   */
  private handleNetworkChange(state: NetInfoState): void {
    const quality = this.assessNetworkQuality(state);
    const status = this.determineNetworkStatus(quality);

    // Only notify if status changed
    if (status !== this.currentStatus || !this.deepEqual(quality, this.currentQuality)) {
      const previousStatus = this.currentStatus;
      this.currentStatus = status;
      this.currentQuality = quality;

      console.log(`[NetworkService] Status changed: ${previousStatus} -> ${status}`, quality);

      // Notify all listeners
      this.listeners.forEach(listener => {
        try {
          listener(status, quality);
        } catch (error) {
          console.error('[NetworkService] Listener error:', error);
        }
      });
    }
  }

  /**
   * Assess network quality based on connection details
   */
  private assessNetworkQuality(state: NetInfoState): NetworkQuality {
    const details = state.details as any;

    // Base quality assessment
    const quality: NetworkQuality = {
      isConnected: state.isConnected ?? false,
      type: state.type,
      isInternetReachable: state.isInternetReachable,
      effectiveType: details?.effectiveConnectionType || null,
      quality: 'poor'
    };

    // Not connected
    if (!state.isConnected || state.isInternetReachable === false) {
      quality.quality = 'poor';
      return quality;
    }

    // Connection type based quality
    switch (state.type) {
      case NetInfoStateType.wifi:
      case NetInfoStateType.ethernet:
        quality.quality = 'excellent';
        break;

      case NetInfoStateType.cellular:
        // Use effective type if available
        const effectiveType = details?.cellularGeneration || details?.effectiveConnectionType;
        if (effectiveType) {
          if (effectiveType === '5g' || effectiveType === '4g') {
            quality.quality = 'excellent';
          } else if (effectiveType === '3g') {
            quality.quality = 'good';
          } else if (effectiveType === '2g') {
            quality.quality = 'fair';
          } else {
            quality.quality = 'poor';
          }
        } else {
          quality.quality = 'good'; // Default for cellular
        }
        break;

      case NetInfoStateType.bluetooth:
      case NetInfoStateType.wimax:
        quality.quality = 'fair';
        break;

      default:
        quality.quality = 'poor';
    }

    return quality;
  }

  /**
   * Determine network status from quality
   */
  private determineNetworkStatus(quality: NetworkQuality): NetworkStatus {
    if (!quality.isConnected || quality.isInternetReachable === false) {
      return 'offline';
    }

    if (quality.quality === 'poor' || quality.quality === 'fair') {
      return 'poor';
    }

    return 'online';
  }

  /**
   * Deep equality check for objects
   */
  private deepEqual(a: any, b: any): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /**
   * Add a listener for network changes
   */
  addListener(listener: NetworkChangeListener): () => void {
    this.listeners.add(listener);

    // Immediately notify with current status
    if (this.currentQuality) {
      listener(this.currentStatus, this.currentQuality);
    }

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Remove a listener
   */
  removeListener(listener: NetworkChangeListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Get current network status
   */
  getStatus(): NetworkStatus {
    return this.currentStatus;
  }

  /**
   * Get current network quality
   */
  getQuality(): NetworkQuality | null {
    return this.currentQuality;
  }

  /**
   * Get detailed network state information
   */
  getNetworkState(): {
    status: NetworkStatus;
    quality: NetworkQuality | null;
    isInitialized: boolean;
  } {
    return {
      status: this.currentStatus,
      quality: this.currentQuality,
      isInitialized: this.initialized
    };
  }

  /**
   * Check if network is online
   */
  isOnline(): boolean {
    return this.currentStatus === 'online';
  }

  /**
   * Check if network is offline
   */
  isOffline(): boolean {
    return this.currentStatus === 'offline';
  }

  /**
   * Check if network quality is poor
   */
  isPoorQuality(): boolean {
    return this.currentStatus === 'poor';
  }

  /**
   * Wait for network to be online
   * @param timeout - Optional timeout in milliseconds
   */
  async waitForOnline(timeout?: number): Promise<void> {
    if (this.isOnline()) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timeoutId = timeout
        ? setTimeout(() => {
            unsubscribe();
            reject(new Error('Network timeout'));
          }, timeout)
        : null;

      const unsubscribe = this.addListener((status) => {
        if (status === 'online') {
          if (timeoutId) clearTimeout(timeoutId);
          unsubscribe();
          resolve();
        }
      });
    });
  }

  /**
   * Refresh network state
   */
  async refresh(): Promise<void> {
    const state = await NetInfo.fetch();
    this.handleNetworkChange(state);
  }

  /**
   * Automatic retry helper with exponential backoff
   * @param fn - Function to retry
   * @param maxRetries - Maximum number of retries
   * @param baseDelay - Base delay in milliseconds
   */
  async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Check if online before attempting
        if (!this.isOnline()) {
          throw new Error('Network is not available');
        }

        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on last attempt
        if (attempt === maxRetries) {
          break;
        }

        // Calculate exponential backoff delay
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(
          `[NetworkService] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`
        );

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay));

        // Re-check if online before next attempt
        if (!this.isOnline()) {
          console.log('[NetworkService] Network went offline, stopping retries');
          break;
        }
      }
    }

    throw lastError || new Error('Retry failed after maximum attempts');
  }

  /**
   * Retry with custom backoff strategy
   * @param fn - Function to retry
   * @param config - Retry configuration
   */
  async withCustomRetry<T>(
    fn: () => Promise<T>,
    config: {
      maxRetries?: number;
      delays?: number[]; // Custom delays for each retry
      backoffMultiplier?: number; // Multiply delay by this factor each attempt
      onRetry?: (attempt: number, error: Error) => void;
    } = {}
  ): Promise<T> {
    const { maxRetries = 3, delays, backoffMultiplier = 2, onRetry } = config;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (!this.isOnline()) {
          throw new Error('Network is not available');
        }

        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === maxRetries) {
          break;
        }

        // Determine delay
        let delay: number;
        if (delays && delays[attempt] !== undefined) {
          delay = delays[attempt];
        } else {
          delay = 1000 * Math.pow(backoffMultiplier, attempt);
        }

        onRetry?.(attempt + 1, lastError);

        console.log(
          `[NetworkService] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`
        );

        await new Promise(resolve => setTimeout(resolve, delay));

        if (!this.isOnline()) {
          console.log('[NetworkService] Network went offline, stopping retries');
          break;
        }
      }
    }

    throw lastError || new Error('Retry failed after maximum attempts');
  }

  /**
   * Cleanup and remove all listeners
   */
  cleanup(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.listeners.clear();
    this.initialized = false;
  }
}

// Singleton instance
export const networkService = new NetworkService();

/**
 * React Hook for network status
 * Usage:
 * const { status, quality, isOnline } = useNetworkStatus();
 */
export function useNetworkStatus() {
  const [status, setStatus] = React.useState<NetworkStatus>('offline');
  const [quality, setQuality] = React.useState<NetworkQuality | null>(null);

  React.useEffect(() => {
    // Initialize if needed
    if (!networkService['initialized']) {
      networkService.initialize().catch(console.error);
    }

    // Subscribe to changes
    const unsubscribe = networkService.addListener((newStatus, newQuality) => {
      setStatus(newStatus);
      setQuality(newQuality);
    });

    return unsubscribe;
  }, []);

  return {
    status,
    quality,
    isOnline: status === 'online',
    isOffline: status === 'offline',
    isPoor: status === 'poor'
  };
}

// Import React for the hook (will be available in the app context)
import * as React from 'react';
