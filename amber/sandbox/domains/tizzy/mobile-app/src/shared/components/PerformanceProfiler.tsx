import React, { Profiler, ProfilerOnRenderCallback } from 'react';
import { PerformanceMonitoring } from '../../services/PerformanceMonitoring';

interface PerformanceProfilerProps {
  id: string;
  children: React.ReactNode;
}

/**
 * Performance Profiler Wrapper
 * Wraps components to track render performance
 *
 * Usage:
 * <PerformanceProfiler id="MyComponent">
 *   <MyComponent />
 * </PerformanceProfiler>
 */
export function PerformanceProfiler({ id, children }: PerformanceProfilerProps) {
  const onRender: ProfilerOnRenderCallback = (
    id: string,
    phase: 'mount' | 'update' | 'nested-update',
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number
  ) => {
    // Only track in production or when explicitly enabled
    if (__DEV__ && !process.env.ENABLE_PERFORMANCE_PROFILING) {
      return;
    }

    // Convert nested-update to update for PerformanceMonitoring
    const trackingPhase: 'mount' | 'update' = phase === 'nested-update' ? 'update' : phase;
    PerformanceMonitoring.trackComponentRender(id, trackingPhase, actualDuration, baseDuration);
  };

  return (
    <Profiler id={id} onRender={onRender}>
      {children}
    </Profiler>
  );
}
