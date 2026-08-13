---
title: Schema development setup
description: Regenerate Hypo's lexicon artifacts and run the focused schema checks.
---

# Schema development setup

This developer tutorial takes a source lexicon through the **schema derivation path** (SDP): JSON lexicon → TypeScript runtime → readable reference page → focused verification. The same source files thus control validation, editor completion, and documentation.

## 1. Install the workspace

From the repository root, install the pinned dependencies:

```bash
npm install
```

## 2. Generate the runtime and documentation

Generate the TypeScript package first, then the one-page-per-NSID reference:

```bash
npm run generate:lexicons
node scripts/generate-lexicon-docs.mjs
```

The second command rewrites `docs/reference/lexicons/`, the generated sidebar data, and the counts used on the documentation home page. It also fails before writing if a lexicon ref cannot be resolved.

## 3. Inspect one NSID

Open [`app.graycard.instance.camera`](../reference/lexicons/app.graycard.instance.camera.md). Its `main` definition shows the required `type` and `createdAt` fields, blob limits, and the resolved record key.

The source of that page is `lexicons/app/graycard/instance/camera.json`. Edit the JSON, not the generated Markdown.

## 4. Run the focused checks

```bash
npm test -- tests/lexiconCodegen.test.js tests/lexiconDocs.test.js
```

These tests check both derived surfaces: the runtime namespace and validator package, and the documentation page set. You now have a reproducible path from a lexicon edit to the artifacts a client consumes.

Next, [build and validate a first record](./first-record.md).
