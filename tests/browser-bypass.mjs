import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const b = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
try {
  const p = await b.newPage();
  await p.goto(process.env.BASE_URL || "http://127.0.0.1:8787");
  const result = await p.evaluate(async () => {
    const { Drone } = await import("./audio.js");
    window.AudioContext = class extends OfflineAudioContext {
      constructor() {
        super(2, 48000, 48000);
      }
      async resume() {}
    };
    const results = [];
    for (const post of [false, true])
      for (const settings of [
        { drive: 0, saturationMix: 1 },
        { drive: 1, saturationMix: 0 },
      ]) {
        const d = new Drone();
        d.update({ ...d.settings, ...settings });
        await d.ready();
        const stage = post ? d.postSaturation : d.preSaturation;
        stage.output.disconnect();
        stage.output.connect(d.ctx.destination);
        const source = d.ctx.createBufferSource(),
          buffer = d.ctx.createBuffer(1, 48000, 48000),
          data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++)
          data[i] = 0.1 * Math.sin(i * 0.04) + 0.05 * Math.sin(i * 0.17);
        source.buffer = buffer;
        source.connect(stage.input);
        source.start();
        const output = (await d.ctx.startRendering()).getChannelData(0);
        let diff = 0;
        for (let i = 0; i < data.length; i++)
          diff = Math.max(diff, Math.abs(data[i] - output[i]));
        results.push({ post, ...settings, diff });
      }
    return results;
  });
  console.log(result);
  result.forEach((x) => assert.equal(x.diff, 0));
} finally {
  await b.close();
}
