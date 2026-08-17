# Pinning and bumping the lexicons

Build and review the schema and migration artifacts that Hypo ships, then advance the pinned
release as one tested change.

## Keep three versions distinct

Hypo pins three related inputs:

1. The `panproto-swift` package and its engine XCFramework. PanprotoKit currently resolves the
   exact `0.70.1` package release.
2. The Hypo lexicon release label written in a record's optional `schemaVersion` field.
3. The reviewed chain set that relates supported lexicon releases.

Matching these versions does not, by itself, prove that every record can migrate. Each chain must
also instantiate at its bundled source schema, and representative records must pass the forward
and round-trip fixtures for that release pair.

## Assemble artifacts at build time

Assemble the entire cross-file lexicon suite before producing an app bundle. A call to
`SchemaHandle.parseAtprotoLexicon(_:)` sees one document and represents references into other
documents as placeholders; it is suitable for a single-document fixture, not for production
suite assembly.

The build pipeline should:

1. Assemble and validate the full lexicon suite.
2. Serialize each released structural `Schema` with PanprotoStructural's deterministic CBOR
   encoder.
3. Compile or load each reviewed migration, retaining its complete runnable chain JSON.
4. Test the chain at its declared source and target releases against the release corpus.
5. Copy only the approved schema definitions, chain documents, release catalog, and fixtures into
   the application bundle.

PanprotoKit restores a schema with `SchemaHandle.define(_:)`. It loads a chain with
`ProtolensChainHandle.fromJSON(_:)` and instantiates it at the source schema. Do not substitute
`stepSummaries()` output for full-chain JSON: summaries omit the transforms and complement
constructor required to run the lens.

## Interpret record releases

An explicit `schemaVersion` is authoritative. PanprotoKit looks up that exact label and validates
the record against that release. An unknown label or a mismatch is reported as a typed fault; the
resolver does not try another release merely because it accepts the bytes.

An unlabeled record has no authoritative release claim. In that case, pass the supported releases
to `PanprotoRecordMigrator/interpretRelease(of:releasesNewestFirst:)` in newest-first order. The
resolver selects the first schema that can parse and validate the record, and marks the result as
`PanprotoReleaseEvidence/compatibleUnlabeled`. This result is a compatible interpretation, not
proof of which schema the producer used.

## Choose lift or reversible projection

Use `PanprotoRecordMigrator/forwardLift(_:using:)` when an older record is read into the pinned
schema and later written as a pinned record. This path uses the compiled migration's structural
forward lift and does not produce a complement.

Use `PanprotoRecordMigrator/get(_:using:)` and
`PanprotoRecordMigrator/put(editedView:complement:using:)` when an older client presents a view
of a newer record and must write the newer form back without discarding fields it cannot display.
`get` returns the view and deterministic CBOR for the Panproto `Complement`; `put` consumes the
edited view and those same bytes.

## Keep complements in custody

Treat `PanprotoOpaqueComplement` as opaque. Persistence should store its `rawValue` under the
tuple `(record URI, native CID, chain ID)`. The tuple ties the complement to (i) the logical record,
(ii) the exact source revision projected, and (iii) the migration that captured it. Do not reuse a
complement after the source CID or chain changes.

Two typed failures require a fresh projection rather than a retry with the same custody entry:

- `PanprotoFault/complementFingerprintMismatch(left:right:)` means the complement was captured
  against a different source schema.
- `PanprotoFault/complementConflict(kind:key:)` means two complement entries disagree for the
  same structural key.

Other parse, validation, and migration failures are also mapped to `PanprotoFault` so callers do
not branch on Panproto engine messages.

### Panproto 0.70.1 fingerprint normalization

Panproto 0.70.1 may report a lens `put` mismatch as `source fingerprint mismatch: complement has
…, lens expects …`. That decimal spelling is not recognized by the binding's structured-fault
parser, which expects the engine's other fingerprint form. `PanprotoFault.wrapping(_:)` therefore
normalizes this exact message to `complementFingerprintMismatch` after first checking the official
structured fault. The test `panproto0701DecimalFingerprintMessageIsNormalized` is the removal
gate: when an adopted upstream binding recognizes the decimal form, delete the fallback parser and
keep the test passing through the official structured-fault path.

## Bump a release

To bump the pinned lexicons:

1. Add the new assembled schema definition without removing schemas still needed for reading.
2. Add reviewed forward chains from supported older releases to the new pinned release.
3. Add backward-view chains needed by the oldest client version still expected to edit new
   records.
4. Run schema, compatibility, forward-lift, get/put, malformed-complement, fingerprint-mismatch,
   and record-corpus tests.
5. Change the pinned release label only after the artifact set and fixtures pass together.
6. Remove an old schema or chain only when the support policy no longer requires records or clients
   at that release.

These checks establish what the committed fixtures cover. They do not replace corpus expansion
when a new record shape or lexicon feature appears.

## Panproto references

- [Panproto Swift SDK reference](https://github.com/panproto/panproto/blob/v0.70.1/book/src/reference/sdk-swift.md)
- [Define a schema from Swift](https://github.com/panproto/panproto/blob/v0.70.1/book/src/how-to/define-schema/swift.md)
- [panproto-swift 0.70.1 source](https://github.com/panproto/panproto-swift/tree/v0.70.1)
- [Panproto C ABI contract](https://github.com/panproto/panproto/blob/v0.70.1/crates/panproto-c/CONTRACT.md)
