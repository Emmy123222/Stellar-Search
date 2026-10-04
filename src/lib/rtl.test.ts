import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isRtlLocale, getDirection, setDocumentDirection, RTL_LOCALES } from './rtl'

describe('RTL helpers (#346)', () => {
  const originalDir = document.documentElement.dir
  const originalLang = document.documentElement.lang

  beforeEach(() => {
    document.documentElement.dir = 'ltr'
    document.documentElement.lang = 'en'
  })

  afterEach(() => {
    document.documentElement.dir = originalDir
    document.documentElement.lang = originalLang
  })

  describe('isRtlLocale()', () => {
    it('identifies RTL locales accurately', () => {
      RTL_LOCALES.forEach(loc => {
        expect(isRtlLocale(loc)).toBe(true)
      })
      expect(isRtlLocale('ar-EG')).toBe(true)
      expect(isRtlLocale('he-IL')).toBe(true)
      expect(isRtlLocale('fa-IR')).toBe(true)
      expect(isRtlLocale('ur-PK')).toBe(true)
    })

    it('returns false for LTR locales, empty values, or undefined', () => {
      expect(isRtlLocale('en')).toBe(false)
      expect(isRtlLocale('en-US')).toBe(false)
      expect(isRtlLocale('fr')).toBe(false)
      expect(isRtlLocale('es')).toBe(false)
      expect(isRtlLocale('')).toBe(false)
      expect(isRtlLocale(null)).toBe(false)
      expect(isRtlLocale(undefined)).toBe(false)
    })
  })

  describe('getDirection()', () => {
    it('returns "rtl" for RTL locales and "ltr" for others', () => {
      expect(getDirection('ar')).toBe('rtl')
      expect(getDirection('he')).toBe('rtl')
      expect(getDirection('en')).toBe('ltr')
      expect(getDirection('es')).toBe('ltr')
      expect(getDirection(null)).toBe('ltr')
    })
  })

  describe('setDocumentDirection()', () => {
    it('updates document.documentElement.dir and lang when given a locale', () => {
      const dir = setDocumentDirection('ar')
      expect(dir).toBe('rtl')
      expect(document.documentElement.dir).toBe('rtl')
      expect(document.documentElement.lang).toBe('ar')

      const dir2 = setDocumentDirection('en')
      expect(dir2).toBe('ltr')
      expect(document.documentElement.dir).toBe('ltr')
      expect(document.documentElement.lang).toBe('en')
    })

    it('accepts explicit "rtl" or "ltr" direction directly', () => {
      setDocumentDirection('rtl')
      expect(document.documentElement.dir).toBe('rtl')

      setDocumentDirection('ltr')
      expect(document.documentElement.dir).toBe('ltr')
    })
  })
})
