# Harmonic Drift

## Base and scope

Built on main `7c12ee5` (PR #1 harmonic context and PR #2 accepted-edge resolution / race-free hold previews are both merged). No open PR existed at the start. Remote main was checked again before submission and was unchanged. No stacked dependency or merge ordering is required. No files in `kitadadesu/chord-atlas` are changed. Harmony, candidate ranking, adopted history and pointer ownership logic are unchanged.

## Sound and controls

Each string keeps the original pair of detuned sine fundamentals, plus four independent sine partials. The ratios at Inharmonicity 0 are 2, 3, 4, 6. At full Inharmonicity they become 2.03, 3.21, 4.68, 5.52. Relative partial weights are 0.30, 0.22, 0.14, 0.09. Each target comes from that string's actual MIDI, not pitch class or another string's oscillator. Partials have no detune: pitch displacement here is a spectral relationship, not unison thickening.

- Harmonics: 0–1. Default 0 preserves the old transparent sound. Try 0.35–0.6 first.
- Inharmonicity: 0–1, default 0.12. Zero means harmonic target ratios. Try 0.15–0.4 for glass, 0.7–1 for more alien metal.
- Spectral Drift: 0–1, default 0.4. At 0 every partial takes Glide seconds. At 1 the four durations are 0.45×, 1.8×, 3.2×, 5× Glide, bounded at 30 seconds. Interpolation is logarithmic in duration. The fundamental still uses exactly the original Glide.

With Glide 1–3 seconds and Drift 0.6–1, hold a candidate, adopt it, or release it. Hear the pitch center arrive while upper components are still travelling. A second move interrupts each partial at its own in-flight exponential frequency. The trajectory is tracked per partial (start/end time and start/target frequency); cancellation explicitly anchors that interpolated frequency before scheduling the next ramp. This avoids depending on an in-flight `AudioParam.value` or repeated hold cancellation in one audio quantum. Volume/space/detune edits do not restart spectral movement.

FM and extra visual animation were deliberately left out to keep this change focused on independently moving partials. The existing display continues to show the actual fundamental and output waveform.

## Gain, bandwidth and lifecycle

Partial amount and fundamental mix are normalized to the legacy absolute amplitude budget: `norm = 1 / (1 + Harmonics × sum(weights))`. The two fundamentals each get `norm`; partials get `2 × Harmonics × weight × norm`. Their absolute amplitudes sum to 2, before the original 0.035 voice envelope. All mix gains use the same 35 ms smoothing, so changing amount/bandwidth does not introduce an upward amplitude-budget jump. This constrains peak amplitude; it does not promise identical perceived loudness across timbres. The original compressor, reverb and filtered delay remain downstream.

At the top of the spectrum, partials fade between 0.40 and 0.45 times sample rate, and scheduled frequencies never exceed 0.45 times sample rate. Targets and interrupted exponential trajectories stay positive and below that ceiling.

Partials are lazy: a fresh Harmonics-0 performance still has 12 oscillators. First enabling Harmonics allocates at most 24 more, for 36 total. Harmonics 0 and mute silence but retain those bounded oscillators to support instant reversal without asynchronous start/stop races. Muting uses the original whole-voice Release; unmuting uses Attack/Decay. Stop releases and stops all six oscillators in each voice. Every source and intermediate gain is disconnected when all sources finish; restart explicitly clears pending retiring voices. Disposal also clears them after closing the context, even if onended was never delivered. No timers are used for partial ownership.

## Verification

- 24 dependency-free Node tests: prior harmony/hold regressions plus six independent spectra and unisons; two successive moves with exact held intermediate pitches and different durations; integer/noninteger ratios; all zero settings; Nyquist ceiling; amplitude budget; 300 mute/preview/knob cycles without node growth; Stop/Resume; delayed retiring source cleanup and disposal; cancelled asynchronous resume.
- Build succeeds. There is no lint script or lint dependency in this repository; JavaScript syntax checks and `git diff --check` are used as additional checks.
- Real Chrome `tests/browser.mjs`, desktop 1440×1000 and touch-emulated 390×844, both legacy and `TEST_SPECTRUM=1`: pointer outside release, keyboard hold, cancel/blur/hidden, 150 rapid audition pairs, accepted edge→normal resolution, Undo, Stop/Resume, edit/new start; no page errors, no horizontal overflow, sound controls fit the viewport.
- `tests/browser-drift.mjs`: real WebAudio interrupted movement (fundamental already at target while slow partial still travels); full Reverb/Delay/Feedback with knob changes; finite nonzero output below full scale, waveform adjacent-sample jump bound, all-string mute, zero output after Stop, nonzero Resume, retiring set empty. Also checks the new sliders at both viewport sizes and renders clean/additive audio through OfflineAudioContext to measure actual second/third partial energy.

Run `npm test`, `npm run build`. On this host npm is absent; the same package scripts were run with the bundled pnpm/Node runtime. Browser scripts need Playwright and Chrome, supplied by `PLAYWRIGHT_MODULE` and `CHROME_PATH` if not installed normally, plus a static server at `BASE_URL` (default port 8787). For the full spectral regression: `TEST_SPECTRUM=1 node tests/browser.mjs`. For spectral measurements: `node tests/browser-drift.mjs`.

One measured run: fundamental 92.4986 Hz while the slow partial was still at 491.6013 Hz toward 523.9121 Hz; full-effect output peak 0.16072 and maximum adjacent-sample step 0.00696. Offline rendering gave second/fundamental ≈0.300 and third/fundamental ≈0.220 with Harmonics 1, versus second amplitude ≈1.45e-8 at Harmonics 0. These are measurements from this run, not fixed sound-quality thresholds.

Browser audio output is silenced after the analyser. Human listening / aesthetic A/B judgement, Safari/iOS/Android hardware and low-end CPU profiling remain unverified. Automated amplitude and waveform checks are bounded observations, not proof that every possible performance is click-free. Silent partials remain allocated until transport cleanup as described above.
