import winston from 'winston';
import crypto from 'crypto';

export function privacySafeQuery(value: unknown): undefined {
  // Query text is intentionally never logged; use request IDs for correlation.
  return undefined
}

export function privacySafeIp(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return raw ? `ip:${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16)}` : 'ip:unknown'
}

// Configure Winston to log structured JSON to stderr.
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      // By default, Winston writes to stdout. We redirect to stderr for all log levels.
      stderrLevels: ['error', 'warn', 'info', 'debug'],
      consoleWarnLevels: [],
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.json()
      ),
    }),
  ],
});

export default logger;
