import { describe, it, expect } from "vitest";
import { PAYMENT_PHASES, EMPTY_TIMINGS, buildPhaseState } from "./useSearch";

describe("useSearch payment phase timing", () => {
  it("tracks challenge, signing, settlement, provider, and rendering as separate timing phases", () => {
    const timing = {
      challenge: 120,
      signing: 240,
      settlement: 680,
      provider: 540,
      rendering: 90,
    };

    const state = buildPhaseState({
      phase: "rendering",
      completedPhases: ["challenge", "signing", "settlement", "provider"],
      timings: timing,
    });

    expect(PAYMENT_PHASES).toEqual([
      "challenge",
      "signing",
      "settlement",
      "provider",
      "rendering",
    ]);
    expect(state.completedPhases).toEqual([
      "challenge",
      "signing",
      "settlement",
      "provider",
    ]);
    expect(state.activePhase).toBe("rendering");
    expect(state.timings).toEqual(timing);
    expect(state.currentStep).toBe(5);
    expect(state.durationMs).toBe(1670);
  });

  it("keeps timing entries present even when no phase has completed yet", () => {
    const state = buildPhaseState({
      phase: "challenge",
      completedPhases: [],
      timings: EMPTY_TIMINGS,
    });

    expect(state.completedPhases).toEqual([]);
    expect(state.activePhase).toBe("challenge");
    expect(state.timings.challenge).toBeNull();
    expect(state.timings.rendering).toBeNull();
  });
});
