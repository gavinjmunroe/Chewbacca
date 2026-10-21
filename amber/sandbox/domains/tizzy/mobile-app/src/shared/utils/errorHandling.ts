/**
 * Error Handling Utilities
 * Comprehensive error classification, user-friendly messages, and recovery strategies
 */

import { AxiosError } from 'axios';

// ============================================================================
// Custom Error Classes
// ============================================================================

/**
 * Base error class for all application errors
 */
export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly severity: ErrorSeverity;
  public readonly userMessage: string;
  public readonly recoveryStrategy: RecoveryStrategy;
  public readonly code?: string;
  public readonly technicalDetails?: string;
  public readonly timestamp: Date;

  constructor(
    message: string,
    type: ErrorType,
    severity: ErrorSeverity,
    userMessage: string,
    recoveryStrategy: RecoveryStrategy,
    code?: string,
    technicalDetails?: string,
  ) {
    super(message);
    this.name = 'AppError';
    this.type = type;
    this.severity = severity;
    this.userMessage = userMessage;
    this.recoveryStrategy = recoveryStrategy;
    this.code = code;
    this.technicalDetails = technicalDetails;
    this.timestamp = new Date();

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, AppError.prototype);
  }

  toErrorDetails(): ErrorDetails {
    return {
      type: this.type,
      severity: this.severity,
      message: this.message,
      userMessage: this.userMessage,
      recoveryStrategy: this.recoveryStrategy,
      canRetry: isRetryableErrorType(this.type),
      code: this.code,
      technicalDetails: this.technicalDetails,
    };
  }
}

/**
 * Network error - connection issues, timeout, etc.
 */
export class NetworkError extends AppError {
  constructor(message: string = 'Network error', code?: string, technicalDetails?: string) {
    super(
      message,
      ErrorType.NETWORK,
      ErrorSeverity.HIGH,
      'Unable to connect to the server. Please check your internet connection.',
      RecoveryStrategy.CHECK_INTERNET,
      code,
      technicalDetails,
    );
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * Timeout error - request took too long
 */
export class TimeoutError extends AppError {
  constructor(message: string = 'Request timeout', technicalDetails?: string) {
    super(
      message,
      ErrorType.TIMEOUT,
      ErrorSeverity.MEDIUM,
      'The request took too long. Please check your connection and try again.',
      RecoveryStrategy.RETRY,
      '408',
      technicalDetails,
    );
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }

  getRetryDelay(): number {
    return 2000;
  }
}

/**
 * Authentication error - login, token refresh, etc.
 */
export class AuthError extends AppError {
  public readonly subtype: 'invalid_token' | 'expired_token' | 'invalid_credentials' | 'access_denied';

  constructor(
    message: string = 'Authentication failed',
    subtype: 'invalid_token' | 'expired_token' | 'invalid_credentials' | 'access_denied' = 'invalid_token',
    technicalDetails?: string,
  ) {
    const userMessages = {
      expired_token: 'Your session has expired. Please log in again.',
      invalid_token: 'Authentication failed. Please log in again.',
      invalid_credentials: 'Invalid username or password. Please try again.',
      access_denied: "You don't have permission to access this resource.",
    };

    const recoveryStrategies = {
      expired_token: RecoveryStrategy.REFRESH_TOKEN,
      invalid_token: RecoveryStrategy.REFRESH_TOKEN,
      invalid_credentials: RecoveryStrategy.LOGOUT,
      access_denied: RecoveryStrategy.NONE,
    };

    super(
      message,
      ErrorType.AUTH,
      subtype === 'access_denied' ? ErrorSeverity.HIGH : ErrorSeverity.HIGH,
      userMessages[subtype],
      recoveryStrategies[subtype],
      subtype === 'access_denied' ? '403' : '401',
      technicalDetails,
    );
    this.name = 'AuthError';
    this.subtype = subtype;
    Object.setPrototypeOf(this, AuthError.prototype);
  }

  static isRetryable(): boolean {
    return false;
  }
}

/**
 * Validation error - invalid input data
 */
export class ValidationError extends AppError {
  public readonly field?: string;
  public readonly value?: any;
  public readonly constraint?: string;

  constructor(
    message: string = 'Validation failed',
    field?: string,
    value?: any,
    constraint?: string,
  ) {
    const userMessage = field
      ? `Invalid ${field}. Please check and try again.`
      : 'Please check your input and try again.';

    super(
      message,
      ErrorType.VALIDATION,
      ErrorSeverity.LOW,
      userMessage,
      RecoveryStrategy.NONE,
      '400',
      `Field: ${field}, Constraint: ${constraint}`,
    );
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
    this.constraint = constraint;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }

  static isRetryable(): boolean {
    return false;
  }
}

/**
 * System error - unexpected application errors
 */
export class SystemError extends AppError {
  constructor(
    message: string = 'System error',
    code?: string,
    technicalDetails?: string,
  ) {
    super(
      message,
      ErrorType.SYSTEM,
      ErrorSeverity.MEDIUM,
      'An unexpected error occurred. Please try again.',
      RecoveryStrategy.RETRY,
      code,
      technicalDetails,
    );
    this.name = 'SystemError';
    Object.setPrototypeOf(this, SystemError.prototype);
  }
}

/**
 * Bluetooth/BLE error - device connection issues
 */
export class BLEError extends AppError {
  public readonly subtype: 'disabled' | 'not_found' | 'disconnected' | 'permission_denied';

  constructor(
    message: string = 'Bluetooth error',
    subtype: 'disabled' | 'not_found' | 'disconnected' | 'permission_denied' = 'disconnected',
    technicalDetails?: string,
  ) {
    const userMessages = {
      disabled: 'Please turn on Bluetooth to connect to your Tizzy device.',
      not_found: "Unable to find your Tizzy device. Make sure it's nearby and powered on.",
      disconnected: 'Lost connection to your Tizzy device. Attempting to reconnect...',
      permission_denied: 'Please grant Bluetooth permissions in your device settings.',
    };

    const recoveryStrategies = {
      disabled: RecoveryStrategy.ENABLE_BLUETOOTH,
      not_found: RecoveryStrategy.RETRY,
      disconnected: RecoveryStrategy.RETRY,
      permission_denied: RecoveryStrategy.GRANT_PERMISSION,
    };

    super(
      message,
      ErrorType.BLE,
      subtype === 'permission_denied' ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM,
      userMessages[subtype],
      recoveryStrategies[subtype],
      undefined,
      technicalDetails,
    );
    this.name = 'BLEError';
    this.subtype = subtype;
    Object.setPrototypeOf(this, BLEError.prototype);
  }

  getRetryDelay(): number {
    switch (this.subtype) {
      case 'disabled':
        return 0; // No retry delay, user must enable
      case 'not_found':
        return 3000; // Device scan timeout
      case 'disconnected':
        return 2000; // Reconnection attempt
      case 'permission_denied':
        return 0; // No retry delay, user must grant
      default:
        return 2000;
    }
  }
}

/**
 * Permission error - missing device permissions
 */
export class PermissionError extends AppError {
  public readonly permission: string;

  constructor(permission: string, technicalDetails?: string) {
    super(
      `${permission} permission denied`,
      ErrorType.PERMISSION,
      ErrorSeverity.HIGH,
      'This feature requires additional permissions. Please grant them in your device settings.',
      RecoveryStrategy.GRANT_PERMISSION,
      'PERM_DENIED',
      technicalDetails,
    );
    this.name = 'PermissionError';
    this.permission = permission;
    Object.setPrototypeOf(this, PermissionError.prototype);
  }

  static isRetryable(): boolean {
    return false;
  }
}

/**
 * Rate limit error - too many requests
 */
export class RateLimitError extends AppError {
  public readonly retryAfter?: number;

  constructor(message: string = 'Too many requests', retryAfter?: number) {
    super(
      message,
      ErrorType.RATE_LIMIT,
      ErrorSeverity.MEDIUM,
      "You're making too many requests. Please wait a moment and try again.",
      RecoveryStrategy.WAIT_AND_RETRY,
      '429',
      undefined,
    );
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter || 60000; // 1 minute default
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }

  getRetryDelay(): number {
    return this.retryAfter || 60000;
  }
}

/**
 * Server error - 5xx HTTP errors
 */
export class ServerError extends AppError {
  public readonly statusCode: number;

  constructor(statusCode: number = 500, message?: string) {
    const statusMessages = {
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout',
    };

    super(
      message || statusMessages[statusCode as keyof typeof statusMessages] || 'Server error',
      ErrorType.SERVER,
      ErrorSeverity.HIGH,
      'Our servers are experiencing issues. Please try again in a few moments.',
      RecoveryStrategy.RETRY,
      String(statusCode),
      undefined,
    );
    this.name = 'ServerError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, ServerError.prototype);
  }

  getRetryDelay(): number {
    return 5000;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if an error type is generally retryable
 */
function isRetryableErrorType(type: ErrorType): boolean {
  const retryableTypes = [
    ErrorType.NETWORK,
    ErrorType.TIMEOUT,
    ErrorType.BLE,
    ErrorType.RATE_LIMIT,
    ErrorType.SERVER,
    ErrorType.SYSTEM,
  ];
  return retryableTypes.includes(type);
}

// ============================================================================
// Error Types and Classification
// ============================================================================

export enum ErrorType {
  NETWORK = 'network',
  AUTH = 'auth',
  VALIDATION = 'validation',
  SYSTEM = 'system',
  BLE = 'ble',
  PERMISSION = 'permission',
  TIMEOUT = 'timeout',
  RATE_LIMIT = 'rate_limit',
  SERVER = 'server',
  UNKNOWN = 'unknown',
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface ErrorDetails {
  type: ErrorType;
  severity: ErrorSeverity;
  message: string;
  userMessage: string;
  recoveryStrategy: RecoveryStrategy;
  canRetry: boolean;
  retryDelay?: number;
  technicalDetails?: string;
  code?: string;
}

export enum RecoveryStrategy {
  RETRY = 'retry',
  REFRESH_TOKEN = 'refresh_token',
  LOGOUT = 'logout',
  ENABLE_BLUETOOTH = 'enable_bluetooth',
  GRANT_PERMISSION = 'grant_permission',
  CHECK_INTERNET = 'check_internet',
  CONTACT_SUPPORT = 'contact_support',
  WAIT_AND_RETRY = 'wait_and_retry',
  NONE = 'none',
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Classify an error and extract relevant details
 */
export function classifyError(error: any): ErrorDetails {
  // App error classes
  if (error instanceof AppError) {
    return error.toErrorDetails();
  }

  // Network/Axios errors
  if (isAxiosError(error)) {
    return classifyAxiosError(error);
  }

  // BLE errors
  if (isBLEError(error)) {
    return classifyBLEError(error);
  }

  // Permission errors
  if (isPermissionError(error)) {
    return classifyPermissionError(error);
  }

  // JavaScript errors
  if (error instanceof Error) {
    return classifyJSError(error);
  }

  // Unknown error type
  return {
    type: ErrorType.UNKNOWN,
    severity: ErrorSeverity.MEDIUM,
    message: error?.message || 'An unexpected error occurred',
    userMessage: 'Something went wrong. Please try again.',
    recoveryStrategy: RecoveryStrategy.RETRY,
    canRetry: true,
    technicalDetails: String(error),
  };
}

/**
 * Classify Axios/Network errors
 */
function classifyAxiosError(error: AxiosError): ErrorDetails {
  const status = error.response?.status;
  const code = error.code;

  // No response - network error
  if (!error.response) {
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
      const timeoutError = new TimeoutError('Request timeout', code);
      return {
        ...timeoutError.toErrorDetails(),
        retryDelay: timeoutError.getRetryDelay(),
      };
    }

    const networkError = new NetworkError('Network error', code);
    return {
      ...networkError.toErrorDetails(),
      retryDelay: 3000,
    };
  }

  // Status-based classification
  switch (status) {
    case 400:
      const validationError = new ValidationError(
        'Invalid request',
        undefined,
        undefined,
        'bad_request',
      );
      return {
        ...validationError.toErrorDetails(),
        userMessage: getValidationMessage(error),
        technicalDetails: JSON.stringify(error.response?.data),
      };

    case 401:
      const authError = new AuthError('Authentication failed', 'expired_token');
      return {
        ...authError.toErrorDetails(),
        canRetry: true,
      };

    case 403:
      const forbiddenError = new AuthError('Access denied', 'access_denied');
      return forbiddenError.toErrorDetails();

    case 404:
      const notFoundError = new ValidationError(
        'Resource not found',
        undefined,
        undefined,
        'not_found',
      );
      return notFoundError.toErrorDetails();

    case 429:
      const rateLimitError = new RateLimitError('Rate limit exceeded', 60000);
      return {
        ...rateLimitError.toErrorDetails(),
        retryDelay: rateLimitError.getRetryDelay(),
      };

    case 500:
    case 502:
    case 503:
    case 504:
      const serverError = new ServerError(status);
      return {
        ...serverError.toErrorDetails(),
        retryDelay: serverError.getRetryDelay(),
      };

    default:
      return {
        type: ErrorType.UNKNOWN,
        severity: ErrorSeverity.MEDIUM,
        message: `HTTP ${status}`,
        userMessage: 'An unexpected error occurred. Please try again.',
        recoveryStrategy: RecoveryStrategy.RETRY,
        canRetry: true,
        code: String(status),
      };
  }
}

/**
 * Classify BLE errors
 */
function classifyBLEError(error: any): ErrorDetails {
  const message = error.message?.toLowerCase() || '';

  if (message.includes('bluetooth') && message.includes('off')) {
    const bleError = new BLEError('Bluetooth is off', 'disabled', error.message);
    return {
      ...bleError.toErrorDetails(),
      retryDelay: bleError.getRetryDelay(),
    };
  }

  if (message.includes('timeout') || message.includes('scan timeout')) {
    const bleError = new BLEError('Device not found', 'not_found', error.message);
    return {
      ...bleError.toErrorDetails(),
      retryDelay: bleError.getRetryDelay(),
    };
  }

  if (message.includes('connection') || message.includes('disconnected')) {
    const bleError = new BLEError('Connection lost', 'disconnected', error.message);
    return {
      ...bleError.toErrorDetails(),
      retryDelay: bleError.getRetryDelay(),
    };
  }

  if (message.includes('permission')) {
    const bleError = new BLEError('Bluetooth permission denied', 'permission_denied', error.message);
    return bleError.toErrorDetails();
  }

  const bleError = new BLEError('Bluetooth error', 'disconnected', error.message);
  return {
    ...bleError.toErrorDetails(),
    retryDelay: bleError.getRetryDelay(),
  };
}

/**
 * Classify permission errors
 */
function classifyPermissionError(error: any): ErrorDetails {
  const message = error.message?.toLowerCase() || '';

  // Extract permission type from message if available
  let permissionType = 'required';
  if (message.includes('location')) permissionType = 'location';
  else if (message.includes('camera')) permissionType = 'camera';
  else if (message.includes('microphone') || message.includes('audio')) permissionType = 'microphone';
  else if (message.includes('bluetooth')) permissionType = 'bluetooth';
  else if (message.includes('storage')) permissionType = 'storage';
  else if (message.includes('contact')) permissionType = 'contacts';

  const permissionError = new PermissionError(permissionType, error.message);
  return permissionError.toErrorDetails();
}

/**
 * Classify JavaScript errors
 */
function classifyJSError(error: Error): ErrorDetails {
  const message = error.message.toLowerCase();

  if (message.includes('network') || message.includes('fetch')) {
    const networkError = new NetworkError(error.message, undefined, error.stack);
    return {
      ...networkError.toErrorDetails(),
      retryDelay: 3000,
    };
  }

  if (message.includes('timeout')) {
    const timeoutError = new TimeoutError(error.message, error.stack);
    return {
      ...timeoutError.toErrorDetails(),
      retryDelay: timeoutError.getRetryDelay(),
    };
  }

  const systemError = new SystemError(error.message, undefined, error.stack);
  return {
    ...systemError.toErrorDetails(),
    retryDelay: 2000,
  };
}

// ============================================================================
// Error Type Checkers
// ============================================================================

function isAxiosError(error: any): error is AxiosError {
  return error?.isAxiosError === true;
}

function isBLEError(error: any): boolean {
  const message = error?.message?.toLowerCase() || '';
  return (
    message.includes('ble') ||
    message.includes('bluetooth') ||
    message.includes('device scan') ||
    message.includes('characteristic')
  );
}

function isPermissionError(error: any): boolean {
  const message = error?.message?.toLowerCase() || '';
  return message.includes('permission');
}

// ============================================================================
// User-Friendly Messages
// ============================================================================

/**
 * Get user-friendly validation message from error response
 */
function getValidationMessage(error: AxiosError): string {
  const data = error.response?.data as any;

  if (data?.error?.message) {
    return data.error.message;
  }

  if (data?.error?.field) {
    return `Invalid ${data.error.field}. Please check and try again.`;
  }

  if (data?.message) {
    return data.message;
  }

  return 'Please check your input and try again.';
}

/**
 * Get recovery suggestion text for user
 */
export function getRecoverySuggestion(strategy: RecoveryStrategy): string {
  switch (strategy) {
    case RecoveryStrategy.RETRY:
      return 'Tap to retry';
    case RecoveryStrategy.REFRESH_TOKEN:
      return 'Please log in again';
    case RecoveryStrategy.LOGOUT:
      return 'You need to log in again';
    case RecoveryStrategy.ENABLE_BLUETOOTH:
      return 'Turn on Bluetooth in your device settings';
    case RecoveryStrategy.GRANT_PERMISSION:
      return 'Grant permissions in device settings';
    case RecoveryStrategy.CHECK_INTERNET:
      return 'Check your internet connection and try again';
    case RecoveryStrategy.CONTACT_SUPPORT:
      return 'Contact support if this issue persists';
    case RecoveryStrategy.WAIT_AND_RETRY:
      return 'Please wait a moment before trying again';
    case RecoveryStrategy.NONE:
      return '';
    default:
      return 'Try again';
  }
}

// ============================================================================
// Retry Strategies
// ============================================================================

export interface RetryOptions {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  shouldRetry?: (error: any, attempt: number) => boolean;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
};

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: any;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (opts.shouldRetry && !opts.shouldRetry(error, attempt)) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === opts.maxAttempts - 1) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        opts.baseDelay * Math.pow(opts.backoffMultiplier, attempt),
        opts.maxDelay
      );

      console.log(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Determine if an error should be retried
 */
export function shouldRetryError(error: any): boolean {
  const details = classifyError(error);
  return details.canRetry;
}

/**
 * Get retry delay for an error (optional attempt number for custom logic)
 */
export function getRetryDelay(error: any, attemptNumber?: number): number {
  const details = classifyError(error);
  let baseDelay = details.retryDelay || 2000;

  // If error is an AppError with a getRetryDelay method, use it
  if (error instanceof AppError && typeof (error as any).getRetryDelay === 'function') {
    baseDelay = (error as any).getRetryDelay();
  }

  // Apply exponential backoff if attempt number is provided
  if (attemptNumber !== undefined && attemptNumber > 0) {
    return getExponentialBackoffDelay(baseDelay, attemptNumber);
  }

  return baseDelay;
}

/**
 * Calculate exponential backoff delay
 * Formula: baseDelay * 2^attemptNumber (capped at maxDelay)
 */
export function getExponentialBackoffDelay(
  baseDelay: number = 1000,
  attemptNumber: number = 0,
  maxDelay: number = 30000,
  multiplier: number = 2,
): number {
  const delay = baseDelay * Math.pow(multiplier, attemptNumber);
  return Math.min(delay, maxDelay);
}

// ============================================================================
// Error Logging
// ============================================================================

export interface ErrorLog {
  timestamp: string;
  type: ErrorType;
  severity: ErrorSeverity;
  message: string;
  technicalDetails?: string;
  context?: Record<string, any>;
}

/**
 * Log error for tracking service (e.g., Sentry)
 */
export function logError(error: any, context?: Record<string, any>): void {
  const details = classifyError(error);

  const errorLog: ErrorLog = {
    timestamp: new Date().toISOString(),
    type: details.type,
    severity: details.severity,
    message: details.message,
    technicalDetails: details.technicalDetails,
    context,
  };

  // Log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.error('[Error Log]', errorLog);
  }

  // In production, send to error tracking service
  // Example: Sentry.captureException(error, { extra: errorLog });
}

// ============================================================================
// Error Formatters
// ============================================================================

/**
 * Format error for display in UI
 */
export function formatErrorForDisplay(error: any): {
  title: string;
  message: string;
  suggestion: string;
  canRetry: boolean;
} {
  const details = classifyError(error);

  return {
    title: getErrorTitle(details.type),
    message: details.userMessage,
    suggestion: getRecoverySuggestion(details.recoveryStrategy),
    canRetry: details.canRetry,
  };
}

/**
 * Get error title based on type
 */
function getErrorTitle(type: ErrorType): string {
  switch (type) {
    case ErrorType.NETWORK:
      return 'Connection Error';
    case ErrorType.AUTH:
      return 'Authentication Error';
    case ErrorType.VALIDATION:
      return 'Invalid Input';
    case ErrorType.BLE:
      return 'Bluetooth Error';
    case ErrorType.PERMISSION:
      return 'Permission Required';
    case ErrorType.TIMEOUT:
      return 'Request Timeout';
    case ErrorType.RATE_LIMIT:
      return 'Too Many Requests';
    case ErrorType.SERVER:
      return 'Server Error';
    default:
      return 'Error';
  }
}

// ============================================================================
// Usage Examples and Documentation
// ============================================================================

/**
 * ERROR HANDLING SYSTEM - COMPREHENSIVE GUIDE
 *
 * 1. THROWING CUSTOM ERRORS:
 *    // Network error
 *    throw new NetworkError('Failed to fetch data', 'ECONNREFUSED');
 *
 *    // Auth error
 *    throw new AuthError('Invalid credentials', 'invalid_credentials');
 *
 *    // Validation error
 *    throw new ValidationError('Invalid email format', 'email', 'user@invalid', 'email_format');
 *
 *    // BLE error
 *    throw new BLEError('Cannot find device', 'not_found');
 *
 *    // Permission error
 *    throw new PermissionError('LOCATION');
 *
 *    // Rate limit error
 *    throw new RateLimitError('Too many requests', 60000);
 *
 *    // Server error
 *    throw new ServerError(503);
 *
 * 2. CLASSIFYING ERRORS:
 *    try {
 *      // some operation
 *    } catch (error) {
 *      const details = classifyError(error);
 *      console.log(details.type); // ErrorType
 *      console.log(details.userMessage); // User-friendly message
 *      console.log(details.canRetry); // Whether to retry
 *    }
 *
 * 3. DISPLAYING ERRORS TO USER:
 *    try {
 *      // operation
 *    } catch (error) {
 *      const formatted = formatErrorForDisplay(error);
 *      showErrorModal({
 *        title: formatted.title,
 *        message: formatted.message,
 *        suggestion: formatted.suggestion,
 *        canRetry: formatted.canRetry,
 *      });
 *    }
 *
 * 4. RETRYING WITH BACKOFF:
 *    await retryWithBackoff(() => fetchUserData(), {
 *      maxAttempts: 3,
 *      baseDelay: 1000,
 *      maxDelay: 10000,
 *      backoffMultiplier: 2,
 *      shouldRetry: (error) => shouldRetryError(error),
 *    });
 *
 * 5. GETTING RECOVERY SUGGESTIONS:
 *    const strategy = classifyError(error).recoveryStrategy;
 *    const suggestion = getRecoverySuggestion(strategy);
 *
 * 6. EXPONENTIAL BACKOFF FOR ATTEMPTS:
 *    for (let i = 0; i < 5; i++) {
 *      try {
 *        await operation();
 *        break;
 *      } catch (error) {
 *        if (shouldRetryError(error)) {
 *          const delay = getRetryDelay(error, i); // i = attempt number
 *          await sleep(delay);
 *        } else {
 *          throw error;
 *        }
 *      }
 *    }
 *
 * 7. ERROR LOGGING:
 *    try {
 *      // operation
 *    } catch (error) {
 *      logError(error, {
 *        userId: currentUser.id,
 *        operation: 'fetchUserProfile',
 *        timestamp: new Date(),
 *      });
 *    }
 *
 * ERROR TYPES AND RECOVERY STRATEGIES:
 *
 * NETWORK:
 *   - Cause: Connection issues, offline
 *   - Recovery: CHECK_INTERNET
 *   - Retryable: Yes
 *
 * AUTH:
 *   - Cause: Invalid credentials, expired token, access denied
 *   - Recovery: REFRESH_TOKEN, LOGOUT, or NONE
 *   - Retryable: No (requires user action)
 *
 * VALIDATION:
 *   - Cause: Invalid input, malformed data
 *   - Recovery: NONE
 *   - Retryable: No (user must fix input)
 *
 * BLE:
 *   - Cause: Bluetooth issues, device not found, connection lost
 *   - Recovery: ENABLE_BLUETOOTH, GRANT_PERMISSION, or RETRY
 *   - Retryable: Usually yes
 *
 * PERMISSION:
 *   - Cause: Missing app permissions
 *   - Recovery: GRANT_PERMISSION
 *   - Retryable: No (requires user action)
 *
 * TIMEOUT:
 *   - Cause: Request took too long
 *   - Recovery: RETRY
 *   - Retryable: Yes
 *
 * RATE_LIMIT:
 *   - Cause: Too many requests in short period
 *   - Recovery: WAIT_AND_RETRY
 *   - Retryable: Yes (after delay)
 *
 * SERVER:
 *   - Cause: 5xx HTTP status codes
 *   - Recovery: RETRY
 *   - Retryable: Yes
 */
