// Shared query-validation test table. Consumed directly by
// src/lib/queryValidator.test.ts (unit tests against validateQuery) and by
// server/index.test.ts + api/search.test.ts (integration tests asserting the
// Express and Vercel handlers both return the same status code / cleaned
// query for the same raw `q` input).

import { MAX_QUERY_LENGTH } from './queryValidator'

export interface QueryValidationCase {
  name: string
  input: unknown
  expectedStatus: 200 | 400
  expectedCleanQ?: string
}

const tooLong = 'a'.repeat(MAX_QUERY_LENGTH + 1)
const exactMax = 'a'.repeat(MAX_QUERY_LENGTH)

export const queryValidationCases: QueryValidationCase[] = [
  { name: 'valid query', input: 'stellar blockchain', expectedStatus: 200, expectedCleanQ: 'stellar blockchain' },
  { name: 'trims surrounding whitespace', input: '  hello world  ', expectedStatus: 200, expectedCleanQ: 'hello world' },
  { name: 'missing q (undefined)', input: undefined, expectedStatus: 400 },
  { name: 'empty string', input: '', expectedStatus: 400 },
  { name: 'whitespace-only string', input: '   ', expectedStatus: 400 },
  { name: 'query too long', input: tooLong, expectedStatus: 400 },
  { name: 'query exactly at max length', input: exactMax, expectedStatus: 200, expectedCleanQ: exactMax },
  { name: 'strips null bytes and control characters', input: 'hello\x00\x01\x1Fworld\x7F', expectedStatus: 200, expectedCleanQ: 'helloworld' },
  { name: 'becomes empty after stripping controls', input: '\x00\x01\x1F   ', expectedStatus: 400 },
  { name: 'strips controls then trims', input: '\x00  hello \x1F ', expectedStatus: 200, expectedCleanQ: 'hello' },
  { name: 'preserves punctuation and unicode', input: 'Stellar blockchain — pay-per-query & 0.001 USDC!', expectedStatus: 200, expectedCleanQ: 'Stellar blockchain — pay-per-query & 0.001 USDC!' },
]
