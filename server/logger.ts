import winston from 'winston';
import crypto from 'crypto';
import { redact } from '../src/lib/redactor.js';

export function privacySafeQuery(value: unknown): undefined {
  // Query text is intentionally never logged; use request IDs for correlation.
  return undefined
}

export function privacySafeIp(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return raw ? `ip:${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16)}` : 'ip:unknown'
}

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
