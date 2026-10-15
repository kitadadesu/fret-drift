// Adapted from kitadadesu/chord-atlas src/lib/music/chords.ts at 5013cdb.
import { mod12, pcName } from "./notes.js";

/** Role label of an interval in a given interpretation */

/** Build a chord interpretation from an interval set relative to a root. */
export function interpretIntervals(intervals) {
  const has = (i) => intervals.has(i);
  const used = new Set([0]);
  const roles = [{ interval: 0, role: "R" }];
  const implied = [];
  const notes = [];
  let score = 0;
  const take = (i, role) => {
    used.add(i);
    roles.push({ interval: i, role });
  };

  // ---- third
  let third;
  if (has(4)) {
    third = "M";
    take(4, "3");
  } else if (has(3)) {
    third = "m";
    take(3, "b3");
  } else if (has(5)) {
    third = "sus4";
    take(5, "4");
    score += 0.8;
    notes.push("3度がないため sus4 として解釈");
  } else if (has(2)) {
    third = "sus2";
    take(2, "2");
    score += 0.9;
    notes.push("3度がないため sus2 として解釈");
  } else {
    third = "none";
    score += 2.2;
    notes.push("3度（長短）がなく、長短の性格は不確定");
    implied.push({ interval: 4, role: "3 / b3" });
  }

  // ---- fifth
  let fifth;
  if (has(7)) {
    fifth = "P";
    take(7, "5");
  } else if (third === "m" && has(6)) {
    fifth = "b5";
    take(6, "b5");
  } else if (third === "M" && has(8) && !has(9)) {
    fifth = "#5";
    take(8, "#5");
  } else if (
    third !== "m" &&
    has(6) &&
    !has(5) &&
    third !== "sus4" &&
    !has(8)
  ) {
    fifth = "b5";
    take(6, "b5");
    score += 0.8;
  } else {
    fifth = "none";
    score += 0.5;
    implied.push({ interval: 7, role: "5" });
    notes.push("5度は省略（ヴォイシング上よくある省略）");
  }

  // ---- seventh / sixth
  let seventh = "none";
  if (has(11)) {
    seventh = "maj7";
    take(11, "7");
  } else if (has(10)) {
    seventh = "b7";
    take(10, "b7");
  } else if (third === "m" && fifth === "b5" && has(9)) {
    seventh = "dim7";
    take(9, "bb7");
  } else if (has(9) && fifth !== "#5") {
    seventh = "6";
    take(9, "6");
  }
  if (has(11) && has(10)) {
    score += 2;
  } // b7 & 7 both → odd

  // ---- tensions
  const tensions = [];
  const tens = (i, label, natural) => {
    if (!has(i) || used.has(i)) return;
    take(i, label);
    tensions.push({ i, label, natural });
  };
  tens(1, "b9", false);
  if (third !== "sus2") tens(2, "9", true);
  if (third === "M") tens(3, "#9", false);
  if (third !== "sus4") tens(5, "11", true);
  tens(6, fifth === "P" || third === "sus4" ? "#11" : "b5", false);
  tens(8, fifth === "P" || seventh !== "none" ? "b13" : "#5", false);
  tens(9, "13", true);
  tens(10, "b7", false);
  tens(3, "b3", false);

  const has7 = seventh === "maj7" || seventh === "b7";
  const natural = tensions.filter((t) => t.natural).map((t) => t.label);
  const altered = tensions.filter((t) => !t.natural).map((t) => t.label);

  // ---- name assembly
  let q = "";
  let triad = "";
  if (third === "m")
    triad =
      fifth === "b5" && seventh !== "b7" && seventh !== "dim7" ? "dim" : "m";
  if (third === "M" && fifth === "#5" && !has7) triad = "aug";
  if (third === "m" && fifth === "b5" && seventh === "dim7") triad = "dim";

  let ext = "";
  if (has7) {
    let top = 7;
    if (natural.includes("13")) top = 13;
    else if (natural.includes("11")) top = 11;
    else if (natural.includes("9")) top = 9;
    if (top >= 11 && !natural.includes("9"))
      implied.push({ interval: 2, role: "9" });
    if (top === 13 && !natural.includes("11") && third === "m") {
      /* m13 often omits 11; fine */
    }
    const shown = new Set();
    if (top >= 9) shown.add("9");
    if (top >= 11) shown.add("11");
    if (top >= 13) shown.add("13");
    const leftoverNatural = natural.filter((n) => !shown.has(n));
    if (seventh === "maj7") ext = third === "m" ? `mMaj${top}` : `maj${top}`;
    else if (third === "m" && fifth === "b5") ext = `m${top}b5`;
    else ext = (third === "m" ? "m" : "") + `${top}`;
    triad = "";
    q = ext;
    if (fifth === "#5") altered.unshift("#5");
    else if (fifth === "b5" && third !== "m") altered.unshift("b5");
    leftoverNatural.forEach((n) => altered.push(`add${n}`));
  } else if (seventh === "dim7") {
    q = "dim7";
    natural.forEach((n) => altered.push(n));
  } else if (seventh === "6") {
    q = (third === "m" ? "m" : "") + (natural.includes("9") ? "6/9" : "6");
    natural.filter((n) => n !== "9").forEach((n) => altered.push(`add${n}`));
    if (fifth === "b5") altered.unshift("b5");
  } else {
    q = triad;
    natural.forEach((n) => altered.push(`add${n}`));
    if (fifth === "b5" && triad !== "dim") altered.unshift("b5");
  }
  if (third === "sus4") q += "sus4";
  if (third === "sus2") q += "sus2";
  if (third === "none")
    q += fifth === "P" && intervals.size === 1 ? "5" : "(no3)";

  // separate add-tones and alterations
  const adds = altered.filter((a) => a.startsWith("add"));
  const alts = altered.filter((a) => !a.startsWith("add"));
  // single add on simple triad written without parens: "add9"
  if (adds.length === 1 && !q.includes("(")) {
    q += adds[0];
    if (alts.length) q += `(${alts.join(",")})`;
  } else {
    const parts = [...alts, ...adds];
    if (parts.length) q += `(${parts.join(",")})`;
  }

  score += tensions.filter((t) => t.natural).length * 0.35;
  score += tensions.filter((t) => !t.natural).length * 1.0;
  if (fifth === "b5" && third === "M") score += 0.6;
  if (fifth === "#5") score += 0.4;
  if (seventh === "6") score += 0.2;
  // implied 5th of perfect expected
  return { quality: q, roles, implied, notes, score };
}

const INVERSION_NAMES = {
  3: "第1転回形（3度ベース）",
  b3: "第1転回形（3度ベース）",
  5: "第2転回形（5度ベース）",
  b5: "第2転回形（5度ベース）",
  "#5": "第2転回形（5度ベース）",
  b7: "第3転回形（7度ベース）",
  7: "第3転回形（7度ベース）",
  bb7: "第3転回形（7度ベース）",
};

/**
 * Rank chord-name interpretations. Every pitch class present is tried as a root.
 * Score is a heuristic ordering only — not a confidence percentage.
 */
export function analyzeChord(pcs, bassPc) {
  if (pcs.length === 0 || bassPc === null) return [];
  const out = [];
  for (const root of pcs) {
    const intervals = new Set(pcs.map((p) => mod12(p - root)));
    intervals.delete(0);
    const a = interpretIntervals(intervals);
    const isSlash = root !== bassPc;
    const roles = a.roles.map((r) => ({ ...r, pc: mod12(root + r.interval) }));
    const bassRole = roles.find((r) => r.pc === bassPc)?.role ?? "";
    let score = a.score;
    let inversion = null;
    const notes = [...a.notes];
    if (isSlash) {
      inversion =
        INVERSION_NAMES[bassRole] ?? `オンベース（ベースは ${bassRole}）`;
      score += INVERSION_NAMES[bassRole] ? 1.2 : 1.8;
      notes.unshift(`最低音がルートではない → ${inversion}`);
    } else {
      notes.unshift("最低音＝ルート（基本形）");
    }
    if (pcs.length === 1) notes.push("単音のためコードとしては未確定");
    if (pcs.length === 2)
      notes.push("2音のみ：インターバル（ダイアド）であり、コード名は文脈依存");
    const missing = a.implied.map((m) => ({
      ...m,
      pc: mod12(root + m.interval),
    }));
    out.push({
      root,
      bass: bassPc,
      quality: a.quality,
      name: (acc) =>
        `${pcName(root, acc)}${a.quality}${isSlash ? `/${pcName(bassPc, acc)}` : ""}`,
      roles,
      missing,
      notes,
      score: Math.round(score * 100) / 100,
      isSlash,
      inversion,
    });
  }
  return out.sort(
    (x, y) => x.score - y.score || x.quality.length - y.quality.length,
  );
}
