import { useRef, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Search, Zap, AlertTriangle, Calendar } from "lucide-react";
import { toast } from "sonner";
import {
  IS_MAINNET,
  EXPECTED_WALLET_NETWORK,
  AMOUNT_USDC,
} from "../../lib/stellar";

export interface FreshnessOption {
  label: string;
  value: string;
}

export interface SearchOptions {
  locale: string;
  country: string;
  language: string;
}

export const FRESHNESS_OPTIONS: FreshnessOption[] = [
  { label: "Any Time", value: "" },
  { label: "Past Day", value: "pd" },
  { label: "Past Week", value: "pw" },
  { label: "Past Month", value: "pm" },
];

export interface SafeSearchOption {
  label: string
  value: string
}

export const SAFE_SEARCH_OPTIONS: SafeSearchOption[] = [
  { label: 'Strict', value: 'strict' },
  { label: 'Moderate', value: 'moderate' },
  { label: 'Off', value: 'off' },
]

interface Props {
  onSearch: (query: string, freshness?: string, safeSearch?: string) => void
  isSearching: boolean
  walletConnected: boolean
  usdcBalance: string
  walletNetwork: string
  query?: string
}

const ADVANCED_OPERATORS = [
  { label: '"Exact Phrase"', insert: '"exact phrase"', description: 'Wrap terms in double quotes to match an exact phrase' },
  { label: '-Exclude', insert: '-excluded', description: 'Prefix a term with minus to exclude it' },
  { label: 'site:', insert: 'site:', description: 'Limit results to a specific website (e.g. site:developer.mozilla.org)' },
  { label: 'filetype:', insert: 'filetype:', description: 'Limit results by file type (e.g. filetype:pdf)' },
] as const

export function SearchBar({
  onSearch,
  isSearching,
  walletConnected,
  usdcBalance,
  walletNetwork,
  query = '',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [freshness, setFreshness] = useState<string>('')
  const [inputValue, setInputValue] = useState(query)

  useEffect(() => {
    setInputValue(query)
  }, [query])

  const isWrongNetwork =
    walletConnected && walletNetwork !== EXPECTED_WALLET_NETWORK;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isQueryTooLong = query.length > MAX_QUERY_LENGTH

  const insertOperator = (token: string) => {
    const el = inputRef.current
    if (!el) return
    const start = el.selectionStart ?? query.length
    const end = el.selectionEnd ?? query.length
    const before = query.slice(0, start)
    const after = query.slice(end)
    const needsSpace = before.length > 0 && !before.endsWith(' ')
    const next = (needsSpace ? before + ' ' + token : before + token) + after
    if (next.length > MAX_QUERY_LENGTH) {
      toast.warning('Query too long', { description: `Maximum ${MAX_QUERY_LENGTH} characters.` })
      return
    }
    setQuery(next)
    requestAnimationFrame(() => {
      el.focus()
      const caret = before.length + (needsSpace ? 1 : 0) + token.length
      el.setSelectionRange(caret, caret)
    })
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isWrongNetwork) return;

    if (walletConnected && parseFloat(usdcBalance) < parseFloat(AMOUNT_USDC)) {
      toast.info("Low Balance", {
        description: `You need at least ${AMOUNT_USDC} USDC to search.`,
      });
      return;
    }

    const q = (
      e.currentTarget.elements.namedItem("q") as HTMLInputElement
    ).value.trim();
    if (q) onSearch(q, freshness, { locale, country, language });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="relative"
      role="search"
      aria-label="Search"
    >
      {isWrongNetwork && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute -top-12 left-0 right-0 py-2 px-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-3 text-red-400"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <p className="text-xs font-display tracking-wide">
            NETWORK MISMATCH: Switch Freighter to {EXPECTED_WALLET_NETWORK} to
            search
          </p>
        </motion.div>
      )}

      <div className="relative group">
        {/* Glow ring on focus */}
        <div
          className={`absolute -inset-px rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity blur-sm ${
            isWrongNetwork ? "bg-red-500/20" : ""
          }`}
          style={
            !isWrongNetwork
              ? {
                  background:
                    "linear-gradient(135deg, rgba(0,245,255,0.2), rgba(14,165,233,0.2), rgba(0,245,255,0.2))",
                }
              : {}
          }
        />

        <div
          className="relative flex flex-col sm:flex-row items-stretch sm:items-center gap-3 px-3 sm:px-5 py-3 sm:py-4 rounded-2xl"
          style={{
            background: "rgba(6,13,20,0.85)",
            border: isWrongNetwork
              ? "1px solid rgba(239,68,68,0.3)"
              : "1px solid rgba(0,245,255,0.15)",
            backdropFilter: "blur(16px)",
          }}
        >
          <Search
            className="w-5 h-5 flex-shrink-0"
            style={{
              color: isWrongNetwork
                ? "rgba(239,68,68,0.5)"
                : "rgba(0,245,255,0.5)",
            }}
          />

          <input
            ref={inputRef}
            name="q"
            type="text"
            aria-label="Search query"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={
              isWrongNetwork
                ? "Switch network to search..."
                : "Search anything — pay per query, not per month..."
            }
            disabled={isSearching || isWrongNetwork}
            className="flex-1 min-w-0 bg-transparent text-white placeholder:text-white/20 text-sm outline-none disabled:opacity-50"
            style={{ caretColor: isWrongNetwork ? "#ef4444" : "#00f5ff" }}
          />

          <motion.button
            type="submit"
            disabled={isSearching || isWrongNetwork || isQueryTooLong}
            className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl font-display text-xs tracking-wider transition-all disabled:opacity-40"
            style={{
              background:
                isSearching || isWrongNetwork
                  ? "transparent"
                  : "rgba(0,245,255,0.12)",
              border: "1px solid",
              borderColor:
                isSearching || isWrongNetwork
                  ? "rgba(255,255,255,0.1)"
                  : "rgba(0,245,255,0.4)",
              color:
                isSearching || isWrongNetwork
                  ? "rgba(255,255,255,0.3)"
                  : "#00f5ff",
            }}
            whileTap={{ scale: 0.96 }}
          >
            {isSearching ? (
              <motion.div
                className="w-3.5 h-3.5 rounded-full border border-neon-cyan/40 border-t-neon-cyan"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
              />
            ) : (
              <>
                <Zap className="w-3.5 h-3.5" /> {AMOUNT_USDC} USDC
              </>
            )}
          </motion.button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3 px-1">
        <label className="text-left">
          <span className="block font-display text-[10px] uppercase tracking-[0.2em] text-white/30 mb-1">
            Locale
          </span>
          <select
            aria-label="Search locale"
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none"
          >
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
            <option value="fr-FR">Français</option>
            <option value="es-ES">Español</option>
            <option value="de-DE">Deutsch</option>
          </select>
        </label>

        <label className="text-left">
          <span className="block font-display text-[10px] uppercase tracking-[0.2em] text-white/30 mb-1">
            Country
          </span>
          <select
            aria-label="Search country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none"
          >
            <option value="us">US</option>
            <option value="gb">UK</option>
            <option value="fr">FR</option>
            <option value="es">ES</option>
            <option value="de">DE</option>
          </select>
        </label>

        <label className="text-left">
          <span className="block font-display text-[10px] uppercase tracking-[0.2em] text-white/30 mb-1">
            Language
          </span>
          <select
            aria-label="Search language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none"
          >
            <option value="en">English</option>
            <option value="fr">French</option>
            <option value="es">Spanish</option>
            <option value="de">German</option>
          </select>
        </label>
      </div>

      {/* Date Range Freshness Filter Chips (#17) */}
      <div
        className="flex items-center gap-2 mt-3 px-1 flex-wrap"
        role="group"
        aria-label="Date range filters"
      >
        <span className="inline-flex items-center gap-1 font-display text-xs text-white/30 tracking-wider uppercase mr-1">
          <Calendar className="w-3 h-3 text-neon-cyan/60" /> Freshness:
        </span>
        {FRESHNESS_OPTIONS.map((opt) => {
          const isSelected = freshness === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFreshness(opt.value)}
              className="px-2.5 py-1 rounded-lg font-display text-xs transition-all border cursor-pointer"
              style={{
                background: isSelected
                  ? "rgba(0,245,255,0.15)"
                  : "rgba(255,255,255,0.03)",
                borderColor: isSelected
                  ? "rgba(0,245,255,0.5)"
                  : "rgba(255,255,255,0.08)",
                color: isSelected ? "#00f5ff" : "rgba(255,255,255,0.4)",
              }}
              aria-pressed={isSelected}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Advanced Operators — composed client-side, inserted into the visible editable query. */}
      {/* These operators never change per-query price (AMOUNT_USDC). */}
      <div
        className="flex items-center gap-2 mt-3 px-1 flex-wrap"
        role="group"
        aria-label="Advanced search operators"
      >
        <span
          className="inline-flex items-center gap-1 font-display text-xs text-white/30 tracking-wider uppercase mr-1"
          title="Advanced operators do not change the payment amount"
        >
          <SlidersHorizontal className="w-3 h-3 text-neon-cyan/60" /> Operators:
        </span>
        {ADVANCED_OPERATORS.map((op) => (
          <button
            key={op.label}
            type="button"
            onClick={() => insertOperator(op.insert)}
            title={op.description}
            disabled={isSearching || isWrongNetwork}
            className="px-2.5 py-1 rounded-lg font-display text-xs transition-all border cursor-pointer disabled:opacity-40"
            style={{
              background: 'rgba(255,255,255,0.03)',
              borderColor: 'rgba(255,255,255,0.08)',
              color: isQueryTooLong ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.4)',
            }}
          >
            {op.label}
          </button>
        ))}
      </div>

      {/* Query length validation indicator */}
      <div className="flex justify-end px-1 mt-1">
        <span className={`font-mono text-xs ${isQueryTooLong ? 'text-red-400' : 'text-white/30'}`}>
          {query.length}/{MAX_QUERY_LENGTH}
        </span>
      </div>

      {/* Meta row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mt-2 px-1">
        <p className="font-display text-xs text-white/20">
          {walletConnected
            ? `Balance: ${usdcBalance} USDC · ~${Math.floor(
                parseFloat(usdcBalance) / parseFloat(AMOUNT_USDC),
              ).toLocaleString()} queries left`
            : "Connect Freighter wallet to search"}
        </p>
        <p className="font-display text-xs text-white/20 uppercase tracking-widest">
          Serper.dev · x402 · Stellar {IS_MAINNET ? "Mainnet" : "Testnet"}
        </p>
      </div>
    </form>
  );
}
