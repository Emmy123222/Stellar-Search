import winston from 'winston';
import { redact } from '../src/lib/redactor.js';
import { privacySafeIp, privacySafeQuery } from './privacy.js';

// Re-exported for existing consumers; the implementations live in
// server/privacy.ts so handlers can use them without importing the logger.
export { privacySafeIp, privacySafeQuery };

const redactorFormat = winston.format((info) => {
  return redact(info as Record<string, unknown>) as unknown as winston.Logform.TransformableInfo
})

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(redactorFormat(), winston.format.json()),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

export default logger;
export { redact };
