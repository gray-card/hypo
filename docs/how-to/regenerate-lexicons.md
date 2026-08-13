---
title: Regenerate lexicon artifacts
description: Refresh TypeScript and documentation outputs after a lexicon edit.
---

# Regenerate lexicon artifacts

After editing `lexicons/**/*.json`, run both generators from the repository root:

```bash
npm run generate:lexicons
node scripts/generate-lexicon-docs.mjs
```

Then run the focused checks:

```bash
npm test -- tests/lexiconCodegen.test.js tests/lexiconDocs.test.js
```

Review the generated diff. In particular, check (i) the TypeScript type and namespace changes under `packages/lexicon/src/` and (ii) the matching NSID page under `docs/reference/lexicons/`.

Do not edit the generated files by hand. The next generator run will replace them.
