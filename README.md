# Fret Drift

Independent, buildless six-string ambient instrument. Choose your initial tuning and frets; enter a one-screen drone performance with per-string continuous portamento, normal/edge suggestions, temporary previews, adoption and history.

## Run

Serve this directory with any static HTTP server. Node 22+: `npm test` and `npm run build`. No dependencies. Deploy `dist/` to static hosting, or enable GitHub Pages → GitHub Actions for the included workflow.

## Play

Tuning inputs accept note + octave (E2, Bb3). Frets accept 0–24 or x. Start explicitly unlocks Web Audio. Preview lasts 2.5 seconds and restores the current drone (or silence if stopped). Adoption commits the selected six-string voicing. Space toggles transport, 1–4 adopt, left arrow returns, Escape stops. Keyboard shortcuts do not override focused form controls. Tone and Space tabs keep all controls accessible on small screens. Very short viewports allow page scrolling to preserve control accessibility.

ADSR applies to new voices; surviving string voices glide without retriggering. Release applies to muted voices; Stop follows Release and silences effect tails. Restart clears retiring voices before opening the output again. Two detuned sine oscillators per string, gain bounded per oscillator, filtered feedback limited to 0.65, delay 0.05–1.5s, compressor before destination. Settings update with smoothing. No microphone, account, analytics or server storage.

## Reference and independence

Design reference read from kitadadesu/chord-atlas at commit 5013cdb35ac0f50ed28e03a704a100a7e211eddf: src/lib/music/{notes,fretting,suggest}.ts and src/lib/audio/voicing-player.ts. Retains the low-to-high six-string convention, null mute slots, MIDI pitch math and bounded gain principle. Implementation written separately; no files copied verbatim. The source repository was accessed read-only and was not modified. Suggestions here are experimental voice transformations, not guaranteed guitar-playable fingerings or harmonic-function predictions. Font loading uses Google Fonts with system fallbacks.
