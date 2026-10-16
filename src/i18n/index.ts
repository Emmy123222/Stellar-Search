/**
 * i18n/index.ts — internationalization framework (#345, #346)
 *
 * i18next + react-i18next, with English as the fallback and Arabic ('ar')
 * as the RTL test locale. Namespaces split by feature area (common, wallet,
 * search, onboarding, errors, docs).
 *
 * `common` loads eagerly for both 'en' and 'ar'. Other namespaces are loaded
 * on demand via loadNamespace().
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import enCommon from './locales/en/common.json'
import arCommon from './locales/ar/common.json'
import { setDocumentDirection } from '../lib/rtl'

export const SUPPORTED_NAMESPACES = [
  'common',
  'wallet',
  'search',
  'onboarding',
  'errors',
  'docs',
] as const

export type Namespace = (typeof SUPPORTED_NAMESPACES)[number]

export const SUPPORTED_LOCALES = ['en', 'ar'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

// One lazy import per (locale, namespace) pair. Vite statically analyzes
// this glob at build time and emits a separate chunk per matched file.
// @ts-ignore — import.meta.glob is available in Vite
const localeModules = import.meta.glob(
  './locales/*/*.json',
) as Record<string, () => Promise<{ default: Record<string, unknown> }>>

let initPromise: Promise<typeof i18n> | null = null

export function initI18n(initialLng = 'en') {
  if (initPromise) return initPromise

  initPromise = i18n
    .use(initReactI18next)
    .init({
      lng: initialLng,
      fallbackLng: 'en',
      supportedLngs: ['en', 'ar'],
      ns: ['common'],
      defaultNS: 'common',
      resources: {
        en: { common: enCommon },
        ar: { common: arCommon },
      },
      interpolation: { escapeValue: false }, // React already escapes
      returnEmptyString: false,
    })
    .then(() => {
      setDocumentDirection(i18n.language || initialLng)
      i18n.on('languageChanged', (lng: string) => {
        setDocumentDirection(lng)
      })
      return i18n
    })

  return initPromise
}

/**
 * Loads a namespace's resources on demand. If a specific locale is given,
 * loads for that locale; otherwise loads for all supported locales so
 * switching to/from RTL is instant and seamless.
 */
export async function loadNamespace(ns: Namespace, lng?: string): Promise<void> {
  const locales = lng ? [lng] : SUPPORTED_LOCALES

  for (const l of locales) {
    if (!i18n.hasResourceBundle(l, ns)) {
      const loader = localeModules[`./locales/${l}/${ns}.json`]
      if (loader) {
        const mod = await loader()
        i18n.addResourceBundle(l, ns, mod.default, true, true)
      }
    }
  }
}

/**
 * Changes language and synchronizes HTML dir and lang attributes.
 */
export async function changeLanguage(lng: string): Promise<void> {
  await i18n.changeLanguage(lng)
  setDocumentDirection(lng)
}

export default i18n
