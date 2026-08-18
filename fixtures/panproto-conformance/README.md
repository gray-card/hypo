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

The versioned case uses the exact `v1.2.0` exposure schema retained with the reviewed release
fixtures and the current `v1.3.0` schema. The latter adds optional import identity and time-zone
fields, so the reviewed chain has no value transform. The gate still loads distinct source and
target definitions, lifts a `v1.2.0` record, validates it against `v1.3.0`, and compares Swift
lift/get/put results with the TypeScript oracle. A no-op chain here means that the released change
was additive; it does not reduce the test to a same-schema identity projection.
