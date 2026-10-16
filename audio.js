import { frequency } from "./music.js";
// LP/HP WebAudio Q is in dB: -3.0103 dB is the nonresonant Butterworth value (Q=1/√2).
export const dampedQ = -3.0103;
export const defaults = {
  glide: 2.5,
  harmonics: 0,
  bloom: 0.7,
  dryDrift: 0.15,
  wetDrift: 0.35,
  shimmer: 0.35,
  shimmerDecay: 8,
  diffusion: 0.6,
  drive: 0.25,
  character: 0.15,
  saturationMix: 0.4,
  saturationPost: 0,
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
  dryDrift: [0, 1],
  wetDrift: [0, 1],
  shimmer: [0, 1],
  shimmerDecay: [1, 12],
  diffusion: [0, 1],
  drive: [0, 1],
  character: [0, 1],
  saturationMix: [0, 1],
  saturationPost: [0, 1],
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
  v.spectralEnvelope.disconnect();
  v.partials.forEach(p => p.send.disconnect());
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
// Independent looping control signals: shallow wow/flutter plus smooth random
// drift. Buffer sources run for the context lifetime, never on UI timers.
function driftSignal(c, duration, wow, flutter) {
  const rate = 8000, buffer = c.createBuffer(1, rate * duration, rate);
  const data = buffer.getChannelData(0);
  const knots = Array.from({ length: Math.ceil(duration / 7) + 1 }, () => Math.random() * 2 - 1);
  knots[knots.length - 1] = knots[0];
  for (let i = 0; i < data.length; i++) {
    const t = i / rate, x = t / duration * (knots.length - 1), k = Math.floor(x);
    const f = x - k, smooth = f * f * (3 - 2 * f);
    // Integer cycles ensure a seamless loop, including the random component.
    data[i] = 0.55 * Math.sin(2 * Math.PI * wow * t / duration) +
      0.08 * Math.sin(2 * Math.PI * flutter * t / duration) +
      0.37 * (knots[k] + (knots[k + 1] - knots[k]) * smooth);
  }
  const source = c.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.start();
  return source;
}
// Mirror the string ADSR on a separate high-partial-only envelope.
function envelope(v, method, ...args) {
  v.gain.gain[method](...args);
  v.spectralEnvelope.gain[method](...args);
}
// Fixed curves: Character morphs gains, never replaces a live WaveShaper curve.
export function saturationCurve(kind, size = 8193) {
  return Float32Array.from({ length: size }, (_, i) => {
    const x = i * 2 / (size - 1) - 1;
    if (kind === 0) return Math.tanh(x * 2) / 2;
    if (kind === 1) return (Math.tanh(x * 2 + 0.35) - Math.tanh(0.35)) / 2.3;
    return Math.sin(x * 5) / 4;
  });
}
export function characterWeights(x) {
  const asymmetric = Math.max(0, Math.min(1, (x - 0.3) / 0.4));
  const fold = Math.max(0, Math.min(1, (x - 0.7) / 0.3));
  return [1 - asymmetric, asymmetric * (1 - fold), fold];
}
function saturation(c) {
  const input = c.createGain(), output = c.createGain(), dry = c.createGain();
  const drive = c.createGain(), wet = c.createGain();
  wet.gain.value = 0;
  input.connect(dry).connect(output);
  input.connect(drive);
  const colors = [0, 1, 2].map(kind => {
    const shape = c.createWaveShaper(), gain = c.createGain();
    shape.curve = saturationCurve(kind); shape.oversample = "4x";
    drive.connect(shape).connect(gain).connect(wet);
    return { shape, gain };
  });
  const hp = c.createBiquadFilter(), lp = c.createBiquadFilter();
  hp.type = "highpass"; hp.frequency.value = 30; hp.Q.value = dampedQ;
  lp.type = "lowpass"; lp.frequency.value = 6500; lp.Q.value = dampedQ;
  wet.connect(hp).connect(lp).connect(output);
  return { input, output, dry, drive, wet, colors, nodes: [input, output, dry, drive, wet, hp, lp, ...colors.flatMap(x => [x.shape, x.gain])] };
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
      this.texture();
      this.input.connect(this.conv).connect(this.wet).connect(this.wetInput);
      this.input.connect(this.delay);
      this.delay.connect(this.echo).connect(this.wetInput);
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
  texture() {
    const c = this.ctx;
    this.dryMod = c.createGain();
    this.wetMod = c.createGain();
    this.dryMod.gain.value = 0;
    this.wetMod.gain.value = 0;
    this.modulators = [driftSignal(c, 97, 17, 397), driftSignal(c, 109, 23, 503)];
    this.modulators[0].connect(this.dryMod);
    this.modulators[1].connect(this.wetMod);
    this.wetInput = c.createGain();
    this.wetBypass = c.createGain();
    this.wetEffect = c.createGain();
    this.wetEffect.gain.value = 0;
    this.wetDelay = c.createDelay(0.03);
    this.wetDelay.delayTime.value = 0.008;
    this.wetMod.connect(this.wetDelay.delayTime);
    this.wetInput.connect(this.wetBypass).connect(this.master);
    this.wetInput.connect(this.wetDelay).connect(this.wetEffect).connect(this.master);
    this.spectralInput = c.createGain();
    const hp = c.createBiquadFilter(), lp = c.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 650;
    lp.type = "lowpass"; lp.frequency.value = 6200;
    hp.Q.value = lp.Q.value = dampedQ;
    this.preSaturation = saturation(c);
    this.postSaturation = saturation(c);
    this.spectralInput.connect(hp).connect(lp).connect(this.preSaturation.input);
    // Short Schroeder allpasses smear onsets; each feedback is fixed below unity.
    this.diffuseBypass = c.createGain();
    this.diffuseWet = c.createGain();
    this.diffuseWet.gain.value = 0;
    const reverbInput = c.createGain();
    this.preSaturation.output.connect(this.diffuseBypass).connect(reverbInput);
    let chain = this.preSaturation.output;
    for (const seconds of [0.017, 0.023, 0.031]) {
      const delay = c.createDelay(0.04), direct = c.createGain();
      const feedback = c.createGain(), out = c.createGain();
      delay.delayTime.value = seconds;
      direct.gain.value = -0.45; feedback.gain.value = 0.45;
      const delayed = c.createGain();
      delayed.gain.value = 1 - 0.45 ** 2;
      chain.connect(delay).connect(delayed).connect(out);
      chain.connect(direct).connect(out);
      delay.connect(feedback).connect(delay);
      chain = out;
    }
    chain.connect(this.diffuseWet).connect(reverbInput);
    this.spectralWet = c.createGain();
    this.spectralWet.gain.value = 0;
    this.spectralWet.connect(this.postSaturation.input);
    this.postSaturation.output.connect(this.wetInput);
    // Four damped combs, with bounded RT60 feedback and a conservative return.
    // No connection returns to the voice or ordinary reverb input.
    this.tailLines = [0.211, 0.239, 0.269, 0.293].map(seconds => {
      const delay = c.createDelay(0.4), damping = c.createBiquadFilter(), highpass = c.createBiquadFilter();
      const feedback = c.createGain(), level = c.createGain();
      delay.delayTime.value = seconds;
      damping.type = "lowpass"; damping.frequency.value = 4200;
      damping.Q.value = dampedQ; // monotone response: magnitude never exceeds unity
      highpass.type = "highpass"; highpass.frequency.value = 180; highpass.Q.value = dampedQ;
      level.gain.value = 0.08;
      feedback.gain.value = 0;
      reverbInput.connect(delay).connect(damping).connect(level).connect(this.spectralWet);
      damping.connect(highpass).connect(feedback).connect(delay);
      return { seconds, feedback, damping, highpass, level };
    });
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
    p(this.dryMod.gain, s2.dryDrift * 4); // maximum ±4 cents, additive to Detune
    p(this.wetMod.gain, s2.wetDrift * 0.0006);
    p(this.wetBypass.gain, s2.wetDrift === 0 ? 1 : 0);
    p(this.wetEffect.gain, s2.wetDrift === 0 ? 0 : 1);
    p(this.spectralWet.gain, s2.shimmer);
    p(this.diffuseBypass.gain, 1 - s2.diffusion);
    p(this.diffuseWet.gain, s2.diffusion);
    [this.preSaturation, this.postSaturation].forEach((stage, i) => {
      const placement = i ? s2.saturationPost : 1 - s2.saturationPost;
      const mix = s2.drive === 0 ? 0 : s2.saturationMix * placement;
      p(stage.dry.gain, 1 - mix);
      p(stage.wet.gain, mix);
      // Voices are deliberately quiet; excite the curves then compensate drive.
      p(stage.drive.gain, 1 + s2.drive * 12);
      characterWeights(s2.character).forEach((weight, j) =>
        p(stage.colors[j].gain.gain, weight / (1 + s2.drive * 6)));
    });
    this.tailLines.forEach(({ seconds, feedback }) =>
      p(feedback.gain, Math.min(0.94, 10 ** (-3 * seconds / s2.shimmerDecay))));
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
          envelope(v, "cancelAndHoldAtTime", t);
          envelope(v, "linearRampToValueAtTime", 0, t + s.release);
        }
        return;
      }
      if (!v) {
        const gain = c.createGain();
        gain.gain.value = 0;
        gain.connect(this.input);
        const spectralEnvelope = c.createGain();
        spectralEnvelope.gain.value = 0;
        spectralEnvelope.connect(this.spectralInput);
        const tone = c.createGain();
        tone.connect(gain);
        const oscs = [-s.detune, s.detune].map((d) => {
          const o = c.createOscillator();
          o.type = "sine";
          o.detune.value = d;
          o.frequency.value = frequency(n);
          this.dryMod.connect(o.detune);
          o.connect(tone);
          o.start();
          return o;
        });
        v = this.voices[i] = { gain, spectralEnvelope, tone, oscs, partials: [], midi: n, bloomStart: t };
        envelope(v, "linearRampToValueAtTime", 0.035, t + s.attack);
        envelope(v, "linearRampToValueAtTime",
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
        envelope(v, "cancelAndHoldAtTime", t);
        if (unmuting) {
          envelope(v, "linearRampToValueAtTime", 0.035, t + s.attack);
          envelope(v, "linearRampToValueAtTime",
            0.035 * s.sustain,
            t + s.attack + s.decay,
          );
        } else envelope(v, "linearRampToValueAtTime", 0.035 * s.sustain, t + 0.08);
      }
      this.spectrum(v);
    });
  }
  spectrum(v, retune = true) {
    const c = this.ctx, t = c.currentTime, s = this.settings;
    const creating = (s.harmonics > 0 || s.bloom > 0) && !v.partials.length;
    if (creating) {
      v.partials = partials.map((_, i) => {
        const osc = c.createOscillator(), gain = c.createGain(), send = c.createGain();
        send.gain.value = 0;
        osc.connect(send).connect(v.spectralEnvelope);
        this.dryMod.connect(osc.detune);
        osc.type = "sine";
        osc.frequency.value = partialTarget(v.midi, i, s.harmonics > 0 ? s : { ...s, inharmonicity: 0, drift: 0 }, c.sampleRate).frequency;
        gain.gain.value = 0;
        osc.connect(gain).connect(v.gain);
        osc.start();
        const hz = osc.frequency.value;
        return { osc, gain, send, motion: { from: hz, to: hz, start: t, end: t } };
      });
    }
    const pitchSettings = s.harmonics > 0 ? s : { ...s, inharmonicity: 0, drift: 0 };
    const targets = partials.map((_, i) => partialTarget(v.midi, i, pitchSettings, c.sampleRate));
    // Every endpoint has the legacy absolute amplitude budget of 2. Linear
    // interpolation between endpoints preserves that bound, including interrupts.
    const params = [v.tone.gain, ...v.partials.map(p => p.gain.gain)];
    params.forEach(p => p.cancelAndHoldAtTime(t));
    v.partials.forEach(p => p.send.gain.cancelAndHoldAtTime(t));
    const end = Math.max(t + 0.08, v.bloomStart + 12);
    const times = [t + 0.08];
    if (s.bloom > 0) {
      for (let at = t + 0.33; at < end; at += 0.25) times.push(at);
      if (end > times[0]) times.push(end);
    }
    for (const at of times) {
      const levels = spectrumLevels(targets, s, at - v.bloomStart);
      v.partials.forEach((p, i) => {
        // Only Bloom's 3rd/4th/6th partials, independent of Harmonics level.
        const amount = i === 0 ? 0 : 2 * s.bloom * bloomWeights[i] *
          bloomLevel(i, at - v.bloomStart) * levels.core * targets[i].weight / partials[i].weight;
        p.send.gain.linearRampToValueAtTime(amount, at);
      });
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
      oscillators(v).forEach(o => this.dryMod.disconnect(o.detune));
      disconnectVoice(v);
    }
    this.retiring.clear();
  }
  retire(v, fast = false) {
    this.retiring.add(v);
    const t = this.ctx.currentTime,
      r = fast ? 0.025 : this.settings.release;
    envelope(v, "cancelAndHoldAtTime", t);
    envelope(v, "linearRampToValueAtTime", 0, t + r);
    const sources = oscillators(v);
    let remaining = sources.length;
    sources.forEach((o) => {
      o.onended = () => {
        o.disconnect();
        if (--remaining === 0) {
          oscillators(v).forEach(o => this.dryMod.disconnect(o.detune));
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
    this.modulators?.forEach(source => { source.stop(); source.disconnect(); });
    [this.preSaturation, this.postSaturation].forEach(stage => stage?.nodes.forEach(n => n.disconnect()));
    await this.ctx?.close();
    this.clearRetiring();
    this.ctx = null;
  }
}
