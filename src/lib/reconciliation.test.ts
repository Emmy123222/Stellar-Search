import { describe, it, expect } from 'vitest'
import {
  classifyOutcome,
  buildReconciliationRecord,
  summarizeReconciliation,
  type ReconciliationRecord,
} from './reconciliation'

describe('classifyOutcome', () => {
  it('marks settled + delivered as reconciled', () => {
    expect(classifyOutcome(true, true)).toBe('reconciled')
  })

  it('marks settled + not delivered as settled_no_delivery', () => {
    expect(classifyOutcome(true, false)).toBe('settled_no_delivery')
  })

  it('marks not settled + delivered as delivered_no_settlement', () => {
    expect(classifyOutcome(false, true)).toBe('delivered_no_settlement')
  })
})

describe('buildReconciliationRecord', () => {
  it('derives paymentSettled from a non-null idempotencyKey', () => {
    const record = buildReconciliationRecord({
      requestId: 'req-1',
      idempotencyKey: 'tx:abc123',
      route: '/search',
      receiptTxHash: 'abc123',
      providerDelivered: true,
      resultCount: 5,
      now: new Date('2026-01-01T00:00:00Z'),
    })
    expect(record.paymentSettled).toBe(true)
    expect(record.outcome).toBe('reconciled')
    expect(record.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('derives paymentSettled=false from a null idempotencyKey', () => {
    const record = buildReconciliationRecord({
      requestId: 'req-2',
      idempotencyKey: null,
      route: '/images',
      receiptTxHash: null,
      providerDelivered: true,
      resultCount: 2,
    })
    expect(record.paymentSettled).toBe(false)
    expect(record.outcome).toBe('delivered_no_settlement')
  })

  it('never includes query content — only identifiers, booleans, counts, timestamps', () => {
    const record = buildReconciliationRecord({
      requestId: 'req-3',
      idempotencyKey: 'tx:xyz',
      route: '/news',
      receiptTxHash: 'xyz',
      providerDelivered: false,
      resultCount: 0,
    })
    expect(Object.keys(record).sort()).toEqual(
      [
        'requestId',
        'idempotencyKey',
        'route',
        'receiptTxHash',
        'paymentSettled',
        'providerDelivered',
        'resultCount',
        'outcome',
        'createdAt',
      ].sort()
    )
  })
})

describe('summarizeReconciliation', () => {
  const base = {
    route: '/search' as const,
    receiptTxHash: null,
    resultCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  }

  const records: ReconciliationRecord[] = [
    { ...base, requestId: '1', idempotencyKey: 'tx:1', paymentSettled: true, providerDelivered: true, outcome: 'reconciled' },
    { ...base, requestId: '2', idempotencyKey: 'tx:2', paymentSettled: true, providerDelivered: false, outcome: 'settled_no_delivery' },
    { ...base, requestId: '3', idempotencyKey: null, paymentSettled: false, providerDelivered: true, outcome: 'delivered_no_settlement' },
    { ...base, requestId: '4', idempotencyKey: 'tx:4', paymentSettled: true, providerDelivered: true, outcome: 'reconciled' },
  ]

  it('counts each outcome bucket correctly', () => {
    const report = summarizeReconciliation(records)
    expect(report.total).toBe(4)
    expect(report.reconciled).toBe(2)
    expect(report.settledNoDelivery).toBe(1)
    expect(report.deliveredNoSettlement).toBe(1)
  })

  it('collects every non-reconciled record as unmatched', () => {
    const report = summarizeReconciliation(records)
    expect(report.unmatched.map(r => r.requestId).sort()).toEqual(['2', '3'])
  })

  it('returns an empty report for no records', () => {
    const report = summarizeReconciliation([])
    expect(report).toEqual({ total: 0, reconciled: 0, settledNoDelivery: 0, deliveredNoSettlement: 0, unmatched: [] })
  })
})
