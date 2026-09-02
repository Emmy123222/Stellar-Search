/**
 * Browser-compatible SHA-256 hashing utility.
 *
 * Uses the Web Crypto API (`crypto.subtle.digest`) which is available in
 * all modern browsers and Node.js ≥ 15. The Vite config already polyfills
 * `global` as `globalThis`, so this works consistently across runtimes.
 */

/**
 * Returns a hex-encoded SHA-256 digest of the input string.
 *
 * @param input - Plain text to hash.
 * @returns Promise resolving to a lower-case hex-encoded SHA-256 digest (64 chars).
 */
export async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
