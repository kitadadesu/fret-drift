import { note, parse, voicing, analyze, mod12 } from "./music.js";
import {
  createContext,
  selectKey,
  accept,
  centerKey,
  keyId,
  keyLabel,
  modalReadings,
  propose,
  soundKey,
  scaleOf,
} from "./harmony.js";
import { bindHold } from "./hold.js";
import {
  AutoClock,
  initialDrift,
  advanceDrift,
  chooseNext,
  intervalMs,
} from "./autoplay.js";
import { Drone } from "./audio.js";
const $ = (id) => document.getElementById(id),
  engine = new Drone();
let current = [],
  previous = [],
  history = [],
  choices = [],
  edge = false,
  seed = 0,
  previewIndex = -1,
  active = false,
  tab = "tone",
  context = null,
  seen = [],
  choiceNames = [],
  currentName = null,
  runGeneration = 0;

let drift = initialDrift();
const autoSettings = { pace: 12, wander: 0.5, edge: 0.25 };
let lastMode = "normal",
  lastAdoption = "まだ採用なし";
const auto = new AutoClock({
  ready: () =>
    active &&
    engine.running &&
    engine.ctx?.state === "running" &&
    context &&
    !document.hidden &&
    !$("instrument").hidden,
  delay: () => intervalMs(previous, current, lastMode, autoSettings.pace),
  changed: autoDisplay,
  tick: () => {
    const next = chooseNext(current, context, drift, autoSettings);
    if (!next) {
      auto.stop();
      return;
    }
    const { candidate, mode: nextMode } = next;
    commit(candidate.voicing, candidate.name, nextMode, "AUTO");
    // Edge is a single event; the next pool uses the accepted resolution anchor.
    edge = false;
    $("normal").setAttribute("aria-pressed", true);
    $("edge").setAttribute("aria-pressed", false);
    display();
    proposals();
  },
});
function autoDisplay() {
  $("auto").setAttribute("aria-pressed", auto.enabled);
  $("auto").textContent = `AUTO PLAY ${auto.enabled ? "ON" : "OFF"}`;
  $("autostatus").textContent =
    `${auto.enabled ? (auto.paused || document.hidden || engine.ctx?.state !== "running" ? "AUTO 待機" : "AUTO 演奏中") : "AUTO 停止"} · 漂流 ${(drift.wander * 100).toFixed(0)}% · ${lastAdoption}`;
}
$("auto").onclick = () => {
  auto.enabled ? auto.stop() : auto.start();
};
for (const key of ["pace", "wander", "edge"]) {
  const input = $("auto-" + key);
  input.oninput = () => {
    autoSettings[key] = +input.value;
    $("auto-" + key + "-value").textContent =
      key === "pace" ? input.value + "s" : Math.round(+input.value * 100) + "%";
    auto.replan();
  };
}
const freshSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const presets = [
  [40, 45, 50, 55, 59, 64],
  [40, 45, 50, 55, 60, 64],
  [38, 45, 50, 55, 59, 64],
  [38, 45, 50, 55, 57, 62],
  [38, 45, 50, 54, 57, 62],
];
function strings(t = presets[0], f = [0, 2, 2, 0, 0, 0]) {
  $("strings").replaceChildren(
    ...t.map((n, i) => {
      const l = document.createElement("label");
      l.className = "string";
      l.innerHTML = `${6 - i}弦<input aria-label="${6 - i}弦の調弦" value="${note(n)}" spellcheck="false"><input aria-label="${6 - i}弦のフレット" value="${f[i] ?? "x"}" inputmode="text">`;
      return l;
    }),
  );
}
strings();
$("preset").onchange = (e) => strings(presets[e.target.selectedIndex]);
function cancelPreview() {
  const wasPreviewing = previewIndex >= 0;
  previewIndex = -1;
  if (wasPreviewing && active) engine.move(current);
  if (wasPreviewing) auto.pause(false);
  $("status").textContent = active ? "● DRIFTING" : "■ STOPPED";
}
function display() {
  autoDisplay();
  $("chord").textContent = currentName ?? analyze(current);
  $("pitches").textContent = current
    .map((n) => (n === null ? "—" : note(n)))
    .join(" / ");
  $("auto").disabled = !active;
  $("back").disabled = !history.length;
  $("stop").disabled = !active;
  $("resume").disabled = active;
  document.querySelectorAll("[data-preview]").forEach((b) => {
    b.disabled = !active;
    b.textContent = active ? "押して試聴" : "再開して試聴";
  });
  const motion = current.reduce(
    (s, n, i) =>
      s + (n !== null && previous[i] != null ? Math.abs(n - previous[i]) : 0),
    0,
  );
  $("motion").textContent =
    `${current.filter((n) => n !== null).length} voices · Δ ${motion} st`;
}
function analysisDisplay() {
  $("interpretation").replaceChildren(
    ...context.keys.map((k) => {
      const option = document.createElement("option");
      option.value = keyId(k);
      option.textContent = `${keyLabel(k)} · score ${k.score.toFixed(1)} · 相対支持 ${(k.support * 100).toFixed(0)}%`;
      option.selected = keyId(k) === context.center;
      return option;
    }),
  );
  $("keyhint").textContent =
    `${context.steps < 2 ? "1コードの解釈は未確定 · " : ""}${modalReadings(current).slice(0, 2).join(" / ")} · 原点 ${analyze(context.origin)} · 大点＝音階内 / 小点＝音階外`;
  $("keyfield").replaceChildren(
    ...context.keys.slice(0, 3).map((k) => {
      const el = document.createElement("span");
      el.textContent = keyLabel(k);
      el.style.setProperty("--support", `${Math.round(k.support * 100)}%`);
      return el;
    }),
  );
}
$("interpretation").onchange = (e) => {
  cancelPreview();
  if (active) engine.move(current);
  context = selectKey(context, e.target.value);
  seen = [];
  seed = freshSeed();
  proposals();
  auto.replan();
};
function proposals() {
  analysisDisplay();
  const details = propose(current, context, edge, seed, seen);
  choices = details.map((c) => c.voicing);
  choiceNames = details.map((c) => c.name);
  seen = [...seen, ...choices.map(soundKey)].slice(-96);
  $("candidates").replaceChildren(
    ...choices.map((v, i) => {
      const el = document.createElement("article");
      el.className = "candidate";
      el.innerHTML = `<strong>${details[i].name}</strong><small>${details[i].reasons.join(" · ")}<br>${v
        .filter((n) => n !== null)
        .map(note)
        .join(
          " ",
        )}</small><div><button aria-label="候補${i + 1}を試聴">試聴</button><button aria-label="候補${i + 1}を採用">${i + 1} ↗ 採用</button></div>`;
      const audition = el.querySelectorAll("button")[0];
      audition.dataset.preview = "";
      audition.disabled = !active;
      audition.textContent = active ? "押して試聴" : "再開して試聴";
      bindHold(
        audition,
        () => preview(i),
        () => {
          if (previewIndex === i) cancelPreview();
        },
      );
      el.querySelectorAll("button")[1].onclick = () => adopt(i);
      return el;
    }),
  );
}
async function run(v) {
  const id = ++runGeneration;
  try {
    await engine.play(v);
    if (id !== runGeneration) return null;
    if (engine.ctx) engine.ctx.onstatechange = () => auto.replan();
    if (engine.running) engine.move(current);
    return engine.running;
  } catch (e) {
    if (id !== runGeneration) return null;
    engine.stop();
    active = false;
    auto.stop();
    $("status").textContent = "音声を開始できません。再開を押してください。";
    display();
    return false;
  }
}
$("start").onclick = async () => {
  const ls = [...$("strings").children],
    t = ls.map((l) => parse(l.children[0].value)),
    f = ls.map((l) => {
      const s = l.children[1].value.trim();
      return /^x$/i.test(s) ? null : /^\d{1,2}$/.test(s) && +s <= 24 ? +s : NaN;
    });
  if (t.includes(null) || f.some(Number.isNaN) || f.every((n) => n === null)) {
    $("error").textContent =
      "調弦は E2 / Bb3 など。フレットは0–24かx、1弦以上を鳴らしてください。";
    return;
  }
  auto.stop();
  drift = initialDrift();
  lastAdoption = "まだ採用なし";
  lastMode = "normal";
  $("error").textContent = "";
  cancelPreview();
  engine.stop();
  current = voicing(t, f);
  currentName = null;
  previous = [...current];
  history = [];
  context = createContext(current);
  seen = [];
  seed = freshSeed();
  const running = await run(current);
  if (running === null) return;
  active = running;
  $("setup").hidden = true;
  $("instrument").hidden = false;
  $("status").textContent = active ? "● DRIFTING" : "停止中";
  display();
  proposals();
};
function preview(i) {
  if (!active || !choices[i]) return;
  auto.pause(true);
  previewIndex = i;
  engine.move(choices[i]);
  $("status").textContent = `◉ 候補 ${i + 1} を試聴中（離すと戻る）`;
}
function commit(v, name, adoptedMode, source) {
  cancelPreview();
  history.push({
    voicing: [...current],
    name: currentName,
    context: structuredClone(context),
    seen: [...seen],
    seed,
    drift: { ...drift },
    lastMode,
    lastAdoption,
  });
  if (history.length > 100) history.shift();
  previous = [...current];
  current = [...v];
  currentName = name;
  drift = advanceDrift(
    drift,
    previous,
    current,
    adoptedMode,
    autoSettings.wander,
  );
  lastMode = adoptedMode;
  lastAdoption = `${source} → ${name}（${adoptedMode === "edge" ? "キワキワ" : "通常"}）`;
  context = accept(context, current, adoptedMode);
  seen = [];
  seed++;
  if (active) engine.move(current);
  $("status").textContent = active ? "● DRIFTING" : "停止中";
  auto.replan();
}
function adopt(i) {
  if (!choices[i]) return;
  commit(choices[i], choiceNames[i], edge ? "edge" : "normal", `候補 ${i + 1}`);
  display();
  proposals();
}
function stop() {
  auto.stop();
  runGeneration++;
  cancelPreview();
  engine.stop();
  active = false;
  $("status").textContent = "■ STOPPED";
  display();
}
$("stop").onclick = stop;
$("resume").onclick = async () => {
  cancelPreview();
  if (!current.length) return;
  const running = await run(current);
  if (running === null) return;
  active = running;
  $("status").textContent = active ? "● DRIFTING" : "停止中";
  display();
};
$("back").onclick = () => {
  if (!history.length) return;
  cancelPreview();
  previous = [...current];
  const saved = history.pop();
  current = saved.voicing;
  currentName = saved.name;
  context = saved.context;
  seen = saved.seen;
  seed = saved.seed;
  drift = saved.drift;
  lastMode = saved.lastMode;
  lastAdoption = saved.lastAdoption;
  auto.replan();
  if (active) engine.move(current);
  display();
  proposals();
};
$("edit").onclick = () => {
  stop();
  $("setup").hidden = false;
  $("instrument").hidden = true;
};
function mode(e) {
  edge = e;
  seed = freshSeed();
  seen = [];
  cancelPreview();
  if (active) engine.move(current);
  $("normal").setAttribute("aria-pressed", !e);
  $("edge").setAttribute("aria-pressed", e);
  proposals();
  auto.replan();
}
$("normal").onclick = () => mode(false);
$("edge").onclick = () => mode(true);
$("shuffle").onclick = () => {
  cancelPreview();
  if (active) engine.move(current);
  seed++;
  proposals();
  auto.replan();
};
const controls = {
  tone: [
    ["glide", "Glide", 0.02, 8, 0.01, "s"],
    ["detune", "Detune", 0, 30, 1, "ct"],
    ["attack", "Attack", 0.01, 4, 0.01, "s"],
    ["decay", "Decay", 0.01, 4, 0.01, "s"],
    ["sustain", "Sustain", 0, 1, 0.01, ""],
    ["release", "Release", 0.03, 5, 0.01, "s"],
    ["volume", "Volume", 0, 1, 0.01, ""],
  ],
  spectrum: [
    ["bloom", "Bloom", 0, 1, 0.01, ""],
    ["harmonics", "Harmonics", 0, 1, 0.01, ""],
    ["inharmonicity", "Inharmonicity", 0, 1, 0.01, ""],
    ["drift", "Spectral Drift", 0, 1, 0.01, ""],
  ],
  space: [
    ["reverb", "Reverb wet", 0, 1, 0.01, ""],
    ["delay", "Delay wet", 0, 0.7, 0.01, ""],
    ["time", "Delay time", 0.05, 1.5, 0.01, "s"],
    ["feedback", "Feedback", 0, 0.65, 0.01, ""],
  ],
};
function renderControls() {
  $("controls").replaceChildren(
    ...controls[tab].map(([k, title, min, max, step, unit]) => {
      const l = document.createElement("label");
      l.textContent = title;
      const out = document.createElement("output");
      out.textContent = engine.settings[k] + unit;
      const input = document.createElement("input");
      Object.assign(input, {
        type: "range",
        min,
        max,
        step,
        value: engine.settings[k],
      });
      input.setAttribute("aria-label", title);
      input.title =
        {
          bloom:
            "澄んだ基音の背後から、約12秒かけて倍音が花開く。0でBloomなし。",
          harmonics:
            "0で元の透明な音色。上げると鐘・ガラスのような部分音を追加。",
          inharmonicity:
            "0で整数倍。上げるほど部分音の比率をずらし、金属的な響きに。",
          drift:
            "0で全てGlideと同じ速度。上げると部分音ごとに移動速度が分かれます。",
        }[k] || title;
      input.oninput = () => {
        engine.update({ ...engine.settings, [k]: +input.value });
        out.textContent = (+input.value).toFixed(k === "detune" ? 0 : 2) + unit;
      };
      l.append(out, input);
      return l;
    }),
  );
}
document.querySelectorAll("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      tab = b.dataset.tab;
      document
        .querySelectorAll("[data-tab]")
        .forEach((x) => x.setAttribute("aria-pressed", x === b));
      renderControls();
    }),
);
renderControls();
document.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "Escape") {
    stop();
    return;
  }
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if ($("instrument").hidden) return;
  if (e.code === "Space") {
    if (e.target.tagName === "BUTTON") return;
    e.preventDefault();
    active ? stop() : $("resume").click();
  }
  if (/^[1-4]$/.test(e.key)) adopt(+e.key - 1);
  if (e.code === "ArrowLeft") {
    e.preventDefault();
    $("back").click();
  }
});
window.addEventListener("blur", cancelPreview);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) cancelPreview();
  auto.replan();
});
window.addEventListener("pagehide", () => {
  auto.stop();
  runGeneration++;
  active = false;
  cancelPreview();
  void engine.dispose();
});
const canvas = $("field"),
  ctx = canvas.getContext("2d"),
  points = Array(6).fill(null),
  colors = ["#b9efc2", "#82d5cb", "#b0b6f1", "#d2b8e5", "#e8c799", "#dfaaa4"];
let last = 0;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
function draw(now) {
  requestAnimationFrame(draw);
  if ($("instrument").hidden || now - last < (reduced ? 100 : 30)) return;
  last = now;
  const r = canvas.getBoundingClientRect(),
    d = Math.min(devicePixelRatio, 2);
  if (
    canvas.width !== Math.round(r.width * d) ||
    canvas.height !== Math.round(r.height * d)
  ) {
    canvas.width = Math.round(r.width * d);
    canvas.height = Math.round(r.height * d);
  }
  ctx.setTransform(d, 0, 0, d, 0, 0);
  const w = r.width,
    h = r.height;
  ctx.clearRect(0, 0, w, h);
  const sounding = previewIndex >= 0 ? choices[previewIndex] : current;
  const ns = sounding.filter((n) => n !== null),
    lo = Math.min(32, ...ns) - 4,
    hi = Math.max(76, ...ns) + 4;
  for (let m = Math.ceil(lo / 12) * 12; m < hi; m += 12) {
    const y = h - 15 - ((m - lo) / (hi - lo)) * (h - 30);
    ctx.strokeStyle = "#31404466";
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillStyle = "#6f8587";
    ctx.font = "9px sans-serif";
    ctx.fillText(note(m), 2, y - 3);
  }
  const keyScale = scaleOf(centerKey(context));
  sounding.forEach((n, i) => {
    if (n === null) {
      points[i] = null;
      return;
    }
    const target = h - 15 - ((n - lo) / (hi - lo)) * (h - 30);
    points[i] =
      points[i] === null
        ? target
        : points[i] + (target - points[i]) * (reduced ? 1 : 0.06);
    const y = points[i],
      x = 50 + (i * (w - 100)) / 5;
    ctx.strokeStyle = colors[i] + "55";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(25, y);
    ctx.bezierCurveTo(
      x * 0.5,
      y + (active ? Math.sin(now / 1000 + i) * 9 : 0),
      x * 0.8,
      y,
      x,
      y,
    );
    ctx.lineTo(w - 15, y);
    ctx.stroke();
    ctx.shadowBlur = active ? 18 : 0;
    ctx.shadowColor = colors[i];
    ctx.fillStyle = colors[i];
    ctx.beginPath();
    ctx.arc(x, y, keyScale.includes(mod12(n)) ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.font = "10px sans-serif";
    ctx.fillText(`${6 - i} · ${note(n)}`, x + 9, y - 8);
    const from = previewIndex >= 0 ? current[i] : previous[i];
    if (from !== null && from !== undefined && from !== n) {
      const start = h - 15 - ((from - lo) / (hi - lo)) * (h - 30);
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = colors[i] + "99";
      ctx.beginPath();
      ctx.moveTo(x, start);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
  if (engine.analyser && active) {
    const data = new Uint8Array(engine.analyser.frequencyBinCount);
    engine.analyser.getByteTimeDomainData(data);
    ctx.beginPath();
    ctx.strokeStyle = "#bbf4c43a";
    data.forEach((v, i) => {
      const x = (i / data.length) * w,
        y = h * 0.5 + ((v - 128) / 128) * h * 0.7;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
}
requestAnimationFrame(draw);
