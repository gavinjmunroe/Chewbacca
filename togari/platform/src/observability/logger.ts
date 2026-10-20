export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: Error | unknown, meta?: Record<string, unknown>): void;
}

const isStdio = process.env.MCP_TRANSPORT === 'stdio';
const noColor = isStdio || !!process.env.NO_COLOR;

const colors = noColor
  ? { reset: '', gray: '', blue: '', yellow: '', red: '', cyan: '' }
  : {
      reset: '\x1b[0m',
      gray: '\x1b[90m',
      blue: '\x1b[34m',
      yellow: '\x1b[33m',
      red: '\x1b[31m',
      cyan: '\x1b[36m',
    };

function getColorForLevel(level: LogLevel): string {
  switch (level) {
    case 'debug': return colors.gray;
    case 'info': return colors.blue;
    case 'warn': return colors.yellow;
    case 'error': return colors.red;
    default: return colors.reset;
  }
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function getStackTrace(error: unknown): string | undefined {
  if (error instanceof Error && error.stack) return error.stack;
  return undefined;
}

function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export function createLogger(name: string): Logger {
  const isDev = isDevelopment();
  const out = isStdio ? process.stderr : process.stdout;

  function write(line: string): void {
    out.write(line + '\n');
  }

  function log(level: LogLevel, message: string, error?: Error | unknown, meta?: Record<string, unknown>): void {
    const timestamp = formatTimestamp();

    if (isDev) {
      const color = getColorForLevel(level);
      const levelStr = level.toUpperCase().padEnd(5);
      write(`${colors.gray}${timestamp}${colors.reset} ${color}${levelStr}${colors.reset} ${colors.cyan}[${name}]${colors.reset} ${message}`);
      if (meta && Object.keys(meta).length > 0) write(`${colors.gray}  →${colors.reset} ${JSON.stringify(meta)}`);
      if (error) {
        const stack = getStackTrace(error);
        write(stack ? `${colors.red}${stack}${colors.reset}` : `${colors.red}${String(error)}${colors.reset}`);
      }
    } else {
      const logEntry: Record<string, unknown> = { timestamp, level, name, message };
      if (meta && Object.keys(meta).length > 0) logEntry.meta = meta;
      if (error) {
        const stack = getStackTrace(error);
        if (stack) logEntry.stack = stack;
        logEntry.error = error instanceof Error ? { name: error.name, message: error.message } : error;
      }
      write(JSON.stringify(logEntry));
    }
  }

  return {
    debug: (message, meta) => log('debug', message, undefined, meta),
    info: (message, meta) => log('info', message, undefined, meta),
    warn: (message, meta) => log('warn', message, undefined, meta),
    error: (message, error, meta) => log('error', message, error, meta),
  };
}

export default createLogger('app');
