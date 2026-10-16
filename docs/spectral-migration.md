# Spectral Saturation / Tonal Migration

Base: main `5ea7294` (Dream Texture PR #8 merged). No dependency PR. Existing checkouts and chord-atlas were not modified.

## Shimmer stability

The former comb lowpass did not set Q (WebAudio default Q=1 dB). Its resonant magnitude can exceed unity (Chrome measured 1.2533 at Q=1 dB), so a feedback coefficient below 1 did not guarantee a decaying loop. At high Decay the product could exceed unity around the resonance. WebAudio LP/HP Q is a resonance value in dB, as specified by [Web Audio](https://webaudio.github.io/web-audio-api/#BiquadFilterNode). Both comb loop filters now use WebAudio Q=-3.0103 dB (conventional Q=1/√2, Butterworth): a monotonic LP at 4200 Hz and HP at 180 Hz, each with magnitude at most 1. The feedback coefficient follows `10^(-3 * delay / decay)` and has a hard cap of 0.94; over the UI's 1–12 second range the requested coefficient remains below this cap. The loop is a strict contraction even at its worst frequency, independently of master compression. Fixed delay times, passive damping, smoothed feedback and no wet-to-input return bound time-varying changes. High frequencies decay faster than the nominal RT60. Tail length is not artificially reset on a Decay change.

Diffusion now uses canonical Schroeder allpasses: direct -g, delayed output (1-g²), and delay-only feedback g=0.45. The previous output-feedback wiring was a different transfer function. Dry/wet diffusion remains a smoothed linear crossfade.

## Saturation

Defaults: Drive 25%, Character 15%, Mix 40%, PRE. Only the separate Bloom 3rd/4th/6th partial send enters this path; the original six-voice/core route is unchanged. Bloom 0 feeds no new signal, though an existing tail may still sound.

- PRE: Bloom send → HP/LP → Saturation → Diffusion → comb bank → Shimmer gain.
- POST: Bloom send → HP/LP → Diffusion → comb bank → Shimmer gain → Saturation.
- Both stages are allocated once per AudioContext. Position continuously fades the processing mix out of one stage and into the other over 35 ms time constants. There is one reverb bank and one output; no rewiring, duplicate tail, feedback insertion, context restart or oscillator replacement. During the transition both stages can be partially active.
- Each stage has a unity direct path plus a compensated processed path. Mix 0 or Drive 0 targets exact unity direct and zero processed gain; allow smoothing to settle after a live change. Drive increases excitation and compensates output. It is deliberately not a loudness-normalization promise for every chord.
- Three fixed 8193-point WaveShaper curves run with 4x oversampling. Character 0–30% stays soft; 30–70% crossfades soft/asymmetric; 70–100% crossfades asymmetric/fold. Convex, continuous weights avoid live curve replacement. All curves pass through zero. A 30 Hz DC blocker and 6500 Hz lowpass follow the processed sum. Oversampling and filtering reduce aliasing; extreme folding is intentionally brighter and can still contain aliasing.
- Saturation nodes are explicitly disconnected on disposal; context close releases the full texture network. Existing transport/voice cleanup is retained.

## Migration

ON by default, with a separate toggle and compact target/progress indicator. There is no independent Migration timer. The existing generation-owned AutoClock measures only scheduled active time; preview, hidden tab, suspended context and AUTO OFF do not advance it. Stop resets partial clock elapsed. Manual adoption/key/mode changes reset the migration; Undo restores its owned snapshot and starts a fresh wait. AUTO resume continues the saved target without counting the stopped interval. New origin creates fresh state.

Destination selection is weighted among different inferred keys with support at least 35% of the incumbent and score within 2.5. If none qualify, use up to six other inferred keys with at least four shared scale tones. A sole inferred key yields no target. The last three departed/abandoned keys are excluded; parallel tonic modes have a small selection penalty, relative modes still require their own tonic evidence.

Normal selection adds target-key candidates through the existing full-voice generator. Edge resolution continues using its original anchor. Existing score cutoff, common-tone fit, Wander, history/bounce penalties, weighted randomness, seven-semitone limit and variable dwell remain. A gradually increasing bounded bonus favors target scale, complete tonic harmony, tonic bass and dominant-bass→tonic resolution. It never directly edits notes or a label.

120 seconds is the earliest arrival, not a forced switch deadline. Arrival requires a tonic bass plus tonic third/fifth, at least two tonic observations, 18 seconds of accumulated tonic dwell (with decay between related chords), and target support at least 60% of the top inference over eight accepted chords. Incompatible harmony clears dwell. Confirmation sets the center without boosting inference scores. If no arrival occurs within five active minutes, discard that destination without relabeling and choose again on a later adoption. Constrained voicings or wandering choices can take longer than two minutes. The 30–60 minute Destination and artificial Feedback are out of scope.

## Reproduction

`npm test`; `npm run build`. No lint script exists. Optional Chrome/Playwright scripts:

```
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/browser-dream.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/browser-saturation.mjs
```

The optional `tests/browser-bypass.mjs` verifies isolated PRE/POST stage bypass sample-for-sample against its input (set BASE_URL to a running local server). Full graph comparisons allow 1e-5 numerical tolerance between independent renders.

The first two scripts start their own localhost server on port 8787. For the existing AUTO suite, serve `dist/` separately and set BASE_URL and CHROME_PATH. Hardware output is muted during integration tests; offline renders measure actual WebAudio. These establish signal and lifecycle properties, not human aesthetic judgment. Safari/mobile hardware and tens of minutes of real-time CPU use remain separate review work.

Listening: Bloom 70%, Dream defaults, Saturation PRE 25/15/40 should add soft density behind the clear core. Compare Mix 0, then Character 50%, then 100% with Drive raised; POST exposes interaction between old and new tails. Return to PRE and low Character for warm ambience. Try Decay 12 while changing chords, then mute to hear a decaying tail. AUTO's target indicator reaches 100% before arrival if tonic evidence is still insufficient.

## Validation recorded for this change

- npm test: 45/45; npm run build; JS syntax and git diff --check passed. No lint script is defined.
- Chrome `browser-saturation.mjs`: 48-second bypass/character/Bloom-zero cases and two 180-second renders (max Decay, six voices and full partials; live chord/Drive/Character/Mix/position/Decay/Diffusion changes). Filter response sampled at 4096 log-spaced frequencies: each loop filter magnitude ≤1.000001. Measured raw Shimmer return before POST and master compression; warm peak 0.005821, stable peak 0.003306, stress peak 0.005469. Master output stress peak 0.346872, largest adjacent difference 0.013286. Stable render RMS remained about 0.074, without growth; late tail RMS 3.23e-9 (stable) / 5.68e-8 (stress).
- Independent full-render bypass/Bloom-zero differences ≤1.2e-7; isolated PRE/POST stage bypass is sample-exact for both Drive=0 and Mix=0. Character comparison after Bloom opens differs by about 0.007993 peak sample value.
- PC 1440px / mobile-width 390px: Saturation controls and repeated position changes, AUTO migration target/progress, toggle, manual adoption, Undo and Stop tested with no page errors or horizontal overflow. Existing `browser-auto.mjs` also exercises hidden/preview waiting, 100 rapid toggles and native browser timers on the built distribution.
- Fixed seed 23 with the actual chooser, Wander and accepted context arrived in D major after 156 active seconds. This is a reproducible example, not a promise of the same destination or timing every run. Arrival and recent-key suppression also have independent unit tests.
- The prior Dream regression script passed before final damping refinement; final damping is covered by the longer spectral suite. Human listening/aesthetic A/B, Safari/iOS/Android hardware, and tens of minutes of real-time load are not verified.
