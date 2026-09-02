/**
 * usePageVisible.ts
 * Tracks document.visibilityState so background work (polling intervals,
 * canvas animation loops, CSS ticker animations) can pause while the tab is
 * hidden -- avoids burning CPU/battery and firing needless network requests
 * for a page the user isn't looking at (#338).
 */

import { useEffect, useState } from 'react'

function getIsVisible(): boolean {
  if (typeof document === 'undefined') return true
  return document.visibilityState !== 'hidden'
}

export function usePageVisible(): boolean {
  const [isVisible, setIsVisible] = useState(getIsVisible)

  useEffect(() => {
    const handleVisibilityChange = () => setIsVisible(getIsVisible())
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  return isVisible
}
