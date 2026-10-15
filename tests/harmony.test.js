import { test } from "node:test";
import assert from "node:assert/strict";
import { voicing } from "../music.js";
import {
  createContext,
  selectKey,
  accept,
  centerKey,
  keyId,
  inferKeys,
  chordAnalysis,
  modalReadings,
  propose,
  candidatePool,
  assignVoices,
  voiceChord,
  comparison,
  shiftScale,
  pcs,
  soundKey,
  scaleOf,
} from "../harmony.js";
const altered = voicing([40, 45, 50, 55, 60, 64], [6, 8, 0, 7, 0, 0]);
const C = [48, 52, 55, 60, 64, 67],
  Dm = [50, 53, 57, 62, 65, 69],
  G = [43, 50, 55, 59, 62, 67];
test("MIDI analysis preserves actual bass, fifth-color, duplicate D and modal ambiguity", () => {
  assert.deepEqual(altered, [46, 53, 50, 62, 60, 64]);
  const choices = chordAnalysis(altered);
  assert.equal(choices[0].name("flat"), "Bbadd9(#11)");
  assert.equal(choices.length, 5);
  assert.equal(choices[0].roles.length, 5);
  assert.ok(modalReadings(altered).includes("Bb Lydian / F major 音集合"));
  const keys = inferKeys([altered]);
  assert.equal(keys.length, 24);
  assert.deepEqual(keys.slice(0, 2).map(keyId), ["5:major", "2:minor"]);
  assert.equal(keys[0].score, keys[1].score);
  assert.ok(keys[0].support < 0.6);
  assert.ok(Math.abs(keys.reduce((n, k) => n + k.support, 0) - 1) < 1e-10);
  assert.equal(keys.find((k) => keyId(k) === "10:major").outside.length, 1);
  assert.equal(chordAnalysis([64, null, 48, 55, 60, 52])[0].bass, 0);
});
test("Atlas degree arithmetic keeps every extension, unison and null slot", () => {
  assert.deepEqual(
    shiftScale(altered, { tonic: 5, mode: "major" }, -3),
    [41, 48, 45, 57, 55, 58],
  );
  assert.equal(shiftScale(altered, { tonic: 0, mode: "major" }, 1), null);
  for (const mode of ["major", "minor"])
    for (let tonic = 0; tonic < 12; tonic++) {
      const k = { tonic, mode },
        scale = scaleOf(k),
        v = [
          48 + scale[0],
          48 + scale[2],
          48 + scale[4],
          60 + scale[0],
          null,
          60 + scale[2],
        ];
      for (const d of [-3, -1, 1, 3]) {
        const target = shiftScale(v, k, d);
        assert.equal(target[4], null);
        assert.ok(pcs(target).every((p) => scale.includes(p)));
        assert.equal(target[3] - target[0], 12);
      }
    }
});
test("complete-set optimization cannot snap away a third/seventh or duplicate voice", () => {
  const source = [60, 60, 60, null, 60, 60];
  const target = [60, 64, 67, 71, 71];
  assert.deepEqual(
    assignVoices(source, target, 12)
      .filter((n) => n !== null)
      .sort((a, b) => a - b),
    target,
  );
  assert.equal(assignVoices(source, [60, 64]), null);
  const result = voiceChord([48, 52, 55, 60, 64, 67], [0, 4, 7, 11]);
  assert.deepEqual(
    pcs(result).sort((a, b) => a - b),
    [0, 4, 7, 11],
  );
  const cmp = comparison(
    [60, 60, 64, null, 67, 72],
    [60, 64, 64, null, 67, 72],
  );
  assert.deepEqual(cmp.retained, [60, 64, 67, 72]);
  assert.equal(cmp.maxLeap, 4);
});
test("all keys, altered tunings, mutes and unisons keep bounded six-voice proposals immutable", () => {
  const sources = [
    altered,
    C,
    [50, 50, 50, null, 57, 62],
    [40, null, null, null, null, null],
    [12, 12, 19, 24, 28, 31],
    [112, 113, null, 115, 117, 120],
  ];
  for (const v of sources)
    for (const edge of [false, true]) {
      const context = createContext(v),
        before = JSON.stringify([context, v]);
      const candidates = propose(v, context, edge, 17);
      assert.ok(candidates.length > 0);
      assert.equal(
        new Set(candidates.map((c) => soundKey(c.voicing))).size,
        candidates.length,
      );
      for (const c of candidates) {
        assert.equal(c.voicing.length, 6);
        assert.ok(Number.isFinite(c.score));
        assert.ok(c.comparison.maxLeap <= 7);
        assert.equal(
          c.name,
          chordAnalysis(c.voicing)
            .find((a) => a.root === c.root)
            ?.name("flat") ?? chordAnalysis(c.voicing)[0].name("flat"),
        );
        v.forEach((n, i) => {
          assert.equal(c.voicing[i] === null, n === null);
          if (n !== null) assert.ok(c.voicing[i] >= 12 && c.voicing[i] <= 127);
        });
        if (edge) assert.ok(c.outside > 0);
      }
      assert.equal(JSON.stringify([context, v]), before);
    }
  for (const mode of ["major", "minor"])
    for (let tonic = 0; tonic < 12; tonic++) {
      const state = selectKey(createContext(C), `${tonic}:${mode}`);
      for (const edge of [false, true]) {
        const pool = candidatePool(C, state, edge);
        assert.ok(pool.length >= 4);
        assert.ok(pool.every((c) => c.comparison.maxLeap <= 7));
      }
    }
});
test("ii V I ranking follows accepted context and complete C-root harmony", () => {
  let state = selectKey(createContext(C), "0:major");
  state = accept(accept(state, Dm), G);
  const pool = candidatePool(G, state);
  assert.equal(pool[0].root, 0);
  assert.equal(pool[0].degree, 0);
  assert.ok(pool[0].reasons.includes("Ⅴ→Ⅰ の解決"));
  assert.ok(pool[0].voicing.some((n) => n % 12 === 0));
  assert.ok(pool[0].voicing.some((n) => n % 12 === 4));
});
test("rerolls offer diverse sounds; edge has measurably more outside-scale color", () => {
  const state = createContext(altered),
    sounds = [new Set(), new Set()],
    outside = [0, 0];
  for (let mode = 0; mode < 2; mode++)
    for (let seed = 0; seed < 30; seed++)
      for (const c of propose(altered, state, !!mode, seed)) {
        sounds[mode].add(soundKey(c.voicing));
        outside[mode] += c.outside;
      }
  assert.ok(sounds.every((s) => s.size >= 20));
  assert.ok(outside[1] > outside[0] + 80);
  const first = propose(altered, state, false, 1),
    second = propose(
      altered,
      state,
      false,
      2,
      first.map((c) => soundKey(c.voicing)),
    );
  assert.ok(
    second.every(
      (c) => !first.some((f) => soundKey(f.voicing) === soundKey(c.voicing)),
    ),
  );
  assert.deepEqual(
    propose(altered, state, false, 3),
    propose(altered, state, false, 3),
  );
});
test("accepted-only smoothed key history drifts, rejects single-chord jump, restores exact snapshot", () => {
  let state = selectKey(createContext(C), "0:major");
  const saved = structuredClone(state),
    before = JSON.stringify(state);
  propose(C, state, true, 100);
  propose(C, state, false, 101);
  assert.equal(JSON.stringify(state), before);
  const remote = [54, 58, 61, 66, 70, 73];
  state = accept(state, remote);
  assert.equal(state.center, "0:major");
  for (let i = 0; i < 24; i++) state = accept(state, remote);
  assert.equal(state.center, "6:major");
  assert.ok(state.accepted.length <= 16);
  assert.deepEqual(state.origin, C);
  assert.equal(saved.center, "0:major");
  assert.deepEqual(
    propose(C, saved, false, 4),
    propose(C, JSON.parse(before), false, 4),
  );
  remote[0] = 12;
  assert.equal(state.accepted.at(-1)[0], 54);
  assert.deepEqual(saved.origin, C);
});
test("silence and invalid context inputs never create a nonfinite interpretation", () => {
  assert.deepEqual(inferKeys([Array(6).fill(null)]), []);
  assert.deepEqual(chordAnalysis(Array(6).fill(null)), []);
  assert.throws(() => createContext([NaN, 40, 50, 60, 70, 80]));
  for (const v of [
    [60, null, null, null, null, null],
    [60, 60, 60, 60, 60, 60],
  ])
    assert.ok(
      inferKeys([v]).every(
        (k) => Number.isFinite(k.score) && Number.isFinite(k.support),
      ),
    );
});
