# Hypo for iOS

Hypo for iOS is the native field and darkroom client for the shared `app.graycard.*` metadata model. It
meters scenes, logs exposures, and guides development. It is not the Gray Card photo editor.

## Requirements

- Xcode 16.4; CI selects `/Applications/Xcode_16.4.app` on `macos-15`
- Swift 6.1 or later in Swift 6 language mode
- iOS 17 or later
- SwiftLint for the complete local gate (`brew install swiftlint`)

Open `Hypo.xcworkspace`, not the project inside `App/`. The `Hypo` scheme is shared.

## Layout

The app target is a composition root. Each capability is an independent local Swift package:

| Package          | Responsibility                                           | May depend on                                   |
| ---------------- | -------------------------------------------------------- | ----------------------------------------------- |
| `HypoLexicon`    | Record values and validators                             | Foundation only                                 |
| `PanprotoKit`    | App boundary over Panproto 0.70.1                        | `HypoLexicon`, `Panproto`, `PanprotoStructural` |
| `DesignSystem`   | Tokens and SwiftUI components                            | SwiftUI only                                    |
| `DiagnosticsKit` | Bounded, opt-in device-local operational diagnostics     | Foundation only                                 |
| `PhotometryKit`  | Exposure mathematics                                     | Foundation only                                 |
| `TimerEngine`    | Wall-clock schedules and temperature calculations        | Foundation only                                 |
| `CatalogKit`     | Bundled catalog search and provenance                    | Foundation only                                 |
| `PersistenceKit` | Local persistence abstractions                           | Foundation only                                 |
| `ATProtoClient`  | Native OAuth, DPoP, and repo XRPC                        | Apple security/network frameworks               |
| `SyncKit`        | Durable offline outbox, cache, conflicts, reconciliation | `PersistenceKit`                                |
| `MeterEngine`    | AVFoundation sampling, calibration, and spot math        | `PhotometryKit`                                 |
| `Features/*`     | Meter, logger, timer, and companion library UI           | Declared capabilities only                      |

Feature packages depend on the capabilities they declare. `LibraryFeature` reuses
`LoggerFeature` types, and `SettingsFeature` reuses `MeterFeature` calibration types.
The app target wires live implementations; no package depends on the app target.

`PanprotoKit` adopts the official
[`panproto-swift`](https://github.com/panproto/panproto-swift) package at exactly `0.70.1`. The default
`Panproto` and `PanprotoStructural` products are the only Panproto products allowed in the iOS application.
The parse, project, git, and VCS tiers belong in macOS tooling, not the shipped phone binary.

## Build and test

Run the complete local gate from the repository root:

```sh
apps/ios/Scripts/check.sh
```

This is the same unsigned release gate used for iOS pull requests and pushes to
`main`. It checks generated Lexicon, OAuth, and catalog artifacts; Swift formatting
and lint; every package test suite with warnings as errors; simulator and device-SDK
compilation; the iOS 17 minimum; and the compiled app's identity, version, privacy
manifest, camera disclosure, and arm64 slice. CI retains the two unsigned app bundles
and their SHA-256 checksums for 14 days as build evidence.

The release-metadata checks can also be run without compiling the app:

```sh
apps/ios/Scripts/release-preflight.sh
```

Lexicon models are generated from the repository's root `lexicons/` directory and checked in so Xcode does not require a Node build-tool plugin. Regenerate and verify them with:

```sh
node apps/ios/Scripts/generate-hypo-lexicon-swift.mjs
node apps/ios/Scripts/generate-hypo-lexicon-swift.mjs --check
```

The native OAuth constants and metadata derive from the same `src/oauthScope.js`
value used by web Hypo:

```sh
node scripts/gen-client-metadata.mjs
node scripts/gen-client-metadata.mjs --check
```

Stage the canonical content-addressed web catalog for the app bundle with:

```sh
node apps/ios/Scripts/stage-catalog-snapshot.mjs
node apps/ios/Scripts/stage-catalog-snapshot.mjs --check
```

See [ADR 0002](Documentation/Architecture/0002-monorepo-lexicon-code-generation.md) for the source-of-truth and conformance policy.

Run one package while developing it:

```sh
swift test --disable-sandbox --package-path apps/ios/Packages/PhotometryKit
```

Build the application without a signing identity:

```sh
xcodebuild \
  -workspace apps/ios/Hypo.xcworkspace \
  -scheme Hypo \
  -sdk iphonesimulator \
  -arch arm64 \
  -disableAutomaticPackageResolution \
  -onlyUsePackageVersionsFromResolvedFile \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Application builds consume
`Hypo.xcworkspace/xcshareddata/swiftpm/Package.resolved`. Standalone
`PanprotoKit` tests consume `Packages/PanprotoKit/Package.resolved`; release
preflight requires both locks to carry the same reviewed Panproto 0.70.1 pin.

The repository sandbox used by some development tools may require `--disable-sandbox` for SwiftPM manifests.
This does not disable the iOS application sandbox.

## API documentation

Every first-party Swift package has a DocC catalog. Build and merge the package references and tutorials, stage them beside the Docusaurus sources, and build the complete site with:

```sh
npm run docs:build:combined
```

The generated API site is available under `docs/site/build/ios-api/`. CI compiles every catalog with warnings treated as errors and publishes the merged output at `https://hypo.graycard.app/docs/ios-api/`. The Docusaurus [Lexicon reference](https://hypo.graycard.app/docs/reference/lexicons/) remains canonical for public record fields.

There is no Rust package in the iOS app, so `cargo clean` has no target here. Clean
local Swift products, dependency checkouts, custom build directories, retained
Xcode evidence, generated documentation output, and JavaScript build caches with:

```sh
apps/ios/Scripts/clean-packages.sh
```

Run this after each local validation cycle; the next build will resolve the pinned
dependencies again.

## TestFlight releases

The `iOS TestFlight` workflow accepts `ios-vX.Y.Z` tags and manual dispatches. A tag
must match `MARKETING_VERSION` and point to a commit in `origin/main`; a manual upload
must be dispatched from `main`. Both paths rerun the complete unsigned release gate
and the composed UI acceptance suite against the exact upload commit before reading
signing credentials. A signed archive uses
`github.run_number * 1000 + github.run_attempt` as `CFBundleVersion`; thus a workflow
rerun cannot reuse the previous TestFlight build number. The workflow validates the
signed app and extension entitlements, exports one local IPA, retains that IPA and the
signed archive with checksums for 30 days, and explicitly uploads the same IPA once to
App Store Connect. It does not submit a build for App Review or assign it to an external
testing group.

Configure a protected GitHub environment named `testflight` with required reviewers
and these secrets:

- `APP_STORE_CONNECT_API_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_API_PRIVATE_KEY_BASE64`
- `APPLE_TEAM_ID`
- `IOS_DISTRIBUTION_CERTIFICATE_P12_BASE64`
- `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`
- `IOS_PROVISIONING_PROFILE_BASE64`
- `IOS_TIMER_ACTIVITY_PROVISIONING_PROFILE_BASE64`
- `IOS_SYSTEM_INTEGRATION_PROVISIONING_PROFILE_BASE64`

The three provisioning profiles must be App Store distribution profiles for
`app.graycard.hypo`, `app.graycard.hypo.TimerActivity`, and
`app.graycard.hypo.SystemIntegration` on the configured Apple team. The workflow
verifies every application identifier before signing. The main App ID and profile
must authorize the `iCloud.app.graycard.hypo` CloudKit container and the
`applinks:hypo.graycard.app` Associated Domain. Publish an unsigned
`apple-app-site-association` JSON document at
`https://hypo.graycard.app/.well-known/apple-app-site-association` before distributing
a build. Replace `APPLE_TEAM_ID` with the app's 10-character Application Identifier
Prefix:

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["APPLE_TEAM_ID.app.graycard.hypo"],
        "components": [
          {
            "/": "/app/*",
            "comment": "Open Hypo application routes in the installed iOS app."
          }
        ]
      }
    ]
  }
}
```

Serve the extensionless file as `application/json` over HTTPS without a redirect.
Verify the deployed response before uploading the first build:

```sh
curl --fail --show-error --silent --location \
  --write-out '\nstatus=%{http_code} content-type=%{content_type} redirects=%{num_redirects}\n' \
  https://hypo.graycard.app/.well-known/apple-app-site-association
```

The expected result is status `200`, content type `application/json`, and zero
redirects.
Cross-device decryption requires the user to enable iCloud Keychain so the
synchronizable data key can roam. The workflow maps each embedded target to its own profile for
archive and export, then removes the keychain, profiles, and API key at the end of the
job. It inspects the archive and exported IPA with `codesign`, requiring the app and
System Integration extension to retain the reviewed app group and requiring the app
to retain its private CloudKit container and service. Until the protected environment,
all three App IDs, and the App Store Connect app record exist, the workflow fails
before signing rather than attempting an unsigned or partially configured upload.

The app privacy manifest declares the DID or handle used for repository writes as a
linked user ID and retained photographic metadata as linked other user content. It
also declares the device, sensor, and optional precise-location categories used by
opt-in private meter sync. Every declared use is app functionality; none is used for
tracking. Required-reason entries cover app-local and app-group `UserDefaults` plus
system boot time used to reconstruct the absolute time of a Core Motion sample; the
SystemIntegration extension separately declares its app-group preference access.
Private meter sensor payloads are AES-GCM ciphertext in the user's private
CloudKit database. Record IDs, capture and modification times, deletion flags, and a
short key fingerprint remain readable to CloudKit so devices can validate keys, merge
records, and propagate deletion.
Before TestFlight, deploy the `PrivateMeterCaptureContextV1` record type to the
production CloudKit schema with `payload` (Bytes), `capturedAt` and `modifiedAt`
(Date/Time), `isDeleted` and `envelopeVersion` (Int64), and `keyFingerprint` (String). Development-schema
creation is not a substitute for deploying that production schema.
Private context keeps separate timestamps for the meter reading, context collection,
Core Motion sample, and optional location fix. Consumers must not treat the sensor
samples as simultaneous with the reading merely because they share a private context.

`ITSAppUsesNonExemptEncryption` is `false`: Hypo uses standard TLS supplied by the
platform and CryptoKit AES-GCM for user-controlled private data, and the release is
classified as using exempt encryption. The account holder must confirm that
classification in App Store Connect and retain any export-compliance documentation
Apple requests; changing the cryptography requires another review.

Operational diagnostics are off by default and remain on the device until the user
exports or deletes them in Settings. Events use reviewed operation and outcome tokens;
they cannot contain analytics identifiers, account IDs, URLs, record payloads, raw
errors, location, or camera and meter sensor values. Turning diagnostics off deletes
their local history.

## Panproto boundary

Panproto's Swift API is isolated to its thread-pinned `PanprotoEngine` global actor. App and feature code use
`PanprotoKit` protocols and sendable value results; they do not retain engine handles. A single Lexicon document
can be inspected at runtime with `SchemaHandle.parseAtprotoLexicon`. Cross-document schema suites and migration
chains must be assembled and verified by the build-time lexicon pipeline, then shipped as reviewed artifacts.

See [ADR 0001](Documentation/Architecture/0001-modular-workspace-and-panproto.md).

## Current hardware boundary

The simulator uses package fakes and deterministic traces. The AVFoundation pipeline
negotiates RAW and processed capture, records fallback provenance, and converts Bayer
and processed RGB samples, but incident diffusers, per-device characterization, and the
accuracy release gate require physical iPhones and reference-meter testing. The
published Panproto 0.70.1 XCFramework also contains two simulator objects stamped with
a 26.5 minimum; they link into the iOS 17 app with warnings. The app does not rebuild
Panproto with Cargo as a workaround.
