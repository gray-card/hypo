# ADR 0001: Modular workspace and Panproto boundary

- Status: accepted
- Date: 2026-08-13

## Context

Hypo's phone client needs camera, persistence, synchronization, timer, and UI capabilities that have different
platform requirements and testing costs. The metadata model must also remain compatible with web Hypo while the
two clients release independently.

Panproto 0.70.1 provides official Swift bindings and a published XCFramework for iOS. Its core API isolates
engine calls to `PanprotoEngine`, a global actor backed by a pinned thread. The released package also provides a
pure `PanprotoStructural` value layer.

## Decision

The repository uses a thin iOS app project inside an Xcode workspace. Capabilities live in independent local
Swift packages with iOS 17 and macOS 14 baselines, Swift 6 language mode, and strict concurrency checking. Package
manifests enforce dependency direction; the app target contains navigation and live dependency assembly only.

`PanprotoKit` depends on
`https://github.com/panproto/panproto-swift.git` at the exact version `0.70.1` and exposes app-specific protocols
that return sendable values. It imports only the `Panproto` and `PanprotoStructural` products. It neither wraps the
C ABI nor creates a second handle type.

Runtime code may parse and validate one ATProto Lexicon document through the official binding. It must not treat
that method as a project assembler: references to other Lexicon documents remain placeholders when the engine
sees only one document. The lexicon code-generation story will therefore assemble the complete suite at build
time and ship the resulting checked artifacts. Feature-gated Panproto parse, project, and git products remain out
of the iOS dependency graph.

## Consequences

Package tests run on macOS without starting a simulator. The application can replace services with fakes without
linking UI to transport or engine details. Panproto handle lifetime and actor isolation stay inside one package.

Adding a package dependency requires reviewing this layering rule. Updating Panproto requires a deliberate exact
version change, schema and migration conformance tests, and an iOS build against the new XCFramework.
