import { candidatePool, comparison, soundKey } from "./harmony.js";

const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
export const initialDrift = () => ({ wander: 0, cooldown: 0 });
export function movement(a, b) {
  const cmp = comparison(a, b);
  const voices = a.filter((n) => n !== null).length;
  const commonVoices = a.filter(
    (n) => n !== null && b.some((m) => m !== null && (m - n) % 12 === 0),
  ).length;
  const held = cmp.deltas.filter((d) => d === 0).length;
  const distance = clamp(
    0.65 * (1 - commonVoices / voices) +
      (0.35 * cmp.stringMotion) / (voices * 4),
  );
  return { ...cmp, commonVoices, held, distance };
}
export function advanceDrift(
  state,
  a,
  b,
  mode,
  boldness = 0.5,
  rng = Math.random,
) {
  const { distance } = movement(a, b);
  return {
    wander:
      mode === "edge" || distance >= 0.45
        ? state.wander * 0.25
        : clamp(
            state.wander +
              (0.045 + boldness * 0.13) * (0.75 + rng() * 0.5) * (1 - distance),
          ),
    cooldown: mode === "edge" ? 4 : Math.max(0, state.cooldown - 1),
  };
}
export function edgeChance(state, frequency = 0.25) {
  return state.cooldown
    ? 0
    : clamp(frequency) * (0.015 + 0.55 * state.wander ** 2);
}
export function autoScore(candidate, current, context, state) {
  const m = movement(current, candidate.voicing);
  const count = current.filter((n) => n !== null).length;
  // Voice-weighted PC retention and exact per-string holding are different signals.
  const target = count * (0.62 - state.wander * 0.42);
  const commonFit = -Math.abs(m.commonVoices - target) * 1.8;
  const stasis = m.held >= count - 1 ? 4 : 0;
  const recent = context.accepted.slice(-6);
  const key = soundKey(candidate.voicing);
  const repeats = recent.reduce(
    (sum, v, i) => sum + (soundKey(v) === key ? (i + 1) * 1.1 : 0),
    0,
  );
  const bounce = recent.length >= 2 && soundKey(recent.at(-2)) === key ? 5 : 0;
  return (
    candidate.score * 0.65 +
    commonFit -
    stasis -
    repeats -
    bounce +
    state.wander * m.distance * 14
  );
}
export function weightedChoice(items, scores, rng = Math.random) {
  if (!items.length) return null;
  const max = Math.max(...scores);
  const weights = scores.map((s) => Math.exp((s - max) / 2.4));
  let point = rng() * weights.reduce((a, b) => a + b, 0);
  return items[weights.findIndex((w) => (point -= w) < 0)] ?? items.at(-1);
}
export function chooseNext(
  current,
  context,
  state,
  settings,
  rng = Math.random,
  pool = candidatePool,
) {
  const resolving = context.acceptedModes?.at(-1) === "edge";
  let mode =
    !resolving && rng() < edgeChance(state, settings.edge) ? "edge" : "normal";
  let candidates = pool(current, context, mode === "edge");
  if (!candidates.length && mode === "edge") {
    mode = "normal";
    candidates = pool(current, context, false);
  }
  if (!candidates.length) return null;
  // Keep the existing voice-leading grammar and reject the weakest musical candidates.
  const best = Math.max(...candidates.map((c) => c.score));
  candidates = candidates.filter((c) => c.score >= best - 12);
  const candidate = weightedChoice(
    candidates,
    candidates.map((c) => autoScore(c, current, context, state)),
    rng,
  );
  return { candidate, mode };
}
export function intervalMs(a, b, mode, pace = 12, rng = Math.random) {
  const d = movement(a, b).distance;
  const [lo, hi] =
    mode === "edge"
      ? [10, 18]
      : d >= 0.45
        ? [15, 24]
        : d < 0.22
          ? [8, 13]
          : [11, 17];
  return (((lo + rng() * (hi - lo)) * clamp(pace, 4, 30)) / 12) * 1000;
}

// One owned timeout. Invalidated callbacks cannot perform a transition, even if queued.
export class AutoClock {
  constructor({
    tick,
    ready,
    delay,
    changed = () => {},
    // Browser timer functions must be called on their global receiver, not this clock.
    set = (callback, delay) => globalThis.setTimeout(callback, delay),
    clear = (id) => globalThis.clearTimeout(id),
  }) {
    Object.assign(this, { tick, ready, delay, changed, set, clear });
    this.enabled = false;
    this.generation = 0;
    this.timer = null;
    this.paused = false;
  }
  cancel() {
    this.generation++;
    if (this.timer !== null) this.clear(this.timer);
    this.timer = null;
  }
  stop() {
    this.enabled = false;
    this.cancel();
    this.changed();
  }
  start() {
    if (!this.ready()) return;
    this.enabled = true;
    this.replan();
  }
  replan() {
    this.cancel();
    if (this.enabled && !this.paused && this.ready()) {
      const id = this.generation;
      this.timer = this.set(() => {
        if (
          id !== this.generation ||
          !this.enabled ||
          this.paused ||
          !this.ready()
        )
          return;
        this.timer = null;
        try {
          this.tick();
        } catch {
          this.stop();
          return;
        }
        this.replan();
      }, this.delay());
    }
    this.changed();
  }
  pause(value) {
    this.paused = value;
    this.replan();
  }
}
