export async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onDelta: (delta: string) => void,
  onModel?: (model: string) => void
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const processBuffer = (flush = false): boolean => {
    while (true) {
      const match = buffer.match(/\r?\n\r?\n/)
      if (!match && !flush) return false

      let rawEvent = ''
      if (match) {
        rawEvent = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index! + match[0].length)
      } else {
        rawEvent = buffer
        buffer = ''
        if (!rawEvent) return false
      }

      let event = 'message'
      let data = ''
      const lines = rawEvent.split(/\r?\n/)

      for (const line of lines) {
        if (line.startsWith(':')) continue // comment
        
        const colon = line.indexOf(':')
        if (colon === -1) {
          const field = line
          if (field === 'event') event = ''
          else if (field === 'data') data += data ? '\n' : ''
          continue
        }

        const field = line.slice(0, colon)
        const value = line.slice(colon + (line[colon + 1] === ' ' ? 2 : 1))
        
        if (field === 'event') {
          event = value
        } else if (field === 'data') {
          data += (data ? '\n' : '') + value
        }
      }

      if (!data) continue

      if (event === 'delta') {
        try {
          const { content } = JSON.parse(data) as { content?: string }
          if (content) onDelta(content)
        } catch { /* malformed chunk; skip */ }
      } else if (event === 'done') {
        try {
          const { model } = JSON.parse(data) as { model?: string }
          if (model && onModel) onModel(model)
        } catch { /* ignore malformed done event */ }
        return true // Stop processing on 'done'
      } else if (event === 'error') {
        try {
          const { error } = JSON.parse(data) as { error?: string }
          throw new Error(error || 'stream error')
        } catch (e) {
          throw e instanceof Error ? e : new Error('stream error')
        }
      }
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        processBuffer(true)
        break
      }
      buffer += decoder.decode(value, { stream: true })
      if (processBuffer(false)) {
        await reader.cancel()
        break
      }
    }
  } finally {
    reader.releaseLock()
  }
}
