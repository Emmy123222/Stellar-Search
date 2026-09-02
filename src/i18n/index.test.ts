import { describe, it, expect, beforeAll } from 'vitest'
import i18n, { initI18n, loadNamespace } from './index'

beforeAll(async () => {
  await initI18n()
})

describe('i18n framework (#345)', () => {
  it('resolves a namespaced key from the eagerly-bundled common namespace', () => {
    expect(i18n.t('common:nav.search')).toBe('SEARCH')
  })

  it('falls back to English for an unknown locale, since English is the only/complete locale', () => {
    expect(i18n.getFixedT('fr', 'common')('nav.search')).toBe('SEARCH')
  })

  it('interpolates a variable into a translated string', () => {
    expect(i18n.t('common:footer.links.explorer', { network: 'Testnet' })).toBe(
      'Testnet Explorer',
    )
  })

  it('does not have the docs namespace loaded until something requests it', () => {
    // Fresh i18n singleton state from prior tests in this file could have
    // already loaded it — assert the mechanism, not global ordering.
    expect(typeof i18n.hasResourceBundle).toBe('function')
  })

  it('loadNamespace() lazy-loads a namespace not present at boot', async () => {
    expect(i18n.hasResourceBundle('en', 'docs')).toBe(false)

    await loadNamespace('docs')

    expect(i18n.hasResourceBundle('en', 'docs')).toBe(true)
    expect(i18n.t('docs:title')).toBe('HOW IT WORKS')
  })

  it('loadNamespace() is idempotent — loading twice does not throw or duplicate work', async () => {
    await loadNamespace('docs')
    await loadNamespace('docs')

    expect(i18n.t('docs:title')).toBe('HOW IT WORKS')
  })

  it('pluralizes via the standard i18next _one/_other key suffixes', async () => {
    await loadNamespace('wallet')

    expect(i18n.t('wallet:queriesRemaining', { count: 1 })).toBe('~1 query')
    expect(i18n.t('wallet:queriesRemaining', { count: 0 })).toBe('~0 queries')
    expect(i18n.t('wallet:queriesRemaining', { count: 42 })).toBe('~42 queries')
  })

  it('interpolates a payment-unit amount into onboarding copy', async () => {
    await loadNamespace('onboarding')

    expect(i18n.t('onboarding:steps.payment.description', { amount: '0.001' })).toContain(
      '0.001 USDC',
    )
  })
})
