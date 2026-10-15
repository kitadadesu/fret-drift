import { test } from "node:test";
import assert from "node:assert/strict";
import { Drone, defaults, partialTarget, partialFrequencyAt, sanitize } from "../audio.js";
class Param {
  constructor() {
    this.value = 0;
    this.events = [];
  }
  setTargetAtTime(v) {
    this.value = v;
  }
  setValueAtTime(v, t) {
    this.events.push(["set", v, t]);
    this.value = v;
  }
  cancelScheduledValues(t) { this.events.push(["cancel", t]); }
  cancelAndHoldAtTime(t) { this.events.push(["hold", t]); }
  linearRampToValueAtTime(v) {
    this.value = v;
  }
  exponentialRampToValueAtTime(v, t) {
    this.events.push(["exponential", v, t]);
    this.value = v;
  }
}
class Node {
  constructor() {
    for (const k of [
      "gain",
      "frequency",
      "detune",
      "threshold",
      "ratio",
      "delayTime",
    ])
      this[k] = new Param();
  }
  connect(n) {
    return n;
  }
  disconnect() {
    this.disconnected = true;
  }
  start() {}
  stop() {
    this.stopped = true;
    this.onended?.();
  }
}
class Context {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.destination = new Node();
    this.oscs = [];
    this.resumes = [];
  }
  createGain() {
    return new Node();
  }
  createDelay() {
    return new Node();
  }
  createConvolver() {
    return new Node();
  }
  createBiquadFilter() {
    return new Node();
  }
  createDynamicsCompressor() {
    return new Node();
  }
  createAnalyser() {
    return new Node();
  }
  createBuffer(ch, len) {
    return { getChannelData: () => new Float32Array(len) };
  }
  createOscillator() {
    const n = new Node();
    this.oscs.push(n);
    return n;
  }
  async resume() {}
  async close() {
    this.closed = true;
  }
}
globalThis.AudioContext = Context;
test("continuous string voices, unisons, mute retirement and disposal", async () => {
  const d = new Drone();
  await d.play([50, 50, null, 55, 59, 64]);
  const first = d.voices[0];
  assert.notEqual(first, d.voices[1]);
  d.move([52, 48, null, 55, 60, 65]);
  assert.equal(d.voices[0], first);
  assert.equal(d.ctx.oscs.length, 10);
  d.move([null, 48, null, 55, 60, 65]);
  assert.equal(d.voices[0], first);
  assert.ok(first.muted);
  assert.ok(first.oscs.every((o) => !o.stopped));
  d.move([50, 48, null, 55, 60, 65]);
  assert.equal(d.voices[0], first);
  assert.equal(d.ctx.oscs.length, 10);
  d.stop();
  assert.ok(d.ctx.oscs.every((o) => o.stopped));
  assert.equal(d.master.gain.value, 0);
  d.update({...d.settings,volume:1});
  assert.equal(d.master.gain.value,0);
  const ctx = d.ctx;
  await d.dispose();
  assert.ok(ctx.closed);
});
test("rapid audition and mute changes reuse voices without stop/start", async () => {
  const d = new Drone();
  await d.play([40, 45, 50, 55, 59, 64]);
  const voices = [...d.voices];
  for (let i = 0; i < 300; i++) {
    d.move([41, 46, null, 56, 60, 65]);
    d.move([40, 45, 50, 55, 59, 64]);
  }
  assert.deepEqual(d.voices, voices);
  assert.equal(d.ctx.oscs.length, 12);
  assert.equal(d.retiring.size, 0);
  assert.ok(d.ctx.oscs.every((o) => !o.stopped));
  await d.dispose();
});
test("six independent spectra follow MIDI with separate in-flight glides", async () => {
  const d = new Drone();
  d.update({ ...d.settings, harmonics: 0.8, inharmonicity: 0.6, drift: 1, glide: 2 });
  await d.play([40, 40, 50, 55, 59, 64]);
  assert.equal(d.ctx.oscs.length, 36);
  assert.notEqual(d.voices[0].partials[0], d.voices[1].partials[0]);
  d.ctx.currentTime = 1;
  d.move([42, 39, 52, 57, 60, 65]);
  const held = d.voices.map(v => v.partials.map(p => partialFrequencyAt(p.motion, 1.2)));
  d.ctx.currentTime = 1.2;
  const notes = [41, 43, 49, 54, 58, 63];
  d.move(notes);
  d.voices.forEach((v, string) => {
    const fundamental = v.oscs[0].frequency.events.at(-1);
    assert.equal(fundamental[2], 3.2);
    assert.equal(fundamental[1], 440 * 2 ** ((notes[string] - 69) / 12));
    const times = v.partials.map((p, i) => {
      const events = p.osc.frequency.events;
      assert.deepEqual(events.at(-3), ["cancel", 1.2]);
      assert.equal(events.at(-2)[0], "set");
      assert.equal(events.at(-2)[2], 1.2);
      assert.equal(events.at(-2)[1], held[string][i]);
      const target = partialTarget(notes[string], i, d.settings, 48000);
      assert.equal(events.at(-1)[1], target.frequency);
      assert.equal(events.at(-1)[2], 1.2 + target.glide);
      return target.glide;
    });
    assert.equal(new Set(times).size, 4);
    assert.ok(times[0] < 2 && times[3] > 2);
  });
  // Unrelated volume/space edits must not restart spectral travel.
  const count = d.voices[0].partials[0].osc.frequency.events.length;
  d.update({ ...d.settings, volume: 0.2, reverb: 1 });
  assert.equal(d.voices[0].partials[0].osc.frequency.events.length, count);
  await d.dispose();
});
test("interrupted partial motion starts from its geometric in-flight pitch", () => {
  const motion = {from: 200, to: 800, start: 1, end: 5};
  assert.equal(partialFrequencyAt(motion, 0), 200);
  assert.equal(partialFrequencyAt(motion, 3), 400);
  assert.equal(partialFrequencyAt(motion, 9), 800);
});
test("zero controls, Nyquist ceiling and absolute amplitude budget", async () => {
  const d = new Drone();
  await d.play([28, 45, 70, 100, 120, 127]);
  assert.equal(d.ctx.oscs.length, 12); // legacy path needs no partials
  for (const harmonics of [0.01, 0.4, 1, 0]) {
    d.update({ ...d.settings, harmonics, inharmonicity: 0, drift: 0 });
    d.voices.forEach((v) => {
      const budget = 2 * v.tone.gain.value + v.partials.reduce((a, p) => a + p.gain.gain.value, 0);
      assert.ok(budget <= 2 + 1e-12);
      v.partials.forEach((p, i) => {
        assert.ok(p.osc.frequency.value <= d.ctx.sampleRate * 0.45);
        if (p.osc.frequency.events.length)
          assert.equal(p.osc.frequency.events.at(-1)[2], d.settings.glide);
        if (v.midi < 100) assert.equal(p.osc.frequency.value, partialTarget(v.midi, i, d.settings, 48000).frequency);
        if (!harmonics) assert.equal(p.gain.gain.value, 0);
      });
      if (!harmonics) assert.equal(v.tone.gain.value, 1);
    });
  }
  assert.equal(partialTarget(69, 1, { ...defaults, inharmonicity: 0 }, 48000).frequency, 1320);
  assert.notEqual(partialTarget(69, 1, { ...defaults, inharmonicity: 1 }, 48000).frequency, 1320);
  assert.deepEqual([sanitize({harmonics: 2}).harmonics, sanitize({drift: -1}).drift, sanitize({inharmonicity: NaN}).inharmonicity], [1, 0, defaults.inharmonicity]);
  await d.dispose();
});
test("spectral rapid holds, all-muted recovery, stop and resume stay bounded", async () => {
  const d = new Drone();
  d.update({ ...d.settings, harmonics: 1 });
  await d.play([40, 45, 50, 55, 59, 64]);
  const voices = [...d.voices];
  for (let i = 0; i < 300; i++) {
    d.move([null, null, null, null, null, null]);
    assert.ok(d.voices.every((v) => v.gain.gain.value === 0));
    d.update({ ...d.settings, harmonics: i % 2, drift: (i % 10) / 10 });
    d.move([41, 46, 51, 56, 60, 65]);
    d.move([40, 45, 50, 55, 59, 64]);
  }
  assert.deepEqual(d.voices, voices);
  assert.equal(d.ctx.oscs.length, 36);
  d.stop();
  assert.ok(d.ctx.oscs.every((o) => o.stopped && o.disconnected));
  assert.ok(voices.every((v) => v.partials.every((p) => p.gain.disconnected)));
  assert.equal(d.retiring.size, 0);
  d.update({ ...d.settings, harmonics: 1 });
  assert.equal(d.master.gain.value, 0);
  await d.play([40, 45, 50, 55, 59, 64]);
  assert.ok(d.voices.every((v) => v.partials.length === 4 && v.gain.gain.value > 0));
  await d.dispose();
});
test("resume and dispose disconnect delayed retiring partials before onended", async () => {
  const originalStop = Node.prototype.stop;
  Node.prototype.stop = function () { this.stopped = true; };
  try {
    const d = new Drone();
    d.update({ ...d.settings, harmonics: 1 });
    await d.play([40,45,50,55,59,64]);
    const old = [...d.voices];
    d.stop();
    assert.equal(d.retiring.size, 6);
    await d.play([41,46,51,56,60,65]);
    assert.equal(d.retiring.size, 0);
    assert.ok(old.every(v => v.gain.disconnected && v.tone.disconnected && v.partials.every(p => p.osc.disconnected && p.gain.disconnected)));
    const current = [...d.voices];
    await d.dispose();
    assert.equal(d.retiring.size, 0);
    assert.ok(current.every(v => v.partials.every(p => p.osc.disconnected && p.gain.disconnected)));
  } finally { Node.prototype.stop = originalStop; }
});
test("stop cancels a pending AudioContext resume", async () => {
  const d = new Drone();
  let release;
  Context.prototype.resume = function () {
    return new Promise((r) => (release = r));
  };
  const p = d.play([40, 45, 50, 55, 59, 64]);
  d.stop();
  release();
  await p;
  assert.equal(d.running, false);
  assert.equal(d.ctx.oscs.length, 0);
  await d.dispose();
});
