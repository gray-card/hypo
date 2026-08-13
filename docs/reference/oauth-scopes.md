---
title: OAuth scopes
description: The production and loopback OAuth contracts used by Hypo.
---

# OAuth scopes

Hypo uses an **enumerated write grant**: the production client requests only the record collections it writes, plus blob upload. Public reads do not require a session.

The scope string is generated in `src/oauthScope.js`:

```text
atproto
repo:<each app.graycard collection Hypo writes>
repo:social.grain.gallery
repo:social.grain.photo
repo:social.grain.gallery.item
repo:social.grain.photo.exif
blob:*/*
```

The `app.graycard` portion is exact rather than namespace-wide. It contains every kind in `CATALOG_KINDS` and `INSTANCE_KINDS`, then these explicit collections:

- `process.developSession`, `process.digitizeSession`, `process.editSession`, `process.maintenanceSession`, `process.printSession`, and `process.renderSession`;
- `session.capture`;
- `meter.reading` and `meter.calibration`;
- `workflow.template`, `workflow.run`, and `workflow.stage`;
- `photo.capture` and `photo.workflow`;
- `gallery.defaults` and `rule.batch`;
- `scene.graph`, `scene.node`, `scene.edge`, and `scene.region`; and
- `setup`.

Consequently, having a lexicon in the generated `NS` table does not grant writes to it. The client does not currently request scopes for the unwritten `artifact`, `edit.recipe`, or `scene.ontology` collections. It also does not request a broad `repo:*` or `transition:generic` grant. A write grant records current Hypo behavior; it does not make an experimental schema stable.

## Production client metadata

The production `client_id` is the metadata URL:

```text
https://hypo.graycard.app/client-metadata.json
```

`public/client-metadata.json` declares the same scope, the site-root redirect URI, authorization-code and refresh-token grants, DPoP-bound access tokens, and no client secret. `tests/oauthScope.test.js` asserts that its scope matches `OAUTH_SCOPE` exactly.

When a writable collection changes, update the namespace table or explicit set in `src/oauthScope.js`, then run:

```bash
node scripts/gen-client-metadata.mjs
npm test -- tests/oauthScope.test.js
```

Changing the hosted metadata URL changes the client identifier and invalidates existing sessions. A scope change may also require users to authorize the new grant.

## Loopback development

At `http://127.0.0.1:5173`, Hypo uses atproto's loopback client behavior. A hosted metadata document is not required. Use the numeric loopback address, not `localhost`; the development server and preview server are configured accordingly.

The fixture-PDS end-to-end runtime uses a test-only scope and auth stub. It is not evidence that a production deployment may request `repo:*`.
