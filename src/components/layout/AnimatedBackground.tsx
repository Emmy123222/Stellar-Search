import { useEffect, useRef } from 'react'

export function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number
    const matrixChars = '01ABCDEF⬡◈▲⬢x402USDC'.split('')

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const columns = Array.from({ length: Math.floor(window.innerWidth / 28) }, (_, i) => ({
      x: i * 28,
      y: Math.random() * window.innerHeight,
      speed: 0.2 + Math.random() * 0.5,
      opacity: 0.015 + Math.random() * 0.03,
      chars: Array.from({ length: 12 }, () => matrixChars[Math.floor(Math.random() * matrixChars.length)]),
    }))

    const stars = Array.from({ length: 100 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: 0.5 + Math.random() * 1,
      phase: Math.random() * Math.PI * 2,
    }))

    interface Particle {
      x: number; y: number; vx: number; vy: number
      life: number; maxLife: number; size: number
    }
    const particles: Particle[] = []
    let frame = 0

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      frame++

      const g = ctx.createRadialGradient(
        canvas.width * 0.5, canvas.height * 0.25, 0,
        canvas.width * 0.5, canvas.height * 0.25, canvas.width * 0.65
      )
      g.addColorStop(0, 'rgba(14,165,233,0.07)')
      g.addColorStop(1, 'transparent')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      stars.forEach(s => {
        const pulse = Math.sin(frame * 0.018 + s.phase) * 0.5 + 0.5
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(125,211,252,${0.15 + pulse * 0.35})`
        ctx.fill()
      })

      ctx.font = '10px monospace'
      columns.forEach(col => {
        col.y += col.speed
        if (col.y > canvas.height + 160) {
          col.y = -160
          col.chars = Array.from({ length: 12 }, () => matrixChars[Math.floor(Math.random() * matrixChars.length)])
        }
        col.chars.forEach((ch, i) => {
          const a = (1 - i / col.chars.length) * col.opacity * (i === 0 ? 8 : 1)
          ctx.fillStyle = `rgba(0,245,255,${Math.min(a, 0.15)})`
          ctx.fillText(ch, col.x, col.y - i * 13)
        })
      })

      if (particles.length < 35 && Math.random() < 0.12) {
        particles.push({
          x: Math.random() * canvas.width, y: canvas.height,
          vx: (Math.random() - 0.5) * 0.4,
          vy: -(0.4 + Math.random() * 1.2),
          life: 0, maxLife: 150 + Math.random() * 150,
          size: 1 + Math.random() * 2,
        })
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.x += p.vx; p.y += p.vy; p.life++
        if (p.life >= p.maxLife) { particles.splice(i, 1); continue }
        const a = Math.sin((p.life / p.maxLife) * Math.PI) * 0.5
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(0,245,255,${a})`
        ctx.fill()
      }

      ctx.strokeStyle = 'rgba(0,245,255,0.025)'
      ctx.lineWidth = 0.5
      for (let x = 0; x < canvas.width; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke()
      }
      for (let y = 0; y < canvas.height; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke()
      }

      animId = requestAnimationFrame(draw)
    }
    draw()

    // Pause the RAF loop entirely while the tab is hidden (#338) -- a
    // background tab still gets requestAnimationFrame callbacks throttled
    // by the browser, but not stopped, so this avoids the wasted per-frame
    // canvas work (and CPU/battery drain) outright rather than relying on
    // browser throttling alone.
    const handleVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(animId)
      } else {
        draw()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ mixBlendMode: 'screen' }}
    />
  )
}
