import winston from 'winston';
import { redact } from '../src/lib/redactor.js';

const redactorFormat = winston.format((info) => {
  // Winston info is mutated; we redact a shallow copy to avoid infinite loops
  // Redact the entire info object recursively
  const redacted = redact(info as Record<string, unknown>) as Record<string, unknown>;
  // Preserve level/message/symbol properties that winston uses
  // winston stores level as string, message as string; redact already handled nested keys
  return redacted as unknown as winston.Logform.TransformableInfo;
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    redactorFormat(),
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ level: true }),
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          // Meta already redacted by outer format, but double-ensure
          const safeMeta = Object.keys(meta).length ? ` ${JSON.stringify(redact(meta))}` : '';
          return `${timestamp as string} ${level as string}: ${message as string}${safeMeta}`;
        })
      ),
    }),
  ],
});

export default logger;
export { redact };
