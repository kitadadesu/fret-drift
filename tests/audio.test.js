import { test } from "node:test";
import assert from "node:assert/strict";
import { Drone } from "../audio.js";
class Param {
  constructor() {
    this.value = 0;
  }
  setTargetAtTime(v) {
    this.value = v;
  }
  setValueAtTime(v) {
    this.value = v;
  }
  cancelAndHoldAtTime() {}
  linearRampToValueAtTime(v) {
    this.value = v;
  }
  exponentialRampToValueAtTime(v) {
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
    this.sampleRate = 100;
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
