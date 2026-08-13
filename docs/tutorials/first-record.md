---
title: Build a first record
description: Construct and validate an app.graycard record with the generated TypeScript package.
---

# Build a first record

This tutorial constructs a camera-instance record. An instance names one physical camera body; its `type` field points to a shareable [`app.graycard.catalog.cameraType`](../reference/lexicons/app.graycard.catalog.cameraType.md) record.

## 1. Use the generated namespace

In a workspace TypeScript module, import the collection constant and validator:

```ts
import { NS, validateRecord } from "@hypo/lexicon";

const camera = {
  type: "at://did:plc:example/app.graycard.catalog.cameraType/3jzn2",
  nickname: "Field F2",
  createdAt: new Date().toISOString(),
};

const result = validateRecord(NS.instance.camera, camera);

if (!result.success) {
  throw new TypeError(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
}
```

`NS.instance.camera` is generated from the schema tree, so application code does not repeat the NSID string. `validateRecord` resolves local and cross-schema refs before reporting field paths.

## 2. Observe a useful failure

Change `createdAt` to a number:

```ts
const invalidCamera = {
  type: "at://did:plc:example/app.graycard.catalog.cameraType/3jzn2",
  createdAt: 42,
};

const invalid = validateRecord(NS.instance.camera, invalidCamera);
```

The result contains an issue at `$.createdAt`. The validator reports all fields it can inspect in one pass, which makes it suitable for an editor review screen as well as a write boundary.

## 3. Verify the behavior

The focused runtime test contains both the successful and failing shapes:

```bash
npm test -- tests/lexiconCodegen.test.js
```

Before sending a record to a PDS, use the same collection and record with `@hypo/pds`; that package validates writes by default. See [Generated TypeScript package](../reference/generated-package.md) for the public surfaces.
