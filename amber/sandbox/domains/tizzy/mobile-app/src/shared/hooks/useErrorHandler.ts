/**
 * Error Handler Hook
 * Provides comprehensive error handling with user-friendly messages and retry logic
 */

import { useState, useCallback, useEffect } from 'react';
import {
  classifyError,
  formatErrorForDisplay,
  ErrorDetails,
  retryWithBackoff,
  shouldRetryError,
} from '../utils/errorHandling';
import * as ErrorTracking from '../../services/ErrorTracking';

export interface UseErrorHandlerOptions {
  /**
   * Callback when an error occurs
   */
  onError?: (error: any) => void;

  /**
   * Callback after successful retry
   */
  onRetrySuccess?: () => void;

  /**
   * Enable automatic retry for certain errors
   */
  enableAutoRetry?: boolean;

  /**
   * Maximum retry attempts
   */
  maxRetries?: number;

  /**
   * Component/feature name for tracking
   */
  context?: string;
}

export interface ErrorState {
  hasError: boolean;
  error: any | null;
  errorDetails: ErrorDetails | null;
  isRetrying: boolean;
  retryCount: number;
}

/**
 * Hook for comprehensive error handling
 *
 * @example
 * ```tsx
 * const { error, handleError, retry, clearError, isRetrying } = useErrorHandler({
 *   context: 'SessionScreen',
 *   maxRetries: 3,
 * });
 *
 * const loadSession = async () => {
 *   try {
 *     const data = await fetchSession();
 *   } catch (err) {
 *     handleError(err);
 *   }
 * };
 *
 * // In UI
 * {error && (
 *   <ErrorView
 *     error={error}
 *     onRetry={retry}
 *     isRetrying={isRetrying}
 *   />
 * )}
 * ```
 */
export function useErrorHandler(options: UseErrorHandlerOptions = {}) {
  const {
    onError,
    onRetrySuccess,
    enableAutoRetry = false,
    maxRetries = 3,
    context = 'unknown',
  } = options;

  const [errorState, setErrorState] = useState<ErrorState>({
    hasError: false,
    error: null,
    errorDetails: null,
    isRetrying: false,
    retryCount: 0,
  });

  /**
   * Handle an error
   */
  const handleError = useCallback(
    (error: any) => {
      const details = classifyError(error);

      // Track error
      ErrorTracking.addBreadcrumb({
        category: 'error',
        message: `Error in ${context}: ${details.message}`,
        level: 'error',
        data: {
          errorType: details.type,
          canRetry: details.canRetry,
        },
      });

      // Update state
      setErrorState((prev) => ({
        hasError: true,
        error,
        errorDetails: details,
        isRetrying: false,
        retryCount: prev.retryCount,
      }));

      // Call callback
      if (onError) {
        onError(error);
      }
    },
    [context, onError]
  );

  /**
   * Retry the operation
   */
  const retry = useCallback(
    async (operation?: () => Promise<any>) => {
      if (!errorState.errorDetails?.canRetry) {
        console.warn('[ErrorHandler] Cannot retry this error');
        return;
      }

      if (errorState.retryCount >= maxRetries) {
        console.warn('[ErrorHandler] Max retries reached');
        return;
      }

      setErrorState((prev) => ({
        ...prev,
        isRetrying: true,
      }));

      try {
        if (operation) {
          // Retry with exponential backoff
          await retryWithBackoff(operation, {
            maxAttempts: 1, // We're managing attempts ourselves
            baseDelay: errorState.errorDetails?.retryDelay || 1000,
          });

          // Success - clear error
          setErrorState({
            hasError: false,
            error: null,
            errorDetails: null,
            isRetrying: false,
            retryCount: 0,
          });

          if (onRetrySuccess) {
            onRetrySuccess();
          }

          ErrorTracking.addBreadcrumb({
            category: 'error',
            message: `Retry successful in ${context}`,
            level: 'info',
          });
        } else {
          // Just clear the error state (manual retry)
          setErrorState((prev) => ({
            hasError: false,
            error: null,
            errorDetails: null,
            isRetrying: false,
            retryCount: prev.retryCount + 1,
          }));
        }
      } catch (retryError) {
        // Retry failed
        setErrorState((prev) => ({
          ...prev,
          isRetrying: false,
          retryCount: prev.retryCount + 1,
        }));

        handleError(retryError);
      }
    },
    [errorState, maxRetries, context, onRetrySuccess, handleError]
  );

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setErrorState({
      hasError: false,
      error: null,
      errorDetails: null,
      isRetrying: false,
      retryCount: 0,
    });
  }, []);

  /**
   * Get user-friendly error display
   */
  const getErrorDisplay = useCallback(() => {
    if (!errorState.error) {
      return null;
    }
    return formatErrorForDisplay(errorState.error);
  }, [errorState.error]);

  return {
    // State
    error: errorState.error,
    errorDetails: errorState.errorDetails,
    hasError: errorState.hasError,
    isRetrying: errorState.isRetrying,
    retryCount: errorState.retryCount,

    // Methods
    handleError,
    retry,
    clearError,
    getErrorDisplay,
  };
}

/**
 * Hook for handling async operations with automatic error handling
 *
 * @example
 * ```tsx
 * const { execute, loading, error, retry } = useAsyncError(
 *   fetchSessionData,
 *   { context: 'SessionScreen' }
 * );
 *
 * useEffect(() => {
 *   execute();
 * }, []);
 *
 * if (loading) return <LoadingSpinner />;
 * if (error) return <ErrorView error={error} onRetry={retry} />;
 * ```
 */
export function useAsyncError<T>(
  asyncFn: () => Promise<T>,
  options: UseErrorHandlerOptions = {}
) {
  const errorHandler = useErrorHandler(options);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<T | null>(null);

  const execute = useCallback(async () => {
    setLoading(true);
    errorHandler.clearError();

    try {
      const result = await asyncFn();
      setData(result);
      return result;
    } catch (error) {
      errorHandler.handleError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [asyncFn, errorHandler]);

  const retryOperation = useCallback(() => {
    return errorHandler.retry(execute);
  }, [errorHandler, execute]);

  return {
    execute,
    loading,
    data,
    retry: retryOperation,
    error: errorHandler.error,
    errorDetails: errorHandler.errorDetails,
    hasError: errorHandler.hasError,
    isRetrying: errorHandler.isRetrying,
    retryCount: errorHandler.retryCount,
    handleError: errorHandler.handleError,
    clearError: errorHandler.clearError,
    getErrorDisplay: errorHandler.getErrorDisplay,
  };
}
