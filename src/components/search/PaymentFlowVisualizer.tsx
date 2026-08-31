import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink } from "lucide-react";
import type { SearchSession } from "../../hooks/useSearch";
import { PAYMENT_PHASES } from "../../hooks/useSearch";
import { explorerTxUrl, truncateHash } from "../../lib/stellar";

const PHASES = [
  {
    key: "challenge",
    icon: "→",
    label: "Challenge",
    sub: "402 required",
    color: "#00f5ff",
  },
  {
    key: "signing",
    icon: "✦",
    label: "Signing",
    sub: "Freighter auth",
    color: "#7dd3fc",
  },
  {
    key: "settlement",
    icon: "◈",
    label: "Settlement",
    sub: "Stake + x402",
    color: "#39ff14",
  },
  {
    key: "provider",
    icon: "↻",
    label: "Provider",
    sub: "Search call",
    color: "#c084fc",
  },
  {
    key: "rendering",
    icon: "✓",
    label: "Rendering",
    sub: "Display results",
    color: "#34d399",
  },
] as const;

const TOTAL_STEPS = PHASES.length;

interface Props {
  session: SearchSession;
}

export function PaymentFlowVisualizer({ session }: Props) {
  if (session.status === "idle") return null;

  const isSearching = session.status === "searching";
  const isComplete = session.status === "complete";
  const isError = session.status === "error";
  const activePhase = session.activePhase ?? "challenge";
  const completedPhases = session.completedPhases ?? [];
  const activeIdx = PAYMENT_PHASES.indexOf(activePhase);
  const doneCount = isComplete ? TOTAL_STEPS : completedPhases.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      className="rounded-xl p-5 space-y-4"
      style={{
        background: "rgba(6,13,20,0.7)",
        border: "1px solid rgba(0,245,255,0.1)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-xs text-white/30 tracking-widest">
          x402 PAYMENT FLOW
        </span>
        {session.status === "complete" && (
          <span className="font-display text-xs text-neon-green">
            ✓ SETTLED
          </span>
        )}
        {session.status === "error" && (
          <span className="font-display text-xs text-red-400">✗ FAILED</span>
        )}
      </div>

      <div className="relative">
        <div className="absolute top-5 left-5 right-5 h-px bg-white/8 z-0" />
        <div className="relative z-10 flex justify-between">
          {PHASES.map((phase, i) => {
            const stepDone = doneCount > i;
            const stepActive = isSearching && i === activeIdx;
            const stepFailed = isError && i === activeIdx;
            const phaseCompleted = completedPhases.includes(phase.key);

            return (
              <div
                key={phase.label}
                className="flex flex-col items-center gap-2 flex-1"
              >
                <motion.div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm border relative"
                  animate={{
                    borderColor: stepFailed
                      ? "#ef4444"
                      : stepDone || stepActive || phaseCompleted
                        ? phase.color
                        : "rgba(255,255,255,0.1)",
                    backgroundColor:
                      stepDone || phaseCompleted
                        ? `${phase.color}20`
                        : stepActive
                          ? `${phase.color}10`
                          : stepFailed
                            ? "rgba(239,68,68,0.1)"
                            : "transparent",
                    boxShadow: stepActive
                      ? `0 0 20px ${phase.color}50`
                      : "none",
                  }}
                >
                  {stepDone || phaseCompleted ? (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      style={{ color: phase.color }}
                      className="text-xs font-bold"
                    >
                      ✓
                    </motion.span>
                  ) : stepFailed ? (
                    <span
                      style={{ color: "#ef4444" }}
                      className="text-xs font-bold"
                    >
                      ✗
                    </span>
                  ) : (
                    <span
                      style={{
                        color: stepActive
                          ? phase.color
                          : "rgba(255,255,255,0.25)",
                      }}
                      className="text-xs"
                    >
                      {phase.icon}
                    </span>
                  )}
                  {stepActive && (
                    <motion.div
                      className="absolute inset-0 rounded-full border"
                      style={{ borderColor: phase.color }}
                      animate={{ scale: [1, 1.8], opacity: [0.8, 0] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    />
                  )}
                </motion.div>
                <div className="text-center">
                  <p
                    className="font-display text-xs"
                    style={{
                      color: stepFailed
                        ? "#ef4444"
                        : stepDone || stepActive || phaseCompleted
                          ? phase.color
                          : "rgba(255,255,255,0.25)",
                      fontSize: "10px",
                    }}
                  >
                    {phase.label}
                  </p>
                  <p
                    className="text-white/20 hidden sm:block"
                    style={{ fontSize: "9px" }}
                  >
                    {phase.sub}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={session.status}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 8 }}
          className="flex items-center gap-3 py-2.5 px-3 rounded-lg bg-white/4 border border-white/5"
        >
          {session.status === "searching" && (
            <motion.div
              className="w-2 h-2 rounded-full bg-neon-cyan flex-shrink-0"
              animate={{ opacity: [1, 0.2, 1] }}
              transition={{ duration: 0.7, repeat: Infinity }}
            />
          )}
          <p className="font-display text-xs text-white/50">
            {isSearching &&
              `→ ${session.currentStep ?? 1}/${TOTAL_STEPS}: ${PHASES[activeIdx]?.label} — ${PHASES[activeIdx]?.sub}...`}
            {isComplete &&
              `✓ Payment settled — ${session.results.length} results in ${session.durationMs ?? 0}ms`}
            {isError && `✗ ${session.error}`}
          </p>
        </motion.div>
      </AnimatePresence>

      {session.status === "complete" && session.txHash && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="space-y-2"
        >
          <div className="flex items-center justify-between py-2 px-3 rounded bg-neon-green/5 border border-neon-green/20">
            <span className="font-display text-xs text-neon-green/50">
              TX HASH
            </span>
            <a
              href={explorerTxUrl(session.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-neon-green hover:opacity-80 transition-opacity flex items-center gap-1"
            >
              {truncateHash(session.txHash)}{" "}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          {session.paidAmount && (
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["PAID", `${session.paidAmount} USDC`],
                  ["NETWORK", "TESTNET"],
                  ["STATUS", "SETTLED"],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div
                  key={k}
                  className="py-1.5 px-2 rounded bg-white/4 text-center"
                >
                  <p
                    className="font-display text-white/25"
                    style={{ fontSize: "8px" }}
                  >
                    {k}
                  </p>
                  <p
                    className="font-display text-neon-cyan"
                    style={{ fontSize: "10px" }}
                  >
                    {v}
                  </p>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
