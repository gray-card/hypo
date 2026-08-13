---
title: Generated TypeScript package
description: Runtime schemas, namespaces, types, and validators exported by @hypo/lexicon.
---

# Generated TypeScript package

The private workspace package `@hypo/lexicon` is generated from `lexicons/**/*.json`. Its exports keep collection strings, TypeScript shapes, and runtime validation attached to the same schema source.

## Public surfaces

| Export              | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| `NS`                | Nested collection constants, such as `NS.instance.camera`   |
| `RECORD_NSID_LIST`  | Readonly list of every record collection                    |
| `CATALOG_KINDS`     | Catalog collections that the client may write               |
| `ALL_CATALOG_KINDS` | All catalog collection names, including static catalog data |
| `INSTANCE_KINDS`    | Instance collection names                                   |
| `SCHEMAS`           | Runtime table containing every source lexicon               |
| `KNOWN_VALUES`      | Known-value arrays indexed by source path                   |
| `validateRecord`    | Non-throwing record validation with structured issues       |
| `assertRecord`      | Throwing assertion for a record boundary                    |

Named TypeScript aliases are generated for every definition. For instance, `app.graycard.instance.camera#main` becomes `AppGraycardInstanceCameraMain`.

## Imports

Use the package root for general application code:

```ts
import { NS, validateRecord } from "@hypo/lexicon";
```

The package also exposes narrower paths for code that benefits from explicit chunk boundaries:

```ts
import { NS } from "@hypo/lexicon/namespaces";
import { validateRecord } from "@hypo/lexicon/validators";
```

`@hypo/pds` loads the validator path lazily on the first validated write.

## Regeneration

Run the TypeScript generator and its focused test:

```bash
npm run generate:lexicons
npm test -- tests/lexiconCodegen.test.js
```

Run the documentation generator separately after the same schema edit:

```bash
node scripts/generate-lexicon-docs.mjs
npm test -- tests/lexiconDocs.test.js
```
