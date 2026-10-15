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
  const page = await browser.newPage({ viewport: { width, height } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE_URL);
  // Read output without connecting it to hardware speakers; WebAudio graph is real.
  await page.evaluate(() => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...args) {
      if (destination instanceof AudioDestinationNode) return destination;
      return connect.call(this, destination, ...args);
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
  await page.waitForTimeout(2800);
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
  await page.waitForTimeout(2700);
  assert.equal(await page.locator("#pitches").innerText(), original);
  await page.locator("#stop").click();
  await page.getByRole("button", { name: "候補1を試聴", exact: true }).click();
  await page.waitForTimeout(2800);
  assert.equal(await page.locator("#status").innerText(), "■ STOPPED");
  await page.locator("#resume").click();
  await page.keyboard.press("1");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.locator("#pitches").innerText(), original);
  await page.locator('[data-tab="space"]').click();
  await page
    .getByRole("slider", { name: "Delay wet", exact: true })
    .fill("0.3");
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    canvas: document.querySelector("canvas").getBoundingClientRect().height,
    bottom: document.querySelector(".sound").getBoundingClientRect().bottom,
    height: innerHeight,
  }));
  assert.equal(geometry.scroll, width);
  assert.ok(geometry.canvas >= 55);
  assert.equal(errors.length, 0);
  await page.screenshot({ path: `artifacts/${name}.png`, fullPage: true });
  results.push({ name, initialKey, first, edge, shuffled, geometry, errors });
  await page.close();
}
await browser.close();
await writeFile(
  "artifacts/browser-results.json",
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
