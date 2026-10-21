/**
 * Performance optimization utilities
 * Provides debounce, throttle, memoization, and image optimization helpers
 */

interface DebouncedFunction<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): void;
  cancel: () => void;
  flush: () => void;
}

/**
 * Debounce function - delays function execution until after a specified delay
 * Useful for search input, resize handlers, etc.
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number = 300
): DebouncedFunction<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastRejectionHandler: ((reason?: any) => void) | null = null;

  function debounced(...args: Parameters<T>) {
    // Clear previous timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Set new timeout
    timeoutId = setTimeout(() => {
      try {
        func(...args);
      } catch (error) {
        if (lastRejectionHandler) {
          lastRejectionHandler(error);
        }
      }
      timeoutId = null;
    }, delay);
  }

  // Add cancel method
  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  // Add flush method to execute immediately
  debounced.flush = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return debounced;
}

/**
 * Throttle function - executes function at most once every specified interval
 * Useful for scroll events, resize handlers, etc.
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number = 300
): (...args: Parameters<T>) => void {
  let inThrottle: boolean = false;
  let lastRan: number = 0;
  let lastFunc: ReturnType<typeof setTimeout> | null = null;

  function throttled(...args: Parameters<T>) {
    const now = Date.now();

    if (!lastRan) {
      try {
        func(...args);
        lastRan = now;
      } catch (error) {
        console.error('Throttled function error:', error);
      }
    } else {
      // Clear previous timeout
      if (lastFunc) {
        clearTimeout(lastFunc);
      }

      // Schedule execution at the end of the throttle period
      lastFunc = setTimeout(() => {
        if (now - lastRan >= limit) {
          try {
            func(...args);
            lastRan = now;
          } catch (error) {
            console.error('Throttled function error:', error);
          }
          lastFunc = null;
        }
      }, limit - (now - lastRan));
    }
  }

  // Add cancel method
  (throttled as any).cancel = () => {
    if (lastFunc) {
      clearTimeout(lastFunc);
      lastFunc = null;
    }
  };

  return throttled;
}

/**
 * Memoization helper for functions
 * Caches function results based on arguments
 */
export function memoize<T extends (...args: any[]) => any>(
  func: T,
  options: {
    maxSize?: number;
    ttl?: number; // Time to live in milliseconds
  } = {}
): T {
  const { maxSize = 100, ttl = 0 } = options;

  interface CacheEntry {
    result: any;
    timestamp: number;
  }

  const cache = new Map<string, CacheEntry>();

  function memoized(...args: Parameters<T>): ReturnType<T> {
    // Create cache key from arguments
    const key = JSON.stringify(args);

    // Check cache
    const cached = cache.get(key);
    if (cached) {
      // Check TTL
      if (ttl === 0 || Date.now() - cached.timestamp < ttl) {
        return cached.result;
      }
      // TTL expired, remove from cache
      cache.delete(key);
    }

    // Execute function and cache result
    const result = func(...args);

    // Manage cache size
    if (cache.size >= maxSize) {
      const firstKey = cache.keys().next().value;
      if (firstKey) {
        cache.delete(firstKey);
      }
    }

    cache.set(key, {
      result,
      timestamp: Date.now(),
    });

    return result;
  }

  // Add clear method
  (memoized as any).clear = () => {
    cache.clear();
  };

  // Add cache info method
  (memoized as any).cacheSize = () => cache.size;

  return memoized as T;
}

/**
 * Image optimization configuration
 */
export interface ImageOptimizationConfig {
  width?: number;
  height?: number;
  quality?: number; // 0-1
  format?: 'jpeg' | 'png' | 'webp';
}

/**
 * Image URL optimizer for displaying optimized images
 * Useful for different screen sizes and network conditions
 */
export function getOptimizedImageUrl(
  imageUrl: string,
  config: ImageOptimizationConfig = {}
): string {
  const { width = 400, height = 400, quality = 0.8, format = 'jpeg' } = config;

  // If using a CDN like Cloudinary, Imgix, or similar
  // you can construct optimized URLs
  // This is a placeholder implementation for local/custom CDNs

  // For Cloudinary (example):
  // return `${imageUrl}?w=${width}&h=${height}&q=${Math.round(quality * 100)}&f=${format}`;

  // For now, return the original URL
  // Implement based on your actual CDN solution
  return imageUrl;
}

/**
 * Generate responsive image URLs for different screen sizes
 */
export function getResponsiveImageUrl(
  imageUrl: string,
  screenWidth: number,
  pixelRatio: number = 2
): string {
  // Calculate optimal image width based on device pixel ratio
  const optimalWidth = Math.ceil(screenWidth * pixelRatio);

  return getOptimizedImageUrl(imageUrl, {
    width: optimalWidth,
    quality: pixelRatio > 2 ? 0.75 : 0.85,
    format: 'jpeg',
  });
}

/**
 * Batch operations helper
 * Useful for batching DOM operations, API calls, etc.
 */
export function batchOperations<T>(
  operations: Array<() => Promise<T>>,
  batchSize: number = 5,
  onProgress?: (completed: number, total: number) => void
): Promise<T[]> {
  return new Promise(async (resolve, reject) => {
    const results: T[] = [];
    let completed = 0;

    try {
      for (let i = 0; i < operations.length; i += batchSize) {
        const batch = operations.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map((op) => op()));

        results.push(...batchResults);
        completed += batch.length;

        if (onProgress) {
          onProgress(completed, operations.length);
        }
      }

      resolve(results);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Request animation frame wrapper
 * Useful for smooth animations and layout calculations
 */
export function requestAnimationFrameAsync(): Promise<number> {
  return new Promise((resolve) => {
    requestAnimationFrame((timestamp) => {
      resolve(timestamp);
    });
  });
}

/**
 * Performance measurement helper
 */
export class PerformanceMonitor {
  private marks: Map<string, number> = new Map();
  private measures: Map<string, number[]> = new Map();

  mark(label: string): void {
    this.marks.set(label, performance.now());
  }

  measure(label: string, startMark: string, endMark?: string): number {
    const startTime = this.marks.get(startMark);
    const endTime = endMark ? this.marks.get(endMark) : performance.now();

    if (!startTime || !endTime) {
      console.warn(`Cannot measure ${label}: missing marks`);
      return 0;
    }

    const duration = endTime - startTime;

    // Store measurement
    if (!this.measures.has(label)) {
      this.measures.set(label, []);
    }
    this.measures.get(label)?.push(duration);

    return duration;
  }

  getMetrics(label: string) {
    const measurements = this.measures.get(label) || [];

    if (measurements.length === 0) {
      return null;
    }

    const sum = measurements.reduce((a, b) => a + b, 0);
    const avg = sum / measurements.length;
    const min = Math.min(...measurements);
    const max = Math.max(...measurements);

    return {
      count: measurements.length,
      avg,
      min,
      max,
      total: sum,
    };
  }

  clear(label?: string): void {
    if (label) {
      this.measures.delete(label);
      this.marks.delete(label);
    } else {
      this.marks.clear();
      this.measures.clear();
    }
  }

  logMetrics(): void {
    console.log('=== Performance Metrics ===');
    for (const [label, metrics] of this.measures) {
      const info = this.getMetrics(label);
      if (info) {
        console.log(
          `${label}: ${info.avg.toFixed(2)}ms avg (${info.min.toFixed(2)}-${info.max.toFixed(2)}ms)`
        );
      }
    }
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

/**
 * Memory-efficient data structure for handling large lists
 */
export class VirtualizedListData<T> {
  private items: T[] = [];
  private windowStart: number = 0;
  private windowSize: number = 50;

  constructor(items: T[], windowSize: number = 50) {
    this.items = items;
    this.windowSize = windowSize;
  }

  getWindowedItems(offset: number): T[] {
    const start = Math.max(0, offset - this.windowSize);
    const end = Math.min(this.items.length, offset + this.windowSize * 2);

    return this.items.slice(start, end);
  }

  updateItems(items: T[]): void {
    this.items = items;
  }

  getItem(index: number): T | undefined {
    return this.items[index];
  }

  size(): number {
    return this.items.length;
  }
}
