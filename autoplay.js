import {
  candidatePool,
  comparison,
  soundKey,
  centerKey,
  keyId,
  scaleOf,
  inferKeys,
} from "./harmony.js";

const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
export const initialDrift = () => ({ wander: 0, cooldown: 0 });
export const initialMigration = () => ({
  target: null,
  elapsed: 0,
  stable: 0,
  visits: 0,
  recent: [],
  arrived: false,
});
export function migrationTarget(context, recent = [], rng = Math.random) {
  const current = centerKey(context);
  const others = context.keys.filter(
    (k) => keyId(k) !== context.center && !recent.includes(keyId(k)),
  );
  if (!others.length) return null;
  const close = others.filter(
    (k) =>
      k.support >= current.support * 0.35 &&
      Math.abs(k.score - current.score) <= 2.5,
  );
  const candidates = close.length
    ? close
    : others
        .filter(
          (k) =>
            scaleOf(k).filter((pc) => scaleOf(current).includes(pc)).length >=
            4,
        )
        .slice(0, 6);
  return weightedChoice(
    candidates,
    candidates.map((k) => k.score - (k.tonic === current.tonic ? 1 : 0)),
    rng,
  );
}
export function beginMigration(state, context, rng = Math.random) {
  if (state.target) return state;
  const target = migrationTarget(context, state.recent, rng);
  return {
    ...state,
    target,
    from: context.center,
    elapsed: 0,
    stable: 0,
    visits: 0,
    arrived: false,
  };
}
export function migrationBias(candidate, current, state) {
  if (!state?.target) return 0;
  const k = state.target,
    scale = scaleOf(k);
  const notes = candidate.voicing.filter((n) => n !== null);
  if (!notes.length) return 0;
  const pcs = [...new Set(notes.map((n) => n % 12))];
  const inside = pcs.filter((pc) => scale.includes(pc)).length / pcs.length;
  const tonicBass = Math.min(...notes) % 12 === k.tonic;
  const third = (k.tonic + (k.mode === "minor" ? 3 : 4)) % 12;
  const triad =
    pcs.includes(k.tonic) &&
    pcs.includes(third) &&
    pcs.includes((k.tonic + 7) % 12);
  const bass = Math.min(...current.filter((n) => n !== null)) % 12;
  const resolution = tonicBass && bass === (k.tonic + 7) % 12;
  return (
    Math.min(1, state.elapsed / 120000) *
    (inside * 1.5 +
      Number(triad) * 1.5 +
      Number(tonicBass) * (2.5 + 4 * Math.min(1, state.elapsed / 120000)) +
      Number(resolution) * 0.5)
  );
}
// Arrival needs repeated tonic harmony, bass, evidence across history and dwell.
// A relative major/minor shares its scale, so scale membership alone cannot arrive.
export function advanceMigration(state, context, current, previous, elapsed) {
  if (!state.target) return state;
  const k = state.target,
    notes = current.filter((n) => n !== null),
    pc = notes.map((n) => n % 12);
  const third = (k.tonic + (k.mode === "minor" ? 3 : 4)) % 12;
  const tonic =
    notes.length &&
    Math.min(...notes) % 12 === k.tonic &&
    pc.includes(third) &&
    pc.includes((k.tonic + 7) % 12);
  const evidence = inferKeys(context.accepted.slice(-8));
  const support = evidence.find((x) => keyId(x) === keyId(k))?.support ?? 0;
  const supported = support >= (evidence[0]?.support ?? 1) * 0.6;
  const prior = previous.filter((n) => n !== null);
  const priorTonic =
    prior.length &&
    Math.min(...prior) % 12 === k.tonic &&
    prior.some((n) => n % 12 === third) &&
    prior.some((n) => n % 12 === (k.tonic + 7) % 12);
  const related = pc.every((n) => scaleOf(k).includes(n));
  const stable =
    supported && priorTonic
      ? state.stable + elapsed
      : related
        ? Math.max(0, state.stable - elapsed * 0.2)
        : 0;
  const visits = state.visits + Number(tonic && supported);
  const total = state.elapsed + elapsed;
  const arrived = Boolean(
    tonic && supported && total >= 120000 && stable >= 18000 && visits >= 2,
  );
  // If the available voicings never establish a center, abandon without relabeling.
  if (total > 300000 && !arrived)
    return {
      ...initialMigration(),
      recent: [...state.recent, keyId(k)].slice(-3),
    };
  return {
    ...state,
    elapsed: total,
    stable,
    visits,
    arrived,
    recent: arrived ? [...state.recent, state.from].slice(-3) : state.recent,
  };
}
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
    migration: state.migration,
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
  if (
    settings.migration &&
    state.migration?.target &&
    mode === "normal" &&
    !resolving
  ) {
    const targetContext = { ...context, center: keyId(state.migration.target) };
    const additions = pool(current, targetContext, false);
    const seen = new Set(candidates.map((c) => soundKey(c.voicing)));
    candidates = [
      ...candidates,
      ...additions.filter((c) => !seen.has(soundKey(c.voicing))),
    ];
  }
  // Keep the existing voice-leading grammar and reject the weakest musical candidates.
  const best = Math.max(...candidates.map((c) => c.score));
  candidates = candidates.filter((c) => c.score >= best - 12);
  const candidate = weightedChoice(
    candidates,
    candidates.map(
      (c) =>
        autoScore(c, current, context, state) +
        (settings.migration ? migrationBias(c, current, state.migration) : 0),
    ),
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
    this.elapsed = 0;
    this.since = null;
  }
  resetElapsed() {
    this.elapsed = 0;
    this.since = this.timer === null ? null : performance.now();
  }
  cancel() {
    if (this.since !== null)
      this.elapsed += Math.max(0, performance.now() - this.since);
    this.since = null;
    this.generation++;
    if (this.timer !== null) this.clear(this.timer);
    this.timer = null;
  }
  stop() {
    this.enabled = false;
    this.cancel();
    this.resetElapsed();
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
      this.since = performance.now();
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
          const elapsed =
            this.elapsed + Math.max(0, performance.now() - this.since);
          this.since = null;
          this.elapsed = 0;
          this.tick(elapsed);
        } catch (error) {
          console.error("AUTO PLAY stopped after transition failure", error);
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
