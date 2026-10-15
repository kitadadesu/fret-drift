import { test } from "node:test";
import assert from "node:assert/strict";
import { bindHold } from "../hold.js";
class Button extends EventTarget {
  focus() {}
  setPointerCapture() {}
  send(type, props = {}) {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, props);
    this.dispatchEvent(e);
  }
}
test("hold/release, cancel, lost capture, keyboard repeat and blur", () => {
  const b = new Button();
  let playing = false,
    starts = 0;
  bindHold(
    b,
    () => {
      playing = true;
      starts++;
    },
    () => (playing = false),
  );
  for (const end of [
    "pointerup",
    "pointercancel",
    "lostpointercapture",
    "blur",
  ]) {
    b.send("pointerdown", { button: 0, pointerId: 1 });
    assert.ok(playing);
    b.send(end, { pointerId: 1 });
    assert.equal(playing, false);
  }
  b.send("keydown", { code: "Space" });
  b.send("keydown", { code: "Space", repeat: true });
  assert.equal(starts, 5);
  b.send("keyup", { code: "Space" });
  assert.equal(playing, false);
});
test("an older release cannot undo a rapid switch", () => {
  const a = new Button(),
    b = new Button();
  let sounding;
  bindHold(
    a,
    () => (sounding = "a"),
    () => (sounding = "drone"),
  );
  bindHold(
    b,
    () => (sounding = "b"),
    () => (sounding = "drone"),
  );
  for (let i = 0; i < 100; i++) {
    a.send("pointerdown", { button: 0 });
    b.send("pointerdown", { button: 0 });
    a.send("pointerup");
    assert.equal(sounding, "b");
    b.send("pointerup");
    assert.equal(sounding, "drone");
  }
});

test("old touch on the same button cannot release the new finger", () => {
  const b = new Button();
  let sounding = false;
  bindHold(
    b,
    () => (sounding = true),
    () => (sounding = false),
  );
  b.send("pointerdown", { button: 0, pointerId: 1 });
  b.send("pointerdown", { button: 0, pointerId: 2 });
  b.send("pointerup", { pointerId: 1 });
  assert.ok(sounding);
  b.send("pointercancel", { pointerId: 2 });
  assert.equal(sounding, false);
});
