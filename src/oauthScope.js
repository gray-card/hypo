// oauthScope.js: the exact, minimal OAuth permission scope this app requests.
//
// We move away from the broad transitional `transition:generic` grant (which lets
// an app create/update/delete ANY record in the repo) to granular atproto scopes:
// one `repo:<nsid>` per collection we actually WRITE, plus `blob:*/*` for image
// uploads. Reads of public records need no scope, so none are requested. No
// `rpc:`/`identity:`/`account:` scopes — we only touch the user's own repo and
// read the public appview unauthenticated.
//
// Derived from the namespace map so it can't drift from the code, and mirrored
// verbatim into public/client-metadata.json (asserted equal by a test).

import { NS, CATALOG_KINDS, INSTANCE_KINDS } from "./graycard.js";

// exactly the collections the app creates / updates / deletes.
export const WRITTEN_COLLECTIONS = [
  // catalog "types" created behind gear (cameraType, lensType, … paperType)
  ...CATALOG_KINDS.map((k) => NS.catalog[k]),
  // the user's own gear instances
  ...INSTANCE_KINDS.map((k) => NS.instance[k]),
  // darkroom / scanning / maintenance sessions
  NS.process.developSession, NS.process.digitizeSession, NS.process.maintenanceSession,
  // shoots
  NS.session.capture,
  // workflows (template + per-photo runs/stages)
  NS.workflow.template, NS.workflow.run, NS.workflow.stage,
  // per-photo graycard metadata
  NS.photo.capture, NS.photo.workflow,
  // gallery defaults
  NS.gallery.defaults,
  // batch rules
  NS.rule.batch,
  // scene graph (tags/regions/relations)
  NS.scene.graph, NS.scene.node, NS.scene.edge, NS.scene.region,
  // public "setup" record that opts the user into cross-network Discover
  NS.setup,
  // the grain collections we write to on the user's behalf (upload + EXIF + linking)
  "social.grain.gallery", "social.grain.photo", "social.grain.gallery.item", "social.grain.photo.exif",
];

// the OAuth scope string: base `atproto`, one repo write-scope per collection, and
// blob uploads. (A `repo:` scope covers create+update+delete for that collection.)
export const OAUTH_SCOPE = ["atproto", ...WRITTEN_COLLECTIONS.map((c) => `repo:${c}`), "blob:*/*"].join(" ");
