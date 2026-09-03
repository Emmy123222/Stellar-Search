export class ConcurrencyGate {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly limit: number) {}

  acquire(timeoutMs: number): Promise<() => void> {
    return new Promise((resolve, reject) => {
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; reject(new Error('provider capacity unavailable')) }, timeoutMs)
      const grant = () => {
        if (timedOut) return
        clearTimeout(timer)
        this.active += 1
        resolve(() => {
          this.active -= 1
          this.waiters.shift()?.()
        })
      }
      if (this.active < this.limit) grant()
      else this.waiters.push(grant)
    })
  }
}
