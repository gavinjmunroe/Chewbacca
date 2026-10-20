/**
 * Log level types
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger interface for consistent logging across the application
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: Error | unknown, meta?: Record<string, unknown>): void;
}

/**
 * ANSI color codes for terminal output
 */
const colors = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

/**
 * Get color for log level
 */
function getColorForLevel(level: LogLevel): string {
  switch (level) {
    case 'debug':
      return colors.gray;
    case 'info':
      return colors.blue;
    case 'warn':
      return colors.yellow;
    case 'error':
      return colors.red;
    default:
      return colors.reset;
  }
}

/**
 * Format timestamp for logs
 */
function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Extract stack trace from error
 */
function getStackTrace(error: unknown): string | undefined {
  if (error instanceof Error && error.stack) {
    return error.stack;
  }
  return undefined;
}

/**
 * Check if running in development mode
 */
function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Create a logger instance with the specified name
 *
 * In development mode:
 * - Pretty print with colors and timestamps
 * - Human-readable format
 *
 * In production mode:
 * - JSON output with structured data
 * - Includes timestamp, level, name, message, and metadata
 * - error() method includes stack traces
 *
 * @param name - The name/identifier for this logger instance
 * @returns Logger instance
 *
 * @example
 * ```typescript
 * const logger = createLogger('MyService');
 * logger.info('Service started', { port: 3000 });
 * logger.error('Failed to connect', new Error('Connection refused'));
 * ```
 */
export function createLogger(name: string): Logger {
  const isDev = isDevelopment();

  function log(level: LogLevel, message: string, error?: Error | unknown, meta?: Record<string, unknown>): void {
    const timestamp = formatTimestamp();

    if (isDev) {
      // Development: Pretty print with colors
      const color = getColorForLevel(level);
      const levelStr = level.toUpperCase().padEnd(5);
      const nameStr = `[${name}]`;

      console.log(
        `${colors.gray}${timestamp}${colors.reset} ${color}${levelStr}${colors.reset} ${colors.cyan}${nameStr}${colors.reset} ${message}`
      );

      if (meta && Object.keys(meta).length > 0) {
        console.log(`${colors.gray}  →${colors.reset}`, meta);
      }

      if (error) {
        const stack = getStackTrace(error);
        if (stack) {
          console.log(`${colors.red}${stack}${colors.reset}`);
        } else {
          console.log(`${colors.red}`, error, `${colors.reset}`);
        }
      }
    } else {
      // Production: JSON output
      const logEntry: Record<string, unknown> = {
        timestamp,
        level,
        name,
        message,
      };

      if (meta && Object.keys(meta).length > 0) {
        logEntry.meta = meta;
      }

      if (error) {
        const stack = getStackTrace(error);
        if (stack) {
          logEntry.stack = stack;
        }
        if (error instanceof Error) {
          logEntry.error = {
            name: error.name,
            message: error.message,
          };
        } else {
          logEntry.error = error;
        }
      }

      console.log(JSON.stringify(logEntry));
    }
  }

  return {
    debug(message: string, meta?: Record<string, unknown>): void {
      log('debug', message, undefined, meta);
    },

    info(message: string, meta?: Record<string, unknown>): void {
      log('info', message, undefined, meta);
    },

    warn(message: string, meta?: Record<string, unknown>): void {
      log('warn', message, undefined, meta);
    },

    error(message: string, error?: Error | unknown, meta?: Record<string, unknown>): void {
      log('error', message, error, meta);
    },
  };
}

/**
 * Default application logger instance
 */
export default createLogger('app');
