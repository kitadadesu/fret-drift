import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const port = Number(process.env.PORT || 8787);
const server = createServer(async (req, res) => {
  try {
    const path = req.url.split("?")[0];
    res.setHeader(
      "Content-Type",
      path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(
      await readFile(
        new URL(".." + (path === "/" ? "/index.html" : path), import.meta.url),
      ),
    );
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(port, "127.0.0.1", r));
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
try {
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}`);
  const result = await page.evaluate(async () => {
    const { Drone } = await import("./audio.js");
    let duration = 28;
    window.AudioContext = class extends OfflineAudioContext {
      constructor() {
        super(2, 48000 * duration, 48000);
      }
      async resume() {}
    };
    const render = async (settings, stress = false) => {
      // Reproducible convolution and drift for sample-by-sample bypass comparisons.
      let seed = 11;
      Math.random = () =>
        (seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32;
      const d = new Drone();
      d.update({
        ...d.settings,
        detune: 0,
        dryDrift: 0,
        wetDrift: 0,
        reverb: 0,
        delay: 0,
        attack: 0.01,
        decay: 0.01,
        sustain: 1,
        volume: 1,
        bloom: 1,
        shimmer: 1,
        shimmerDecay: 12,
        ...settings,
      });
      await d.play([40, 45, 50, 55, 59, 64]);
      // Capture spectral return before POST saturation and master compression in R.
      const meter = d.ctx.createChannelMerger(2);
      d.analyser.disconnect();
      d.analyser.connect(meter, 0, 0);
      d.spectralWet.connect(meter, 0, 1);
      meter.connect(d.ctx.destination);
      const frequencies = Float32Array.from(
        { length: 4096 },
        (_, i) => 10 * 2400 ** (i / 4095),
      );
      const magnitude = new Float32Array(4096),
        phase = new Float32Array(4096);
      for (const line of d.tailLines)
        for (const filter of [line.damping, line.highpass]) {
          filter.getFrequencyResponse(frequencies, magnitude, phase);
          if (Math.max(...magnitude) > 1.000001)
            throw Error("resonant feedback filter");
        }
      const voices = [...d.voices],
        context = d.ctx;
      if (stress)
        for (let t = 4; t < duration - 30; t += 4)
          d.ctx.suspend(t).then(() => {
            d.move([40 + (t % 7), 45, 50 + (t % 3), 55, 59, 64]);
            d.update({
              ...d.settings,
              drive: t % 8 ? 1 : 0,
              character: (t % 24) / 24,
              saturationMix: t % 12 ? 1 : 0,
              saturationPost: t % 8 ? 1 : 0,
              diffusion: t % 12 ? 1 : 0,
              shimmerDecay: t % 8 ? 12 : 1,
            });
            OfflineAudioContext.prototype.resume.call(d.ctx);
          });
      const muteAt = duration - 25;
      d.ctx.suspend(muteAt).then(() => {
        d.move(Array(6).fill(null));
        OfflineAudioContext.prototype.resume.call(d.ctx);
      });
      const b = await d.ctx.startRendering(),
        a = b.getChannelData(0),
        raw = b.getChannelData(1);
      let peak = 0,
        loopPeak = 0,
        step = 0,
        late = 0,
        earlyTail = 0;
      const windows = [];
      for (let i = 1; i < a.length; i++) {
        assertFinite(a[i]);
        assertFinite(raw[i]);
        loopPeak = Math.max(loopPeak, Math.abs(raw[i]));
        peak = Math.max(peak, Math.abs(a[i]));
        step = Math.max(step, Math.abs(a[i] - a[i - 1]));
        if (i > (duration - 3) * 48000) late += a[i] ** 2;
        if (i > (muteAt + 6) * 48000 && i < (muteAt + 9) * 48000)
          earlyTail += a[i] ** 2;
      }
      for (let t = 10; t < duration - 25; t += 10) {
        let sum = 0;
        for (let i = t * 48000; i < (t + 1) * 48000; i++) sum += a[i] ** 2;
        windows.push(Math.sqrt(sum / 48000));
      }
      if (!d.voices.every((v, i) => v === voices[i]) || d.ctx !== context)
        throw Error("sources replaced");
      return {
        peak,
        loopPeak,
        step,
        late: Math.sqrt(late / (3 * 48000)),
        earlyTail: Math.sqrt(earlyTail / (3 * 48000)),
        windows,
        samples: Array.from(a.slice(16 * 48000, 17 * 48000)),
      };
    };
    function assertFinite(x) {
      if (!Number.isFinite(x)) throw Error("nonfinite");
    }
    // Short comparisons retain signal before mute; long render measures steady state and tail.
    duration = 48;
    const off = await render({ saturationMix: 0 }),
      driveZero = await render({ drive: 0 }),
      postOff = await render({ saturationMix: 0, saturationPost: 1 });
    const diff = (a, b) =>
      Math.max(...a.samples.map((v, i) => Math.abs(v - b.samples[i])));
    const bypassDifference = diff(off, driveZero),
      positionBypassDifference = diff(off, postOff);
    const warm = await render({
        drive: 0.25,
        character: 0.15,
        saturationMix: 0.4,
      }),
      fold = await render({
        drive: 1,
        character: 1,
        saturationMix: 1,
        saturationPost: 1,
      });
    const zero = await render({ bloom: 0 }),
      zeroOff = await render({ bloom: 0, saturationMix: 0 });
    const bloomZeroDifference = diff(zero, zeroOff),
      characterDifference = diff(warm, fold);
    duration = 180;
    const stable = await render({
      drive: 1,
      character: 1,
      saturationMix: 1,
      saturationPost: 1,
      harmonics: 1,
    });
    const stress = await render(
      { harmonics: 1, feedback: 0.65, delay: 0.7, reverb: 1 },
      true,
    );
    for (const x of [
      off,
      driveZero,
      postOff,
      warm,
      fold,
      zero,
      zeroOff,
      stable,
      stress,
    ])
      delete x.samples;
    return {
      bypassDifference,
      positionBypassDifference,
      bloomZeroDifference,
      characterDifference,
      warm,
      fold,
      stable,
      stress,
    };
  });
  console.log(JSON.stringify(result, null, 2));
  assert.ok(result.bypassDifference < 1e-5);
  assert.ok(result.positionBypassDifference < 1e-5);
  assert.ok(result.bloomZeroDifference < 1e-5);
  assert.ok(result.characterDifference > 1e-5);
  for (const k of ["warm", "fold", "stable", "stress"]) {
    assert.ok(result[k].peak < 0.9, k);
    assert.ok(result[k].loopPeak < 0.5, k);
    assert.ok(result[k].step < 0.08, k);
    assert.ok(result[k].late < result[k].earlyTail * 0.1 + 1e-7, k);
  }
  assert.ok(
    Math.max(...result.stable.windows.slice(-5)) <
      Math.max(...result.stable.windows.slice(0, 5)) * 2,
  );
  await page.reload();
  // UI and actual AUTO integration, with a muted hardware destination.
  await page.evaluate(() => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dest, ...args) {
      if (dest instanceof AudioDestinationNode) {
        const mute = dest.context.createGain();
        mute.gain.value = 0;
        connect.call(this, mute);
        return connect.call(mute, dest);
      }
      return connect.call(this, dest, ...args);
    };
  });
  await page.clock.install();
  await page.locator("#start").click();
  await page.locator("#auto").click();
  for (let i = 0; i < 10; i++) await page.clock.fastForward(15000);
  assert.match(await page.locator("#migration-status").textContent(), /→|到着/);
  await page.locator("#migration").click();
  assert.equal(
    await page.locator("#migration").getAttribute("aria-pressed"),
    "false",
  );
  await page.clock.fastForward(20000);
  assert.equal(
    await page.locator("#migration-status").textContent(),
    "転調なし",
  );
  await page.locator("#migration").click();
  await page.getByRole("button", { name: "候補1を採用", exact: true }).click();
  assert.match(await page.locator("#migration-status").textContent(), /約2分/);
  await page.locator("#back").click();
  await page.locator("#stop").click();
  assert.equal(
    await page.locator("#auto").getAttribute("aria-pressed"),
    "false",
  );
  const status = await page.locator("#migration-status").textContent();
  await page.clock.fastForward(180000);
  assert.equal(await page.locator("#migration-status").textContent(), status);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('[data-tab="saturation"]').click();
    assert.equal(await page.locator("#controls input").count(), 3);
    assert.equal(await page.locator("#controls select").count(), 1);
    for (let i = 0; i < 30; i++)
      await page.locator("#controls select").selectOption(String(i % 2));
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    if (process.env.OUTPUT_DIR) {
      await mkdir(process.env.OUTPUT_DIR, { recursive: true });
      await page.screenshot({
        path: `${process.env.OUTPUT_DIR}/saturation-${width}.png`,
        fullPage: true,
      });
    }
  }
  assert.deepEqual(errors, []);
  if (process.env.OUTPUT_DIR)
    await writeFile(
      `${process.env.OUTPUT_DIR}/saturation-metrics.json`,
      JSON.stringify(result, null, 2),
    );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
