import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialMigration,
  beginMigration,
  migrationTarget,
  migrationBias,
  advanceMigration,
  chooseNext,
  initialDrift,
  AutoClock,
} from "../autoplay.js";
import { createContext, accept, keyId } from "../harmony.js";
import { characterWeights, saturationCurve } from "../audio.js";
const c = [48, 55, 60, 64, 67, 72],
  g = [43, 50, 55, 59, 62, 67];
const key = { tonic: 0, mode: "major" };
test("Character is continuous, convex and finite through all boundaries", () => {
  for (let i = 0; i <= 1000; i++) {
    const w = characterWeights(i / 1000);
    assert.ok(w.every((x) => x >= 0 && x <= 1));
    assert.ok(Math.abs(w.reduce((a, b) => a + b) - 1) < 1e-12);
    if (i)
      assert.ok(
        w.every(
          (x, j) => Math.abs(x - characterWeights((i - 1) / 1000)[j]) < 0.004,
        ),
      );
  }
  for (let kind = 0; kind < 3; kind++) {
    const curve = saturationCurve(kind);
    assert.ok(curve.every((x) => Number.isFinite(x) && Math.abs(x) < 0.6));
    assert.equal(curve[4096], 0);
  }
});
test("Migration probabilistically selects different close keys, excludes recent and handles sparse inference", () => {
  const context = createContext(c),
    results = new Set();
  for (let i = 0; i < 100; i++) {
    const k = migrationTarget(context, [], () => i / 100);
    assert.notEqual(keyId(k), context.center);
    results.add(keyId(k));
  }
  assert.ok(results.size > 1);
  const recent = [...results];
  const k = migrationTarget(context, recent, () => 0);
  if (k) assert.ok(!recent.includes(keyId(k)));
  assert.equal(migrationTarget({ ...context, keys: [context.keys[0]] }), null);
  const sparse = {
    ...context,
    keys: context.keys.map((k, i) => ({ ...k, support: i ? 0 : 1 })),
  };
  assert.ok(migrationTarget(sparse));
  assert.ok(beginMigration(initialMigration(), context).target);
});
test("Arrival requires actual tonic bass, third, repeated evidence, dwell and two minutes", () => {
  let context = createContext(g),
    state = { ...initialMigration(), target: key, from: "7:major" };
  for (let i = 0; i < 8; i++) {
    context = accept(context, g);
    state = advanceMigration(state, context, g, g, 20000);
    assert.equal(state.arrived, false);
  }
  // A shared C-major collection with A bass cannot establish C tonic.
  const a = [45, 52, 57, 60, 64, 69];
  for (let i = 0; i < 4; i++) {
    context = accept(context, a);
    state = advanceMigration(state, context, a, a, 10000);
    assert.equal(state.arrived, false);
  }
  state = { ...initialMigration(), target: key, from: "7:major" };
  context = createContext(c);
  for (let i = 0; i < 5; i++) {
    context = accept(context, c);
    state = advanceMigration(state, context, c, c, 20000);
    assert.equal(state.arrived, false);
  }
  state = advanceMigration(state, accept(context, c), c, c, 20000);
  assert.ok(state.arrived);
  assert.deepEqual(state.recent, ["7:major"]);
  const bad = advanceMigration(
    { ...state, elapsed: 300000, arrived: false },
    createContext(g),
    g,
    g,
    20000,
  );
  assert.equal(bad.target, null);
});
test("Migration bias grows gently and seeded walks keep voice grammar and actual history", () => {
  let context = createContext(c),
    current = c,
    state = {
      ...initialDrift(),
      migration: beginMigration(initialMigration(), context, () => 0.5),
    };
  const target = { ...state.migration, target: key };
  assert.equal(migrationBias({ voicing: c }, g, target), 0);
  assert.ok(
    migrationBias({ voicing: c }, g, { ...target, elapsed: 120000 }) >
      migrationBias({ voicing: g }, g, { ...target, elapsed: 120000 }),
  );
  let seed = 23;
  const rng = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 60; i++) {
    state.migration = beginMigration(state.migration, context, rng);
    state.migration.elapsed += 12000;
    const next = chooseNext(
      current,
      context,
      state,
      { edge: 0.25, migration: true },
      rng,
    );
    assert.ok(next);
    const v = next.candidate.voicing;
    assert.ok(
      v.every((n, j) =>
        n === null ? current[j] === null : Math.abs(n - current[j]) <= 7,
      ),
    );
    context = accept(context, v, next.mode);
    state.migration.elapsed -= 12000;
    state.migration = advanceMigration(
      state.migration,
      context,
      v,
      current,
      12000,
    );
    current = v;
  }
  assert.equal(context.steps, 60);
});
test("Clock active duration excludes pause, resets stop and invalidates old callbacks", () => {
  let now = 0,
    id = 0;
  const jobs = new Map(),
    ticks = [];
  const original = globalThis.performance;
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { now: () => now },
  });
  try {
    const clock = new AutoClock({
      tick: (ms) => ticks.push(ms),
      ready: () => true,
      delay: () => 1000,
      set: (fn) => (jobs.set(++id, fn), id),
      clear: (i) => jobs.delete(i),
    });
    clock.start();
    now = 400;
    clock.pause(true);
    now = 50000;
    clock.pause(false);
    now = 50600;
    jobs.get(id)();
    assert.deepEqual(ticks, [1000]);
    const stale = jobs.get(id);
    clock.stop();
    now = 90000;
    stale();
    assert.deepEqual(ticks, [1000]);
    clock.start();
    now += 1000;
    jobs.get(id)();
    assert.deepEqual(ticks, [1000, 1000]);
  } finally {
    Object.defineProperty(globalThis, "performance", {
      configurable: true,
      value: original,
    });
  }
});

test("seeded migration reaches a new tonal center through adopted chords near two minutes", () => {
  let seed = 23;
  const rng = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32;
  let current = [40, 45, 50, 55, 59, 64],
    context = createContext(current),
    state = { ...initialDrift(), migration: initialMigration() };
  let arrival = null;
  for (let i = 0; i < 25; i++) {
    state.migration = beginMigration(state.migration, context, rng);
    const m = state.migration;
    const next = chooseNext(
      current,
      context,
      { ...state, migration: { ...m, elapsed: m.elapsed + 12000 } },
      { edge: 0.25, migration: true },
      rng,
    );
    const prior = current;
    current = next.candidate.voicing;
    context = accept(context, current, next.mode);
    // Match real Wander and cooldown updates as well as Migration.
    state = advanceDriftForTest(state, prior, current, next.mode, 0.5, rng);
    state.migration = advanceMigration(m, context, current, prior, 12000);
    if (state.migration.arrived) {
      arrival = state.migration;
      break;
    }
  }
  assert.ok(arrival);
  assert.ok(arrival.elapsed >= 120000 && arrival.elapsed <= 240000);
  assert.notEqual(keyId(arrival.target), arrival.from);
  assert.ok(arrival.visits >= 2);
  assert.ok(arrival.stable >= 18000);
  assert.ok(context.steps >= 10);
  assert.ok(
    !arrival.recent.includes(
      keyId(migrationTarget(context, arrival.recent, rng)),
    ),
  );
});
import { advanceDrift as advanceDriftForTest } from "../autoplay.js";
