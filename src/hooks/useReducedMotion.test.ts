import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useReducedMotion } from './useReducedMotion'

describe('useReducedMotion', () => {
  let matchMediaMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    matchMediaMock = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: matchMediaMock,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns false when reduced motion is not preferred', () => {
    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })

  it('returns true when reduced motion is preferred', () => {
    matchMediaMock.mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(true)
  })

  it('subscribes to media query changes', () => {
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener,
      removeEventListener,
    })
    const { unmount } = renderHook(() => useReducedMotion())
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    unmount()
    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('updates when media query changes', async () => {
    const listeners: Record<string, (e: { matches: boolean }) => void> = {}
    const addEventListener = vi.fn((_type: string, listener: (e: { matches: boolean }) => void) => {
      listeners[_type] = listener
    })
    const removeEventListener = vi.fn((_type: string) => {
      delete listeners[_type]
    })
    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener,
      removeEventListener,
    })

    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)

    listeners.change({ matches: true })
    expect(result.current).toBe(true)

    listeners.change({ matches: false })
    expect(result.current).toBe(false)
  })
})
