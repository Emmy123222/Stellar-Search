import { IS_MAINNET, AMOUNT_USDC } from '../../lib/stellar'
import { usePageVisible } from '../../hooks/usePageVisible'

interface Props {
  walletConnected: boolean
}

const getTickerItems = () => [
  ['NETWORK',    IS_MAINNET ? 'STELLAR MAINNET' : 'STELLAR TESTNET'],
  ['PROTOCOL',   'x402'],
  ['PRICE',      `${AMOUNT_USDC} USDC / QUERY`],
  ['SETTLEMENT', '~5 SECONDS'],
  ['SEARCH',     'SERPER.DEV'],
  ['AI',         'GROQ LLAMA 3'],
  ['WALLET',     'FREIGHTER'],
]

function TickerItem({ item: [k, v] }: { item: string[] }) {
  return (
    <div className="inline-flex items-center gap-2 px-6">
      <span
        className="font-display text-neon-cyan/30 tracking-widest"
        style={{ fontSize: '10px' }}
      >
        {k}
      </span>
      <span
        className="font-display text-neon-cyan font-bold tracking-wider"
        style={{ fontSize: '10px' }}
      >
        {v}
      </span>
      <span className="text-neon-cyan/15">◆</span>
    </div>
  )
}

export function LiveTicker({ walletConnected }: Props) {
  // The scroll is a pure CSS animation (animate-ticker), which browsers do
  // NOT pause on their own when a tab is backgrounded -- so pause it
  // explicitly via animation-play-state (#338).
  const isVisible = usePageVisible()

  const items = [
    ...getTickerItems(),
    ['STATUS', walletConnected ? 'WALLET CONNECTED' : 'NOT CONNECTED'],
  ]

  return (
    <div
      className="border-b border-white/4 py-1.5 overflow-hidden"
      style={{ background: 'rgba(2,4,8,0.4)' }}
    >
      <div
        className="flex items-center gap-8 animate-ticker whitespace-nowrap"
        style={{ width: 'max-content', animationPlayState: isVisible ? 'running' : 'paused' }}
      >
        {items.map((item, i) => (
          <TickerItem key={i} item={item} />
        ))}
        {/* Duplicated for the seamless scroll loop only; hidden so screen readers see one copy. */}
        <div aria-hidden="true" className="flex items-center gap-8">
          {items.map((item, i) => (
            <TickerItem key={i} item={item} />
          ))}
        </div>
      </div>
    </div>
  )
}
