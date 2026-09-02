import { Search, Image, Newspaper } from 'lucide-react'
import type { SearchMode } from '../../types'

interface Props {
  mode: SearchMode
  onChange: (mode: SearchMode) => void
  disabled?: boolean
}

export function ModeSelector({ mode, onChange, disabled }: Props) {
  const modes: { id: SearchMode; label: string; icon: React.ReactNode }[] = [
    { id: 'web', label: 'Web', icon: <Search className="w-4 h-4" /> },
    { id: 'images', label: 'Images', icon: <Image className="w-4 h-4" /> },
    { id: 'news', label: 'News', icon: <Newspaper className="w-4 h-4" /> },
  ]

  return (
    <div
      className="flex items-center gap-1 p-1 rounded-xl"
      style={{
        background: 'rgba(6,13,20,0.6)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
      role="tablist"
      aria-label="Search mode"
    >
      {modes.map(({ id, label, icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          disabled={disabled}
          role="tab"
          aria-selected={mode === id}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-display text-xs tracking-wider transition-all disabled:opacity-50"
          style={{
            background: mode === id ? 'rgba(0,245,255,0.12)' : 'transparent',
            border: mode === id ? '1px solid rgba(0,245,255,0.3)' : '1px solid transparent',
            color: mode === id ? '#00f5ff' : 'rgba(255,255,255,0.5)',
          }}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  )
}