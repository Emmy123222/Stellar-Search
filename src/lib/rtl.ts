/**
 * lib/rtl.ts — Right-to-Left (RTL) layout & internationalization support (#346)
 *
 * Provides locale direction detection, document direction sync, and a React
 * hook for direction-aware styling (such as Recharts orientation and gradients).
 */
import { useState, useEffect, useCallback } from 'react'
import i18n from '../i18n'

export const RTL_LOCALES = ['ar', 'he', 'fa', 'ur'] as const
export type RtlLocale = (typeof RTL_LOCALES)[number]

/**
 * Checks whether a given locale string is a Right-To-Left language.
 * Accepts full tags like 'ar-SA', 'he-IL', or simple language codes like 'ar'.
 */
export function isRtlLocale(locale?: string | null): boolean {
  if (!locale) return false
  const base = locale.toLowerCase().split(/[-_]/)[0]
  return (RTL_LOCALES as readonly string[]).includes(base)
}

/**
 * Returns 'rtl' or 'ltr' for a given locale string.
 */
export function getDirection(locale?: string | null): 'rtl' | 'ltr' {
  return isRtlLocale(locale) ? 'rtl' : 'ltr'
}

/**
 * Sets document.documentElement dir and lang attributes safely in browser environments.
 */
export function setDocumentDirection(localeOrDir?: string | null): 'rtl' | 'ltr' {
  if (typeof document === 'undefined') {
    return isRtlLocale(localeOrDir) ? 'rtl' : 'ltr'
  }

  let dir: 'rtl' | 'ltr'
  if (localeOrDir === 'rtl' || localeOrDir === 'ltr') {
    dir = localeOrDir
  } else {
    dir = getDirection(localeOrDir)
    if (localeOrDir) {
      document.documentElement.lang = localeOrDir
    }
  }

  document.documentElement.dir = dir
  return dir
}

/**
 * React hook that returns the current layout direction and active locale,
 * syncing automatically when i18n changes language.
 */
export function useDirection() {
  const [currentLocale, setCurrentLocale] = useState<string>(() => i18n.language || 'en')
  const [dir, setDir] = useState<'rtl' | 'ltr'>(() => getDirection(i18n.language || 'en'))

  useEffect(() => {
    const handleLanguageChanged = (lng: string) => {
      setCurrentLocale(lng)
      const newDir = setDocumentDirection(lng)
      setDir(newDir)
    }

    // Initialize document direction immediately on mount
    const initialDir = setDocumentDirection(i18n.language || 'en')
    setDir(initialDir)

    i18n.on('languageChanged', handleLanguageChanged)
    return () => {
      i18n.off('languageChanged', handleLanguageChanged)
    }
  }, [])

  const setLocale = useCallback(async (lng: string) => {
    await i18n.changeLanguage(lng)
    setDocumentDirection(lng)
  }, [])

  const toggleDirection = useCallback(async () => {
    const nextLocale = isRtlLocale(currentLocale) ? 'en' : 'ar'
    await setLocale(nextLocale)
  }, [currentLocale, setLocale])

  return {
    dir,
    isRtl: dir === 'rtl',
    currentLocale,
    setLocale,
    toggleDirection,
  }
}
