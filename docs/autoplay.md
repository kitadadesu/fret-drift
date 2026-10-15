# AUTO PLAY

## Controls and behavior

Start the drone, then turn AUTO PLAY ON. Pace defaults to 12 seconds and scales
all dwell ranges (4–30 seconds). Wander controls the rate at which internal
restlessness rises (default 50%); the readout shows that internal state separately.
Edge controls rare chromatic excursions (default 25%). Edge=0 disables automatic
edge events, but manual edge adoption remains possible. AUTO OFF cancels only
automatic transitions: the current drone continues. Audio Stop / Escape / editing
turn AUTO OFF. Resume restarts audio; turn AUTO ON explicitly to restart progression.
Feedback AUTO and Dream Texture are outside this change.

The readout names the last adopted sound, source (AUTO or numbered manual candidate)
and adopted mode, independently of the next candidate cards. AUTO samples the full
existing candidate pool rather than choosing only among the four manual cards.
After an automatic adoption the candidate UI returns to normal mode. A manual mode
switch changes the displayed cards; AUTO itself still chooses normal/edge according
to Wander, Edge and cooldown. Actual accepted edge events, including manual ones,
use the existing resolution anchor and force the next automatic choice to normal.

## Decision model

`autoplay.js` has no DOM or audio dependency. Randomness is injected in selection,
state updates and interval sampling; `AutoClock` injects its timeout functions.
Existing candidate generation, completeness, mute positions, seven-semitone limit,
key inference, tension→resolution scores and voice assignment remain unchanged.
No new distant voicing generator bypasses those bounds.

- A voice counts as PC-common if its pitch class occurs in the destination. This
  distinguishes duplicated voices from unique common PCs. Exact retained MIDI
  multiset, held string slots, string motion and maximum leap remain distinct.
- At low Wander target about 62% shared voices (3–4 of six). Existing candidate
  score contributes 0.65×; shared-voice mismatch costs 1.8 per voice; keeping all
  but one string exactly unchanged costs 4. Recent sound-set occurrences in six
  accepted chords and an explicit return to the chord two steps ago are penalized.
- Rising Wander reduces the shared-voice target toward 20% and rewards distance.
  Similar changes add randomized increments; large changes (distance >=0.45) or
  edge events reduce internal Wander to one quarter. The existing smoothed key
  inference follows accepted harmony without forcing a return to the origin.
- Selection keeps candidates within 12 of the original best harmonic score, then
  uses exponential weighted sampling (temperature 2.4), never a fixed maximum.
- Edge probability is Edge × (0.015 + 0.55 × Wander²), with four subsequent normal
  adoptions required before another automatic edge. Resolution always overrides
  the probability. Empty edge pools fall back to normal; no eligible normal
  candidates turns AUTO off while the drone continues.
- Distance blends 65% lost common voices and 35% normalized actual string motion.
  At Pace=12: small distance <0.22 holds 8–13s; medium holds 11–17s; large >=0.45
  holds 15–24s. An edge adoption holds 10–18s before its normal resolution.
  Dwell is sampled after the adopted transition; large movements stay longer.

## State and lifecycle

Manual and automatic acceptance share one commit path. Undo snapshots restore MIDI,
name, harmonic context, drift/cooldown and last-adoption display. Controls stay at
user-selected values. A new origin resets drift and turns AUTO off. The full audio
path (Bloom, Drift, Portamento, fundamentals, envelopes and effects) is unchanged.

Only one timeout is owned, guarded by a generation token. Holds pause and cancel
that timeout; release, manual adoption, Undo, key/mode changes and reroll schedule
an entirely new dwell. Hidden tabs and suspended AudioContexts do not advance;
visibility/audio-state restoration schedules a new dwell with no catch-up burst.
Audio readiness must complete before AUTO can start. Stop, edit and pagehide cancel
AUTO and invalidate pending audio runs. After asynchronous play, the current
accepted voicing is reconciled so intervening manual changes cannot leave stale
notes sounding. AUTO settings reschedule without changing audio parameters.

## Verification

Base: latest main `1f9d572` (PRs #1–#5 merged), no open PRs or repository AGENTS.md.
Existing separate checkout had uncommitted build changes; a dedicated clone avoids
modifying it. `kitadadesu/chord-atlas` is untouched.

- `npm test`: 35 tests, including 8 AUTO tests, existing harmony/hold/audio/Bloom
  regressions and whole-module cache generation. Seeded 100-adoption walk checks
  mutes, bounded leaps, keys/history and actual spaced edge adoption. Fake timeouts
  check ownership, stale callbacks, stop, rapid toggles and holds.
- `npm run build`, JS syntax checks, `git diff --check`. No lint script exists.
- `tests/browser.mjs`: existing real WebAudio regression on desktop 1440×1000 and
  mobile/touch emulation 390×844, including held adoption, Undo, stop/resume, edits,
  keyboard and rapid preview switches. Also run with Bloom=1.
- `tests/browser-auto.mjs`: Playwright clock advances real UI timeouts through
  automatic adoption, OFF with drone running, held preview, manual adoption/Undo,
  actual manual-edge→automatic-normal resolution, hidden tabs, stop/resume, 100
  rapid toggles, edit/new origin and delayed AudioContext readiness cancellation.
  Both viewport sizes check horizontal overflow and visible sound controls.

Run browser scripts with BASE_URL for a local HTTP server, PLAYWRIGHT_MODULE for
an optional installed Playwright, and CHROME_PATH for Chrome. No runtime or build
dependencies were added. Browser output is muted at hardware destination while the
upstream audio graph is exercised. Human listening, musical A/B assessment and
physical Safari/iOS/Android devices remain unverified. The weights are musical
heuristics; common-tone availability and sparse/extreme inputs can constrain the
range of exploration. Four normal adoptions is a minimum cooldown, not a promise
of a periodic edge event. State is session-only.
