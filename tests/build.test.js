import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, cp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

test("deploy assets invalidate the whole module graph when UI changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "fret-drift-build-"));
  try {
    const files = ["build.js", "index.html", "style.css", "app.js", "autoplay.js", "hold.js",
      "music.js", "audio.js", "harmony.js", "chords.js", "notes.js"];
    await Promise.all(files.map(file => cp(new URL(`../${file}`, import.meta.url), join(root, file))));
    await writeFile(join(root, "package.json"), '{"type":"module"}');
    const build = () => execFileSync(process.execPath, ["build.js"], {cwd: root});
    build();
    const before = await readdir(join(root, "dist"));
    build();
    assert.deepEqual(await readdir(join(root, "dist")), before, "identical sources have stable URLs");
    await writeFile(join(root, "app.js"), (await readFile(join(root, "app.js"), "utf8")) + "\n// next UI release\n");
    build();
    const after = await readdir(join(root, "dist"));
    assert.equal(after.filter(file => before.includes(file)).length, 1, "only index.html keeps its name");
    for (const file of after) {
      const content = await readFile(join(root, "dist", file), "utf8");
      for (const match of content.matchAll(/["'](?:\.\/)?([\w.-]+\.(?:js|css))["']/g))
        assert.ok(after.includes(match[1]), `${file} references a missing or stale asset: ${match[1]}`);
    }
    const app = await readFile(join(root, "dist", after.find(f => f.startsWith("app."))), "utf8");
    assert.match(app, /"bloom", "Bloom"/);
    assert.ok(!after.includes("app.js") && !after.includes("audio.js"));
  } finally { await rm(root, {recursive: true, force: true}); }
});
