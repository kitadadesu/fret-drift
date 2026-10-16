// AUTO TEXTURE is a separate, deterministic musical timeline. It owns no
// AudioNodes, timers or DOM, and never overwrites the musician's manual values.
export const textureKeys = [
  "bloom", "harmonics", "inharmonicity", "drift",
  "dryDrift", "wetDrift", "shimmer", "shimmerDecay", "diffusion",
  "drive", "character", "saturationMix", "reverb", "delay", "detune",
];
export const textureBounds = {
  bloom: [0, 1], harmonics: [0, 1], inharmonicity: [0, 1],
  drift: [0, 1], dryDrift: [0, 1], wetDrift: [0, 1],
  shimmer: [0, 0.85], shimmerDecay: [1, 10.5], diffusion: [0, 1],
  drive: [0, 0.9], character: [0, 1], saturationMix: [0, 0.76],
  reverb: [0, 0.85], delay: [0, 0.52], detune: [0, 26],
};
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (v) => { const x = clamp(v); return x * x * (3 - 2 * x); };

// Unlike a sequence of fixed presets, these are probabilistic destinations.
// Each visit is varied within a safe range; individual controls approach their
// destinations with different delayed envelopes over several minutes.
export const textureScenes = {
  HOLLOW: { bloom: .02, harmonics: .015, inharmonicity: .01, drift: .10,
    dryDrift: .01, wetDrift: .01, shimmer: .02, shimmerDecay: 2,
    diffusion: .08, drive: .015, character: .02, saturationMix: .05,
    reverb: .12, delay: .01, detune: 1 },
  CLEAR: { bloom: .36, harmonics: .13, inharmonicity: .03, drift: .20,
    dryDrift: .07, wetDrift: .12, shimmer: .13, shimmerDecay: 4,
    diffusion: .25, drive: .09, character: .04, saturationMix: .16,
    reverb: .26, delay: .08, detune: 4 },
  HAZE: { bloom: .84, harmonics: .38, inharmonicity: .18, drift: .55,
    dryDrift: .33, wetDrift: .83, shimmer: .72, shimmerDecay: 9.4,
    diffusion: .94, drive: .23, character: .11, saturationMix: .35,
    reverb: .81, delay: .38, detune: 18 },
  GLOW: { bloom: 1, harmonics: .94, inharmonicity: .32, drift: .80,
    dryDrift: .21, wetDrift: .52, shimmer: .59, shimmerDecay: 7.5,
    diffusion: .62, drive: .61, character: .34, saturationMix: .65,
    reverb: .45, delay: .19, detune: 13 },
  DISSOLVE: { bloom: .93, harmonics: .88, inharmonicity: .77, drift: .97,
    dryDrift: .60, wetDrift: .95, shimmer: .78, shimmerDecay: 10.2,
    diffusion: .98, drive: .86, character: .95, saturationMix: .74,
    reverb: .83, delay: .49, detune: 24 },
};
const nearby = {
  HOLLOW: ["CLEAR", "HAZE"],
  CLEAR: ["HOLLOW", "HAZE", "GLOW"],
  HAZE: ["CLEAR", "GLOW", "DISSOLVE"],
  GLOW: ["HAZE", "DISSOLVE", "CLEAR"],
  DISSOLVE: ["GLOW", "HAZE", "HOLLOW"],
};
export function chooseTextureScene(scene, previous = null, rng = Math.random) {
  const all = Object.keys(textureScenes).filter((x) => x !== scene);
  if (!all.length) return scene;
  // About one in four scene changes bypasses the nearest neighborhoods.
  const farther = all.filter((x) => !(nearby[scene] || []).includes(x));
  const neighbors = all.filter((x) => (nearby[scene] || []).includes(x));
  let pool = (rng() < .26 && farther.length) ? farther : neighbors.length ? neighbors : all;
  const noBacktrack = pool.filter((x) => x !== previous);
  if (noBacktrack.length) pool = noBacktrack;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}
export function safeTextureValues(values) {
  const out = {};
  for (const k of textureKeys) {
    const [lo, hi] = textureBounds[k];
    out[k] = clamp(Number.isFinite(values[k]) ? values[k] : lo, lo, hi);
  }
  // An aggressive folded spectrum and a very loud shimmer return should not
  // reach maximum level together, regardless of random target variation.
  if (out.drive > .65 && out.character > .65)
    out.shimmer = Math.min(out.shimmer, .78);
  return out;
}
export function textureDistance(a, b) {
  const keys = ["bloom", "harmonics", "shimmer", "wetDrift", "drive", "character", "reverb"];
  return keys.reduce((sum, key) => {
    const [lo, hi] = textureBounds[key];
    return sum + Math.abs(a[key] - b[key]) / (hi - lo);
  }, 0) / keys.length;
}
function destination(name, rng) {
  const profile = textureScenes[name];
  const values = {};
  for (const k of textureKeys) {
    const [lo, hi] = textureBounds[k];
    // ±5% of knob range makes repeated visits related but not identical.
    values[k] = clamp(profile[k] + (rng() - .5) * (hi - lo) * .10, lo, hi);
  }
  return safeTextureValues(values);
}
export class TextureDrift {
  constructor(manual, rng = Math.random) {
    this.manual = { ...manual };
    this.values = { ...manual };
    this.rng = rng;
    this.enabled = false;
    this.returning = false;
    this.depth = 1; // A full-range journey by default.
    this.elapsed = 0;
    this.wall = null;
    this.scene = null;
    this.previous = null;
    this.plan = null;
    this.overrides = new Map();
  }
  freeze(now) { this.wall = now; }
  start(now = 0) {
    if (this.enabled) return;
    this.enabled = true;
    this.returning = false;
    this.wall = now;
    this.elapsed = 0;
    this.scene = null;
    this.previous = null;
    this.overrides.clear();
    this.nextPlan(true);
  }
  nextPlan(first = false) {
    const prior = this.scene;
    const targetName = chooseTextureScene(prior, this.previous, this.rng);
    const target = destination(targetName, this.rng);
    const far = prior && !(nearby[prior] || []).includes(targetName);
    const duration = first ? 65000 + this.rng() * 85000 :
      far ? 70000 + this.rng() * 125000 : 115000 + this.rng() * 195000;
    const hold = first ? 5000 : 15000 + this.rng() * 58000;
    this.plan = {
      from: { ...this.values },
      target,
      name: targetName,
      duration,
      hold,
      started: this.elapsed,
      offsets: Object.fromEntries(textureKeys.map((k) => [k, this.rng() * .33])),
      origin: prior || "ORIGIN",
    };
    this.previous = prior;
    this.scene = targetName;
  }
  setDepth(depth) {
    this.depth = clamp(depth);
    if (this.enabled && this.plan) {
      const p = this.plan;
      // Smoothly retarget the active scene rather than jumping to a new depth.
      this.plan = { ...p, from: { ...this.values }, started: this.elapsed,
        duration: 12000, hold: 20000, offsets: Object.fromEntries(textureKeys.map(k => [k, 0])) };
    }
  }
  manualChange(key, value) {
    this.manual[key] = value;
    this.values[key] = value;
    if (this.enabled && textureKeys.includes(key))
      this.overrides.set(key, { value, until: this.elapsed + 35000, release: 12000 });
    if (this.returning) this.returnFrom[key] = value;
  }
  stop(now = 0) {
    if (!this.enabled) return;
    this.enabled = false;
    this.returning = true;
    this.wall = now;
    this.returnFrom = { ...this.values };
    this.returnTime = 0;
    this.overrides.clear();
  }
  step(now, playing = true) {
    if (this.wall === null) this.wall = now;
    const dt = Math.max(0, Math.min(2000, now - this.wall));
    this.wall = now;
    if (this.returning) {
      this.returnTime += dt;
      const blend = smooth(this.returnTime / 6000);
      for (const k of textureKeys)
        this.values[k] = lerp(this.returnFrom[k], this.manual[k], blend);
      if (blend >= 1) this.returning = false;
      return this.values;
    }
    if (!this.enabled || !playing) return null;
    this.elapsed += dt;
    if (this.elapsed > this.plan.started + this.plan.duration + this.plan.hold)
      this.nextPlan();
    const p = this.plan;
    const raw = clamp((this.elapsed - p.started) / p.duration);
    const desired = {};
    for (const k of textureKeys) {
      const progress = smooth((raw - p.offsets[k]) / (1 - p.offsets[k]));
      const profile = lerp(this.manual[k], p.target[k], this.depth);
      const automatic = lerp(p.from[k], profile, progress);
      const override = this.overrides.get(k);
      if (!override) desired[k] = automatic;
      else if (this.elapsed < override.until) desired[k] = override.value;
      else if (this.elapsed < override.until + override.release) {
        desired[k] = lerp(override.value, automatic,
          smooth((this.elapsed - override.until) / override.release));
      } else {
        this.overrides.delete(k);
        desired[k] = automatic;
      }
    }
    this.values = { ...this.values, ...safeTextureValues(desired) };
    return this.values;
  }
  get status() {
    const plan = this.plan;
    if (this.returning) return { label: "MANUALへ復帰", progress: Math.min(1, this.returnTime / 6000) };
    if (!this.enabled || !plan) return { label: "待機", progress: 0 };
    return {
      label: plan.origin + " → " + plan.name,
      progress: clamp((this.elapsed - plan.started) / plan.duration),
      elapsed: this.elapsed,
    };
  }
}
