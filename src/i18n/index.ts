/**
 * i18n/index.ts — internationalization framework (#345)
 *
 * i18next + react-i18next, with English as the complete, always-available
 * fallback. Namespaces split by feature area (common, wallet, search,
 * onboarding, errors, docs) rather than one giant translation file, so
 * unrelated copy can be reviewed/translated independently.
 *
 * `common` (nav/footer — needed at first paint) loads eagerly. Every other
 * namespace is a separate JSON module loaded on demand via
 * loadNamespace() — Vite's import.meta.glob() with the default (lazy)
 * import form code-splits each into its own chunk, so e.g. `docs` never
 * ships to a user who never opens the docs page.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import enCommon from './locales/en/common.json'

export const SUPPORTED_NAMESPACES = [
  'common',
  'wallet',
  'search',
  'onboarding',
  'errors',
  'docs',
] as const

export type Namespace = (typeof SUPPORTED_NAMESPACES)[number]

// One lazy import per (locale, namespace) pair. Vite statically analyzes
// this glob at build time and emits a separate chunk per matched file —
// nothing here is bundled into the main chunk unless awaited.
// @ts-ignore — this project's tsconfig doesn't include vite/client, so
// import.meta.glob isn't in the ambient ImportMeta type (same reason
// lib/constants.ts's import.meta.env access is @ts-ignore'd).
const localeModules = import.meta.glob(
  './locales/*/*.json',
) as Record<string, () => Promise<{ default: Record<string, unknown> }>>

let initPromise: Promise<typeof i18n> | null = null

export function initI18n() {
  if (initPromise) return initPromise

  initPromise = i18n
    .use(initReactI18next)
    .init({
      lng: 'en',
      fallbackLng: 'en',
      ns: ['common'],
      defaultNS: 'common',
      resources: { en: { common: enCommon } },
      interpolation: { escapeValue: false }, // React already escapes
      returnEmptyString: false,
    })
    .then(() => i18n)

  return initPromise
}

/**
 * Loads one namespace's English resources on demand and registers them
 * with the running i18next instance. Idempotent — a namespace already
 * loaded (or already bundled, like `common`) is a no-op. Call this before
 * rendering a component that calls useTranslation(ns) for anything beyond
 * `common`.
 */
export async function loadNamespace(ns: Namespace): Promise<void> {
  if (i18n.hasResourceBundle('en', ns)) return

  const loader = localeModules[`./locales/en/${ns}.json`]
  if (!loader) {
    throw new Error(`i18n: no locale file for namespace "${ns}"`)
  }

  const mod = await loader()
  i18n.addResourceBundle('en', ns, mod.default, true, true)
}

export default i18n
