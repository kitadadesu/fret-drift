import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createContext,
  selectKey,
  accept,
  propose,
  candidatePool,
  resolutionScore,
  tension,
} from "../harmony.js";
const a = [48, 52, 55, 60, 64, 67],
  b = [49, 52, 55, 58, 61, 64];
test("only actual edge adoption creates resolution context; undo restores it", () => {
  const initial = selectKey(createContext(a), "0:major"),
    saved = structuredClone(initial);
  propose(a, initial, true, 1);
  propose(a, initial, false, 2);
  assert.deepEqual(initial, saved);
  assert.equal(accept(initial, b).resolutionAnchor, null);
  const edge = accept(initial, b, "edge");
  assert.equal(edge.acceptedModes.at(-1), "edge");
  assert.deepEqual(edge.resolutionAnchor.voicing, a);
  const snapshot = structuredClone(edge),
    more = accept(edge, [50, 53, 56, 59, 62, 65], "edge");
  assert.deepEqual(more.resolutionAnchor.voicing, b);
  assert.deepEqual(edge.resolutionAnchor.voicing, a);
  const selected = selectKey(edge, "2:minor");
  assert.equal(selected.resolutionAnchor.key.tonic, 2);
  assert.equal(edge.resolutionAnchor.key.tonic, 0);
  const normal = propose(b, edge, false, 10);
  assert.ok(normal.length >= 3);
  assert.ok(
    normal.every((c) => c.reasons.some((r) => r.includes("緊張→解決"))),
  );
  assert.ok(
    normal.some((c) => JSON.stringify(c.voicing) !== JSON.stringify(a)),
  );
  assert.ok(
    normal.every(
      (c) =>
        tension(c.voicing, edge.resolutionAnchor.key) <
        tension(b, edge.resolutionAnchor.key),
    ),
  );
  assert.equal(
    accept(edge, normal[0].voicing, "normal").resolutionAnchor,
    null,
  );
  assert.deepEqual(edge, snapshot);
  assert.equal(initial.resolutionAnchor, null);
  assert.ok(
    propose(b, snapshot, true).every(
      (c) => !c.reasons.some((r) => r.includes("緊張→解決")),
    ),
  );
});
test("resolution balances chromatic relief and A context without changing ordinary scoring", () => {
  const initial = selectKey(createContext(a), "0:major"),
    edge = accept(initial, b, "edge");
  const pool = candidatePool(b, edge, false),
    ordinary = candidatePool(b, accept(initial, b), false);
  assert.ok(pool[0].score > ordinary[0].score);
  assert.ok(resolutionScore(b, a, edge) > resolutionScore(b, b, edge));
  assert.equal(resolutionScore(b, a, initial), 0);
  const different = accept(
    selectKey(createContext([50, 53, 57, 62, 65, 69]), "2:minor"),
    b,
    "edge",
  );
  assert.notEqual(
    resolutionScore(b, a, edge),
    resolutionScore(b, a, different),
  );
});
