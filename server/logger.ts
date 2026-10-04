import winston from 'winston';
import crypto from 'crypto';
import { redact } from '../src/lib/redactor.js';

/**
 * Debug logging mode - for development/troubleshooting only.
 *
 * WARNING: When DEBUG_LOGGING=true, logs may contain:
 * - Full client IP addresses (PII)
 * - Full query text (user search queries)
 * - Other sensitive data that is normally redacted
 *
 * Retention policy for debug mode:
 * - Debug logs should only be enabled temporarily for active debugging sessions
 * - Debug logs should never be stored long-term or committed to version control
 * - Debug logs should be cleared after the debugging session is complete
 * - Debug logs are subject to the same access controls as regular logs
 *
 * In production deployments, ensure DEBUG_LOGGING is unset or set to "false".
 */
function isDebugMode(): boolean {
  return process.env.DEBUG_LOGGING === 'true';
}

export function privacySafeQuery(value: unknown): string | undefined {
  if (isDebugMode()) {
    // In debug mode, return full query (truncated to avoid log bloat)
    const raw = typeof value === 'string' ? value : ''
    return raw ? String(raw).substring(0, 200) : undefined
  }
  // Default: query text is intentionally never logged; use request IDs for correlation.
export function privacySafeQuery(_value: unknown): undefined {
  // Query text is intentionally never logged; use request IDs for correlation.
  return undefined
}

export function privacySafeIp(value: unknown): string {
  if (isDebugMode()) {
    // In debug mode, return full IP (for troubleshooting)
    const raw = typeof value === 'string' ? value : ''
    return raw || 'ip:unknown'
  }
  // Default: return SHA-256 hash (first 16 chars) for privacy
  const raw = typeof value === 'string' ? value : ''
  return raw ? `ip:${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16)}` : 'ip:unknown'
}

const redactorFormat = winston.format((info: any) => {
  return redact(info as Record<string, unknown>) as unknown as winston.Logform.TransformableInfo
})

const logger = winston.createLogger({
  level: isDebugMode() ? 'debug' : 'info',
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
