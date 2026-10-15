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
try {
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
    await page.clock.install();
    await page.goto(process.env.BASE_URL || "http://127.0.0.1:8787");
    assert.equal(await page.locator("#auto").count(), 1);
    await page.evaluate(() => {
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (dest, ...args) {
        if (dest instanceof AudioDestinationNode) {
          const silence = this.context.createGain();
          silence.gain.value = 0;
          connect.call(this, silence);
          return connect.call(silence, dest);
        }
        return connect.call(this, dest, ...args);
      };
    });
    await page.locator("#start").click();
    await page.waitForFunction(
      () => !document.querySelector("#instrument").hidden,
    );
    const pitches = () => page.locator("#pitches").textContent();
    const original = await pitches();
    await page.locator("#auto").click();
    assert.equal(
      await page.locator("#auto").getAttribute("aria-pressed"),
      "true",
    );
    await page.clock.fastForward(25000);
    const adopted = await pitches();
    assert.notEqual(adopted, original);
    assert.match(await page.locator("#autostatus").textContent(), /AUTO →/);
    // OFF leaves audio running and the current chord intact.
    await page.locator("#auto").click();
    await page.clock.fastForward(60000);
    assert.equal(await pitches(), adopted);
    assert.ok(await page.locator("#stop").isEnabled());
    await page.locator("#auto").click();
    const audition = page.locator("[data-preview]").first();
    await audition.focus();
    await page.keyboard.down("Enter");
    await page.clock.fastForward(60000);
    assert.equal(await pitches(), adopted);
    await page.keyboard.up("Enter");
    await page.clock.fastForward(25000);
    assert.notEqual(await pitches(), adopted);
    // Manual adoption and Undo preserve both harmonic context and fresh dwell time.
    const beforeManual = await pitches();
    await page
      .getByRole("button", { name: "候補1を採用", exact: true })
      .click();
    assert.match(await page.locator("#autostatus").textContent(), /候補 1 →/);
    await page.locator("#back").click();
    assert.equal(await pitches(), beforeManual);
    await page.clock.fastForward(1000);
    assert.equal(await pitches(), beforeManual);
    await page.locator("#edge").click();
    await page
      .getByRole("button", { name: "候補1を採用", exact: true })
      .click();
    await page.locator("#normal").click();
    assert.match(await page.locator("#candidates").textContent(), /緊張→解決/);
    await page.clock.fastForward(25000);
    assert.match(
      await page.locator("#autostatus").textContent(),
      /AUTO →.*通常/,
    );
    // Hidden tabs hold their chord; coming back starts a full interval.
    const beforeHidden = await pitches();
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.fastForward(60000);
    assert.equal(await pitches(), beforeHidden);
    assert.match(await page.locator("#autostatus").textContent(), /待機/);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.fastForward(1000);
    assert.equal(await pitches(), beforeHidden);
    await page.locator("#stop").click();
    assert.equal(
      await page.locator("#auto").getAttribute("aria-pressed"),
      "false",
    );
    await page.clock.fastForward(60000);
    assert.equal(await pitches(), beforeHidden);
    await page.locator("#resume").click();
    assert.equal(
      await page.locator("#auto").getAttribute("aria-pressed"),
      "false",
    );
    // Rapid toggles leave no callback able to advance after OFF.
    await page.evaluate(() => {
      for (let i = 0; i < 100; i++) document.querySelector("#auto").click();
    });
    await page.clock.fastForward(60000);
    assert.equal(await pitches(), beforeHidden);
    await page.locator("#auto").click();
    await page.locator("#edit").click();
    await page.locator("#start").click();
    await page.clock.fastForward(60000);
    assert.equal(await pitches(), original);
    assert.equal(
      await page.locator("#auto").getAttribute("aria-pressed"),
      "false",
    );
    assert.match(
      await page.locator("#autostatus").textContent(),
      /漂流 0% · まだ採用なし/,
    );
    const geometry = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      bottom: document.querySelector(".sound").getBoundingClientRect().bottom,
      height: innerHeight,
      canvas: document.querySelector("canvas").getBoundingClientRect().height,
    }));
    assert.equal(geometry.width, geometry.scroll);
    assert.ok(geometry.bottom <= geometry.height);
    assert.ok(geometry.canvas >= 55);
    assert.deepEqual(errors, []);
    await mkdir("artifacts", { recursive: true });
    await page.screenshot({
      path: `artifacts/auto-${name}.png`,
      fullPage: true,
    });
    results.push({ name, geometry, errors });
    await page.close();
  }
  // Real browser timers: Playwright's clock substitutes functions that mask receiver errors.
  const nativePage = await browser.newPage();
  const nativeErrors = [];
  nativePage.on('pageerror', e => nativeErrors.push(e.message));
  await nativePage.goto(process.env.BASE_URL || 'http://127.0.0.1:8787');
  await nativePage.evaluate(() => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dest, ...args) {
      if (dest instanceof AudioDestinationNode) {
        const silence = this.context.createGain(); silence.gain.value = 0;
        connect.call(this, silence); return connect.call(silence, dest);
      }
      return connect.call(this, dest, ...args);
    };
  });
  await nativePage.locator('#start').click();
  await nativePage.getByRole('slider', {name: 'Pace', exact: true}).fill('4');
  await nativePage.locator('#auto').click();
  assert.equal(await nativePage.locator('#auto').getAttribute('aria-pressed'), 'true');
  const beforeNative = await nativePage.locator('#pitches').textContent();
  await nativePage.waitForFunction(() => document.querySelector('#autostatus').textContent.includes('AUTO →'), {timeout: 8000});
  assert.notEqual(await nativePage.locator('#pitches').textContent(), beforeNative);
  await nativePage.getByRole('button', {name: '候補1を採用', exact: true}).click();
  assert.match(await nativePage.locator('#autostatus').textContent(), /候補 1 →/);
  assert.ok(await nativePage.locator('#candidates article').count() > 0);
  await nativePage.locator('#auto').click();
  await nativePage.locator('#back').click();
  await nativePage.getByRole('button', {name: '候補1を採用', exact: true}).click();
  assert.deepEqual(nativeErrors, []);
  await nativePage.close();
  // Deferred AudioContext readiness cannot arm AUTO or revive playback after Stop.
  const page = await browser.newPage();
  await page.goto(process.env.BASE_URL || "http://127.0.0.1:8787");
  await page.evaluate(() => {
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () {
      return new Promise((resolve) => {
        window.finishResume = () => resume.call(this).then(resolve);
      });
    };
    document.querySelector("#start").click();
    document.querySelector("#auto").click();
    document.querySelector("#stop").click();
  });
  await page.waitForFunction(() => typeof window.finishResume === "function");
  await page.evaluate(() => window.finishResume());
  assert.equal(
    await page.locator("#auto").getAttribute("aria-pressed"),
    "false",
  );
  assert.ok(await page.locator("#stop").isDisabled());
  await page.close();
  console.log(JSON.stringify(results, null, 2));
  await writeFile(
    "artifacts/auto-results.json",
    JSON.stringify(results, null, 2),
  );
} finally {
  await browser.close();
}
