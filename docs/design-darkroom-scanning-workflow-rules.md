# Design: Darkroom, Scanning, Workflow & Rules

A holistic redesign of the post-capture side of Hypo. The organizing idea: a roll of
film has a **life**: shot → developed → scanned → edited → printed, and each stage
is a *session* that produces a record. We already nailed the shooting stage (shoots +
the offline frame logger). This doc extends that same spine to the darkroom, the
scanner, and the print bench, ties them together with workflows, and automates the
busywork with rules.

---

## 1. The unifying idea: a "session" spine

Every production stage is the same shape:

- it consumes **inputs** (one or more rolls / frames, gear, chemistry),
- it happens at a **time** (and optionally a place),
- it records **what actually happened** (times, temperatures, settings, notes),
- it can be logged **offline** and synced later,
- it emits a **record** that becomes part of the roll's history.

We already have this for capture (`session.capture` + `instance.exposure`, logged via
the offline outbox). The proposal is to generalize it so the darkroom, scanner, and
printer reuse the *same* component family and the *same* offline machinery:

```
capture  → session.capture      + exposure         (DONE)
develop  → process.development   + developStep       (NEW: the timer's output)
scan     → process.scan          + scanFrame         (NEW)
print    → process.print         + printExposure     (NEW, later)
```

A shared `SessionLogger` UI primitive (full-screen overlay, big controls, offline
writes) already exists in spirit as the shot logger. We factor it into a reusable base
so the dev timer and scan logger are variations on a theme rather than new inventions.

**Shared primitives to extract:**
- `outbox` (already built): every session writes through it, so all four stages work
  offline identically.
- native date/time pickers, `captureGeolocation`, the type/instance distinction, and
  edit-in-place: already built for gear/shoots, applied uniformly here.
- a `sessionRecord` shape in `defs.json` (subject rolls[], gear[], chemistry[],
  startedAt, endedAt, location?, notes) that the three new records extend.

---

## 2. Darkroom tab + the development timer (centerpiece)

### 2.1 What development actually needs

B&W development is a temperature- and time-critical sequence of steps, each with its
own duration and agitation rhythm:

```
(pre-soak) → develop → stop → fix → (wash aid) → wash → (photo-flo) → dry
```

The *develop* step is the one that depends on data: its time is a function of
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
   dilution, temperature, per-step *actual* times, push/pull, and notes, through the
   outbox, so a darkroom with no signal still logs everything and syncs on reconnect.

### 2.3 Making the timer trustworthy (the hard part)

A web timer that drifts or dies when the screen locks is worse than a $10 mechanical
one. Design decisions:

- **Absolute timestamps, not tick counting.** Each step stores `endsAt = now + duration`.
  If the tab is backgrounded, the phone locks, or JS is throttled, on resume we recompute
  from wall-clock time (zero drift).
- **Wake Lock API** to keep the screen on during a run (with a visible toggle; falls back
  gracefully where unsupported).
- **Audio + haptics** for agitation and step-change cues so it works even if the screen
  does sleep. A single pre-unlocked `AudioContext` (unlocked on the start tap) avoids the
  mobile autoplay block.
- **Crash/refresh recovery.** The active run is mirrored to `localStorage` every second;
  reopening the app offers "Resume development in progress (4:12 left on Fix)."
- **Everything offline.** The recipe database is bundled at build time (§3), so lookups
  need no network; the session write goes through the outbox.

### 2.4 Chemistry lifecycle (what the timer quietly tracks)

Developers and fixers are consumables with a capacity and an age. The timer is the
natural place to maintain them:

- A chemistry **instance** gains `rollsProcessed`, `mixedAt`, `capacityRolls`,
  `replenished`. Finishing a dev session decrements remaining capacity.
- Warn when you're near capacity ("this is roll 15 of ~16 for this XTOL") or when a
  one-shot dilution is being reused by mistake.
- **Fixer clip-test** reminder + log (clearing time trend → "your fix is getting tired").
- This feeds the Insights tab: cost-per-roll, chemistry age, "replace your stop bath."

---

## 3. The development-time database (built from primary specs)

### 3.1 Sourcing & the copyright boundary

The obvious reference (the Massive Dev Chart) is a **proprietary compilation**: its
selection and arrangement are protected even though an individual development time is a
non-copyrightable fact. So we do **not** copy it. Instead we build our own database the
same way we curated lenses and cameras: **directly from manufacturer datasheets**
(Kodak, Ilford/Harman, Adox, Foma, Bellini, Rollei, Cinestill, etc.), which publish
official PDF time/temperature/dilution tables. We record the facts, **cite the source
datasheet URL on every recipe**, and ship it as our own compilation.

A per-manufacturer agent swarm (identical pattern to the lens/camera waves) extracts
recipes from official datasheets into `data/curated-dev-times/<maker>.jsonl`, globbed at
build into `src/data/curated-dev-times.json`. Each agent gets a strict brief: source =
official datasheet only, capture dilution/EI/temp/time/agitation verbatim, cite URL,
validate ranges, dedupe.

### 3.2 Schema (`devRecipe`)

```jsonc
{
  "developer": { "make": "Kodak", "name": "XTOL" },
  "dilution": "1+1",                 // "stock", "1+1", "1+31", ...
  "film":     { "make": "Kodak", "name": "Tri-X 400" },
  "ei": 400,                          // exposure index the time is for (push/pull rows differ)
  "tempC10": 200,                     // 20.0 °C as tenths (atproto has no float)
  "timeSec": 405,                     // base time at that temperature
  "agitation": {                      // structured so the metronome can drive it
    "initialSec": 30, "everySec": 60, "forSec": 10, "note": "4 inversions"
  },
  "process": "bw",                    // bw | c41 | e6 | monobath
  "source": "https://…/xtol-datasheet.pdf",
  "notes": "Continuous agitation first 30s"
}
```

- **User recipes** are the same shape as a real lexicon record
  (`app.graycard.catalog.devRecipe`) so a photographer can save "my Tri-X in XTOL 1+1"
  and have the timer default to it. Curated (bundled) + personal (in-repo) merge exactly
  like curated lenses + your own gear.
- A **"suggest a recipe"** GitHub-issue flow (mirroring "suggest a lens") lets users
  contribute datasheet-sourced entries.

### 3.3 Temperature handling (datasheet-only; decided)

**Decision: we do not extrapolate off-datasheet.** Times are published at reference
temperatures; we store exactly the temperature points a manufacturer publishes and:

1. **Interpolate only between published points** for the same recipe (e.g. a datasheet
   giving 20 °C and 24 °C lets us show 22 °C as a straight interpolation: still real
   data, bounded by real endpoints).
2. **Outside the published range, we don't guess.** The timer shows only the
   temperatures the datasheet supports; for anything else it says *"no datasheet time
   for 26 °C; dial in and log your own."*
3. **Always log the actual time/temp used.** Over time your own logged sessions become a
   personal recipe source, and the app can surface "you usually run this combo at 24 °C
   for 5:30"; grounded in your data, never in a coefficient guess.

This keeps every displayed time traceable to a manufacturer source or to your own logged
history, which matters most for colour (C-41/E-6), where extrapolation would be actively
dangerous.

---

## 4. Scanning tab

Scanning is currently just a scanner instance + a scan profile. Make it a first-class
session so the roll's digital life is captured and frames link back to exposures.

### 4.1 `process.scan` + `scanFrame`

- **Scan session:** scanner used, scan profile (dpi, bit depth, colour space, software,
  negative/positive, dust removal, multi-exposure passes), holder/wet-or-dry, IT8
  calibration target used + date, the roll(s), timestamp, notes.
- **Frame linking (the payoff):** scanning a roll produces `scanFrame` links that bind
  **exposure ⇄ scanned photo (AT-URI)**. This is the missing bridge between the frame you
  logged in-camera and the grain photo you uploaded; it closes the loop so a public
  photo can inherit its exposure's gear/aperture/location automatically.
- **Batch:** "scan roll → 36 frames," auto-numbering frames and matching them to logged
  exposures by frame index (with a manual reconcile UI for gaps).

### 4.2 Scan profiles & calibration

- Promote **scan profiles** to reusable catalog types with the type/instance distinction
  (a "profile" is a type; "this scan run used profile X" is the instance usage).
- Track **calibration** (IT8 target, ICC profile, last calibrated) and nudge when stale.
- A lightweight **scanning checklist** (clean glass, calibrate, preview, set black/white
  point, scan, verify) as a workflow stage type (same engine as §5).

---

## 5. Workflow tab (the thread that stitches stages)

Templates already exist; make them the connective tissue.

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
- **Board view:** a simple kanban of rolls by current stage ("3 rolls shot, awaiting
  develop; 1 drying; 2 ready to scan"): the darkroom equivalent of a project tracker,
  and a great candidate for the live-artifact treatment.

---

## 6. Rules tab (automate the metadata busywork)

Reframe "batch rules" into a small, consistent **rule engine**: *when a condition holds,
suggest or apply a change.* Everything runs **preview → approve → apply** (never silent),
consistent with the EXIF-is-a-suggestion principle we already agreed.

**Rule kinds:**
- **Gear tagging**: "EXIF camera = Nikon F2 and no graycard camera set → *suggest*
  instance #7119573." Suggestions only when unambiguous; surfaced for approval otherwise
  (honoring the two-F2 ambiguity rule).
- **Defaulting**: "roll = Tri-X and develop stage empty → default recipe XTOL 1+1."
- **Batch edit**: bulk set/clear a field across a selection (already partly built).
- **Derivation**: compute values (35 mm-equivalent focal length, coarse location cell).
- **Lint / validation**: *flag* rather than change: "these 4 photos have no lens,"
  "this roll has 37 exposures logged but 36 frames," "fixer past capacity."

**Triggers:** on-demand (run now), on-import (new grain photos), on-session-complete
(after a scan links frames). **Scope:** a gallery, a roll, a shoot, or a selection.

A **rule builder** (condition rows + action rows + live preview count) plus a **preset
library** (the current `RULE_PRESETS`, expanded). Rules are stored as `rule.batch`
records extended with a trigger + kind.

---

## 7. Cross-cutting improvements (the "as a whole" part)

- **Tab order follows the production flow** (as we did placing Shoots between Film and
  Darkroom): `Setup → Film → Shoots → Darkroom → Scan → Edit → Print → Workflows →
  Rules → Insights`. Each tab is a stage; Workflows/Rules/Insights are the meta-tools.
- **One session-logger component family** behind shots, development, and scanning: same
  offline outbox, same big-control ergonomics, same resume behavior.
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

1. **Dev-time DB pipeline + schema** (`devRecipe`, JSONL, build glob, a first
   manufacturer or two by hand to prove the shape). Unblocks the timer.
2. **Development timer + `process.development`**: offline, timestamp-based,
   with chemistry decrement. Highest user value.
3. **Full dev-time swarm** across manufacturers (once the schema is proven).
4. **Scan session + frame⇄photo linking**: closes the exposure→public-photo loop and
   makes the profile filters far richer.
5. **Workflow runs wired to session actuals** + the roll board.
6. **Rule engine refactor** (preview/approve/apply, triggers, builder, lint rules).
7. **Print bench** + per-domain Insights (last).

---

## 9. Decisions (resolved)

- **Scope:** build the whole roadmap (§8), in order: dev DB + timer, scan linking,
  workflow runs, and the rule engine.
- **Timer process scope:** **B&W *and* colour (C-41/E-6) from the start.** The step model
  and per-step temperature tolerance are first-class, so a 38 °C ±0.3 °C colour run and a
  relaxed 20 °C B&W run use the same engine.
- **Temperature:** **datasheet-only** (§3.3): interpolate within published points,
  never extrapolate; otherwise "dial in and log your own."

### Still worth confirming as we go
- **Recipe seeding:** which developers/films are on your actual shelf, so the first
  hand-built wave covers what you use before the manufacturer swarm.
- **Timer surface:** dedicated full-screen tool (like the shot logger) is the default;
  we can also embed a compact version inside a workflow run's develop stage later.
