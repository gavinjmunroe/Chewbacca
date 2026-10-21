import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography } from '../constants/typography';
import { Button } from './Button';
import {
  classifyError,
  formatErrorForDisplay,
  logError,
  ErrorType,
  ErrorSeverity,
} from '../utils/errorHandling';
import * as ErrorTracking from '../../services/ErrorTracking';

interface ErrorBoundaryProps {
  /**
   * Child components to render
   */
  children: ReactNode;

  /**
   * Optional fallback component to render when an error occurs
   */
  fallback?: (error: Error, resetError: () => void, retryCount: number) => ReactNode;

  /**
   * Optional callback when an error occurs
   */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;

  /**
   * Optional custom error message to display
   */
  errorMessage?: string;

  /**
   * Optional name for this error boundary (useful for debugging)
   */
  name?: string;

  /**
   * Maximum number of retry attempts
   */
  maxRetries?: number;

  /**
   * Enable automatic retry for certain error types
   */
  enableAutoRetry?: boolean;

  /**
   * Delay before auto retry (ms)
   */
  autoRetryDelay?: number;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  retryCount: number;
  isRetrying: boolean;
}

/**
 * Error Boundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI instead of crashing.
 *
 * @example
 * ```tsx
 * <ErrorBoundary>
 *   <YourComponent />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private retryTimeout: NodeJS.Timeout | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
      isRetrying: false,
    };
  }

  componentWillUnmount(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
  }

  /**
   * Update state when an error is caught
   */
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  /**
   * Log error details when an error is caught
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { name, onError, enableAutoRetry, maxRetries = 3 } = this.props;
    const { retryCount } = this.state;

    // Classify and log the error
    const errorDetails = classifyError(error);
    logError(error, {
      boundaryName: name,
      componentStack: errorInfo.componentStack,
      retryCount,
    });

    // Send to Sentry/error tracking service
    ErrorTracking.captureException(error, {
      errorBoundary: {
        name,
        retryCount,
        componentStack: errorInfo.componentStack,
        errorType: errorDetails.type,
        canRetry: errorDetails.canRetry,
      },
    });

    // Add breadcrumb
    ErrorTracking.addBreadcrumb({
      message: `Error boundary caught error in ${name || 'unknown'}`,
      category: 'error-boundary',
      level: 'error',
      data: {
        errorType: errorDetails.type,
        retryCount,
      },
    });

    // Log error to console in development
    if (__DEV__) {
      console.error(`[ErrorBoundary${name ? ` - ${name}` : ''}] Error caught:`, error);
      console.error('Error details:', errorDetails);
      console.error('Component stack:', errorInfo.componentStack);
    }

    // Store error info in state
    this.setState({
      errorInfo,
    });

    // Call optional error handler
    if (onError) {
      onError(error, errorInfo);
    }

    // Auto-retry for certain error types if enabled
    if (
      enableAutoRetry &&
      errorDetails.canRetry &&
      retryCount < maxRetries &&
      errorDetails.type === ErrorType.NETWORK
    ) {
      this.scheduleAutoRetry();
    }
  }

  /**
   * Schedule automatic retry after delay
   */
  scheduleAutoRetry = (): void => {
    const { autoRetryDelay = 2000 } = this.props;
    const { retryCount } = this.state;

    console.log(`[ErrorBoundary] Scheduling auto-retry in ${autoRetryDelay}ms (attempt ${retryCount + 1})`);

    this.setState({ isRetrying: true });

    this.retryTimeout = setTimeout(() => {
      this.handleRetry();
    }, autoRetryDelay);
  };

  /**
   * Reset error state and attempt to recover
   */
  handleReset = (): void => {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }

    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
      isRetrying: false,
    });
  };

  /**
   * Retry with incremented counter
   */
  handleRetry = (): void => {
    this.setState((prevState) => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: prevState.retryCount + 1,
      isRetrying: false,
    }));
  };

  /**
   * Render fallback UI when an error occurs
   */
  renderFallback(): ReactNode {
    const { fallback, errorMessage, name, maxRetries = 3 } = this.props;
    const { error, retryCount, isRetrying } = this.state;

    // Use custom fallback if provided
    if (fallback && error) {
      return fallback(error, this.handleReset, retryCount);
    }

    // Get formatted error details
    const errorDisplay = error ? formatErrorForDisplay(error) : null;

    // Default fallback UI
    return (
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.iconContainer}>
            <Text style={styles.iconText}>
              {isRetrying ? '[arrow.triangle.2.circlepath]' : errorDisplay?.title.includes('Connection') ? '[antenna.radiowaves.left.and.right]' : '[exclamationmark.triangle]'}
            </Text>
          </View>

          <Text style={styles.title}>
            {isRetrying ? 'Retrying...' : errorDisplay?.title || 'Oops! Something went wrong'}
          </Text>

          <Text style={styles.message}>
            {errorMessage || errorDisplay?.message || 'We encountered an unexpected error. Please try again.'}
          </Text>

          {errorDisplay?.suggestion && !isRetrying && (
            <Text style={styles.suggestion}>{errorDisplay.suggestion}</Text>
          )}

          {retryCount > 0 && retryCount < maxRetries && (
            <Text style={styles.retryInfo}>Retry attempt: {retryCount} of {maxRetries}</Text>
          )}

          {retryCount >= maxRetries && (
            <View style={styles.maxRetriesContainer}>
              <Text style={styles.maxRetriesText}>
                Maximum retry attempts reached. Please try again later or contact support if the issue persists.
              </Text>
            </View>
          )}

          {__DEV__ && error && (
            <View style={styles.errorDetails}>
              <Text style={styles.errorDetailsTitle}>Error Details (Dev Only):</Text>
              {name && (
                <Text style={styles.errorDetailsText}>Boundary: {name}</Text>
              )}
              <Text style={styles.errorDetailsText}>
                {error.name}: {error.message}
              </Text>
              {error.stack && (
                <ScrollView
                  style={styles.stackContainer}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                >
                  <Text style={styles.stackText}>{error.stack}</Text>
                </ScrollView>
              )}
            </View>
          )}

          {!isRetrying && errorDisplay?.canRetry && (
            <View style={styles.buttonContainer}>
              <Button
                title={retryCount >= maxRetries ? 'Start Over' : 'Try Again'}
                onPress={this.handleReset}
                variant="primary"
                size="large"
                fullWidth
                testID="error-boundary-reset-button"
              />
            </View>
          )}

          {isRetrying && (
            <View style={styles.retryingContainer}>
              <Text style={styles.retryingText}>Attempting to recover...</Text>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  render(): ReactNode {
    const { hasError } = this.state;
    const { children } = this.props;

    if (hasError) {
      return this.renderFallback();
    }

    return children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  iconText: {
    fontSize: 64,
  },
  title: {
    ...typography.heading2,
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  message: {
    ...typography.body1,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  suggestion: {
    ...typography.body2,
    color: colors.primary.main,
    textAlign: 'center',
    marginBottom: spacing.lg,
    fontWeight: '600',
  },
  retryInfo: {
    ...typography.caption,
    color: colors.text.tertiary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  maxRetriesContainer: {
    backgroundColor: colors.warning.light,
    borderRadius: spacing.radius.md,
    padding: spacing.md,
    marginVertical: spacing.lg,
  },
  maxRetriesText: {
    ...typography.body2,
    color: colors.warning.dark,
    textAlign: 'center',
  },
  buttonContainer: {
    marginTop: spacing.lg,
  },
  retryingContainer: {
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  retryingText: {
    ...typography.body1,
    color: colors.text.tertiary,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  errorDetails: {
    backgroundColor: colors.background.tertiary,
    borderRadius: spacing.radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border.light,
  },
  errorDetailsTitle: {
    ...typography.subtitle1,
    color: colors.danger.main,
    marginBottom: spacing.sm,
  },
  errorDetailsText: {
    ...typography.caption,
    color: colors.text.secondary,
    fontFamily: 'monospace',
    marginBottom: spacing.xs,
  },
  stackContainer: {
    maxHeight: 200,
    marginTop: spacing.sm,
  },
  stackText: {
    ...typography.caption,
    color: colors.text.tertiary,
    fontFamily: 'monospace',
    fontSize: 10,
  },
});
