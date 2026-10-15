const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : {}),
});
const results = [];
const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8787";
await mkdir("artifacts", { recursive: true });
for (const [name, width, height] of [
  ["desktop", 1440, 1000],
  ["mobile", 390, 844],
]) {
  const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: name === "mobile",
      isMobile: name === "mobile",
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE_URL);
  // Read output without connecting it to hardware speakers; WebAudio graph is real.
  await page.evaluate(() => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...args) {
      if (destination instanceof AudioDestinationNode) {
        const silence = this.context.createGain();
        silence.gain.value = 0;
        connect.call(this, silence);
        connect.call(silence, destination);
        return destination;
      }
      return connect.call(this, destination, ...args);
    };
  });
  await page.evaluate(() => {
    window.audioProbe = { oscs: [], contexts: [], stops: 0 };
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args) {
        super(...args);
        window.audioProbe.contexts.push(this);
      }
    };
    const create = Native.prototype.createOscillator;
    Native.prototype.createOscillator = function () {
      const o = create.call(this);
      window.audioProbe.oscs.push(o);
      const stop = o.stop.bind(o);
      o.stop = (...args) => {
        window.audioProbe.stops++;
        return stop(...args);
      };
      return o;
    };
    const createAnalyser = Native.prototype.createAnalyser;
    Native.prototype.createAnalyser = function () {
      const n = createAnalyser.call(this);
      window.audioProbe.analyser = n;
      return n;
    };
  });
  await page.locator("#preset").selectOption({ index: 1 });
  for (let i = 0; i < 6; i++)
    await page
      .locator("#strings label")
      .nth(i)
      .locator("input")
      .nth(1)
      .fill(String([6, 8, 0, 7, 0, 0][i]));
  await page.locator("#start").click();
  await page.locator("#instrument").waitFor({ state: "visible" });
  assert.equal(await page.locator("#chord").innerText(), "Bbadd9(#11)");
  assert.equal(await page.locator("#interpretation option").count(), 24);
  const original = await page.locator("#pitches").innerText(),
    initialKey = await page.locator("#interpretation").inputValue();
  const first = await page.locator("#candidates strong").allTextContents();
  assert.equal(first.length, 4);
  await page.locator("#interpretation").selectOption("5:major");
  const manual = await page.locator("#interpretation").inputValue();
  await page.getByRole("button", { name: "候補1を試聴", exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#pitches").innerText(), original);
  assert.equal(await page.locator("#interpretation").inputValue(), manual);
  await page.getByRole("button", { name: "候補1を採用", exact: true }).click();
  assert.notEqual(await page.locator("#pitches").innerText(), original);
  await page.locator("#back").click();
  assert.equal(await page.locator("#pitches").innerText(), original);
  assert.equal(await page.locator("#interpretation").inputValue(), manual);
  await page.locator("#edge").click();
  assert.equal(
    await page.locator("#edge").getAttribute("aria-pressed"),
    "true",
  );
  const edge = await page.locator("#candidates strong").allTextContents();
  await page.locator("#shuffle").click();
  const shuffled = await page.locator("#candidates strong").allTextContents();
  assert.notDeepEqual(edge, shuffled);
  await page.getByRole("button", { name: "候補2を試聴", exact: true }).click();
  await page.locator("#normal").click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#pitches").innerText(), original);
  // Real graph: hold, outside release, keyboard, pointercancel, blur, hidden page and rapid switches.
  const audition = page.getByRole("button", {
    name: "候補1を試聴",
    exact: true,
  });
  await page.getByRole("slider", { name: "Glide", exact: true }).fill("0.02");
  await page.getByRole("slider", { name: "Attack", exact: true }).fill("0.01");
  await page.waitForTimeout(100);
  const originalFrequencies = await page.evaluate(async () => {
    const { parse, frequency } = await import("./music.js");
    return document
      .querySelector("#pitches")
      .textContent.split(" / ")
      .flatMap((n) => [frequency(parse(n)), frequency(parse(n))]);
  });
  const baseline = await page.evaluate(() => ({
    oscs: audioProbe.oscs.length,
    stops: audioProbe.stops,
  }));
  async function holdPointer() {
    const r = await audition.boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.down();
  }
  const box = await audition.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  assert.match(await page.locator("#status").textContent(), /試聴中/);
  await page.mouse.move(1, 1);
  await page.mouse.up();
  assert.equal(await page.locator("#status").textContent(), "● DRIFTING");
  await audition.focus();
  await page.keyboard.down("Space");
  assert.match(await page.locator("#status").textContent(), /試聴中/);
  await page.keyboard.up("Space");
  for (const end of ["pointercancel", "lostpointercapture", "blur"]) {
    await holdPointer();
    await audition.dispatchEvent(end, { pointerId: 1 });
    assert.equal(await page.locator("#status").textContent(), "● DRIFTING");
    await page.mouse.up();
  }
  await holdPointer();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  assert.equal(await page.locator("#status").textContent(), "● DRIFTING");
  await page.mouse.up();
  await holdPointer();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    delete document.hidden;
  });
  assert.equal(await page.locator("#status").textContent(), "● DRIFTING");
  await page.mouse.up();
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("[data-preview]")];
    for (let i = 0; i < 150; i++) {
      buttons[0].dispatchEvent(new KeyboardEvent("keydown", { code: "Enter" }));
      buttons[1].dispatchEvent(new KeyboardEvent("keydown", { code: "Enter" }));
      buttons[0].dispatchEvent(new KeyboardEvent("keyup", { code: "Enter" }));
      buttons[1].dispatchEvent(new KeyboardEvent("keyup", { code: "Enter" }));
    }
  });
  assert.deepEqual(
    await page.evaluate(() => ({
      oscs: audioProbe.oscs.length,
      stops: audioProbe.stops,
    })),
    baseline,
  );
  await page.waitForTimeout(200);
  const signal = await page.evaluate(() => {
    const a = new Float32Array(audioProbe.analyser.fftSize);
    audioProbe.analyser.getFloatTimeDomainData(a);
    return Math.max(...a.map(Math.abs));
  });
  const restored = await page.evaluate(() =>
    audioProbe.oscs.slice(-12).map((o) => o.frequency.value),
  );
  assert.ok(
    restored.every((v, i) => Math.abs(v - originalFrequencies[i]) < 0.01),
  );
  assert.ok(signal > 0.00001 && signal < 1, `audio signal ${signal}`);
  if (name === "mobile") {
    const cdp = await page.context().newCDPSession(page),
      r = await audition.boundingBox();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 2 }],
    });
    assert.match(await page.locator("#status").textContent(), /試聴中/);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    assert.equal(await page.locator("#status").textContent(), "● DRIFTING");
    await cdp.detach();
  }
  // Adopting while holding invalidates the old release; Undo restores the edge context.
  await page.locator("#edge").click();
  await audition.focus();
  await page.keyboard.down("Enter");
  await page.keyboard.press("1");
  await page.keyboard.up("Enter");
  const acceptedEdge = await page.locator("#pitches").textContent();
  await page.locator("#normal").click();
  assert.ok(
    (await page.locator("#candidates").textContent()).includes("緊張→解決"),
  );
  await page.keyboard.press("1");
  await page.locator("#back").click();
  assert.equal(await page.locator("#pitches").textContent(), acceptedEdge);
  assert.ok(
    (await page.locator("#candidates").textContent()).includes("緊張→解決"),
  );
  await page.locator("#back").click();
  assert.equal(await page.locator("#pitches").innerText(), original);
  await page.getByRole("slider", { name: "Release", exact: true }).fill("0.03");
  await audition.focus();
  await page.keyboard.down("Enter");
  await page.evaluate(() => document.querySelector("#stop").click());
  await page.keyboard.up("Enter");
  await page.waitForTimeout(150);
  assert.equal(
    await page.evaluate(() => {
      const a = new Float32Array(audioProbe.analyser.fftSize);
      audioProbe.analyser.getFloatTimeDomainData(a);
      return Math.max(...a.map(Math.abs));
    }),
    0,
  );
  assert.ok(await audition.isDisabled());
  assert.equal(await audition.textContent(), "再開して試聴");
  await page.locator("#resume").click();
  await page.keyboard.press("1");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.locator("#pitches").innerText(), original);
  await page.locator('[data-tab="space"]').click();
  await page
    .getByRole("slider", { name: "Delay wet", exact: true })
    .fill("0.3");
  // Held Undo and edit/new start must invalidate the previous gesture.
  await page.keyboard.press("1");
  await audition.focus();
  await page.keyboard.down("Enter");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Enter");
  assert.equal(await page.locator("#pitches").innerText(), original);
  await audition.focus();
  await page.keyboard.down("Enter");
  await page.evaluate(() => document.querySelector("#edit").click());
  await page.locator("#start").click();
  await page.keyboard.up("Enter");
  assert.equal(await page.locator("#pitches").innerText(), original);
  assert.equal(await page.locator("#status").textContent(), "● DRIFTING");
  assert.ok(
    !(await page.locator("#candidates").textContent()).includes("緊張→解決"),
  );
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    canvas: document.querySelector("canvas").getBoundingClientRect().height,
    bottom: document.querySelector(".sound").getBoundingClientRect().bottom,
    height: innerHeight,
  }));
  assert.equal(geometry.scroll, width);
  assert.ok(geometry.canvas >= 55);
  assert.ok(geometry.bottom <= geometry.height);
  assert.equal(errors.length, 0);
  await page.screenshot({ path: `artifacts/${name}.png`, fullPage: true });
  results.push({
    name,
    initialKey,
    first,
    edge,
    shuffled,
    geometry,
    signal,
    errors,
  });
  await page.close();
}
await browser.close();
await writeFile(
  "artifacts/browser-results.json",
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
