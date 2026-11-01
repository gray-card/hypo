---
title: Evolve a lexicon safely
description: Change a schema, regenerate derived artifacts, and classify compatibility before release.
---

# Evolve a lexicon safely

Treat `lexicons/` as one cross-referential schema suite. A shared definition change may affect several record namespaces.

1. Edit the source JSON under `lexicons/app/graycard/`.
2. Reuse shared shapes from `app.graycard.defs` when the concept is genuinely shared.
3. Add or update representative validation tests, including invalid boundary cases.
4. Regenerate the TypeScript runtime and documentation:

```bash
npm run generate:lexicons
npm run generate:lexicon-docs
```

5. Classify suite-level compatibility against the released baseline. Required fields, removed known values, narrowed constraints, and changed ref targets may need a migration rather than a direct rollout. For a breaking change, complete [the Panproto migration procedure](./make-breaking-lexicon-change.md) before committing the suite.
6. Stage and commit the current suite and conformance corpus in the checked-in Panproto sidecar, including for additive changes:

```bash
schema add . --data fixtures/records
schema diff --staged
schema commit -m "Describe the schema change"
```

7. Run the focused checks:

```bash
npm run check:lexicons
npm run check:lexicon-docs
npm run check:panproto
npm run typecheck
npm test
```

8. Inspect the generated diff. A change that looks local may alter resolved references, validators, namespace constants, or many reference pages. Confirm the Panproto snapshot has no unstaged lexicon changes before opening the pull request.

Do not hand-edit `packages/lexicon/src/generated.ts`, `packages/lexicon/src/namespaces.ts`, or generated NSID pages. Their differences are signals from the source schema.

[How schema versions work](../explanation/schema-versions.md) explains why compatibility is evaluated at the suite boundary.
