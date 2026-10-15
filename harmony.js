// Adapted from chord-atlas 5013cdb: chords, diatonic, predict, compare,
// suggest and roulette. See docs/harmony.md for provenance and ranking limits.
import { analyzeChord } from "./chords.js";
import { mod12, pcName } from "./notes.js";
export const scales = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};
const modes = [
  "Ionian",
  "Dorian",
  "Phrygian",
  "Lydian",
  "Mixolydian",
  "Aeolian",
  "Locrian",
];
const moves = {
  major: [
    [2, 2, 1, 4, 5, 4, 1],
    [2, 1, 1, 2, 7, 1, 1],
    [2, 2, 1, 5, 2, 4, 1],
    [4, 3, 1, 1, 7, 2, 1],
    [8, 1, 1, 1, 1, 5, 1],
    [3, 4, 1, 7, 3, 1, 1],
    [6, 1, 1, 1, 2, 1, 1],
  ],
  minor: [
    [2, 3, 6, 4, 5, 3, 5],
    [5, 1, 1, 1, 5, 2, 1],
    [2, 2, 1, 5, 2, 4, 3],
    [3, 1, 1, 1, 6, 2, 5],
    [6, 1, 3, 1, 1, 4, 3],
    [3, 1, 5, 2, 2, 1, 4],
    [6, 1, 4, 1, 3, 2, 1],
  ],
};
export const pitches = (v) => v.filter((n) => n !== null);
export const pcs = (v) => [...new Set(pitches(v).map(mod12))];
export const soundKey = (v) =>
  pcs(v)
    .sort((a, b) => a - b)
    .join(",");
const valid = (v) =>
  Array.isArray(v) &&
  v.length === 6 &&
  v.every((n) => n === null || (Number.isInteger(n) && n >= 12 && n <= 127));
export const keyId = (k) => `${k.tonic}:${k.mode}`;
export const keyLabel = (k) =>
  `${pcName(k.tonic, "flat")} ${k.mode === "major" ? "major" : "natural minor"}`;
export const scaleOf = (k) => scales[k.mode].map((n) => mod12(n + k.tonic));
export function chordAnalysis(v) {
  const ns = pitches(v);
  return ns.length ? analyzeChord(pcs(v), mod12(Math.min(...ns))) : [];
}
export function modalReadings(v) {
  const c = chordAnalysis(v)[0];
  if (!c) return [];
  return Array.from({ length: 12 }, (_, tonic) => {
    const scale = scaleOf({ tonic, mode: "major" }),
      degree = scale.indexOf(c.root);
    return degree >= 0 && pcs(v).every((p) => scale.includes(p))
      ? `${pcName(c.root, "flat")} ${modes[degree]} / ${pcName(tonic, "flat")} major 音集合`
      : null;
  }).filter(Boolean);
}
export function diatonic(k, size = 3) {
  const s = scaleOf(k);
  return s.map((root, degree) => ({
    root,
    degree,
    pcs: Array.from({ length: size }, (_, i) => s[(degree + i * 2) % 7]),
  }));
}
function classify(v, k) {
  const set = pcs(v),
    bass = mod12(Math.min(...pitches(v)));
  let best = { degree: null, fit: -3 };
  for (const c of diatonic(k)) {
    const count = c.pcs.filter((p) => set.includes(p)).length;
    const fit =
      count < 2
        ? -3
        : count * 2.1 -
          (3 - count) * 2.5 -
          Math.max(0, set.length - count) * 0.35 +
          (bass === c.root ? 0.4 : 0);
    if (fit > best.fit) best = { degree: c.degree, fit };
  }
  return best;
}
const transition = (a, b, k) =>
  a === null || b === null ? 2 : moves[k.mode][a][b];
/** 24 relative scores; support is normalized heuristic mass, not a calibrated probability. */
export function inferKeys(sequence) {
  const seq = sequence.filter((v) => valid(v) && pitches(v).length).slice(-16);
  if (!seq.length) return [];
  const out = [];
  for (const mode of ["major", "minor"])
    for (let tonic = 0; tonic < 12; tonic++) {
      const k = { tonic, mode },
        scale = scaleOf(k);
      let score = 0,
        total = 0,
        prior = null;
      for (let i = 0; i < seq.length; i++) {
        const v = seq[i],
          set = pcs(v),
          outside = set.filter((p) => !scale.includes(p)).length,
          c = classify(v, k),
          weight = 0.82 ** (seq.length - 1 - i);
        score +=
          weight *
          ((6 * (set.length - outside)) / set.length -
            outside * 2.5 +
            Math.max(-3, c.fit) * 0.6 +
            (c.degree === 0 ? 0.65 : 0) +
            (i ? Math.log1p(transition(prior, c.degree, k)) * 0.8 : 0));
        total += weight;
        prior = c.degree;
      }
      out.push({
        ...k,
        score: score / total,
        outside: pcs(seq.at(-1)).filter((p) => !scale.includes(p)),
        degree: prior,
      });
    }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.mode === "minor") - Number(b.mode === "minor") ||
      a.tonic - b.tonic,
  );
  return normalize(out);
}
function normalize(keys) {
  const max = Math.max(...keys.map((k) => k.score)),
    sum = keys.reduce((n, k) => n + Math.exp((k.score - max) / 1.5), 0);
  return keys
    .map((k) => ({ ...k, support: Math.exp((k.score - max) / 1.5) / sum }))
    .sort((a, b) => b.score - a.score);
}
/** Immutable accepted state. Previews and draws do not enter this history. */
export function createContext(v) {
  if (!valid(v) || !pitches(v).length)
    throw new Error("Expected six MIDI/mute slots");
  const keys = inferKeys([v]);
  return {
    origin: [...v],
    accepted: [[...v]],
    acceptedModes: ["initial"],
    resolutionAnchor: null,
    keys,
    center: keyId(keys[0]),
    initialKey: null,
    steps: 0,
  };
}
export function selectKey(state, id) {
  if (!state.keys.some((k) => keyId(k) === id))
    throw new Error("Unknown interpretation");
  const keys = normalize(
    state.keys.map((k) => ({
      ...k,
      score: k.score + (keyId(k) === id ? 3 : 0),
    })),
  );
  return {
    ...state,
    keys,
    center: id,
    initialKey: id,
    resolutionAnchor: state.resolutionAnchor
      ? {
          ...state.resolutionAnchor,
          key: { ...keys.find((k) => keyId(k) === id) },
        }
      : null,
  };
}
export function accept(state, v, mode = "normal") {
  if (!["normal", "edge"].includes(mode))
    throw new Error("Unknown adoption mode");
  if (!valid(v) || !pitches(v).length)
    throw new Error("Expected six MIDI/mute slots");
  const accepted = [...state.accepted.slice(-15).map((v) => [...v]), [...v]],
    raw = inferKeys(accepted);
  const keys = normalize(
    raw.map((k) => {
      const prev = state.keys.find((p) => keyId(p) === keyId(k));
      return { ...k, score: k.score * 0.35 + prev.score * 0.65 };
    }),
  );
  const incumbent = keys.find((k) => keyId(k) === state.center);
  const center =
    keys[0].score - incumbent.score > 0.55 ? keyId(keys[0]) : state.center;
  return {
    ...state,
    accepted,
    keys,
    center,
    steps: state.steps + 1,
    acceptedModes: [...(state.acceptedModes ?? ["initial"]).slice(-15), mode],
    // Capture A and the history-derived key before each actual edge adoption B.
    resolutionAnchor:
      mode === "edge"
        ? {
            voicing: [...state.accepted.at(-1)],
            key: { ...centerKey(state) },
          }
        : null,
  };
}
export const centerKey = (state) =>
  state.keys.find((k) => keyId(k) === state.center) ?? state.keys[0];
export function comparison(a, b) {
  const A = pitches(a).sort((x, y) => x - y),
    B = pitches(b).sort((x, y) => x - y),
    pool = [...B],
    retained = [];
  for (const n of A) {
    const i = pool.indexOf(n);
    if (i >= 0) {
      retained.push(n);
      pool.splice(i, 1);
    }
  }
  const deltas = a.map((n, i) =>
    n === null || b[i] === null ? null : b[i] - n,
  );
  return {
    common: pcs(a).filter((p) => pcs(b).includes(p)),
    retained,
    totalMotion: A.reduce((s, n, i) => s + Math.abs(n - (B[i] ?? n)), 0),
    stringMotion: deltas.reduce((s, d) => s + Math.abs(d ?? 0), 0),
    maxLeap: Math.max(0, ...deltas.map((d) => Math.abs(d ?? 0))),
    deltas,
  };
}
/** Exact multiset assignment, duplicate-aware, with a hard per-string leap limit.
 * Unlike independent nearest-note snapping this cannot lose a target chord tone.
 */
export function assignVoices(source, targets, maxLeap = 7) {
  const slots = source.flatMap((n, i) => (n === null ? [] : [i]));
  if (targets.length !== slots.length) return null;
  const sorted = [...targets].sort((a, b) => a - b);
  let best = null,
    cost = Infinity;
  const used = Array(sorted.length).fill(false),
    v = Array(6).fill(null);
  function visit(i, sum) {
    if (sum >= cost) return;
    if (i === slots.length) {
      cost = sum;
      best = [...v];
      return;
    }
    const slot = slots[i];
    for (let j = 0; j < sorted.length; j++) {
      if (used[j] || (j > 0 && sorted[j] === sorted[j - 1] && !used[j - 1]))
        continue;
      const n = sorted[j],
        d = Math.abs(n - source[slot]);
      if (n < 12 || n > 127 || d > maxLeap) continue;
      used[j] = true;
      v[slot] = n;
      visit(i + 1, sum + d + d * d * 0.08);
      used[j] = false;
    }
  }
  visit(0, 0);
  return best;
}
/** Complete target pitch-class set with optimally placed octave duplicates.
 * DP over coverage masks guarantees all required tones before accepting a voicing. */
export function voiceChord(source, target, maxLeap = 7) {
  const slots = source.flatMap((n, i) => (n === null ? [] : [i]));
  if (target.length > slots.length) return null;
  let states = new Map([[0, { cost: 0, v: Array(6).fill(null) }]]);
  for (const slot of slots) {
    const next = new Map();
    for (const [mask, s] of states)
      for (let d = -maxLeap; d <= maxLeap; d++) {
        const n = source[slot] + d,
          idx = target.indexOf(mod12(n));
        if (n < 12 || n > 127 || idx < 0) continue;
        const m = mask | (1 << idx),
          cost = s.cost + Math.abs(d) + d * d * 0.1;
        if (!next.has(m) || cost < next.get(m).cost) {
          const v = [...s.v];
          v[slot] = n;
          next.set(m, { cost, v });
        }
      }
    states = next;
  }
  return states.get((1 << target.length) - 1)?.v ?? null;
}
/** Atlas scale-index arithmetic: never quantize an outside-scale tone silently. */
export function shiftScale(v, k, steps) {
  const scale = scales[k.mode];
  if (pcs(v).some((p) => !scaleOf(k).includes(p))) return null;
  return v.map((n) => {
    if (n === null) return null;
    const i = scale.indexOf(mod12(n - k.tonic)),
      j = i + steps;
    return n - scale[i] + scale[mod7(j)] + 12 * Math.floor(j / 7);
  });
}
const mod7 = (n) => ((n % 7) + 7) % 7;
function motif(state, k, degree) {
  const ds = state.accepted.map((v) => classify(v, k).degree);
  for (const len of [3, 2, 1]) {
    const suffix = ds.slice(-len);
    if (suffix.length < len || suffix.includes(null)) continue;
    for (let i = 0; i < ds.length - len; i++)
      if (suffix.every((d, j) => d === ds[i + j]) && ds[i + len] === degree)
        return 3 + len * 2;
  }
  return 0;
}
// Relative tension: chromatic color plus close dissonances. Bounded, register independent.
export function tension(v, k) {
  const set = pcs(v),
    scale = scaleOf(k);
  let value = set.filter((p) => !scale.includes(p)).length * 2;
  for (let i = 0; i < set.length; i++)
    for (let j = i + 1; j < set.length; j++) {
      const d = Math.min(mod12(set[i] - set[j]), mod12(set[j] - set[i]));
      if (d === 1) value += 0.7;
      if (d === 6) value += 0.5;
    }
  return value;
}
export function resolutionScore(b, c, state) {
  const anchor = state.resolutionAnchor;
  if (!anchor || state.acceptedModes?.at(-1) !== "edge") return 0;
  const scale = scaleOf(anchor.key),
    target = pcs(c);
  const color = pcs(b).filter((p) => !scale.includes(p));
  const resolved = color.reduce(
    (sum, p) =>
      sum +
      (target.includes(p)
        ? -0.5
        : target.some((q) => Math.min(mod12(q - p), mod12(p - q)) === 1)
          ? 1
          : 0),
    0,
  );
  const a = state.accepted.at(-2) ?? anchor.voicing;
  const aCommon = pcs(a).filter((p) => target.includes(p)).length;
  const anchorCommon = pcs(anchor.voicing).filter((p) =>
    target.includes(p),
  ).length;
  const degree = classify(c, anchor.key).degree;
  return (
    (tension(b, anchor.key) - tension(c, anchor.key)) * 1.8 +
    resolved * 1.4 +
    aCommon * 0.3 +
    anchorCommon * 0.15 +
    ([0, 2, 5].includes(degree) ? 1.2 : 0) -
    (soundKey(c) === soundKey(anchor.voicing) ? 1.5 : 0)
  );
}
export function candidatePool(v, state = createContext(v), edge = false) {
  if (!valid(v) || !pitches(v).length) return [];
  const resolving =
    !edge && state.acceptedModes?.at(-1) === "edge" && state.resolutionAnchor;
  const k = resolving ? state.resolutionAnchor.key : centerKey(state),
    scale = scaleOf(k),
    count = pitches(v).length,
    sourceDegree = classify(v, k).degree;
  const candidates = new Map();
  const add = (target, kind, root = null) => {
    if (!target) return;
    const result = assignVoices(v, pitches(target));
    if (!result || result.every((n, i) => n === v[i])) return;
    const cmp = comparison(v, result),
      set = pcs(result),
      outside = set.filter((p) => !scale.includes(p)).length;
    if (edge && !outside) return;
    if (!edge && outside > 1) return;
    if (!cmp.common.length && cmp.stringMotion > 18) return;
    const c = classify(result, k),
      interpretations = chordAnalysis(result),
      chord =
        interpretations.find((c) => c.root === root) ?? interpretations[0],
      degree =
        root !== null
          ? scale.indexOf(root) < 0
            ? null
            : scale.indexOf(root)
          : c.degree;
    const harmonic =
      Math.log1p(transition(sourceDegree, degree, k)) * 3 +
      motif(state, k, degree) * 0.35 +
      (sourceDegree === 4 && degree === 0 ? 2 : 0);
    const originCommon = pcs(state.origin).filter((p) =>
      set.includes(p),
    ).length;
    const novelty = state.accepted
      .slice(-4)
      .filter((a) => soundKey(a) === soundKey(result)).length;
    const score =
      harmonic +
      (resolving ? resolutionScore(v, result, state) : 0) +
      cmp.common.length * 1.1 +
      cmp.retained.length * 0.5 +
      originCommon * 0.35 * 0.9 ** state.steps -
      cmp.stringMotion * 0.22 -
      cmp.maxLeap * 0.25 -
      novelty * 3 +
      (edge ? Math.min(outside, 3) * 2.2 : -outside * 3) +
      (kind === "音階内の全声部変換" ? 2 : 0) -
      (chord?.score ?? 0) * 0.12;
    const id = soundKey(result);
    const item = {
      voicing: result,
      name:
        chord?.name("flat") ?? set.map((p) => pcName(p, "flat")).join(" · "),
      kind,
      root: root ?? chord?.root,
      degree,
      score,
      outside,
      comparison: cmp,
      key: keyLabel(k),
      reasons: [
        kind,
        resolving ? "緊張→解決 · 採用前の調性を考慮" : "",
        `${cmp.common.length} 共通音 · Δ${cmp.stringMotion} st`,
        outside ? `${outside} 音が推定音階の外` : `${keyLabel(k)} の音集合`,
        sourceDegree === 4 && degree === 0 ? "Ⅴ→Ⅰ の解決" : "",
        motif(state, k, degree) ? "採用履歴のモチーフ" : "",
      ].filter(Boolean),
    };
    if (!candidates.has(id) || score > candidates.get(id).score)
      candidates.set(id, item);
  };
  // Preserve source's full extensions and unison multiplicity in scale transformations.
  for (const key of [
    k,
    ...state.keys.filter((p) => keyId(p) !== keyId(k)).slice(0, 2),
  ])
    for (const step of [-3, -2, -1, 1, 2, 3]) {
      const shifted = shiftScale(v, key, step);
      if (shifted) add(shifted, "音階内の全声部変換");
    }
  const addSet = (set, kind, root) => add(voiceChord(v, set), kind, root);
  // Third-stacked triads, sevenths, ninths, elevenths and sixth/add-nine colors.
  for (const key of [
    k,
    { tonic: k.tonic, mode: k.mode === "major" ? "minor" : "major" },
  ]) {
    const borrowed = key.mode !== k.mode;
    for (
      let size = 3;
      size <= Math.min(count, Math.max(4, pcs(v).length));
      size++
    )
      for (const c of diatonic(key, size))
        addSet(c.pcs, borrowed ? "同主調から借用" : "ダイアトニック", c.root);
    for (const c of diatonic(key))
      for (const ext of [[2], [9], [2, 9]]) {
        const set = [
          ...new Set([...c.pcs, ...ext.map((x) => mod12(c.root + x))]),
        ];
        if (
          set.length <= count &&
          (!borrowed ? set.every((p) => scale.includes(p)) : true)
        )
          addSet(set, borrowed ? "同主調から借用" : "付加音の響き", c.root);
      }
  }
  // Secondary dominants, tritone substitutions, chromatic mediants and symmetric colors.
  for (const c of diatonic(k))
    for (const root of [mod12(c.root + 7), mod12(c.root + 1)])
      addSet(
        [0, 4, 7, 10].map((x) => mod12(root + x)),
        "副属和音 / 裏コード",
        root,
      );
  if (edge)
    for (let root = 0; root < 12; root++)
      for (const ints of [
        [0, 4, 7, 11],
        [0, 3, 7, 10],
        [0, 3, 6, 9],
        [0, 4, 8],
        [0, 2, 7, 10],
        [0, 4, 7, 10, 1],
        [0, 4, 7, 11, 6],
      ])
        if (ints.length <= count)
          addSet(
            ints.map((x) => mod12(root + x)),
            "クロマティックな和音",
            root,
          );
  return [...candidates.values()].sort((a, b) => b.score - a.score);
}
function seeded(seed) {
  let x = ((seed + 1) * 2654435761) >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}
/** Quality floor before weighted, sound-distinct sampling; deterministic seed aids regression. */
export function propose(v, state, edge = false, seed = 0, seen = []) {
  const ranked = candidatePool(v, state, edge);
  if (!ranked.length) return [];
  const eligible = ranked.filter(
    (c) => c.score >= ranked[0].score - (edge ? 10 : 8),
  );
  let available = eligible.filter((c) => !seen.includes(soundKey(c.voicing)));
  if (available.length < 4) available = [...eligible];
  const result = [],
    random = seeded(seed);
  while (result.length < 4 && available.length) {
    const weights = available.map(
      (c) =>
        Math.exp((c.score - ranked[0].score) / 3) /
        (1 + result.filter((r) => r.root === c.root).length * 3),
    );
    let point = random() * weights.reduce((a, b) => a + b, 0);
    let idx = weights.findIndex((w) => (point -= w) < 0);
    if (idx < 0) idx = 0;
    result.push(available[idx]);
    available.splice(idx, 1);
  }
  return result;
}
