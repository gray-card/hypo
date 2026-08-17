# Panproto cross-binding conformance corpus

`manifest.json` identifies records already used by the web or iOS test suites. Both clients read
those exact files. `oracle.json` records the canonical JSON produced by the official Panproto
TypeScript 0.70.1 binding for identity `lift`, `get`, and `put` operations. The PanprotoKit test
runs the same records through the official Swift 0.70.1 binding and compares every result with the
checked-in oracle.

Regenerate the oracle after an intentional lexicon or fixture change:

```sh
npm run generate:panproto-conformance
```

Then run both sides of the gate:

```sh
npm run check:panproto-conformance
swift test --package-path apps/ios/Packages/PanprotoKit -Xswiftc -warnings-as-errors
```

The rich existing fixtures are always parsed, emitted, and validated. Panproto 0.70.1 cannot carry
records through an identity lens when their populated values traverse certain `ref` or array-item
edges. The manifest therefore names reduced, still schema-valid identity records for the affected
develop-session and meter cases. The required `temps` array prevents such a reduction for
`catalog.devRecipe`, so that case remains a cross-binding parse/emit/validation check. This is
recorded explicitly in the manifest rather than hidden by a skipped test.

The corpus does not claim to test a version-changing migration: the repository has no checked-in
non-identity release chain yet. Add cases for both endpoints when such a chain is reviewed and
committed.
