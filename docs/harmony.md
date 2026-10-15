# Contextual harmony engine and verification

## Source review and adaptation

Work starts from Fret Drift main `a88a24c8505096758d181f70f426b7a567663c65`.
Before editing: inspected remote branch list (only main), open PR list (empty),
tracked repository files (no AGENTS.md), README and existing Pages workflow.
The new branch targets main. Pages deploys only main; this change adds PR CI.
No merge or deployment is performed by this PR.

Fret Atlas was accessed **read-only** through the GitHub connector at its latest
main `5013cdb35ac0f50ed28e03a704a100a7e211eddf`. No writes, branch creation or
commits were made to that repository. Reviewed its AGENTS.md and:

| Atlas module | Fret Drift adaptation |
| --- | --- |
| `chords.ts` | Port interval-role/extension/omission/slash interpretation to dependency-free `chords.js`; analyze actual lowest MIDI rather than string index. All present PCs get roles. |
| `notes.ts` | Port MIDI/PC, flat/sharp naming helpers to `notes.js`; existing music.js public helpers remain compatible. |
| `diatonic.ts` | Major and natural-minor third stacking and octave-correct scale-index shifts. Reject a whole scale transform if any source note is outside; never drop a voice. |
| `predict.ts` | Adapt 24-key scale fit, complete-triad degree fit, major/minor functional weights, cadence and motif recognition. Use bounded recent accepted history, recency decay, score smoothing and center hysteresis. |
| `suggest.ts` | Preserve full target multisets, common PCs, retained exact pitches and MIDI motion. Include original complex voicing transformations as well as new complete chord structures. |
| `compare.ts` | Distinguish common pitch classes, exact multiset intersection, minimal pitch motion and actual string motion. Equal-cardinality 1D absolute-distance assignment is minimized by sorted pairing; synthesizer assignment also penalizes large per-string jumps. |
| `fretting.ts` | Keep MIDI and six aligned slots, string 0 = low 6th string, null mutes and unisons. Deliberately omit guitar reach/fret restrictions for synth proposals. |
| `roulette.ts` | Sound-set deduplication, weighted draws, recent-sound exclusion and root diversity. Replace local semitone mutations with full harmonic families and complete coverage optimization. |

Related tests reviewed: `music.test.ts`, `diatonic.test.ts`, `suggest.test.ts`,
`predict.test.ts`, `harmony-integration.test.ts`. Key regression expectations
(EADGCE 680700, full-voice degree shifts, uncertainty, ii-V-I, all major/minor keys,
snapshots, unisons/mutes and finite scores) are adapted into Node's built-in tests.
No TypeScript compiler or runtime dependency is needed by the delivered app.

## Generation and state

1. Initial six-slot MIDI snapshot retains duplicates and bass independently from
   its unique pitch-class set. Rank root interpretations using Atlas's interval
   roles. Rank all 24 keys; F major and D natural minor intentionally tie for
   680700. Bb Lydian is a *modal reading of the F-major collection*, not a
   separately proven tonal center. The selector can choose any of the 24 keys.
2. Generate full-voice scale shifts, complete triads, sevenths, extensions up to
   the source's PC complexity (at least four, at most voice count), add9/6 colors,
   parallel-mode borrowing, secondary dominants and tritone substitutions.
   Edge adds major/minor seventh, diminished, augmented, suspended and altered
   structures across all roots. This is a bounded harmonic grammar, not a
   table of six independent voice offsets.
3. Dynamic programming over pitch-class coverage masks guarantees every required
   target tone is present. Exact multiset assignment preserves duplicate targets
   and mute positions while optimizing voice exchanges. MIDI range 12–127 and
   per-string motion <= 7 semitones are hard bounds. Unavailable complete targets
   are rejected. No nearest-note snapping that can silently erase the third.
4. Score functional connection, cadence, accepted-history motif, common PCs,
   exact retained pitches, actual per-string motion, maximum leap, recent repeats
   and fading origin affinity. Normal permits at most one outside-scale PC;
   edge requires at least one and rewards up to three. Disconnected candidates
   with no common PCs and total string motion > 18 are rejected.
5. Sample only within 8 score units (normal) / 10 (edge) of the best candidate,
   exponentially weighted, with root repetition penalty and distinct PC sets.
   Exclude recently shown sets when at least four remain; recycle when exhausted.
   The UI initializes seeds from crypto randomness; explicit seeds reproduce tests.
6. Adoption alone updates a window of 16 accepted snapshots. Raw inference weights
   recent chords by 0.82 per age; scores blend 35% new / 65% old. Switch center
   only after a competitor leads by > 0.55. Manual interpretation adds a temporary
   prior and chooses the center, without permanently locking it. The origin MIDI
   remains separate even after the recent window or 100-step undo stack expires.
   Undo restores the full pre-adoption context, pitches and chord interpretation.
   It generates a new eligible proposal batch; it does not promise the exact
   previous cards. Preview and reroll never update accepted history.

Support bars use softmax temperature 1.5 on heuristic key scores. They are not
calibrated confidence probabilities; relative major/minor ambiguity is preserved.
Modal text reports compatibility of the current chord, whereas the selector and
bars reflect accepted context. Those can differ after borrowing. Analysis shows
actual pitches, motion traces, relative key support and inside/outside-scale dots.

## Verification, 2026-10-15 JST

- `npm test`: **13 tests passed**, including the two existing WebAudio lifecycle
  tests. All 24 manual interpretations, major/minor scale shifts, actual altered
  tuning bass, high-register inputs, one-note and unison sources, mutes,
  immutability, complete target coverage, seven-semitone leap bound, ii-V-I,
  non-jumping center, sustained remote-key adoption and snapshot restoration.
- `npm run build`: passed; static dist includes every imported module.
- `git diff --check`: passed.
- `node tests/metrics.mjs`, deterministic seeds 0–29, four proposals each:

| EADGCE 680700 / 120 proposals per mode | Normal | Edge |
| --- | ---: | ---: |
| Distinct pitch-class sets | 32 | 64 |
| Mean outside-scale PCs per proposal | 0.025 | 1.875 |
| Mean total per-string semitone motion | 4.875 | 5.717 |
| Mean unique PCs per proposal | 4.425 | 4.458 |
| Largest individual string leap | 4 | 3 |

These numbers measure diversity, structure and movement, **not musical quality**.
The normal and edge pools for this fixture contain 61 and 99 distinct sounds.
A manually selected C-major ii-V context ranks complete C-root harmony first.
One remote F#-major adoption does not switch a C-major center; 25 repeated remote
adoptions converge to F# major without erasing the original C snapshot.

Headless installed Chrome with real WebAudio on desktop **1440×1000** and mobile
**390×844**: start with EADGCE 680700, 24-key selector, manual interpretation,
preview and timed restoration, adoption, undo, mode switch, reroll, preview
interruption, stopped preview, resume, keyboard adoption/undo and delay control.
Zero page errors. Document widths match viewport widths. Sound controls remain
inside both tested viewports; canvas heights ~340 and ~223 px. Screenshots were
visually inspected. The test disconnects only the destination output to avoid
playing unsolicited sound through hardware; **no human listening assessment**
was made. It does not establish sound quality, audible loudness or physical
phone behavior. `audio.js` is unchanged.

Reproduce unit/build checks with Node 22+ and npm. For optional browser verification,
serve the repo at `http://127.0.0.1:8787`, make Playwright available, then run
`node tests/browser.mjs`. `BASE_URL`, `PLAYWRIGHT_MODULE` (module path) and
`CHROME_PATH` optionally select the server/runtime/browser. Artifacts are saved
under ignored `artifacts/`. No browser dependency is added to the buildless app.
This workstation lacked global Node/npm, so bundled Node 24.19 and temporary
npm 10.9.4 were used; the PR CI independently runs Node 22.

## Remaining musical and technical limits

- No claim of proven aesthetic parity/superiority to Fret Atlas: requires A/B
  listening across user-selected examples. Preserved complex degree shifts,
  complete extensions and explicit borrowing broaden the structural coverage;
  fixture statistics do not prove every proposal sounds good.
- Functional transitions and chord root ranking are heuristics. Pedal bass,
  polytonal clusters, rootless harmony and enharmonic spellings remain ambiguous.
  Atlas's namer may show implied extensions; role/missing-tone data remain
  available through the pure analysis API. The compact UI shows one interpretation
  per candidate. Flat names are used consistently, not full key-aware spelling.
- Modal readings cover rotations of the major collection; the inference state
  ranks major/natural minor, not independent modes or harmonic minor keys.
- The grammar and score floor can return fewer than four proposals on sparse or
  extreme inputs. Coverage and motion bounds take precedence over filling slots.
  Minimal three-note sources can become richer, and new chord families can omit
  source color tones explicitly through changed pitches; only full-voice scale
  transformations preserve the source multiset's degree relationships exactly.
- State is session-only. The origin remains recorded, but undo is bounded to 100
  steps and there is no separate origin-recall button. Key smoothing introduces
  intentional delay. Seven semitones is a hard upper bound, not a comfort guarantee.
- Safari/iOS, Android hardware and acoustic listening were not tested. Existing
  audio synthesis architecture and envelope/effect limits remain unchanged.


## Hold preview and three-chord resolution update (2026-10-15 JST)

Base: main `3b009df` (PR #1 merged); all remote branches and recent PRs checked
before creating `feature/resolution-hold-preview`. No repository AGENTS.md or
contribution rules found. Existing README, theory notes, PR CI and main-only
Pages workflow reviewed. No Fret Atlas files or refs touched. No dependency PRs.

`acceptedModes` is aligned with the bounded 16-chord history. `resolutionAnchor`
captures A and the inferred key immediately before actual edge adoption B.
Repeated edge adoptions refresh A/key before each new B. Only the following
normal proposal pool uses that context: reward removal of outside-key PCs,
semitone destinations, lower chromatic/semitone/tritone tension, stable degrees,
and affinity with A, alongside existing B→C common tones, exact retained notes,
string motion, motif, novelty and maximum-leap bounds. Returning to A has a small
penalty, rather than being mandatory. The existing weighted draw and quality
floor still apply. Normal adoption clears the anchor; Undo snapshots restore it.
An explicit key selection updates the anchor key. Rerolls and previews are pure
with respect to accepted context. Ordinary normal/edge ranking is unchanged
when there is no edge-adoption resolution context.

Preview uses only synchronous `Drone.move`; no timers, `play`, context resume,
node stop or new graph per preview. Pointer capture handles outside release;
per-pointer/key ownership prevents an older gesture from releasing a newer one,
including multiple fingers on one button. Blur, hidden page and all structural
changes restore/clear the transient target. Stopped previews are disabled and
labelled “再開して試聴”. Start/resume use a generation check so a pending resume
cannot overwrite a later stop/edit. Muted voices fade over Release but retain
oscillators until Stop; reversing a mute during release cancels the envelope,
glides existing oscillators and uses Attack/Decay. At most 12 live oscillators
per running drone; Stop retains its bounded release graph and restart clears
retiring voices. Effects and safety limits remain unchanged.

Validation: `npm test` 19 passed; `npm run build`; `git diff --check`.
Browser script runs installed headless Chrome with real Web Audio, routes the
final destination through zero gain, and checks the upstream signal. Desktop
1440×1000 and mobile/touch emulation 390×844: hold/release outside the button,
pointercancel/lost capture, Space/Enter, blur/visibilitychange, 150 rapid switches,
return to stored chord frequencies, nonzero bounded signal after switching,
zero signal after Stop, stopped disabled preview, resume, held adoption/Undo/
edit/new start, edge→normal context and Undo restoration. Unit tests also run
300 audio move/mute cycles without oscillator growth and 100 stale-release
switches. Browser page errors: 0; horizontal overflow: none; sound controls remain
inside both viewports. Screenshots inspected. This verifies browser synthesis
and interaction, not human listening or aesthetic quality. Safari/iOS/Android
hardware and acoustic A/B listening remain unverified. Tension is a relative
heuristic and does not guarantee every offered chord feels resolved.
