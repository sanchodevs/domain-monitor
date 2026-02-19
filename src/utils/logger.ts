import pino from 'pino';
import path from 'path';
import fs from 'fs';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_TO_FILE = process.env.LOG_TO_FILE === 'true';
const LOG_DIR = process.env.LOG_DIR || './logs';

// Ensure log directory exists if file logging is enabled
if (LOG_TO_FILE && !fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Create transports array
const targets: pino.TransportTargetOptions[] = [
  {
    target: 'pino-pretty',
    level: LOG_LEVEL,
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
];

// Add rotating file transport if enabled
if (LOG_TO_FILE) {
  targets.push({
    target: 'pino-roll',
    level: LOG_LEVEL,
    options: {
      file: path.join(LOG_DIR, 'app.log'),
      frequency: 'daily',
      size: '20m',
      limit: { count: 7 }, // keep 7 days of logs
    },
  });
}

const pinoLogger = pino({
  level: LOG_LEVEL,
  transport: {
    targets,
  },
});

// Wrapper interface for logger with flexible API
// Supports both logger.info('message') and logger.info('message', { data })
interface LogFn {
  (msg: string, data?: Record<string, unknown>): void;
}

interface Logger {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  debug: LogFn;
  child: (bindings: Record<string, unknown>) => Logger;
}

function createWrappedLogger(baseLogger: pino.Logger): Logger {
  const wrap = (level: 'info' | 'warn' | 'error' | 'debug'): LogFn => {
    return (msg: string, data?: Record<string, unknown>) => {
      if (data) {
        baseLogger[level](data, msg);
      } else {
        baseLogger[level](msg);
      }
    };
  };

  return {
    info: wrap('info'),
    warn: wrap('warn'),
    error: wrap('error'),
    debug: wrap('debug'),
    child: (bindings: Record<string, unknown>) => createWrappedLogger(baseLogger.child(bindings)),
  };
}

export const logger = createWrappedLogger(pinoLogger);

// Create child loggers for different modules
export const createLogger = (module: string) => logger.child({ module });

// Request logging helper
export const logRequest = (method: string, path: string, statusCode: number, duration: number) => {
  logger.info('request', {
    type: 'request',
    method,
    path,
    statusCode,
    duration: `${duration}ms`,
  });
};

export default logger;
