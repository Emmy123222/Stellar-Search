import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { appendReconciliationRecord, readReconciliationRecords } from './reconciliationStore'
import { buildReconciliationRecord } from '../src/lib/reconciliation'

let tmpDir: string

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
})

function makeLogPath(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconciliation-test-'))
  return path.join(tmpDir, 'reconciliation.jsonl')
}

describe('reconciliationStore', () => {
  it('returns an empty array when the log file does not exist yet', () => {
    const logPath = makeLogPath()
    expect(readReconciliationRecords(logPath)).toEqual([])
  })

  it('creates the log directory and appends one JSON line per record', () => {
    const logPath = makeLogPath()
    const record = buildReconciliationRecord({
      requestId: 'req-1',
      idempotencyKey: 'tx:abc',
      route: '/search',
      receiptTxHash: 'abc',
      providerDelivered: true,
      resultCount: 3,
    })

    appendReconciliationRecord(record, logPath)
    const raw = fs.readFileSync(logPath, 'utf8')
    expect(raw.trim().split('\n')).toHaveLength(1)

    const [read] = readReconciliationRecords(logPath)
    expect(read).toEqual(record)
  })

  it('reads back multiple appended records in order', () => {
    const logPath = makeLogPath()
    const r1 = buildReconciliationRecord({ requestId: 'a', idempotencyKey: 'tx:a', route: '/search', receiptTxHash: 'a', providerDelivered: true, resultCount: 1 })
    const r2 = buildReconciliationRecord({ requestId: 'b', idempotencyKey: 'tx:b', route: '/images', receiptTxHash: null, providerDelivered: false, resultCount: 0 })

    appendReconciliationRecord(r1, logPath)
    appendReconciliationRecord(r2, logPath)

    const records = readReconciliationRecords(logPath)
    expect(records.map(r => r.requestId)).toEqual(['a', 'b'])
    expect(records[1].outcome).toBe('settled_no_delivery')
  })

  it('skips blank lines', () => {
    const logPath = makeLogPath()
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.writeFileSync(logPath, '\n\n')
    expect(readReconciliationRecords(logPath)).toEqual([])
  })
})
