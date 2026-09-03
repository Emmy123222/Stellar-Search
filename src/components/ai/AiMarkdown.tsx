import { Fragment, type ReactNode } from 'react'

interface Props {
  content: string
  /** Highest citation number considered valid, e.g. the number of results shown. */
  citationMax?: number
  /** Called when a valid numbered citation (e.g. `[1]`) is activated. */
  onCitationClick?: (index: number) => void
}

let inlineKey = 0
let blockKey = 0

const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/
const CITATION_RE = /\[(\d+)\]/
const BOLD_RE = /\*\*([^*]+)\*\*/
const CODE_RE = /`([^`]+)`/
const ITALIC_RE = /(?<![*\w])\*([^*]+)\*(?!\w)/

// Parses a single line of text into safe inline React nodes. No HTML is ever
// injected — every fragment is a literal string or a controlled element, so
// there is no path for raw markup to execute.
function renderInline(text: string, citationMax: number | undefined, onCitationClick: Props['onCitationClick']): ReactNode[] {
  if (!text) return []

  const matchers: Array<{ re: RegExp; render: (m: RegExpMatchArray) => ReactNode }> = [
    {
      re: LINK_RE,
      render: m => (
        <a
          key={`il-${inlineKey++}`}
          href={m[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted hover:text-neon-cyan"
        >
          {m[1]}
        </a>
      ),
    },
    {
      re: CITATION_RE,
      render: m => {
        const n = parseInt(m[1], 10)
        const isValid = n >= 1 && (citationMax === undefined || n <= citationMax)
        if (!isValid) return m[0]
        return (
          <button
            key={`il-${inlineKey++}`}
            type="button"
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              if (onCitationClick) {
                onCitationClick(n)
              } else if (typeof document !== 'undefined') {
                const el = document.getElementById(`result-card-${n}`)
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  ;(el as HTMLElement).focus({ preventScroll: true })
                }
              }
            }}
            className="inline-flex items-center px-1 rounded text-neon-cyan hover:underline align-baseline"
            aria-label={`Jump to source ${n}`}
          >
            [{n}]
          </button>
        )
      },
    },
    {
      re: BOLD_RE,
      render: m => <strong key={`il-${inlineKey++}`}>{renderInline(m[1], citationMax, onCitationClick)}</strong>,
    },
    {
      re: CODE_RE,
      render: m => (
        <code key={`il-${inlineKey++}`} className="px-1 py-0.5 rounded bg-white/10 font-mono text-[0.9em]">
          {m[1]}
        </code>
      ),
    },
    {
      re: ITALIC_RE,
      render: m => <em key={`il-${inlineKey++}`}>{renderInline(m[1], citationMax, onCitationClick)}</em>,
    },
  ]

  let earliest: { index: number; match: RegExpMatchArray; render: (m: RegExpMatchArray) => ReactNode } | null = null
  for (const { re, render } of matchers) {
    const m = text.match(re)
    if (m && m.index !== undefined && (earliest === null || m.index < earliest.index)) {
      earliest = { index: m.index, match: m, render }
    }
  }

  if (!earliest) return [text]

  const before = text.slice(0, earliest.index)
  const after = text.slice(earliest.index + earliest.match[0].length)
  const nodes: ReactNode[] = []
  if (before) nodes.push(before)
  nodes.push(earliest.render(earliest.match))
  nodes.push(...renderInline(after, citationMax, onCitationClick))
  return nodes
}

// Renders a restricted, safe subset of Markdown (headings, bold/italic,
// inline code, fenced code blocks, lists, links) as React elements. There is
// no `dangerouslySetInnerHTML` anywhere in this component, so arbitrary HTML
// in the source text is never parsed or executed — it is only ever treated
// as literal text.
export function AiMarkdown({ content, citationMax, onCitationClick }: Props) {
  if (!content) return null

  const lines = content.split('\n')
  const blocks: ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim().startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // consume closing fence
      blocks.push(
        <pre key={`bl-${blockKey++}`} className="rounded-lg bg-white/5 border border-white/10 p-2 overflow-x-auto text-[0.85em] font-mono whitespace-pre-wrap">
          <code>{codeLines.join('\n')}</code>
        </pre>
      )
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const sizes = ['text-base', 'text-base', 'text-sm', 'text-sm', 'text-xs', 'text-xs']
      blocks.push(
        <p key={`bl-${blockKey++}`} className={`font-semibold ${sizes[level - 1]}`}>
          {renderInline(headingMatch[2], citationMax, onCitationClick)}
        </p>
      )
      i++
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      blocks.push(
        <ul key={`bl-${blockKey++}`} className="list-disc pl-4 space-y-0.5">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, citationMax, onCitationClick)}</li>
          ))}
        </ul>
      )
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      blocks.push(
        <ol key={`bl-${blockKey++}`} className="list-decimal pl-4 space-y-0.5">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, citationMax, onCitationClick)}</li>
          ))}
        </ol>
      )
      continue
    }

    if (line.trim() === '') {
      i++
      continue
    }

    blocks.push(
      <p key={`bl-${blockKey++}`}>{renderInline(line, citationMax, onCitationClick)}</p>
    )
    i++
  }

  return (
    <div className="space-y-1.5">
      {blocks.map((b, idx) => (
        <Fragment key={idx}>{b}</Fragment>
      ))}
    </div>
  )
}
