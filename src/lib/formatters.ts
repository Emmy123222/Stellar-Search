/**
 * formatters.ts — Shared Intl-based formatting utilities (#internationalization)
 * 
 * All formatters preserve exact machine values while localizing display output.
 * Supports number formatting, currency, dates, time zones, and plural forms.
 */

/**
 * Format a number with locale-aware separators and decimal points.
 * Preserves exact value semantics while adapting to user locale.
 */
export function formatNumber(
  value: number,
  locale?: string,
  options?: Intl.NumberFormatOptions
): string {
  if (!Number.isFinite(value)) {
    return String(value)
  }
  
  const formatter = new Intl.NumberFormat(locale || 'en-US', {
    maximumFractionDigits: 20, // Preserve precision
    ...options,
  })
  
  return formatter.format(value)
}

/**
 * Format USDC amounts with appropriate precision.
 * Handles very small amounts (< 0.001) with scientific notation fallback.
 */
export function formatUSDC(
  value: number | string,
  locale?: string,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }
): string {
  const num = typeof value === 'string' ? parseFloat(value) : value
  
  if (!Number.isFinite(num) || num === 0) {
    return '0'
  }
  
  // For very small amounts, use scientific notation
  if (Math.abs(num) > 0 && Math.abs(num) < 0.001) {
    return formatNumber(num, locale, {
      notation: 'scientific',
      maximumFractionDigits: 2,
      ...options,
    })
  }
  
  return formatNumber(num, locale, {
    minimumFractionDigits: options?.minimumFractionDigits ?? 3,
    maximumFractionDigits: options?.maximumFractionDigits ?? 3,
  })
}

/**
 * Format XLM (lumens) amounts with standard precision.
 */
export function formatXLM(
  value: number | string,
  locale?: string,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }
): string {
  const num = typeof value === 'string' ? parseFloat(value) : value
  
  if (!Number.isFinite(num)) {
    return '0'
  }
  
  return formatNumber(num, locale, {
    minimumFractionDigits: options?.minimumFractionDigits ?? 4,
    maximumFractionDigits: options?.maximumFractionDigits ?? 7,
  })
}

/**
 * Format a percentage with locale-aware formatting.
 */
export function formatPercent(
  value: number,
  locale?: string,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }
): string {
  if (!Number.isFinite(value)) {
    return '0%'
  }
  
  const formatter = new Intl.NumberFormat(locale || 'en-US', {
    style: 'percent',
    minimumFractionDigits: options?.minimumFractionDigits ?? 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 0,
  })
  
  return formatter.format(value)
}

/**
 * Format a relevance score (0-1 range) as a percentage.
 */
export function formatRelevanceScore(score: number, locale?: string): string {
  return formatPercent(score, locale, { maximumFractionDigits: 0 })
}

/**
 * Format large numbers with compact notation (e.g., 1.2K, 3.4M).
 */
export function formatCompact(value: number, locale?: string): string {
  if (!Number.isFinite(value)) {
    return String(value)
  }
  
  const formatter = new Intl.NumberFormat(locale || 'en-US', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  })
  
  return formatter.format(value)
}

/**
 * Format a relative time string (e.g., "5 seconds ago", "2 hours ago").
 * Falls back to standard units if Intl.RelativeTimeFormat is unavailable.
 */
export function formatRelativeTime(
  date: Date | string | number,
  locale?: string,
  options?: { style?: 'long' | 'short' | 'narrow' }
): string {
  const targetDate = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  
  // Handle invalid dates
  if (!targetDate || !(targetDate instanceof Date) || isNaN(targetDate.getTime())) {
    return 'Invalid date'
  }
  
  const now = Date.now()
  const diffMs = now - targetDate.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  
  // Future dates
  if (diffSeconds < 0) {
    return new Intl.DateTimeFormat(locale || 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(targetDate)
  }
  
  try {
    const rtf = new Intl.RelativeTimeFormat(locale || 'en-US', {
      numeric: 'auto',
      style: options?.style || 'long',
    })
    
    // Determine appropriate unit
    if (diffSeconds < 60) {
      return rtf.format(-diffSeconds, 'second')
    }
    
    const diffMinutes = Math.floor(diffSeconds / 60)
    if (diffMinutes < 60) {
      return rtf.format(-diffMinutes, 'minute')
    }
    
    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) {
      return rtf.format(-diffHours, 'hour')
    }
    
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 30) {
      return rtf.format(-diffDays, 'day')
    }
    
    const diffMonths = Math.floor(diffDays / 30)
    if (diffMonths < 12) {
      return rtf.format(-diffMonths, 'month')
    }
    
    const diffYears = Math.floor(diffDays / 365)
    return rtf.format(-diffYears, 'year')
  } catch {
    // Fallback for environments without Intl.RelativeTimeFormat
    return formatRelativeTimeFallback(diffSeconds)
  }
}

/**
 * Fallback relative time formatter for older browsers.
 */
function formatRelativeTimeFallback(diffSeconds: number): string {
  if (diffSeconds < 60) return `${diffSeconds}s ago`
  
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

/**
 * Format an absolute date with locale-aware formatting.
 */
export function formatDate(
  date: Date | string | number,
  locale?: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const targetDate = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  
  // Handle invalid dates
  if (!targetDate || !(targetDate instanceof Date) || isNaN(targetDate.getTime())) {
    return 'Invalid date'
  }
  
  const formatter = new Intl.DateTimeFormat(locale || 'en-US', {
    month: 'short',
    day: 'numeric',
    ...options,
  })
  
  return formatter.format(targetDate)
}

/**
 * Format a date with time included.
 */
export function formatDateTime(
  date: Date | string | number,
  locale?: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const targetDate = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  
  // Handle invalid dates
  if (!targetDate || !(targetDate instanceof Date) || isNaN(targetDate.getTime())) {
    return 'Invalid date'
  }
  
  const formatter = new Intl.DateTimeFormat(locale || 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  })
  
  return formatter.format(targetDate)
}

/**
 * Format a duration in milliseconds to human-readable format.
 */
export function formatDuration(ms: number, locale?: string): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return '0ms'
  }
  
  if (ms < 1000) {
    return `${formatNumber(Math.round(ms), locale)}ms`
  }
  
  const seconds = ms / 1000
  if (seconds < 60) {
    return `${formatNumber(seconds, locale, { maximumFractionDigits: 1 })}s`
  }
  
  const minutes = seconds / 60
  if (minutes < 60) {
    return `${formatNumber(minutes, locale, { maximumFractionDigits: 1 })}m`
  }
  
  const hours = minutes / 60
  return `${formatNumber(hours, locale, { maximumFractionDigits: 1 })}h`
}

/**
 * Calculate remaining queries from USDC balance and price per query.
 */
export function calculateRemainingQueries(
  usdcBalance: number | string,
  pricePerQuery: number | string
): number {
  const balance = typeof usdcBalance === 'string' ? parseFloat(usdcBalance) : usdcBalance
  const price = typeof pricePerQuery === 'string' ? parseFloat(pricePerQuery) : pricePerQuery
  
  if (!Number.isFinite(balance) || !Number.isFinite(price) || price === 0) {
    return 0
  }
  
  return Math.max(0, Math.floor(balance / price))
}

/**
 * Format remaining queries with locale-aware number formatting.
 */
export function formatRemainingQueries(
  usdcBalance: number | string,
  pricePerQuery: number | string,
  locale?: string
): string {
  const queries = calculateRemainingQueries(usdcBalance, pricePerQuery)
  return formatNumber(queries, locale)
}
