# Hypo for iOS backlog status

This file tracks implementation against `04-graycard-ios-backlog.md`. A checked
item means the story's current acceptance criteria are implemented and tested;
partial items name the remaining boundary.

## M0 foundations

- [x] I1.1 — Swift 6 modular workspace, thin iOS app target, dependency graph,
      strict format/lint/package-test gates, simulator and unsigned device-SDK build
      lanes, compiled-artifact validation, and retained CI build evidence.
- [x] I1.2 — ATProtoKit evaluation and client ADR.
- [x] I1.3 — Panproto 0.70.1 is pinned; all 59 monorepo Lexicons generate typed
      Swift records, open known-value wrappers, validation metadata, source hashes,
      and a regeneration-diff gate.
- [x] I1.4 — the shared TypeScript/Swift corpus covers instance camera and film
      roll, catalog development recipe, process development session, meter reading,
      and meter calibration records. Both clients validate the corpus and compare
      generated Panproto oracle results; supported identity projections assert
      lift/get/put round trips.
- [x] I1.5 — PKCE, DPoP, nonce handling, DID/handle/PDS discovery, AS metadata
      validation, PAR, token exchange/refresh, callback validation, iOS browser
      presentation, Keychain custody, the composed sign-in state machine, and two
      provider topologies are implemented and tested.
- [x] I1.6 — repository get/list/create/put/delete and three-state CAS semantics
      pass through the production client boundary against an in-process XRPC fixture
      PDS, including stale update and delete conflicts.
- [x] I1.7 — shared error taxonomy and presentation boundary.

## Persistence, synchronization, and catalog

- [x] I2.1 — versioned SwiftData persistence, explicit migrations, atomic
      transactions, corrupt-row handling, and an in-memory preview store.
- [x] I2.2 — durable create/put/delete outbox, CAS metadata, backoff state, and
      temporary-URI reconciliation.
- [x] I2.3 — foreground, post-enqueue, NWPathMonitor reconnect, and
      BGAppRefreshTask scheduling use the exact-once flush guard.
- [x] I2.4 — cached records, operation patches, and AsyncSequence changes.
- [x] I2.5 — conflicts are parked with local and remote evidence and appear in an
      account-scoped needs-attention UI with rebase and discard actions.
- [x] I2.6 — offline mixed-operation, relaunch, retry, and convergence tests.
- [x] I3.1 — CatalogKit consumes the immutable shards built by web Hypo.
- [x] I3.2 — prefix, token, and bounded fuzzy search.
- [x] I3.3 — provenance display model.
- [x] I3.4 — content-addressed snapshots and stable item identity.

## Engines

- [x] I5.1–I5.7 — PhotometryKit conversions, solver, cine, reciprocity, zone,
      flash, and filter math.
- [x] I6.1–I6.4 — AVFoundation AE sampling, camera discovery, reflected and
      incident calculations, simulated traces, calibration, averaging, drift
      scheduling, and PDS-backed calibration hydration and reconciliation.
- [ ] I6.5–I6.7 — spot geometry, RAW/processed AVFoundation capture, Bayer and
      RGB conversion, fallback provenance, and incident calculation are implemented;
      the characterization matrix and diffuser protocol remain physical-device work.
- [x] I9.1 — absolute-date multi-stage timer, pause/skip/extend, persistence,
      and relaunch catch-up.
- [x] I9.2 — exact temperature points and opt-in interpolation.
- [x] I9.3 — periodic agitation scheduling drives CoreHaptics, audio fallback,
      visual state, and local notification cues through the production presenter.

## Panproto

- [x] I13.1 — official `panproto-swift` 0.70.1 and its iOS XCFramework replace
      the planned custom C wrapper.
- [ ] I13.2 — pin metadata and the current-release regeneration gate exist. This
      is the first Lexicon release, so a real merge-base compatibility check and
      dual-version corpus require the next version-changing release.
- [x] I13.3 — the official engine performs explicit-version selection,
      compatible inference, lift/get/put, typed faults, and opaque complement
      custody keyed by URI/CID/chain.
- [ ] I13.4 — the shared web/iOS corpus-oracle gate passes for six current-release
      records. A real version-changing chain and its dual-pin corpus require a second
      Lexicon release; an identity-chain fixture must not stand in for that evidence.
- [x] I13.5 — PanprotoKit DocC documents pins, bumping, complement custody,
      guarantees, and the 0.70.1 compatibility shim.

## Feature and release work

- [x] I7 — the Meter tab supports reflected/spot/incident configuration, camera
      preview and accessible reticle control, measured/continuous readings, achieved
      geometry, warnings, durable nine-reading memory, atomic averaged records,
      reading history, multi-spot average and EV deltas, contrast-range analysis,
      accessible Zone placement, exposure promotion, and local/PDS calibration
      management. Physical-device characterization remains separately tracked by I6.8.
- [x] Private meter context — the iPhone writer uses a strict public projection
      that omits location and motion data. Separately opted-in device, camera, motion,
      attitude, and magnetic-field context is AES-GCM encrypted locally; precise
      location has its own opt-in; optional private CloudKit roaming stores ciphertext
      using an iCloud Keychain-synchronized key; export and deletion are available.
- [x] I8.1–I8.3 — the Logger tab uses live PDS/cache data for active rolls,
      constrained quick-log values, sticky values, notes and keyboard dictation,
      shoot-scoped location opt-in, EI overrides, multiple exposures, lifecycle
      milestones, and frame detail/editing through SyncKit.
- [ ] I8.4 — the automated offline outbox and fixture-PDS convergence path is
      composed from the real Logger writer, SwiftData store, SyncEngine, sync-status
      interface, and a process-persistent deterministic transport. CI terminates and
      relaunches the app offline, reconnects it, and checks the remote exposure before
      another relaunch. The manual airplane-mode-to-web protocol still needs release
      evidence.
- [x] I9.4–I9.6 — the Timer tab selects bundled, catalog, and personal PDS
      recipes; runs timed and manual stages with provenance and darkroom treatment;
      reconciles notifications and Live Activity state; and writes a structured
      development session while advancing linked rolls.
- [x] I11 — the Library tab composes live account cache data with the immutable
      catalog, retains provenance, loads a roll from reserve, quick-adds linked camera
      and lens records, and produces production web links.
- [ ] I4 — the design controls, haptic vocabulary, darkroom treatment, adjustable
      accessibility values, Dynamic Type geometry, and contrast checks are implemented.
      A deterministic component gallery now covers the standard and darkroom appearances
      at standard and accessibility text sizes; CI checks stable vector references and
      uploads platform-rendered PNG evidence. The physical haptic fallback matrix remains.
- [x] I10 — App Intents, controls/widgets, shared extension snapshots, and
      deep-link parsing and routing are implemented and covered by package tests.
      A DEBUG-only deterministic XCUITest harness covers custom-scheme cold-start
      lifecycle, HTTPS route parsing, and the actual shared-snapshot types. Associated
      Domains and AASA hosting remain release configuration rather than simulated evidence.
- [ ] I12.1 — automated control-label, adjustable-value, Dynamic Type geometry,
      contrast, component-gallery screenshots, and a representative deterministic
      accessibility flow exist. Full VoiceOver flows and physical-device acceptance remain.
- [x] I12.2–I12.3 — all 18 Swift packages have checked DocC catalogs; the combined
      `/docs/ios-api/` site includes end-to-end roll, simulated-meter, and meter-
      calibration tutorials and builds with DocC warnings treated as errors.
- [x] I12.4 — the photographer-facing iPhone help is part of the Hypo Docusaurus
      site and distinguishes public meter records from private meter context.
- [x] I12.5 — DiagnosticsKit provides a default-off, bounded local event recorder
      with Settings opt-in, reviewed event tokens, explicit export and deletion, and
      no analytics transport. The privacy manifest declares linked user ID, other user
      content, precise location, device ID, and other sensor data for app functionality,
      with no tracking. App Store Connect answers must match these reviewed categories.
- [ ] I12.6 — pull requests and `main` run strict unsigned pre-release gates, and
      `ios-vX.Y.Z` tags from `main` or manual `main` dispatches have a fail-closed,
      protected-environment TestFlight workflow. It reruns composed acceptance against
      the upload commit, assigns a unique build number to each attempt, validates signed
      app-group and CloudKit entitlements, retains the signed IPA and archive, and uploads
      that exact IPA once. The protected credentials, App Store
      Connect app record, store metadata, screenshots, review notes, tester-group
      assignment, and a successful signed upload remain release-operations work.
- [ ] I12.7 — the current-release shared web/iOS conformance corpus is green. The
      physical-device accuracy matrix and a real version-changing Panproto corpus must
      be green and published before the 1.0 exit review.

## Release-gate boundaries

The automated gate checks generated artifacts and dependency pins; formatting and
lint; all package tests with compiler warnings as errors; Debug simulator and Release
device-SDK compilation with compiler and linker warnings as errors; the compiled
bundle identifier, version/build, iOS 17 minimum, camera, location, and motion disclosures,
privacy-manifest collection categories, and arm64 slice; and unsigned artifact checksums. TestFlight cannot run until the
protected `testflight` environment documented in `apps/ios/README.md` is configured.
On CI, an installed iOS simulator runtime also runs the composed XCUITest suite for
offline relaunch and reconnect, cold-start links, shared snapshots, and accessibility.
The signed gate additionally compares the app and System Integration privacy manifests
with their reviewed sources and inspects the app and both extensions with `codesign`.

Automation cannot satisfy the remaining release evidence: incident-diffuser and
per-device meter characterization, VoiceOver and Dynamic Type device passes, App Store
screenshots and measurement review notes, or a real version-changing Panproto
corpus. Those are release blockers, not skipped CI work.

The composed app builds for the iOS 17 simulator SDK. Panproto 0.70.1 currently
links with two upstream object-file deployment-target warnings (26.5 inside the
published XCFramework); the executable itself targets iOS 17. With linker warnings
promoted to errors, a clean gate must either confirm that Xcode 16.4 no longer emits
those warnings or fail until the upstream binary is corrected.
