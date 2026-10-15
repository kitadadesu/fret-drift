import { frequency } from "./music.js";
export const defaults = {
  glide: 2.5,
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
    this.voices.forEach((v) =>
      v?.oscs.forEach((o, j) => p(o.detune, j ? s2.detune : -s2.detune)),
    );
  }
  async play(notes) {
    const id = ++this.generation;
    await this.ready();
    if (id !== this.generation) return;
    for (const v of this.retiring) {
      v.oscs.forEach((o) => {
        o.onended = null;
        try {
          o.stop();
        } catch {}
        o.disconnect();
      });
      v.gain.disconnect();
    }
    this.retiring.clear();
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
        const oscs = [-s.detune, s.detune].map((d) => {
          const o = c.createOscillator();
          o.type = "sine";
          o.detune.value = d;
          o.frequency.value = frequency(n);
          o.connect(gain);
          o.start();
          return o;
        });
        v = this.voices[i] = { gain, oscs };
        gain.gain.linearRampToValueAtTime(0.035, t + s.attack);
        gain.gain.linearRampToValueAtTime(
          0.035 * s.sustain,
          t + s.attack + s.decay,
        );
      } else {
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
    });
  }
  retire(v, fast = false) {
    this.retiring.add(v);
    const t = this.ctx.currentTime,
      r = fast ? 0.025 : this.settings.release;
    v.gain.gain.cancelAndHoldAtTime(t);
    v.gain.gain.linearRampToValueAtTime(0, t + r);
    v.oscs.forEach((o) => {
      o.onended = () => {
        o.disconnect();
        v.gain.disconnect();
        this.retiring.delete(v);
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
    this.ctx = null;
  }
}
