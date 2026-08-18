# Design: Darkroom, scanning, workflows, and rules

This proposal extends Hypo's capture-session model to film development, scanning,
editing, and printing. Each stage creates a session record that links its inputs,
equipment, settings, timestamps, and outputs. Capture and offline frame logging provide
the existing implementation pattern; later stages reuse the same record and sync
boundaries.

---

## 1. Common session model

Every production stage uses the same fields:

- it consumes **inputs** (one or more rolls / frames, gear, chemistry),
- it happens at a **time** (and optionally a place),
- it records **what actually happened** (times, temperatures, settings, notes),
- it can be logged **offline** and synced later,
- it emits a **record** that becomes part of the roll's history.

Capture already uses this model (`session.capture` + `instance.exposure`) and writes
through the offline outbox. Development, scanning, and printing use the same component
family and queue:

```
capture  → session.capture      + exposure         (DONE)
develop  → process.development   + developStep       (NEW: the timer's output)
scan     → process.scan          + scanFrame         (NEW)
print    → process.print         + printExposure     (NEW, later)
```

The shot logger supplies the initial `SessionLogger` behavior: a full-screen overlay,
large controls, and queued writes. A shared base can support the development timer and
scan logger without separate implementations of those behaviors.

**Shared primitives to extract:**

- `outbox` (already built): every session writes through it, so all four stages work
  offline identically.
- native date/time pickers, `captureGeolocation`, the type/instance distinction, and
  edit-in-place: already built for gear/shoots, applied uniformly here.
- a `sessionRecord` shape in `defs.json` (subject rolls[], gear[], chemistry[],
  startedAt, endedAt, location?, notes) that the three new records extend.

---

## 2. Darkroom tab and development timer

### 2.1 What development actually needs

B&W development is a temperature- and time-critical sequence of steps, each with its
own duration and agitation rhythm:

```
(pre-soak) → develop → stop → fix → (wash aid) → wash → (photo-flo) → dry
```

The _develop_ step is the one that depends on data: its time is a function of
**developer + dilution + film stock + exposure index (push/pull) + temperature**.
Colour processes (C-41, E-6) add more steps with much tighter temperature tolerance
(±0.3 °C), so the same engine must handle "one critical step at 38 °C" as well as
"six relaxed steps at 20 °C."

### 2.2 The timer UX (modeled on the shot logger)

Full-screen overlay, launched as **"Start development."** Flow:

1. **Pick what you're developing.** Pre-filled if you launch it from a shot roll (or
   several rolls in one tank). Carries film stock + the EI it was shot at.
2. **Pick the recipe.** Developer (from your chemistry instances or the catalog) +
   dilution. We look up the base time from the dev-time database (§3).
3. **Enter temperature.** Default 20 °C; you can measure and adjust. The engine applies
   temperature compensation (§3.3) and recomputes every step time live.
4. **Run it.** A big countdown for the current step, the next step queued, and an
   **agitation metronome**: a visual pulse plus optional beep and `navigator.vibrate`
   so you get the cue with the lights off and the phone in your pocket.
   - Controls: start/pause, ±15 s nudge, "next step," "mark done."
   - Between steps, a short interstitial ("Pour out developer; stop bath next").

5. **On finish**, it writes a `process.development` record: the rolls, developer +
   dilution, temperature, per-step _actual_ times, push/pull, and notes, through the
   outbox, so a darkroom with no signal still logs everything and syncs on reconnect.

### 2.3 Timer reliability

A web timer that drifts or dies when the screen locks is worse than a $10 mechanical
one. Design decisions:

- **Absolute timestamps, not tick counting.** Each step stores `endsAt = now + duration`.
  If the tab is backgrounded, the phone locks, or JS is throttled, on resume we recompute
  from wall-clock time (zero drift).
- **Wake Lock API** to keep the screen on during a run, controlled by a visible toggle.
  If wake lock is unavailable, the timer continues without it.
- **Audio + haptics** for agitation and step-change cues so it works even if the screen
  does sleep. A single pre-unlocked `AudioContext` (unlocked on the start tap) avoids the
  mobile autoplay block.
- **Crash/refresh recovery.** The active run is mirrored to `localStorage` every second;
  reopening the app offers "Resume development in progress (4:12 left on Fix)."
- **Everything offline.** The recipe database is bundled at build time (§3), so lookups
  need no network; the session write goes through the outbox.

### 2.4 Chemistry lifecycle

Developers and fixers are consumables with a capacity and an age. Completing a timed
session can update their state:

- A chemistry **instance** gains `rollsProcessed`, `mixedAt`, `capacityRolls`,
  `replenished`. Finishing a dev session decrements remaining capacity.
- Warn when you're near capacity ("this is roll 15 of ~16 for this XTOL") or when a
  one-shot dilution is being reused by mistake.
- **Fixer clip-test** reminder + log (clearing time trend → "your fix is getting tired").
- These data support cost-per-roll, chemistry-age, and replacement summaries in the Insights tab.

---

## 3. Development-time catalog

### 3.1 Sources and licensing

The Massive Dev Chart is a **proprietary compilation**. Its selection and arrangement
are protected even though an individual development time may be a non-copyrightable
fact. Hypo therefore does not copy it. The catalog instead records facts from
manufacturer datasheets, including official time, temperature, and dilution tables.
Every recipe cites its source document.

Manufacturer entries are stored in `data/curated-dev-times/<maker>.jsonl` and combined
at build time into `src/data/curated-dev-times.json`. Each entry must cite an official
datasheet and record its dilution, exposure index, temperature, time, and agitation
instructions. The build validates ranges and removes duplicates.

### 3.2 Schema (`devRecipe`)

```jsonc
{
  "developer": { "make": "Kodak", "name": "XTOL" },
  "dilution": "1+1", // "stock", "1+1", "1+31", ...
  "film": { "make": "Kodak", "name": "Tri-X 400" },
  "ei": 400, // exposure index the time is for (push/pull rows differ)
  "tempC10": 200, // 20.0 °C as tenths (atproto has no float)
  "timeSec": 405, // base time at that temperature
  "agitation": {
    // structured so the metronome can drive it
    "initialSec": 30,
    "everySec": 60,
    "forSec": 10,
    "note": "4 inversions",
  },
  "process": "bw", // bw | c41 | e6 | monobath
  "source": "https://…/xtol-datasheet.pdf",
  "notes": "Continuous agitation first 30s",
}
```

- **User recipes** use the same shape as the lexicon record
  (`app.graycard.catalog.devRecipe`) so a photographer can save "my Tri-X in XTOL 1+1"
  and have the timer default to it. Bundled and personal recipes are merged by the same
  catalog mechanism used for gear.
- A **"suggest a recipe"** GitHub-issue flow (mirroring "suggest a lens") lets users
  contribute datasheet-sourced entries.

### 3.3 Temperature handling

**Decision: we do not extrapolate off-datasheet.** Times are published at reference
temperatures; we store exactly the temperature points a manufacturer publishes and:

1. **Interpolate only between published points** for the same recipe. If a datasheet
   gives 20 °C and 24 °C, the timer may derive 22 °C by straight interpolation bounded
   by those source rows.
2. **Do not extrapolate recipe data outside the published range.** The timer never labels
   an unsupported temperature as a recipe recommendation.
3. **Offer a separate general black-and-white estimate.** A user may explicitly apply
   Ilford's 18–27 °C compensation chart to a published reference row. The interface
   labels the result approximate, warns below five minutes, and records
   `timeBasis: general-estimate` instead of `publishedTimeSeconds`.
4. **Always log the actual time/temp used.** Over time your own logged sessions become a
   personal recipe source, and the app can report "you usually run this combination at
   24 °C for 5:30" from those recorded sessions.

Every displayed time is traceable to a manufacturer source, the identified general
chart, or a recorded personal session. General estimation is limited to standard
black-and-white processing and is unavailable for C-41 and E-6.

---

## 4. Scanning tab

Scanning currently records a scanner instance and a scan profile. A scan session adds
the process details and links output frames to their exposures.

### 4.1 `process.scan` + `scanFrame`

- **Scan session:** scanner used, scan profile (dpi, bit depth, colour space, software,
  negative/positive, dust removal, multi-exposure passes), holder/wet-or-dry, IT8
  calibration target used + date, the roll(s), timestamp, notes.
- **Frame links:** scanning a roll produces `scanFrame` links that bind
  **exposure ⇄ scanned photo (AT-URI)**. This is the missing bridge between the frame you
  logged in-camera and the Grain photo uploaded from its scan. A public photo can then
  derive gear, aperture, and location from the linked exposure.
- **Batch:** "scan roll → 36 frames," auto-numbering frames and matching them to logged
  exposures by frame index (with a manual reconcile UI for gaps).

### 4.2 Scan profiles & calibration

- Promote **scan profiles** to reusable catalog types with the type/instance distinction
  (a "profile" is a type; "this scan run used profile X" is the instance usage).
- Track **calibration** (IT8 target, ICC profile, last calibrated) and warn when it is stale.
- A lightweight **scanning checklist** (clean glass, calibrate, preview, set black/white
  point, scan, verify) as a workflow stage type (same engine as §5).

---

## 5. Workflow integration

Templates define how the session types are composed.

- **A template is an ordered list of stages**, each with a `processKind`
  (capture / develop / stop / fix / wash / scan / edit / print) and optional **defaults**
  (chemistry, dilution, target temp, equipment, scan profile).
- **Recipe binding:** a develop stage can reference the dev-time DB, so instantiating a
  workflow for "Tri-X @ 400" pre-fills the timer. A scan stage can reference a scan
  profile.
- **Runs:** "Start a run" for a roll (or batch of rolls), like "Start a shoot." Each
  stage tracks completion + timestamps, and the **actuals flow in from the sessions**:
  finishing a dev session marks the develop stage done and stamps its real time; a scan
  session completes the scan stage.
- **Medium branching:** templates are typed by medium (B&W / C-41 / E-6 / digital /
  instant) so the stage list and defaults match the process.
- **Board view:** a kanban of rolls by current stage ("3 rolls shot, awaiting develop;
  1 drying; 2 ready to scan").

---

## 6. Rules tab

Reframe "batch rules" into a small, consistent **rule engine**: _when a condition holds,
suggest or apply a change._ Everything runs **preview → approve → apply** (never silent),
consistent with the EXIF-is-a-suggestion principle we already agreed.

**Rule kinds:**

- **Gear tagging**: "EXIF camera = Nikon F2 and no graycard camera set → _suggest_
  instance #7119573." Suggestions only when unambiguous; surfaced for approval otherwise
  (honoring the two-F2 ambiguity rule).
- **Defaulting**: "roll = Tri-X and develop stage empty → default recipe XTOL 1+1."
- **Batch edit**: bulk set/clear a field across a selection (already partly built).
- **Derivation**: compute values (35 mm-equivalent focal length, coarse location cell).
- **Lint / validation**: _flag_ rather than change: "these 4 photos have no lens,"
  "this roll has 37 exposures logged but 36 frames," "fixer past capacity."

**Triggers:** on-demand (run now), on-import (new grain photos), on-session-complete
(after a scan links frames). **Scope:** a gallery, a roll, a shoot, or a selection.

A **rule builder** (condition rows + action rows + live preview count) plus a **preset
library** (the current `RULE_PRESETS`, expanded). Rules are stored as `rule.batch`
records extended with a trigger + kind.

---

## 7. Application structure

- **Tab order follows the production flow:** `Setup → Film → Shoots → Darkroom → Scan →
Edit → Print → Workflows → Rules → Insights`. Workflows, Rules, and Insights operate
  across those stages.
- **One session-logger component family** behind shots, development, and scanning, with
  a shared offline outbox, control layout, and resume behavior.
- **Type/instance everywhere**: apply the distinction we built for gear to chemistry,
  scanners, and scan profiles (only surfaced when duplicates exist).
- **Per-domain Insights**: chemistry cost/age, dev-time consistency vs datasheet, push/
  pull habits, scanner resolution defaults, throughput per stage.
- **Consistent empty states & edit-in-place** across all four editors.

### New lexicons summary

```
defs#sessionBase          (subject rolls[], gear[], chemistry[], startedAt, endedAt, location?, notes)
process.development       + developStep     (timer output; per-step actuals)
process.scan              + scanFrame        (exposure ⇄ photo AT-URI bridge)
process.print             + printExposure    (later)
catalog.devRecipe         (user recipes; mirrors curated JSONL)
catalog.scanProfile       (promote to type/instance)
instance.chemistry        (+ rollsProcessed, capacityRolls, mixedAt, replenished)
rule.batch                (+ trigger, kind)
```

---

## 8. Suggested build order

1. **Development-time data pipeline and schema** (`devRecipe`, JSONL, build glob, and
   representative manufacturer entries that validate the shape).
2. **Development timer + `process.development`**: offline, timestamp-based, and linked
   to chemistry capacity.
3. **Expand the development-time catalog** across manufacturers after validating the schema.
4. **Scan session + frame⇄photo linking** to connect exposures with published photos
   and improve profile filters.
5. **Workflow runs wired to session actuals** + the roll board.
6. **Rule engine refactor** (preview/approve/apply, triggers, builder, lint rules).
7. **Print bench** + per-domain Insights (last).

---

## 9. Decisions (resolved)

- **Scope:** follow the implementation order in §8: development data and timer, scan linking,
  workflow runs, and the rule engine.
- **Timer process scope:** **B&W _and_ colour (C-41/E-6) from the start.** The step model
  and per-step temperature tolerance are first-class, so a 38 °C ±0.3 °C colour run and a
  relaxed 20 °C B&W run use the same engine.
- **Temperature:** **datasheet-only** (§3.3): interpolate within published points,
  never extrapolate; otherwise "dial in and log your own."

### Open decisions

- **Recipe seeding:** which developers and films to prioritize before broader catalog expansion.
- **Timer surface:** the default is a dedicated full-screen tool like the shot logger.
  A compact version may later appear inside a workflow run's development stage.
