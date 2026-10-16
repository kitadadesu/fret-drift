import { test } from "node:test";
import assert from "node:assert/strict";
import { Drone, defaults, partialTarget, partialFrequencyAt, bloomLevel, spectrumLevels, sanitize } from "../audio.js";
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
  linearRampToValueAtTime(v, t) {
    this.events.push(["linear", v, t]);
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
      "Q",
    ])
      this[k] = new Param();
  }
  connect(n) {
    (this.connections ||= []).push(n);
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
  createWaveShaper() { return new Node(); }
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
  createBufferSource() { return new Node(); }
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
  d.update({...d.settings,bloom:0});
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
  d.update({...d.settings,bloom:0});
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
  d.update({...d.settings,bloom:0});
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
  d.update({...d.settings,bloom:0});
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
  d.update({...d.settings,bloom:0});
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
    d.update({...d.settings,bloom:0});
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
  d.update({...d.settings,bloom:0});
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

test("Bloom unfolds in order with a bounded core and exact zero bypass", () => {
  const targets = [0,1,2,3].map(i => partialTarget(69,i,defaults,48000));
  for (const bloom of [0,0.1,1]) for (const harmonics of [0,0.7,1]) {
    for (let age=0; age<20; age+=0.1) {
      const levels=spectrumLevels(targets,{...defaults,bloom,harmonics},age);
      assert.ok(2*levels.core+levels.partials.reduce((a,b)=>a+b,0)<=2+1e-12);
      assert.ok(levels.core>0.45);
    }
  }
  assert.equal(bloomLevel(0,0),0);
  assert.ok(bloomLevel(0,1)>0);
  assert.equal(bloomLevel(1,1),0);
  assert.equal(bloomLevel(3,5),0);
  assert.equal(bloomLevel(3,12),1);
  assert.deepEqual(spectrumLevels(targets,{...defaults,bloom:0},20),{core:1,partials:[0,0,0,0]});
});
test("Bloom shares sources, restarts only on pitch/unmute and survives live controls", async () => {
  Context.prototype.resume = async function () {};
  const d=new Drone();
  d.update({...d.settings,bloom:1,detune:0});
  await d.play([40,40,50,55,59,64]);
  const voices=[...d.voices];
  assert.equal(d.ctx.oscs.length,36);
  const p=voices[0].partials[0];
  const ramps=p.gain.gain.events.filter(e=>e[0]==="linear");
  assert.ok(ramps[0][1]===0);
  assert.ok(ramps.at(-1)[1]>ramps[3][1]);
  d.ctx.currentTime=2;
  d.move([40,40,50,55,59,64]);
  assert.equal(voices[0].bloomStart,0);
  d.move([42,40,50,55,59,64]);
  assert.equal(voices[0].bloomStart,2);
  assert.equal(p.motion.end,2+d.settings.glide);
  assert.ok(Math.abs(p.motion.to-2*voices[0].oscs[0].frequency.value)<1e-9);
  const motion=p.motion;
  d.update({...d.settings,bloom:0.3});
  assert.equal(p.motion,motion);
  assert.equal(voices[0].bloomStart,2);
  for(let i=0;i<300;i++) {
    d.ctx.currentTime+=0.01;
    d.update({...d.settings,bloom:i%2,harmonics:i%3/2});
    d.move([null,41,51,56,60,65]);
    d.move([40,40,50,55,59,64]);
  }
  assert.deepEqual(d.voices,voices);
  assert.equal(d.ctx.oscs.length,36);
  d.update({...d.settings,bloom:0,harmonics:0});
  assert.equal(voices[0].tone.gain.value,1);
  assert.ok(voices.every(v=>v.partials.every(p=>p.gain.gain.value===0)));
  d.stop();
  assert.ok(d.ctx.oscs.every(o=>o.stopped&&o.disconnected));
  await d.play([40,40,50,55,59,64]);
  d.update({...d.settings,bloom:1});
  assert.equal(d.voices[0].partials.length,4);
  await d.dispose();
});

test("Dream sends contain only Bloom high partials, mirror mute ADSR, and preserve glides", async () => {
  const d = new Drone();
  await d.play([40,45,50,55,59,64]);
  const voices = [...d.voices], sources = d.ctx.oscs.length;
  const motion = voices[0].partials[1].motion;
  assert.equal(defaults.bloom, 0.7);
  for (let i=0; i<200; i++) {
    d.ctx.currentTime += 0.1;
    d.update({...d.settings,dryDrift:i%2,wetDrift:(i%3)/2,shimmer:i%2,
      diffusion:i%2,shimmerDecay:i%2?1:12});
    assert.equal(voices[0].partials[1].motion, motion);
  }
  assert.deepEqual(d.voices, voices);
  assert.equal(d.ctx.oscs.length, sources);
  assert.equal(voices[0].partials[0].send.gain.value, 0);
  assert.ok(voices[0].partials[1].send.gain.value > 0);
  d.move(Array(6).fill(null));
  for (const v of voices) assert.equal(v.spectralEnvelope.gain.value, v.gain.gain.value);
  d.move([40,45,50,55,59,64]);
  d.update({...d.settings,bloom:0,harmonics:1,dryDrift:0,wetDrift:0,shimmer:0,diffusion:0});
  assert.ok(voices.every(v=>v.partials.every(p=>p.send.gain.value===0)));
  assert.equal(d.dryMod.gain.value,0);
  assert.equal(d.wetMod.gain.value,0);
  assert.equal(d.wetBypass.gain.value,1);
  assert.equal(d.wetEffect.gain.value,0);
  assert.equal(d.spectralWet.gain.value,0);
  assert.equal(d.diffuseWet.gain.value,0);
  assert.ok(d.tailLines.every(l=>l.feedback.gain.value<0.89+1e-12));
  const mods=d.modulators;
  await d.dispose();
  assert.ok(mods.every(m=>m.stopped&&m.disconnected));
});


test("Dream independent modulation routes and settings bounds", async () => {
  const settings = sanitize({...defaults, bloom:0, dryDrift:9, wetDrift:-1, shimmerDecay:99, diffusion:NaN});
  assert.equal(settings.bloom,0);
  assert.equal(settings.dryDrift,1);
  assert.equal(settings.wetDrift,0);
  assert.equal(settings.shimmerDecay,12);
  assert.equal(settings.diffusion,defaults.diffusion);
  const d = new Drone();
  await d.play([40,45,50,55,59,64]);
  assert.notEqual(d.modulators[0],d.modulators[1]);
  assert.deepEqual(d.modulators[0].connections,[d.dryMod]);
  assert.deepEqual(d.modulators[1].connections,[d.wetMod]);
  assert.ok(d.dryMod.connections.includes(d.voices[0].oscs[0].detune));
  assert.ok(d.dryMod.connections.includes(d.voices[0].partials[2].osc.detune));
  assert.deepEqual(d.wetMod.connections,[d.wetDelay.delayTime]);
  d.update({...d.settings,detune:13,dryDrift:1});
  assert.deepEqual(d.voices[0].oscs.map(o=>o.detune.value),[-13,13]);
  assert.equal(d.dryMod.gain.value,4);
  await d.dispose();
});

test('saturation boundary bypass, fixed morph nodes, passive feedback and disposal', async () => {
  const d = new Drone(); await d.play([40,45,50,55,59,64]);
  const voices = [...d.voices], context = d.ctx;
  const stages = [d.preSaturation, d.postSaturation];
  const curves = stages.flatMap(s => s.colors.map(c => c.shape.curve));
  for(let i=0;i<240;i++) {
    d.update({...d.settings, drive:i%3?1:0, saturationMix:i%4?1:0,
      character:i/239, saturationPost:i%2, shimmerDecay:12});
    if(d.settings.drive===0 || d.settings.saturationMix===0) stages.forEach(s => {
      assert.equal(s.dry.gain.value,1); assert.equal(s.wet.gain.value,0);
    });
    d.tailLines.forEach(line => {
      assert.equal(line.damping.Q.value,-3.0103); assert.equal(line.highpass.Q.value,-3.0103);
      assert.ok(line.feedback.gain.value<0.94);
      assert.ok(Math.abs(line.feedback.gain.value-10**(-3*line.seconds/12))<1e-12);
    });
  }
  assert.deepEqual(d.voices,voices); assert.equal(d.ctx,context);
  assert.deepEqual(stages.flatMap(s=>s.colors.map(c=>c.shape.curve)),curves);
  stages.forEach(s=>s.colors.forEach(c=>assert.equal(c.shape.oversample,'4x')));
  await d.dispose(); stages.forEach(s=>s.nodes.forEach(n=>assert.ok(n.disconnected)));
});
