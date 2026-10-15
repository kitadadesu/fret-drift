import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialDrift,
  advanceDrift,
  edgeChance,
  autoScore,
  intervalMs,
  chooseNext,
  movement,
  AutoClock,
} from "../autoplay.js";
import { createContext, accept, candidatePool, soundKey } from "../harmony.js";
const a = [48, 52, 55, 60, 64, 67],
  small = [48, 52, 55, 60, 65, 69],
  far = [49, 53, 56, 61, 65, 68];
function seeded(seed) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
test("common voices distinguish PCs, exact MIDI and string motion; prefer 3–4 over stasis or remote", () => {
  const state = initialDrift(),
    context = createContext(a);
  const score = (v) => autoScore({ voicing: v, score: 10 }, a, context, state);
  assert.ok(score(small) > score([48, 52, 55, 60, 64, 68]));
  assert.ok(score(small) > score(far));
  assert.ok(autoScore({ voicing: far, score: 10 }, a, context, { wander: 1, cooldown: 0 }) > autoScore({ voicing: small, score: 10 }, a, context, { wander: 1, cooldown: 0 }));
  const m = movement(
    a,
    a.map((n) => n + 12),
  );
  assert.equal(m.commonVoices, 6);
  assert.equal(m.held, 0);
  assert.equal(m.stringMotion, 72);
});
test("Wander rises with similarity, boldness changes speed, large motion resets it", () => {
  let state = initialDrift();
  for (let i = 0; i < 8; i++)
    state = advanceDrift(state, a, small, "normal", 0.5, () => 0.5);
  assert.ok(state.wander > 0.5);
  assert.ok(advanceDrift(state, a, far, "normal").wander < state.wander / 2);
  assert.ok(
    advanceDrift(initialDrift(), a, small, "normal", 1, () => 0.5).wander >
      advanceDrift(initialDrift(), a, small, "normal", 0, () => 0.5).wander,
  );
});
test("Edge scales with Wander, cooldown and accepted-edge resolution prevent consecutive events", () => {
  assert.ok(
    edgeChance({ wander: 1, cooldown: 0 }, 1) >
      edgeChance(initialDrift(), 1) * 20,
  );
  assert.equal(edgeChance({ wander: 1, cooldown: 1 }, 1), 0);
  assert.equal(edgeChance({ wander: 1, cooldown: 0 }, 0), 0);
  let state = advanceDrift({ wander: 1, cooldown: 0 }, a, far, "edge");
  for (let i = 0; i < 4; i++) {
    assert.equal(edgeChance(state, 1), 0);
    state = advanceDrift(state, a, small, "normal");
  }
  assert.equal(state.cooldown, 0);
  const ctx = accept(createContext(a), far, "edge");
  const result = chooseNext(
    far,
    ctx,
    { wander: 1, cooldown: 0 },
    { edge: 1 },
    () => 0,
  );
  assert.equal(result.mode, "normal");
  assert.ok(result.candidate.reasons.some((s) => s.includes("緊張→解決")));
});
test("recent returns and two-chord bounce are penalized; weighted selection is seeded and diverse", () => {
  const ctx = createContext(a),
    candidate = { voicing: small, score: 10 };
  assert.ok(
    autoScore(candidate, a, ctx, initialDrift()) >
      autoScore(
        candidate,
        a,
        { ...ctx, accepted: [small, a, small, a] },
        initialDrift(),
      ),
  );
  const sequence = (seed) => {
    const rng = seeded(seed);
    return Array.from({ length: 30 }, () =>
      soundKey(
        chooseNext(a, ctx, initialDrift(), { edge: 0 }, rng).candidate.voicing,
      ),
    );
  };
  assert.deepEqual(sequence(42), sequence(42));
  assert.ok(new Set(sequence(42)).size > 3);
});
test("variable intervals honor movement, edge resolution dwell and Pace scaling", () => {
  assert.equal(
    intervalMs(a, small, "normal", 12, () => 0),
    8000,
  );
  assert.equal(
    intervalMs(a, small, "normal", 12, () => 1),
    13000,
  );
  assert.equal(
    intervalMs(a, far, "normal", 12, () => 0),
    15000,
  );
  assert.equal(
    intervalMs(a, far, "normal", 12, () => 1),
    24000,
  );
  assert.equal(
    intervalMs(a, far, "edge", 12, () => 0),
    10000,
  );
  assert.equal(
    intervalMs(a, far, "edge", 12, () => 1),
    18000,
  );
  assert.equal(
    intervalMs(a, small, "normal", 24, () => 0),
    16000,
  );
  assert.notEqual(
    intervalMs(a, small, "normal", 12, seeded(1)),
    intervalMs(a, small, "normal", 12, seeded(2)),
  );
});
test("empty edge falls back to normal; empty normal safely returns null", () => {
  const ctx = createContext(a),
    state = { wander: 1, cooldown: 0 };
  const pool = (v, c, edge) => (edge ? [] : candidatePool(v, c, false));
  assert.equal(
    chooseNext(a, ctx, state, { edge: 1 }, () => 0, pool).mode,
    "normal",
  );
  assert.equal(
    chooseNext(
      a,
      ctx,
      state,
      { edge: 1 },
      () => 0,
      () => [],
    ),
    null,
  );
});
test("single timeout ownership across rapid toggles, manual replan, holds, hidden, stop and stale callbacks", () => {
  let id = 0,
    ticks = 0,
    ready = true;
  const pending = new Map(),
    callbacks = [];
  const clock = new AutoClock({
    tick: () => ticks++,
    ready: () => ready,
    delay: () => 12000,
    set: (fn) => {
      callbacks.push(fn);
      pending.set(++id, fn);
      return id;
    },
    clear: (id) => pending.delete(id),
  });
  clock.start();
  clock.start();
  assert.equal(pending.size, 1);
  callbacks[0]();
  assert.equal(ticks, 0);
  clock.replan();
  assert.equal(pending.size, 1);
  clock.pause(true);
  assert.equal(pending.size, 0);
  callbacks.at(-1)();
  assert.equal(ticks, 0);
  clock.pause(false);
  assert.equal(pending.size, 1);
  const fire = () => {
    const [id, fn] = pending.entries().next().value;
    pending.delete(id);
    fn();
  };
  fire();
  assert.equal(ticks, 1);
  assert.equal(pending.size, 1);
  ready = false;
  clock.replan();
  assert.equal(pending.size, 0);
  callbacks.at(-1)();
  assert.equal(ticks, 1);
  ready = true;
  clock.replan();
  clock.stop();
  assert.equal(pending.size, 0);
  callbacks.at(-1)();
  assert.equal(ticks, 1);
  for (let i = 0; i < 100; i++) {
    clock.start();
    clock.stop();
  }
  assert.equal(pending.size, 0);
});
test("long seeded auto walks retain six slots, key state, mute positions, bounded leaps and edge cooldown", () => {
  let current = [48, null, 55, 60, 64, 67],
    ctx = createContext(current),
    state = initialDrift(),
    lastEdge = -10;
  const rng = seeded(19);
  let edges = 0;
  for (let i = 0; i < 100; i++) {
    const next = chooseNext(current, ctx, state, { edge: 1 }, rng);
    assert.ok(next);
    const v = next.candidate.voicing;
    assert.equal(v.length, 6);
    assert.equal(v[1], null);
    assert.ok(movement(current, v).maxLeap <= 7);
    if (next.mode === "edge") {
      assert.ok(i - lastEdge >= 5);
      lastEdge = i;
      edges++;
    }
    state = advanceDrift(state, current, v, next.mode, 1, rng);
    ctx = accept(ctx, v, next.mode);
    current = v;
    assert.deepEqual(ctx.accepted.at(-1), current);
    assert.equal(ctx.accepted.length, ctx.acceptedModes.length);
    assert.ok(ctx.keys.some((k) => `${k.tonic}:${k.mode}` === ctx.center));
  }
  assert.ok(edges > 0);
});

// Browser natives reject AutoClock as their receiver. Fake clocks alone mask this.
test("default timers retain the global receiver for scheduling and cancellation", () => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let scheduled = 0, cleared = 0;
  try {
    globalThis.setTimeout = function () { assert.equal(this, globalThis); scheduled++; return 42; };
    globalThis.clearTimeout = function (id) { assert.equal(this, globalThis); assert.equal(id, 42); cleared++; };
    const clock = new AutoClock({ tick() {}, ready: () => true, delay: () => 100 });
    clock.start(); clock.replan(); clock.stop();
    assert.equal(scheduled, 2); assert.equal(cleared, 2);
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});
