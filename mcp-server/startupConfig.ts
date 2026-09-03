/**
 * Startup configuration validation for the MCP server.
 *
 * Checks required URLs and API keys, reports disabled/degraded capabilities
 * to stderr, and never prints secrets or full wallet material.
 */

export interface CapabilityStatus {
  available: boolean;
  reason?: string;
}

export interface StartupConfig {
  searchApiUrl: string;
  groqApiKey: string;
  stellarReceivingAddress: string;
  facilitatorUrl: string;
  mcpReceiptsOptIn: boolean;

  // Derived capability map
  capabilities: {
    webSearch: CapabilityStatus;
    imageSearch: CapabilityStatus;
    newsSearch: CapabilityStatus;
    aiSummarize: CapabilityStatus;
    checkBalance: CapabilityStatus;
    getSearchStats: CapabilityStatus;
    receipts: CapabilityStatus;
  };
}

/** Mask a secret value for safe logging (never reveal full keys). */
export function maskSecret(value: string): string {
  if (!value || value.length <= 8) return '****'
  return value.slice(0, 4) + '****' + value.slice(-4)
}

/** Mask a Stellar address for safe logging (show first 6 + last 4). */
export function maskAddress(value: string): string {
  if (!value || value.length <= 10) return '****'
  return value.slice(0, 6) + '****' + value.slice(-4)
}

/** Check if a URL string looks like a valid HTTP(S) URL. */
function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** Check if a Stellar public key has the expected format (G + 55 base32 chars). */
function isValidStellarAddress(addr: string): boolean {
  return /^G[A-Z0-9]{55}$/.test(addr)
}

/**
 * Validate the full startup configuration and return a status report.
 * Side effect: prints warnings to stderr about disabled/degraded capabilities.
 */
export function validateStartupConfig(env: Record<string, string | undefined>): StartupConfig {
  const searchApiUrl = env.SEARCH_API_URL || 'http://localhost:3001'
  const groqApiKey = env.GROQ_API_KEY || ''
  const stellarReceivingAddress = env.STELLAR_RECEIVING_ADDRESS || ''
  const facilitatorUrl = env.FACILITATOR_URL || 'https://www.x402.org/facilitator'
  const mcpReceiptsOptIn = env.MCP_ENABLE_RECEIPTS === '1' || env.MCP_RECEIPTS_OPT_IN === '1'

  const warnings: string[] = []

  // ── Validate SEARCH_API_URL ──────────────────────────────────────────
  const searchApiOk = isValidHttpUrl(searchApiUrl)
  if (!searchApiOk) {
    warnings.push(
      `⚠ SEARCH_API_URL is not a valid HTTP URL: "${searchApiUrl}" — search tools will fail`,
    )
  }

  // ── Validate GROQ_API_KEY ────────────────────────────────────────────
  const groqOk = groqApiKey.length > 0 && groqApiKey !== 'your_groq_api_key_here'
  if (!groqOk) {
    warnings.push(
      `⚠ GROQ_API_KEY is missing or still a placeholder — ai_summarize will fail`,
    )
  }

  // ── Validate STELLAR_RECEIVING_ADDRESS ────────────────────────────────
  const stellarAddressOk =
    stellarReceivingAddress.length > 0 && isValidStellarAddress(stellarReceivingAddress)
  if (!stellarAddressOk && stellarReceivingAddress.length > 0) {
    warnings.push(
      `⚠ STELLAR_RECEIVING_ADDRESS format is invalid (${maskAddress(stellarReceivingAddress)}) — payment settlement may fail`,
    )
  } else if (!stellarAddressOk) {
    warnings.push(
      `⚠ STELLAR_RECEIVING_ADDRESS is not set — payment settlement will fail`,
    )
  }

  // ── Validate FACILITATOR_URL ─────────────────────────────────────────
  const facilitatorOk = isValidHttpUrl(facilitatorUrl)
  if (!facilitatorOk) {
    warnings.push(
      `⚠ FACILITATOR_URL is not a valid HTTP URL — x402 payment settlement will fail`,
    )
  }

  // ── Derive capability status ─────────────────────────────────────────
  const capabilities: StartupConfig['capabilities'] = {
    webSearch: {
      available: searchApiOk && stellarAddressOk && facilitatorOk,
      reason: !searchApiOk
        ? 'SEARCH_API_URL invalid'
        : !stellarAddressOk
          ? 'STELLAR_RECEIVING_ADDRESS missing/invalid'
          : !facilitatorOk
            ? 'FACILITATOR_URL invalid'
            : undefined,
    },
    imageSearch: {
      available: searchApiOk && stellarAddressOk && facilitatorOk,
      reason: !searchApiOk
        ? 'SEARCH_API_URL invalid'
        : !stellarAddressOk
          ? 'STELLAR_RECEIVING_ADDRESS missing/invalid'
          : !facilitatorOk
            ? 'FACILITATOR_URL invalid'
            : undefined,
    },
    newsSearch: {
      available: searchApiOk && stellarAddressOk && facilitatorOk,
      reason: !searchApiOk
        ? 'SEARCH_API_URL invalid'
        : !stellarAddressOk
          ? 'STELLAR_RECEIVING_ADDRESS missing/invalid'
          : !facilitatorOk
            ? 'FACILITATOR_URL invalid'
            : undefined,
    },
    aiSummarize: {
      available: groqOk,
      reason: !groqOk ? 'GROQ_API_KEY missing or placeholder' : undefined,
    },
    checkBalance: {
      available: true, // Horizon URL comes from constants, always valid
    },
    getSearchStats: {
      available: searchApiOk,
      reason: !searchApiOk ? 'SEARCH_API_URL invalid' : undefined,
    },
    receipts: {
      available: mcpReceiptsOptIn,
      reason: !mcpReceiptsOptIn ? 'MCP_ENABLE_RECEIPTS not set' : undefined,
    },
  }

  // ── Print warnings to stderr ─────────────────────────────────────────
  if (warnings.length > 0) {
    console.error('\n── StellarSearch MCP Startup Warnings ──')
    for (const w of warnings) {
      console.error(w)
    }
    console.error('───────────────────────────────────────\n')
  }

  // ── Print capability summary to stderr ───────────────────────────────
  const enabledTools = Object.entries(capabilities)
    .filter(([, v]) => v.available)
    .map(([k]) => k)
  const disabledTools = Object.entries(capabilities)
    .filter(([, v]) => !v.available)
    .map(([k, v]) => `${k} (${v.reason})`)

  console.error(`[startup] Enabled capabilities: ${enabledTools.join(', ') || 'none'}`)
  if (disabledTools.length > 0) {
    console.error(`[startup] Degraded/disabled: ${disabledTools.join('; ')}`)
  }

  // ── Print config summary (no secrets) ────────────────────────────────
  console.error(`[startup] SEARCH_API_URL: ${searchApiUrl}`)
  console.error(`[startup] GROQ_API_KEY: ${groqOk ? maskSecret(groqApiKey) : 'NOT SET'}`)
  console.error(
    `[startup] STELLAR_RECEIVING_ADDRESS: ${stellarAddressOk ? maskAddress(stellarReceivingAddress) : 'NOT SET'}`,
  )
  console.error(`[startup] FACILITATOR_URL: ${facilitatorUrl}`)
  console.error(`[startup] MCP receipts opt-in: ${mcpReceiptsOptIn}`)

  return {
    searchApiUrl,
    groqApiKey,
    stellarReceivingAddress,
    facilitatorUrl,
    mcpReceiptsOptIn,
    capabilities,
  }
}
