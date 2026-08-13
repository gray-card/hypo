---
title: Validate a record
description: Check an unknown value against an app.graycard record NSID.
---

# Validate a record

Import `validateRecord` and a generated collection constant from `@hypo/lexicon`:

```ts
import { NS, validateRecord } from "@hypo/lexicon";

const result = validateRecord(NS.instance.camera, unknownValue);

if (!result.success) {
  for (const issue of result.issues) {
    console.error(issue.path, issue.message);
  }
}
```

Use `assertRecord` when the caller should throw on invalid input:

```ts
import { assertRecord, NS } from "@hypo/lexicon";

assertRecord(NS.instance.camera, unknownValue);
```

The runtime resolves refs and union members. But it deliberately treats `knownValues` as an open set, following AT Protocol semantics; an unfamiliar string does not by itself make a record invalid.

Run the validator tests with:

```bash
npm test -- tests/lexiconCodegen.test.js
```
