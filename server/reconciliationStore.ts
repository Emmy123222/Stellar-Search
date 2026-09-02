import fs from 'fs'
import path from 'path'
import type { ReconciliationRecord } from '../src/lib/reconciliation.js'

/**
 * Append-only JSON-lines log of ReconciliationRecord entries. Deliberately
 * a plain file rather than the in-memory paymentIntegrity store: it must
 * survive process restarts so the reconcile:report job (scripts/reconcile-report.ts)
 * can be run repeatably, independent of server uptime.
 */
export const DEFAULT_RECONCILIATION_LOG_PATH =
  process.env.RECONCILIATION_LOG_PATH || path.join(process.cwd(), 'logs', 'reconciliation.jsonl')

export function appendReconciliationRecord(
  record: ReconciliationRecord,
  logPath: string = DEFAULT_RECONCILIATION_LOG_PATH,
): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  fs.appendFileSync(logPath, JSON.stringify(record) + '\n')
}

export function readReconciliationRecords(
  logPath: string = DEFAULT_RECONCILIATION_LOG_PATH,
): ReconciliationRecord[] {
  if (!fs.existsSync(logPath)) return []
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as ReconciliationRecord)
}
