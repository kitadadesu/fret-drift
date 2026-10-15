import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";

// Version the entire module graph together: a fresh HTML document must never
// reuse cached UI/audio modules from an earlier release.
const files = [
  "index.html", "style.css", "app.js", "autoplay.js", "hold.js", "music.js",
  "audio.js", "harmony.js", "chords.js", "notes.js",
];
const sources = new Map(await Promise.all(files.map(async file =>
  [file, await readFile(file, "utf8")])));
const hash = createHash("sha256");
for (const [file, source] of sources) hash.update(file).update("\0").update(source).update("\0");
const version = hash.digest("hex").slice(0, 16);
const names = new Map(files.map(file => [file,
  file === "index.html" ? file : file.replace(/\.(js|css)$/, `.${version}.$1`)]));
await rm("dist", { recursive: true, force: true });
await mkdir("dist");
for (const [file, source] of sources) {
  const content = source.replace(/(["'])(\.\/)?([\w-]+\.(?:js|css))\1/g,
    (match, quote, relative, target) => names.has(target)
      ? `${quote}${relative || ""}${names.get(target)}${quote}` : match);
  await writeFile(`dist/${names.get(file)}`, content);
}
console.log(`Built static instrument → dist/ (${version})`);
