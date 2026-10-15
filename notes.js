// Adapted from kitadadesu/chord-atlas src/lib/music/notes.ts at 5013cdb.
export const SHARP_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
export const FLAT_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const mod12 = (n) => ((n % 12) + 12) % 12;

export function pcName(pc, acc) {
  return (acc === "sharp" ? SHARP_NAMES : FLAT_NAMES)[mod12(pc)];
}

/** "A#/Bb" for black keys, single name otherwise */
export function pcBothNames(pc) {
  const s = SHARP_NAMES[mod12(pc)];
  const f = FLAT_NAMES[mod12(pc)];
  return s === f ? s : `${s}/${f}`;
}

/** MIDI 60 = C4 (scientific pitch notation) */
export function midiOctave(midi) {
  return Math.floor(midi / 12) - 1;
}

export function midiName(midi, acc) {
  return `${pcName(midi, acc)}${midiOctave(midi)}`;
}

export function midiBothNames(midi) {
  const o = midiOctave(midi);
  const s = SHARP_NAMES[mod12(midi)];
  const f = FLAT_NAMES[mod12(midi)];
  return s === f ? `${s}${o}` : `${s}${o}/${f}${o}`;
}

/** Parse "E2", "C#4", "Bb3", "e♭3". Octave required. */
export function parseNote(input) {
  const s = input.trim().replace("♯", "#").replace("♭", "b");
  const m = /^([A-Ga-g])(#|b|##|bb)?(-?\d)$/.exec(s);
  if (!m)
    return {
      ok: false,
      error: `「${input}」は音名+オクターブ（例: E2, C#4, Bb3）で入力してください`,
    };
  const letter = m[1].toUpperCase();
  const acc = m[2] ?? "";
  const oct = parseInt(m[3], 10);
  const shift =
    acc === "#"
      ? 1
      : acc === "##"
        ? 2
        : acc === "b"
          ? -1
          : acc === "bb"
            ? -2
            : 0;
  const midi = (oct + 1) * 12 + LETTER_PC[letter] + shift;
  if (midi < 12 || midi > 108)
    return { ok: false, error: `「${input}」は音域外です` };
  return { ok: true, value: midi };
}
