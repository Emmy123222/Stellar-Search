#!/usr/bin/env tsx
/**
 * test-search.ts — End-to-end test of the x402 payment flow
 *
 * Usage:
 *   npm run test:search "Stellar blockchain"
 *   npm run test:search "AI agents" -- --count 10
 *
 * Requirements:
 *   - Server must be running:  npm run server
 *   - .env must have STELLAR_RECEIVING_ADDRESS, SERPER_API_KEY, GROQ_API_KEY set
 */

import dotenv from 'dotenv'
dotenv.config()

const query = process.argv[2] || 'Stellar blockchain developer tools'
const countIdx = process.argv.indexOf('--count')
const count = countIdx !== -1 ? Number(process.argv[countIdx + 1]) : 5
const SERVER = process.env.SEARCH_API_URL || 'http://localhost:3001'

async function checkHealth() {
  const res = await fetch(`${SERVER}/health`)
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
  const data = await res.json() as any
  console.log('   Server status:', data.status)
  console.log('   Serper API:   ', data.serperApiConfigured ? '✓' : '✗ MISSING')
  console.log('   Groq API:     ', data.groqApiConfigured ? '✓' : '✗ MISSING')
  console.log('   Receiving addr:', data.receivingAddressConfigured ? '✓' : '✗ MISSING')
  console.log('   Total queries: ', data.totalQueries)
  return data
}

async function runSearch() {
  console.log('\n🔍 StellarSearch End-to-End Test\n')
  console.log(`   Server:  ${SERVER}`)
  console.log(`   Query:   "${query}"`)
  console.log(`   Count:   ${count}\n`)

  // 1. Health check
  console.log('── Health check ──')
  try {
    await checkHealth()
  } catch (err: any) {
    console.error('✗ Server not reachable:', err.message)
    console.error('\nStart the server first: npm run server')
    process.exit(1)
  }

  // 2. Search (x402 payment is handled server-side)
  console.log('\n── Search request ──')
  console.log('→ GET /search (x402 middleware will enforce payment)')

  const t0 = Date.now()
  const params = new URLSearchParams({ q: query, count: String(count) })

  const res = await fetch(`${SERVER}/search?${params}`)
  const ms = Date.now() - t0

  if (res.status === 402) {
    const body = await res.json() as any
    console.log('\n⚡ Received HTTP 402 Payment Required')
    console.log('   Payment requirements:', JSON.stringify(body, null, 2))
    console.log('\nNote: In production, the x402 client auto-handles this.')
    console.log('      The frontend uses @x402/stellar client to sign + retry.')
    return
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as any) as any
    console.error('✗ Error:', body.error || res.status)
    process.exit(1)
  }

  const data = await res.json() as any

  console.log('\n✓ Results received!')
  console.log(`   Query:    "${data.query}"`)
  console.log(`   Results:  ${data.count}`)
  console.log(`   Latency:  ${ms}ms`)
  console.log(`   Paid:     ${data.paidAmount} ${data.currency}`)
  console.log(`   Network:  ${data.network}`)
  if (data.txHash) console.log(`   TX Hash:  ${data.txHash}`)

  console.log('\n── Results ──')
  data.results.forEach((r: any, i: number) => {
    console.log(`\n${i + 1}. ${r.title}`)
    console.log(`   ${r.url}`)
    if (r.description) console.log(`   ${r.description.slice(0, 120)}${r.description.length > 120 ? '...' : ''}`)
  })

  // 3. Test Groq AI
  console.log('\n── Groq AI test ──')
  const aiRes = await fetch(`${SERVER}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: `Summarise what I should know about: ${query}` }],
    }),
  })

  if (aiRes.ok) {
    const aiData = await aiRes.json() as any
    console.log(`\n✓ Groq AI (${aiData.model}):`)
    console.log(`   ${aiData.content.slice(0, 200)}...`)
  } else {
    console.log('✗ Groq AI unavailable (check GROQ_API_KEY)')
  }

  // 4. Test AI suggestions — opt-in via ?suggestions=1
  console.log('\n── AI suggestions test ──')

  // 4a. With ?suggestions=1 — should return 3 suggestions
  const t1 = Date.now()
  const suggParams = new URLSearchParams({ q: query, count: String(count), suggestions: '1' })
  const suggRes = await fetch(`${SERVER}/search?${suggParams}`)
  const suggMs = Date.now() - t1

  if (suggRes.status === 402) {
    console.log('⚡ Got 402 (payment required) — suggestions test skipped in unauthenticated mode')
  } else if (!suggRes.ok) {
    console.error('✗ Suggestions request failed:', suggRes.status)
  } else {
    const suggData = await suggRes.json() as any
    const suggestions: string[] = suggData.suggestions ?? []

    if (!Array.isArray(suggestions)) {
      console.error('✗ suggestions field is not an array')
      process.exit(1)
    }
    if (suggestions.length !== 3) {
      console.error(`✗ Expected 3 suggestions, got ${suggestions.length}`)
      process.exit(1)
    }
    if (suggMs > 500) {
      console.warn(`⚠  Suggestions added ${suggMs - ms}ms — exceeds 500ms budget (total: ${suggMs}ms)`)
    }

    console.log(`\n✓ Got ${suggestions.length} AI suggestions (${suggMs}ms total):`)
    suggestions.forEach((s, i) => console.log(`   ${i + 1}. ${s}`))
  }

  // 4b. Without ?suggestions=1 — should return empty array
  const noSuggParams = new URLSearchParams({ q: query, count: '1' })
  const noSuggRes = await fetch(`${SERVER}/search?${noSuggParams}`)

  if (noSuggRes.status !== 402 && noSuggRes.ok) {
    const noSuggData = await noSuggRes.json() as any
    const noSuggestions: string[] = noSuggData.suggestions ?? []
    if (noSuggestions.length !== 0) {
      console.error(`✗ Expected 0 suggestions without ?suggestions=1, got ${noSuggestions.length}`)
      process.exit(1)
    }
    console.log('✓ No suggestions returned when ?suggestions=1 is omitted')
  }

  console.log('\n✅ All tests passed!\n')
}

runSearch().catch(err => {
  console.error('\n✗ Unhandled error:', err.message)
  process.exit(1)
})
