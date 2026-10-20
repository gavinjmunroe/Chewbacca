/**
 * Production-ready logging utility
 * Centralized logging with levels, timestamps, and structured output
 * Automatically redacts PII and sensitive data from all log outputs
 */

import { redactString, redactObject, redactError } from './piiRedaction';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

class Logger {
  private minLevel: LogLevel;
  private context: Record<string, unknown>;

  constructor(minLevel: LogLevel = LogLevel.INFO, context: Record<string, unknown> = {}) {
    this.minLevel = minLevel;
    this.context = context;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.minLevel;
  }

  private formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error): string {
    // Redact PII from message
    const redactedMessage = redactString(message);

    // Redact PII from context
    const combinedContext = context ? { ...this.context, ...context } : undefined;
    const redactedContext = combinedContext ? redactObject(combinedContext) : undefined;

    // Redact PII from error
    const redactedError = error ? redactError(error) : undefined;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      message: redactedMessage,
      ...(redactedContext && { context: redactedContext }),
      ...(redactedError && { error: redactedError }),
    };

    return JSON.stringify(entry);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(this.formatMessage(LogLevel.DEBUG, message, context));
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(this.formatMessage(LogLevel.INFO, message, context));
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage(LogLevel.WARN, message, context));
    }
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage(LogLevel.ERROR, message, context, error));
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: Record<string, unknown>): Logger {
    return new Logger(this.minLevel, { ...this.context, ...additionalContext });
  }
}

// Create default logger instance
const logLevelFromEnv = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
const logLevel = LogLevel[logLevelFromEnv as keyof typeof LogLevel] ?? LogLevel.INFO;

export const logger = new Logger(logLevel);

// Convenience exports for different modules
export const createLogger = (module: string) => logger.child({ module });
