import { test, expect } from '@playwright/test'

const searchResponse = {
  query: 'Stellar x402 payments',
  count: 2,
  paidAmount: '0.001',
  currency: 'USDC',
  network: 'stellar:testnet',
  txHash: null,
  suggestions: [],
  results: [
    {
      id: '1',
      title: 'Stellar x402 Payments',
      url: 'https://example.com/stellar-x402',
      description: 'A fixture result for the paid search happy path.',
      source: 'example.com',
      relevanceScore: 1,
    },
    {
      id: '2',
      title: 'Building on Stellar',
      url: 'https://example.com/building-on-stellar',
      description: 'A second deterministic result used by the E2E test.',
      source: 'example.com',
      relevanceScore: 0.94,
    },
  ],
}

test('connects a wallet, searches, and renders results', async ({ page }) => {
  await page.addInitScript(() => {
    window.__STELLAR_SEARCH_E2E_WALLET__ = true
  })

  await page.route('**/health', async route => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        totalQueries: 12,
        totalUsdcSettled: '0.012',
        avgLatencyMs: 120,
        uptime: '1h',
      }),
    })
  })

  await page.route('**/search?*', async route => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(searchResponse),
    })
  })

  await page.goto('/')

  await page.getByRole('button', { name: 'CONNECT FREIGHTER' }).first().click()
  const walletMenu = page.getByRole('button', { name: 'Wallet menu' })
  await expect(walletMenu).toContainText('10.000000 USDC')

  const searchInput = page.getByLabel('Search query')
  await searchInput.fill('Stellar x402 payments')
  await searchInput.press('Enter')

  await expect(page.getByText('2 RESULTS')).toBeVisible()
  await expect(page.getByRole('article', { name: 'Stellar x402 Payments' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Building on Stellar' })).toBeVisible()
})
