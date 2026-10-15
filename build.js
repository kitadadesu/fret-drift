import { mkdir, copyFile, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist");
for (const f of [
  "index.html",
  "style.css",
  "app.js",
  "hold.js",
  "music.js",
  "audio.js",
  "harmony.js",
  "chords.js",
  "notes.js",
])
  await copyFile(f, `dist/${f}`);
console.log("Built static instrument → dist/");
