---
title: Make a breaking lexicon change
description: Classify, migrate, and verify a breaking change to the shared lexicon suite.
---

# Make a breaking lexicon change

Use this procedure only when an additive schema change cannot express the intended contract.

## 1. Start from the released schema ref

Create a Panproto branch from the latest `lexicons-v*` tag. Keep the Git work on a corresponding feature branch so source review and schema review remain paired. The first baseline is `lexicons-v1`, released with Hypo 1.0.0.

```sh
schema checkout lexicons-v1
schema branch my-schema-change
schema checkout my-schema-change
```

## 2. Edit and regenerate

Change the JSON lexicons, then regenerate the TypeScript surface and reference pages.

```sh
npm run generate:lexicons
npm run generate:lexicon-docs
npm run typecheck
```

Review the generated diff. Open `knownValues` additions should remain open unions; removed fields, newly required fields, type changes, and tightened constraints require migration treatment.

## 3. Stage the suite and corpus

Stage from the repository root so Panproto finds `panproto.toml` and classifies shared definitions with their consumers. Include the conformance records.

```sh
schema add . --data fixtures/records
schema diff
schema status --data fixtures/records
```

Do not create a release tag if the data status is absent or stale.

## 4. Supply and verify the lens chain

Use an enrichment or an explicit lens for every breaking step. Run compatibility analysis against the release tag, type-check the migration, and exercise both directions over the corpus. A passing structural diff alone does not establish round-trip behavior.

```sh
schema compat path/to/released-suite . --protocol atproto
```

Add `[breaking-change-acknowledged]` to a commit message and describe every transition in `lenses/breaking-change.json`. A transition keeps an exact source suite, the target suite, a reviewed Panproto lens, the narrow projection schema against which the lens is instantiated, migration fixtures, and a verifier that exercises the application rewrite:

```json
{
  "transitions": [
    {
      "id": "develop-session-v2",
      "source": "lenses/develop-session-v2/source",
      "target": "lexicons",
      "lens": "lenses/develop-session-v2/lens.json",
      "projection": "lenses/develop-session-v2/projection-lexicon.json",
      "data": "lenses/develop-session-v2/fixtures.json",
      "verify": "scripts/verify-develop-session-transition.ts"
    }
  ]
}
```

The pull-request gate evaluates compatibility against the Git merge base. For an acknowledged break, it classifies each declared source-to-target transition, compiles and instantiates the Panproto lens, runs the transition fixtures through the application rewrite, and validates the results against the target suite before accepting the manifest.

The browser then consumes the verified chain at the sync boundary. It retains the opaque complement until the migrated write is acknowledged, because a backward `put` may need information that the forward view omitted.

## 5. Commit and tag both histories

After the schema gate, generated-code gate, unit tests, and cross-client corpus checks pass, commit the panproto change and create matching annotated panproto and Git tags. Record the pinned schema tag in every client release that consumes it.
