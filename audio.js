import { frequency } from "./music.js";
export const defaults = {
  glide: 2.5,
  harmonics: 0,
  bloom: 0,
  inharmonicity: 0.12,
  drift: 0.4,
  detune: 7,
  attack: 1.2,
  decay: 1.5,
  sustain: 0.75,
  release: 1.8,
  volume: 0.55,
  reverb: 0.35,
  delay: 0.2,
  time: 0.48,
  feedback: 0.32,
};
const limits = {
  glide: [0.02, 8],
  harmonics: [0, 1],
  bloom: [0, 1],
  inharmonicity: [0, 1],
  drift: [0, 1],
  detune: [0, 30],
  attack: [0.01, 4],
  decay: [0.01, 4],
  sustain: [0, 1],
  release: [0.03, 5],
  volume: [0, 1],
  reverb: [0, 1],
  delay: [0, 0.7],
  time: [0.05, 1.5],
  feedback: [0, 0.65],
};
export function sanitize(s) {
  return Object.fromEntries(
    Object.entries(defaults).map(([k, d]) => [
      k,
      Number.isFinite(s[k])
        ? Math.max(limits[k][0], Math.min(limits[k][1], s[k]))
        : d,
    ]),
  );
}
// Four bounded sine partials per string, never detuned copies of the fundamental.
const partials = [
  { ratio: 2, stretch: 0.015, weight: 0.30, speed: 0.45 },
  { ratio: 3, stretch: 0.07, weight: 0.22, speed: 1.8 },
  { ratio: 4, stretch: 0.17, weight: 0.14, speed: 3.2 },
  { ratio: 6, stretch: -0.08, weight: 0.09, speed: 5 },
];
const oscillators = (v) => [...v.oscs, ...v.partials.map((p) => p.osc)];
const disconnectVoice = (v) => {
  v.gain.disconnect();
  v.tone.disconnect();
  v.partials.forEach((p) => p.gain.disconnect());
};
// Bloom shares Drift's four sources; it needs neither timers nor more oscillators.
const bloomWeights = [0.20, 0.12, 0.07, 0.035];
export function bloomLevel(index, age) {
  const delay = [0.3, 1.8, 3.8, 6][index];
  const duration = [3, 4, 5, 6][index];
  const x = Math.max(0, Math.min(1, (age - delay) / duration));
  return x * x * (3 - 2 * x);
}
export function spectrumLevels(targets, settings, age) {
  const weights = targets.map((p, i) => settings.harmonics * p.weight +
    settings.bloom * bloomWeights[i] * bloomLevel(i, age) * (p.weight / partials[i].weight));
  const norm = 1 / (1 + weights.reduce((a, b) => a + b, 0));
  return { core: norm, partials: weights.map(w => 2 * w * norm) };
}
export function partialTarget(midi, index, settings, sampleRate) {
  const p = partials[index];
  const raw = frequency(midi) * p.ratio * (1 + p.stretch * settings.inharmonicity);
  // Fade before the ceiling; never schedule ultrasonic oscillator frequencies.
  const ceiling = sampleRate * 0.45;
  return { frequency: Math.min(raw, ceiling),
    weight: p.weight * Math.max(0, Math.min(1, (ceiling - raw) / (sampleRate * 0.05))),
    glide: Math.min(30, settings.glide * Math.exp(settings.drift * Math.log(p.speed))) };
}
export function partialFrequencyAt(motion, time) {
  const progress = motion.end <= motion.start ? 1 :
    Math.max(0, Math.min(1, (time - motion.start) / (motion.end - motion.start)));
  return motion.from * (motion.to / motion.from) ** progress;
}
export class Drone {
  constructor() {
    this.settings = { ...defaults };
    this.voices = Array(6).fill(null);
    this.generation = 0;
    this.retiring = new Set();
  }
  async ready() {
    if (!this.ctx) {
      const c = (this.ctx = new AudioContext());
      this.input = c.createGain();
      this.master = c.createGain();
      this.master.gain.value = 0;
      this.dry = c.createGain();
      this.wet = c.createGain();
      this.echo = c.createGain();
      this.feedback = c.createGain();
      this.delay = c.createDelay(1.5);
      this.conv = c.createConvolver();
      const impulse = c.createBuffer(2, c.sampleRate * 3, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = impulse.getChannelData(ch);
        for (let i = 0; i < d.length; i++)
          d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3 * 0.5;
      }
      this.conv.buffer = impulse;
      this.input.connect(this.dry).connect(this.master);
      this.input.connect(this.conv).connect(this.wet).connect(this.master);
      this.input.connect(this.delay);
      this.delay.connect(this.echo).connect(this.master);
      const filter = c.createBiquadFilter();
      filter.frequency.value = 2400;
      this.delay.connect(filter).connect(this.feedback).connect(this.delay);
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 12;
      this.analyser = c.createAnalyser();
      this.analyser.fftSize = 512;
      this.master.connect(comp).connect(this.analyser).connect(c.destination);
      this.update(this.settings);
    }
    await this.ctx.resume();
  }
  update(s) {
    const previous = this.settings;
    this.settings = sanitize(s);
    if (!this.ctx) return;
    const t = this.ctx.currentTime,
      p = (n, v) => n.setTargetAtTime(v, t, 0.035),
      s2 = this.settings;
    p(this.master.gain, this.running ? s2.volume : 0);
    p(this.dry.gain, 1 - s2.reverb * 0.45);
    p(this.wet.gain, s2.reverb * 0.55);
    p(this.echo.gain, s2.delay);
    p(this.delay.delayTime, s2.time);
    p(this.feedback.gain, s2.feedback);
    this.voices.forEach((v) => {
      if (!v) return;
      v.oscs.forEach((o, j) => p(o.detune, j ? s2.detune : -s2.detune));
      if (previous.bloom === 0 && s2.bloom > 0) v.bloomStart = t;
      if (["harmonics", "inharmonicity", "drift", "glide"].some((k) => previous[k] !== s2[k]))
        this.spectrum(v);
      else if (previous.bloom !== s2.bloom) {
        this.spectrum(v, false);
      }
    });
  }
  async play(notes) {
    const id = ++this.generation;
    await this.ready();
    if (id !== this.generation) return;
    this.clearRetiring();
    this.running = true;
    this.master.gain.setTargetAtTime(
      this.settings.volume,
      this.ctx.currentTime,
      0.03,
    );
    this.move(notes);
  }
  move(notes) {
    if (!this.running) return;
    const c = this.ctx,
      t = c.currentTime,
      s = this.settings;
    notes.forEach((n, i) => {
      let v = this.voices[i];
      if (n === null) {
        if (v && !v.muted) {
          v.muted = true;
          v.gain.gain.cancelAndHoldAtTime(t);
          v.gain.gain.linearRampToValueAtTime(0, t + s.release);
        }
        return;
      }
      if (!v) {
        const gain = c.createGain();
        gain.gain.value = 0;
        gain.connect(this.input);
        const tone = c.createGain();
        tone.connect(gain);
        const oscs = [-s.detune, s.detune].map((d) => {
          const o = c.createOscillator();
          o.type = "sine";
          o.detune.value = d;
          o.frequency.value = frequency(n);
          o.connect(tone);
          o.start();
          return o;
        });
        v = this.voices[i] = { gain, tone, oscs, partials: [], midi: n, bloomStart: t };
        gain.gain.linearRampToValueAtTime(0.035, t + s.attack);
        gain.gain.linearRampToValueAtTime(
          0.035 * s.sustain,
          t + s.attack + s.decay,
        );
      } else {
        if (v.midi !== n || v.muted) v.bloomStart = t;
        v.midi = n;
        const unmuting = v.muted;
        v.muted = false;
        v.oscs.forEach((o) => {
          o.frequency.cancelAndHoldAtTime(t);
          o.frequency.exponentialRampToValueAtTime(frequency(n), t + s.glide);
        });
        v.gain.gain.cancelAndHoldAtTime(t);
        if (unmuting) {
          v.gain.gain.linearRampToValueAtTime(0.035, t + s.attack);
          v.gain.gain.linearRampToValueAtTime(
            0.035 * s.sustain,
            t + s.attack + s.decay,
          );
        } else v.gain.gain.linearRampToValueAtTime(0.035 * s.sustain, t + 0.08);
      }
      this.spectrum(v);
    });
  }
  spectrum(v, retune = true) {
    const c = this.ctx, t = c.currentTime, s = this.settings;
    const creating = (s.harmonics > 0 || s.bloom > 0) && !v.partials.length;
    if (creating) {
      v.partials = partials.map((_, i) => {
        const osc = c.createOscillator(), gain = c.createGain();
        osc.type = "sine";
        osc.frequency.value = partialTarget(v.midi, i, s.harmonics > 0 ? s : { ...s, inharmonicity: 0, drift: 0 }, c.sampleRate).frequency;
        gain.gain.value = 0;
        osc.connect(gain).connect(v.gain);
        osc.start();
        const hz = osc.frequency.value;
        return { osc, gain, motion: { from: hz, to: hz, start: t, end: t } };
      });
    }
    const pitchSettings = s.harmonics > 0 ? s : { ...s, inharmonicity: 0, drift: 0 };
    const targets = partials.map((_, i) => partialTarget(v.midi, i, pitchSettings, c.sampleRate));
    // Every endpoint has the legacy absolute amplitude budget of 2. Linear
    // interpolation between endpoints preserves that bound, including interrupts.
    const params = [v.tone.gain, ...v.partials.map(p => p.gain.gain)];
    params.forEach(p => p.cancelAndHoldAtTime(t));
    const end = Math.max(t + 0.08, v.bloomStart + 12);
    const times = [t + 0.08];
    if (s.bloom > 0) {
      for (let at = t + 0.33; at < end; at += 0.25) times.push(at);
      if (end > times[0]) times.push(end);
    }
    for (const at of times) {
      const levels = spectrumLevels(targets, s, at - v.bloomStart);
      [levels.core, ...levels.partials].forEach((value, i) =>
        params[i]?.linearRampToValueAtTime(value, at));
    }
    v.partials.forEach((p, i) => {
      const target = targets[i];
      // Track the exponential trajectory independently of AudioParam.value.
      // Explicitly anchor interruptions, including multiple events in one audio quantum.
      if (!creating && retune) {
        const held = partialFrequencyAt(p.motion, t);
        p.osc.frequency.cancelScheduledValues(t);
        p.osc.frequency.setValueAtTime(held, t);
        p.osc.frequency.exponentialRampToValueAtTime(target.frequency, t + target.glide);
        p.motion = { from: held, to: target.frequency, start: t, end: t + target.glide };
      }
    });
  }
  clearRetiring() {
    for (const v of this.retiring) {
      oscillators(v).forEach((o) => {
        o.onended = null;
        try {
          o.stop();
        } catch {}
        o.disconnect();
      });
      disconnectVoice(v);
    }
    this.retiring.clear();
  }
  retire(v, fast = false) {
    this.retiring.add(v);
    const t = this.ctx.currentTime,
      r = fast ? 0.025 : this.settings.release;
    v.gain.gain.cancelAndHoldAtTime(t);
    v.gain.gain.linearRampToValueAtTime(0, t + r);
    const sources = oscillators(v);
    let remaining = sources.length;
    sources.forEach((o) => {
      o.onended = () => {
        o.disconnect();
        if (--remaining === 0) {
          disconnectVoice(v);
          this.retiring.delete(v);
        }
      };
      o.stop(t + r + 0.01);
    });
  }
  stop() {
    ++this.generation;
    this.running = false;
    if (!this.ctx) return;
    this.voices.forEach((v) => v && this.retire(v));
    this.voices.fill(null);
    this.master.gain.cancelAndHoldAtTime(this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(
      0,
      this.ctx.currentTime + this.settings.release,
    );
  }
  async dispose() {
    this.stop();
    await this.ctx?.close();
    this.clearRetiring();
    this.ctx = null;
  }
}
