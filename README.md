# Fret Drift

Independent, buildless six-string ambient instrument. Choose your initial tuning and frets; enter a one-screen drone performance with per-string continuous portamento, normal/edge suggestions, temporary previews, adoption and history.

## Run

Serve this directory with any static HTTP server. Node 22+: `npm test` and `npm run build`. No dependencies. Deploy `dist/` to static hosting, or enable GitHub Pages → GitHub Actions for the included workflow.

## Play

Tuning inputs accept note + octave (E2, Bb3). Frets accept 0–24 or x. Start explicitly unlocks Web Audio. Hold a preview button (pointer, touch, Space or Enter) to glide to that candidate; release to return to the saved drone. Preview is disabled while stopped; use Resume first. Leaving the window, hiding the page or cancelling a touch also restores the saved drone. Adoption commits the selected six-string voicing. Space toggles transport, 1–4 adopt, left arrow returns, Escape stops. Keyboard shortcuts do not override focused form controls. Tone and Space tabs keep all controls accessible on small screens. Very short viewports allow page scrolling to preserve control accessibility.

ADSR applies to new voices; surviving string voices glide without retriggering. Release fades muted voices while retaining their oscillators for safe reversal; unmuting follows Attack/Decay. Stop follows Release and silences effect tails. Restart clears retiring voices before opening the output again. Two detuned sine oscillators per string, gain bounded per oscillator, filtered feedback limited to 0.65, delay 0.05–1.5s, compressor before destination. Settings update with smoothing. No microphone, account, analytics or server storage.

## Harmonic context

Initial MIDI is analyzed as several chord names and all 12 major / 12 natural-minor keys. The interpretation selector is an assumption you can change, not a detected fact. Relative support is a normalized ranking heuristic, not a probability. For EADGCE `680700`, actual MIDI is Bb2 F3 D3 D4 C4 E4: Bbadd9(#11), with the F-major / D-minor pitch collection and a Bb-Lydian reading.

Normal proposals combine full-voice scale-degree transformations with complete triads, sevenths, extended/add-tone chords, restrained borrowing and secondary dominants. Edge proposals require outside-scale color, including parallel-mode borrowing, altered dominants, tritone substitutions and chromatic harmonies. Complete-set voicing optimization preserves six aligned slots, mutes, target tones and duplicate voices; per-string jumps are limited to seven semitones. Source MIDI is retained separately from unique pitch-class analysis.

Only adoption updates harmonic context, including whether normal or edge was actually adopted. Immediately after edge adoption B, normal proposals use A (the preceding accepted chord), the pre-B inferred key, B’s chromatic motion and tension relief, and B→C voice leading. Each subsequent edge adoption captures its own preceding A; preview, mode switches and rerolls cannot activate this context. Normal adoption consumes it and Undo restores it. A manual key change also updates the resolution interpretation.

Only adoption updates harmonic context. Recent accepted MIDI, functional transitions, motifs and a fading origin influence rank the next proposals. Smoothed key scores and a switching margin reduce one-chord oscillation while allowing drift. Back restores the MIDI, key state and original chord. The origin is stored independently even after bounded recent history is exhausted. Previews, rerolls and tuning edits never rewrite it. Session state is in memory.

The field shows actual string pitches, movement traces and scale membership (large dots inside, small outside), with relative key-support bars. Candidate names describe the actual notes; alternative roots/inversions remain possible. Sound-distinct weighted rerolls use a fresh random session seed and avoid recently shown sounds when the eligible pool allows it.

## Reference and independence

Theory adapted from read-only `kitadadesu/chord-atlas` at `5013cdb35ac0f50ed28e03a704a100a7e211eddf`, including the chord interpretation and note modules. See [engineering and verification notes](docs/harmony.md) for all eight source modules reviewed, algorithms, limits and reproducible validation. Guitar fingering constraints are deliberately replaced with bounded per-string synthesizer voicing. These are experimental voice transformations, not guaranteed guitar-playable fingerings. Existing six-voice continuous WebAudio, glide, detune, ADSR, reverb and delay remain in audio.js. No Fret Atlas repository files were modified. Font loading uses Google Fonts with system fallbacks.

Musical quality is subjective; this implementation does not claim proven parity with Atlas by listening. Tests establish structural and contextual properties, not aesthetic quality.
