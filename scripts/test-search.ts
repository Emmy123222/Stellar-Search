#!/usr/bin/env tsx
/**
 * test-search.ts — supported CLI client for StellarSearch
 *
 * Usage examples:
 *   npx tsx scripts/test-search.ts "Stellar x402" --mode discovery
 *   npx tsx scripts/test-search.ts "Stellar x402" --mode quote --json
 *   npx tsx scripts/test-search.ts "Stellar x402" --mode search --count 3 --timeout 10000
 *
 * Secret handling:
 *   - Prefer a secure env var or protected stdin prompt for signing keys.
 *   - Never paste secret material into a shell command line. It must not appear in logs or README examples.
 */

import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'

dotenv.config()

export type CliMode = 'discovery' | 'quote' | 'search'

export interface ParsedCliArgs {
  query: string
  mode: CliMode
  count: number
  timeout: number
  json: boolean
  freshness?: string
  receiptPath?: string
  server: string
  privateKey?: string
  privateKeyFile?: string
}

const DEFAULT_QUERY = 'Stellar blockchain developer tools'
const DEFAULT_SERVER = process.env.SEARCH_API_URL || 'http://localhost:3001'
const DEFAULT_TIMEOUT_MS = 30_000

export function redactSecret(value?: string): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return '<empty>'
  if (raw.length <= 4) return '*'.repeat(raw.length)
  const head = raw.slice(0, 2)
  const tail = raw.slice(-2)
  const maskLength = Math.max(4, Math.min(12, raw.length - 4))
  return `${head}${'*'.repeat(maskLength)}${tail}`
}

export function printHelp(): string {
  return [
    'Usage: npx tsx scripts/test-search.ts [query] [options]',
    '',
    'Modes:',
    '  discovery    Check server health and runtime config',
    '  quote        Request the x402 quote without settling payment',
    '  search       Run the paid search flow with optional signing config',
    '',
    'Options:',
    '  --mode, -m <discovery|quote|search>  Select the client mode',
    '  --count, -c <n>                     Result count (default: 5)',
    '  --timeout, -t <ms>                  HTTP timeout in milliseconds (default: 30000)',
    '  --json, -j                          Emit machine-readable JSON only',
    '  --freshness, -f <pd|pw|pm>          Serper freshness filter',
    '  --receipt, -r <path>                Write a JSON receipt for the final request',
    '  --server, --url <url>               Server base URL (default: http://localhost:3001)',
    '  --private-key <value>               Secret signing material; never log it',
    '  --private-key-file <path>           Read signing material from a file without echoing it',
    '  --help                              Show this help and exit',
    '',
    'Secure secret guidance:',
    '  Use a protected environment variable or a stdin prompt instead of pasting a key into a shell command.',
    '  Keys never appear in logs, output, or shell history guidance, and are redacted before printing.',
  ].join('\n')
}

function parsePositiveInteger(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
  return Math.floor(parsed)
}

export function parseCliArgs(argv: string[] = process.argv.slice(2)): ParsedCliArgs {
  const args: ParsedCliArgs = {
    query: DEFAULT_QUERY,
    mode: 'search',
    count: 5,
    timeout: DEFAULT_TIMEOUT_MS,
    json: false,
    server: DEFAULT_SERVER,
  }

  const positional: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') {
      throw new Error(printHelp())
    }
    if (token === '--json' || token === '-j') {
      args.json = true
      continue
    }
    if (token === '--mode' || token === '-m') {
      const val = argv[i + 1]
      if (!val) throw new Error('Missing value for --mode')
      if (!['discovery', 'quote', 'search'].includes(val)) {
        throw new Error(`Unsupported mode: ${val}. Supported modes: discovery, quote, search`)
      }
      args.mode = val as CliMode
      i += 1
      continue
    }
    if (token === '--count' || token === '-c') {
      const val = argv[i + 1]
      args.count = parsePositiveInteger(val, args.count, 'count')
      i += 1
      continue
    }
    if (token === '--timeout' || token === '-t') {
      const val = argv[i + 1]
      args.timeout = parsePositiveInteger(val, args.timeout, 'timeout')
      i += 1
      continue
    }
    if (token === '--freshness' || token === '-f') {
      const val = argv[i + 1]
      if (!val) throw new Error('Missing value for --freshness')
      args.freshness = val
      i += 1
      continue
    }
    if (token === '--receipt' || token === '-r') {
      const val = argv[i + 1]
      if (!val) throw new Error('Missing value for --receipt')
      args.receiptPath = val
      i += 1
      continue
    }
    if (token === '--server' || token === '--url') {
      const val = argv[i + 1]
      if (!val) throw new Error('Missing value for --server')
      args.server = val
      i += 1
      continue
    }
    if (token === '--private-key') {
      const val = argv[i + 1]
      if (!val) throw new Error('Missing value for --private-key')
      args.privateKey = val
      i += 1
      continue
    }
    if (token === '--private-key-file') {
      const val = argv[i + 1]
      if (!val) throw new Error('Missing value for --private-key-file')
      args.privateKeyFile = val
      i += 1
      continue
    }
    if (token.startsWith('--')) {
      throw new Error(`Unknown option: ${token}`)
    }

    positional.push(token)
  }

  if (positional.length > 0) {
    args.query = positional.join(' ')
  }

  return args
}

async function resolvePrivateKey(args: ParsedCliArgs): Promise<string | undefined> {
  if (args.privateKey) return args.privateKey
  if (args.privateKeyFile) {
    const contents = fs.readFileSync(args.privateKeyFile, 'utf8').trim()
    if (!contents) throw new Error(`Private key file is empty: ${args.privateKeyFile}`)
    return contents
  }
  const envValue = process.env.STELLAR_PRIVATE_KEY || process.env.SEARCH_PRIVATE_KEY
  if (envValue) return envValue
  return undefined
}

async function writeReceipt(pathname: string, payload: Record<string, unknown>): Promise<void> {
  const resolved = path.resolve(pathname)
  const dir = path.dirname(resolved)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(resolved, JSON.stringify(payload, null, 2) + '\n', 'utf8')
}

async function runCli() {
  const args = parseCliArgs()
  const privateKey = await resolvePrivateKey(args)

  if (args.mode === 'discovery') {
    const res = await fetch(`${args.server}/health`, { signal: AbortSignal.timeout(args.timeout) })
    const payload = await res.json().catch(() => ({}))
    const result = {
      server: args.server,
      ok: res.ok,
      status: res.status,
      payload,
      privateKeyConfigured: !!privateKey,
      signingKeyRedacted: privateKey ? redactSecret(privateKey) : null,
    }

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(`Server: ${args.server}`)
      console.log(`Health: ${res.status} ${res.ok ? 'OK' : 'FAILED'}`)
      console.log(`Private key configured: ${privateKey ? 'yes' : 'no'}`)
      if (privateKey) console.log(`Signing key: ${redactSecret(privateKey)}`)
      console.log(JSON.stringify(payload, null, 2))
    }
    return
  }

  if (args.mode === 'quote') {
    const params = new URLSearchParams({ q: args.query, count: String(args.count) })
    if (args.freshness) params.set('freshness', args.freshness)

    const res = await fetch(`${args.server}/search?${params}`, { signal: AbortSignal.timeout(args.timeout) })
    const body = await res.json().catch(() => ({}))
    const envelope = {
      request: { query: args.query, mode: 'quote', url: `${args.server}/search?${params.toString()}` },
      status: res.status,
      ok: res.ok,
      body,
      privateKeyConfigured: !!privateKey,
      signingKeyRedacted: privateKey ? redactSecret(privateKey) : null,
    }

    if (args.receiptPath) {
      await writeReceipt(args.receiptPath, envelope)
    }

    if (args.json) {
      console.log(JSON.stringify(envelope, null, 2))
      return
    }

    if (res.status === 402) {
      console.log(`Received 402 Payment Required from ${args.server}`)
      console.log(JSON.stringify(body, null, 2))
      return
    }

    if (!res.ok) {
      throw new Error(`Quote request failed with ${res.status}: ${JSON.stringify(body)}`)
    }

    console.log(JSON.stringify({ query: args.query, status: res.status, body }, null, 2))
    return
  }

  // search mode
  const params = new URLSearchParams({ q: args.query, count: String(args.count) })
  if (args.freshness) params.set('freshness', args.freshness)
  if (args.privateKey) params.set('x402_signing_key', 'provided')

  const res = await fetch(`${args.server}/search?${params}`, {
    signal: AbortSignal.timeout(args.timeout),
  })
  const body = await res.json().catch(() => ({}))
  const envelope = {
    request: { query: args.query, mode: 'search', url: `${args.server}/search?${params.toString()}` },
    status: res.status,
    ok: res.ok,
    body,
    privateKeyConfigured: Boolean(privateKey),
    signingKeyRedacted: privateKey ? redactSecret(privateKey) : null,
  }

  if (args.receiptPath) {
    await writeReceipt(args.receiptPath, envelope)
  }

  if (res.status === 402) {
    const paymentMessage = privateKey
      ? 'Search requires a valid x402 payment signature. Provide a signed x-payment header or a supported wallet flow.'
      : 'No signing material was configured. Use a secure environment variable or protected stdin prompt to supply a private key before running paid search.'
    const result = { ...envelope, advice: paymentMessage }
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(`Search status: 402 Payment Required`) 
      console.log(paymentMessage)
      console.log(JSON.stringify(body, null, 2))
    }
    return
  }

  if (!res.ok) {
    const errorMessage = typeof body?.error === 'string' ? body.error : 'Search failed'
    throw new Error(`Search request failed with ${res.status}: ${errorMessage}`)
  }

  if (args.json) {
    console.log(JSON.stringify(envelope, null, 2))
    return
  }

  console.log(JSON.stringify({ query: args.query, response: body }, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((err: unknown) => {
    const errorText = err instanceof Error ? err.message : String(err)
    if (errorText.includes('Usage:')) {
      console.log(errorText)
      process.exit(0)
    }
    const message = errorText || 'Unknown CLI error'
    console.error(message)
    process.exit(1)
  })
}

export { runCli }

