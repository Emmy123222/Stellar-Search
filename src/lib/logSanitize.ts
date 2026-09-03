/**
 * Sanitizes free-form text before it is written to operator logs.
 *
 * Upstream providers (Serper.dev) and thrown errors can contain control
 * characters, newlines, and unbounded payloads that would otherwise allow
 * log injection or flood operator output. This helper guarantees a stable,
 * single-line, bounded string that is safe to log.
 */
export function sanitizeOperatorText(value: unknown, maxLength = 200): string {
  if (value === null || value === undefined) return ''
  const str = typeof value === 'string' ? value : String(value)
  // Strip C0 control characters + DEL (newlines, tabs, null bytes, ANSI escapes...)
  const stripped = str.replace(/[\x00-\x1F\x7F]/g, ' ')
  // Collapse runs of whitespace into a single space and trim
  const collapsed = stripped.replace(/\s+/g, ' ').trim()
  return collapsed.slice(0, maxLength)
}
