# Intl-Based Formatters Documentation

## Overview

The `src/lib/formatters.ts` module provides shared, locale-aware formatting utilities using the browser's native `Intl` API. All formatters preserve exact machine values while adapting display output to the user's locale.

## Design Principles

1. **Preserve Precision**: Machine values are never rounded before calculations, only for display
2. **Locale Awareness**: All formatters respect browser locale settings
3. **Graceful Degradation**: Invalid inputs return sensible defaults
4. **Consistent API**: All formatters follow similar parameter patterns

## Number Formatting

### `formatNumber(value, locale?, options?)`

Formats numbers with locale-aware separators and decimal points.

```typescript
formatNumber(1234.56) // "1,234.56" (en-US)
formatNumber(1234.56, 'de-DE') // "1.234,56" (German)
formatNumber(0.123456789012345) // Preserves high precision
```

**Parameters:**
- `value: number` - The number to format
- `locale?: string` - BCP 47 language tag (defaults to 'en-US')
- `options?: Intl.NumberFormatOptions` - Additional formatting options

**Edge Cases:**
- `NaN`, `Infinity`, `-Infinity` return their string representation
- Preserves up to 20 decimal places by default

## Currency Formatting

### `formatUSDC(value, locale?, options?)`

Formats USDC amounts with appropriate precision. Handles very small amounts (< 0.001) with scientific notation.

```typescript
formatUSDC(123.456789) // "123.457"
formatUSDC(0.0001) // "1e-4" (scientific notation for tiny amounts)
formatUSDC('1.001') // "1.001" (accepts strings)
```

**Parameters:**
- `value: number | string` - The USDC amount
- `locale?: string` - BCP 47 language tag
- `options?: { minimumFractionDigits?, maximumFractionDigits? }`

**Default Precision:** 3-6 decimal places

### `formatXLM(value, locale?, options?)`

Formats XLM (lumens) amounts with standard precision.

```typescript
formatXLM(100.1234567) // "100.1234567"
formatXLM('50.5') // "50.5000"
```

**Default Precision:** 4-7 decimal places

## Percentage Formatting

### `formatPercent(value, locale?, options?)`

Formats decimal values as percentages.

```typescript
formatPercent(0.5) // "50%"
formatPercent(0.1234) // "12%"
formatPercent(-0.25) // "-25%"
```

### `formatRelevanceScore(score, locale?)`

Formats relevance scores (0-1 range) as whole percentages.

```typescript
formatRelevanceScore(0.95) // "95%"
formatRelevanceScore(0.123) // "12%"
```

## Compact Notation

### `formatCompact(value, locale?)`

Formats large numbers with compact notation (K, M, B).

```typescript
formatCompact(1200) // "1.2K"
formatCompact(1500000) // "1.5M"
formatCompact(1000000000) // "1B"
formatCompact(999) // "999" (no compacting for small numbers)
```

## Date and Time Formatting

### `formatRelativeTime(date, locale?, options?)`

Formats relative time strings using `Intl.RelativeTimeFormat`.

```typescript
formatRelativeTime(fiveSecondsAgo) // "5 seconds ago"
formatRelativeTime(twoHoursAgo) // "2 hours ago"
formatRelativeTime(futureDate) // Falls back to absolute date
```

**Parameters:**
- `date: Date | string` - The date to format (ISO string or Date object)
- `locale?: string` - BCP 47 language tag
- `options?: { style?: 'long' | 'short' | 'narrow' }`

**Edge Cases:**
- Invalid dates return `"Invalid date"`
- Future dates return formatted absolute date
- Automatically selects appropriate unit (seconds, minutes, hours, days, months, years)

### `formatDate(date, locale?, options?)`

Formats absolute dates with locale-aware formatting.

```typescript
formatDate('2024-01-15T12:00:00Z') // "Jan 15"
formatDate(date, 'en-US', { year: 'numeric' }) // "Jan 15, 2024"
```

### `formatDateTime(date, locale?, options?)`

Formats dates with time included.

```typescript
formatDateTime('2024-01-15T12:30:00Z') // "Jan 15, 12:30 PM"
```

## Duration Formatting

### `formatDuration(ms, locale?)`

Formats durations in milliseconds to human-readable format.

```typescript
formatDuration(500) // "500ms"
formatDuration(5000) // "5s"
formatDuration(120000) // "2m"
formatDuration(7200000) // "2h"
```

## Query Calculations

### `calculateRemainingQueries(usdcBalance, pricePerQuery)`

Calculates remaining queries from USDC balance and price.

```typescript
calculateRemainingQueries(10, 0.001) // 10000
calculateRemainingQueries('5', '0.5') // 10
```

**Returns:** `number` - Floor of balance divided by price

### `formatRemainingQueries(usdcBalance, pricePerQuery, locale?)`

Formats remaining queries with locale-aware number formatting.

```typescript
formatRemainingQueries(1000, 0.001) // "1,000,000"
formatRemainingQueries(5, 0.5) // "10"
```

## Time Zones

All date formatters accept a `timeZone` option through `Intl.DateTimeFormatOptions`:

```typescript
formatDate(date, 'en-US', { timeZone: 'UTC' })
formatDateTime(date, 'en-US', { timeZone: 'America/New_York' })
```

## Plural Forms

`formatRelativeTime` automatically handles plural forms through `Intl.RelativeTimeFormat`:

```typescript
formatRelativeTime(oneSecondAgo) // "1 second ago"
formatRelativeTime(fiveSecondsAgo) // "5 seconds ago"
```

## Browser Compatibility

All formatters use standard `Intl` APIs available in modern browsers:
- `Intl.NumberFormat` (ES5.1)
- `Intl.DateTimeFormat` (ES5.1)
- `Intl.RelativeTimeFormat` (ES2020, with fallback)

The `formatRelativeTime` function includes a fallback for older browsers that don't support `Intl.RelativeTimeFormat`.

## Testing

Comprehensive tests are in `src/lib/formatters.test.ts` covering:
- Number formatting with various locales
- Currency formatting (USDC, XLM)
- Percentage and relevance score formatting
- Compact notation
- Relative and absolute date/time formatting
- Time zone handling
- Plural forms
- Invalid input handling
- Very small amounts (< 0.001 USDC)
- Duration formatting
- Query calculations

## Migration Guide

### From Hard-Coded Formatting

**Before:**
```typescript
(score * 100).toFixed(0) + '%'
parseFloat(balance).toFixed(4)
new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
Math.floor(balance / price).toLocaleString()
```

**After:**
```typescript
formatRelevanceScore(score)
formatXLM(balance)
formatDate(date)
formatRemainingQueries(balance, price)
```

### Benefits

1. **Consistency**: All formatting uses the same locale
2. **Maintainability**: Centralized formatting logic
3. **Accessibility**: Proper locale support for international users
4. **Type Safety**: TypeScript types for all parameters
5. **Testing**: Comprehensive test coverage

## Related Files

- `src/lib/formatters.ts` - Main implementation
- `src/lib/formatters.test.ts` - Test suite
- `src/lib/stellar.ts` - Legacy formatters (deprecated)
