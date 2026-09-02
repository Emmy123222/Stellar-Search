#!/usr/bin/env tsx
/**
 * Repeatable reconciliation job.
 *
 * Reads the append-only reconciliation log (server/reconciliationStore.ts —
 * one JSON line per paid /search, /images, or /news request) and reports
 * requests where a settled payment has no matching delivered response, or a
 * response was delivered without a captured settlement. Never prints query
 * content — ReconciliationRecord doesn't carry it.
 *
 * Usage:  npm run reconcile:report [-- --path <logfile>]
 * Exit code is 1 when unmatched records are found, so this can run on a
 * schedule (cron / CI) and alert on non-zero exit.
 */
import { readReconciliationRecords, DEFAULT_RECONCILIATION_LOG_PATH } from '../server/reconciliationStore.js'
import { summarizeReconciliation } from '../src/lib/reconciliation.js'

function parseLogPath(argv: string[]): string {
  const idx = argv.indexOf('--path')
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : DEFAULT_RECONCILIATION_LOG_PATH
}

function main(): void {
  const logPath = parseLogPath(process.argv.slice(2))
  const records = readReconciliationRecords(logPath)
  const report = summarizeReconciliation(records)

  console.log(`Reconciliation report — ${logPath}`)
  console.log(`  total records:            ${report.total}`)
  console.log(`  reconciled:               ${report.reconciled}`)
  console.log(`  settled, no delivery:     ${report.settledNoDelivery}`)
  console.log(`  delivered, no settlement: ${report.deliveredNoSettlement}`)

  if (report.unmatched.length > 0) {
    console.log('\nUnmatched records:')
    for (const r of report.unmatched) {
      console.log(
        `  [${r.outcome}] requestId=${r.requestId} route=${r.route} idempotencyKey=${r.idempotencyKey ?? '(none)'} txHash=${r.receiptTxHash ?? '(none)'} resultCount=${r.resultCount} at=${r.createdAt}`
      )
    }
    process.exitCode = 1
  } else {
    console.log('\nNo unmatched or inconsistent records. ✓')
  }
}

main()
