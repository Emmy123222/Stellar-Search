import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePageVisible } from './usePageVisible'

function setVisibilityState(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('usePageVisible', () => {
  afterEach(() => {
    setVisibilityState('visible')
  })

  it('returns true when the document is visible', () => {
    setVisibilityState('visible')
    const { result } = renderHook(() => usePageVisible())
    expect(result.current).toBe(true)
  })

  it('returns false after the tab is hidden', () => {
    const { result } = renderHook(() => usePageVisible())

    act(() => {
      setVisibilityState('hidden')
    })

    expect(result.current).toBe(false)
  })

  it('returns true again after the tab becomes visible', () => {
    const { result } = renderHook(() => usePageVisible())

    act(() => {
      setVisibilityState('hidden')
    })
    expect(result.current).toBe(false)

    act(() => {
      setVisibilityState('visible')
    })
    expect(result.current).toBe(true)
  })
})
