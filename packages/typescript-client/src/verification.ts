import type { SearchReceipt, ReceiptVerificationDetail, VerifyOptions } from './types'

export const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org'
export const HORIZON_MAINNET = 'https://horizon.stellar.org'

/**
 * Returns the appropriate Horizon endpoint URL for a given Stellar network identifier.
 */
export function getHorizonUrlForNetwork(network: string): string {
  if (network === 'stellar:mainnet') {
    return HORIZON_MAINNET
  }
  return HORIZON_TESTNET
}

/**
 * Verifies a single SearchReceipt against the Stellar Horizon ledger.
 */
export async function verifyReceiptAgainstHorizon(
  receipt: SearchReceipt,
  options: VerifyOptions = {}
): Promise<ReceiptVerificationDetail> {
  const fetchFn =
    options.fetchFn ||
    (typeof window !== 'undefined' ? window.fetch.bind(window) : globalThis.fetch)

  // 1. Transaction Hash Presence Check
  if (!receipt || !receipt.txHash || typeof receipt.txHash !== 'string' || !receipt.txHash.trim()) {
    return {
      status: 'mismatched',
      mismatches: ['Missing or empty transaction hash'],
      txHash: receipt?.txHash || '',
      network: receipt?.network || '',
    }
  }

  const txHash = receipt.txHash.trim()
  const network = receipt.network || 'stellar:testnet'

  // 2. Network Format & Expected Network Check
  if (!network.startsWith('stellar:')) {
    return {
      status: 'mismatched',
      mismatches: [`Invalid network identifier: "${network}"`],
      txHash,
      network,
    }
  }

  if (options.expectedNetwork && network !== options.expectedNetwork) {
    return {
      status: 'mismatched',
      mismatches: [`Network mismatch: receipt specifies "${network}", expected "${options.expectedNetwork}"`],
      txHash,
      network,
    }
  }

  const horizonBase = options.horizonUrl || getHorizonUrlForNetwork(network)
  const expectedAmount = receipt.amount
    ? parseFloat(receipt.amount)
    : options.expectedAmount
    ? typeof options.expectedAmount === 'number'
      ? options.expectedAmount
      : parseFloat(options.expectedAmount)
    : 0.001
  const expectedAsset = receipt.asset || options.expectedAsset || 'USDC'
  const expectedDestination = receipt.destination || options.expectedDestination

  try {
    // 3. Query Horizon for Transaction Record
    const txRes = await fetchFn(`${horizonBase}/transactions/${txHash}`)

    if (txRes.status === 404) {
      return {
        status: 'mismatched',
        mismatches: ['Transaction not found on Stellar Horizon ledger'],
        txHash,
        network,
      }
    }

    if (!txRes.ok) {
      return {
        status: 'unverified',
        error: `Horizon API error (${txRes.status} ${txRes.statusText})`,
        txHash,
        network,
      }
    }

    const txData: any = await txRes.json()

    if (txData.successful === false) {
      return {
        status: 'mismatched',
        mismatches: ['Transaction failed on ledger (successful: false)'],
        ledgerSequence: txData.ledger,
        txHash,
        network,
        verifiedAt: new Date().toISOString(),
      }
    }

    const ledgerSequence = typeof txData.ledger === 'number' ? txData.ledger : undefined

    // 4. Query Horizon for Transaction Operations
    const opsRes = await fetchFn(`${horizonBase}/transactions/${txHash}/operations`)
    if (!opsRes.ok) {
      return {
        status: 'unverified',
        error: `Failed to fetch operations from Horizon (${opsRes.status})`,
        ledgerSequence,
        txHash,
        network,
      }
    }

    const opsData: any = await opsRes.json()
    const records: any[] = Array.isArray(opsData?._embedded?.records)
      ? opsData._embedded.records
      : Array.isArray(opsData?.records)
      ? opsData.records
      : []

    if (records.length === 0) {
      return {
        status: 'mismatched',
        mismatches: ['Transaction contains no operations'],
        ledgerSequence,
        txHash,
        network,
        verifiedAt: new Date().toISOString(),
      }
    }

    // 5. Inspect operations for matching payment / invocation
    const mismatches: string[] = []
    let hasMatchedOperation = false

    for (const op of records) {
      // Classic payment or path payment
      if (
        op.type === 'payment' ||
        op.type === 'payment_strict_send' ||
        op.type === 'payment_strict_receive' ||
        op.type === 'path_payment_strict_send' ||
        op.type === 'path_payment_strict_receive' ||
        op.type_i === 1
      ) {
        const opAmount = parseFloat(op.amount || op.dest_amount || '0')
        const opAsset = op.asset_code || (op.asset_type === 'native' ? 'XLM' : op.dest_asset_code || '')
        const opTo = op.to || op.destination || op.account || ''

        let amountMatches = true
        let assetMatches = true
        let destinationMatches = true

        if (!isNaN(expectedAmount) && Math.abs(opAmount - expectedAmount) > 0.0000001) {
          amountMatches = false
        }

        if (expectedAsset) {
          if (expectedAsset === 'XLM') {
            if (op.asset_type !== 'native' && opAsset !== 'XLM') assetMatches = false
          } else {
            if (opAsset !== expectedAsset) assetMatches = false
          }
        }

        if (expectedDestination) {
          if (opTo && opTo !== expectedDestination) {
            destinationMatches = false
          }
        }

        if (amountMatches && assetMatches && destinationMatches) {
          hasMatchedOperation = true
          break
        } else {
          const reasons: string[] = []
          if (!amountMatches) {
            reasons.push(`Amount mismatch: expected ${receipt.amount}, found ${op.amount || op.dest_amount}`)
          }
          if (!assetMatches) {
            reasons.push(`Asset mismatch: expected ${expectedAsset}, found ${opAsset || op.asset_type}`)
          }
          if (!destinationMatches && expectedDestination) {
            reasons.push(`Destination mismatch: expected ${expectedDestination}, found ${opTo}`)
          }
          mismatches.push(...reasons)
        }
      } else if (op.type === 'invoke_host_function' || op.type_i === 24) {
        // Soroban contract invocation (x402 contract settlement)
        let destinationMatches = true
        if (expectedDestination) {
          if (op.to && op.to !== expectedDestination) {
            destinationMatches = false
          }
        }

        if (destinationMatches) {
          hasMatchedOperation = true
          break
        }
      }
    }

    if (hasMatchedOperation) {
      return {
        status: 'confirmed',
        ledgerSequence,
        verifiedAt: new Date().toISOString(),
        network,
        txHash,
        asset: expectedAsset,
        amount: receipt.amount,
        destination: expectedDestination,
      }
    }

    return {
      status: 'mismatched',
      mismatches: mismatches.length > 0 ? Array.from(new Set(mismatches)) : ['No matching payment operation found in transaction'],
      ledgerSequence,
      txHash,
      network,
      verifiedAt: new Date().toISOString(),
    }
  } catch (err: any) {
    return {
      status: 'unverified',
      error: `Network error connecting to Horizon: ${err?.message || String(err)}`,
      txHash,
      network,
    }
  }
}

/**
 * Batch verifies multiple receipts in parallel against Stellar Horizon.
 */
export async function verifyReceiptsAgainstHorizon(
  receipts: SearchReceipt[],
  options: VerifyOptions = {}
): Promise<Map<string, ReceiptVerificationDetail>> {
  const results = new Map<string, ReceiptVerificationDetail>()
  if (!receipts || receipts.length === 0) return results

  await Promise.all(
    receipts.map(async (receipt) => {
      if (!receipt.txHash) return
      const detail = await verifyReceiptAgainstHorizon(receipt, options)
      results.set(receipt.txHash, detail)
    })
  )

  return results
}
