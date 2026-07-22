#!/usr/bin/env node
// gen-client-metadata.mjs: write the requested OAuth scope into the static
// public/client-metadata.json so it always matches src/oauthScope.js (the
// requested scope must be a subset of what the client metadata declares).
//
//   node scripts/gen-client-metadata.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OAUTH_SCOPE } from "../src/oauthScope.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "public", "client-metadata.json");

const meta = JSON.parse(readFileSync(FILE, "utf8"));
meta.scope = OAUTH_SCOPE;
writeFileSync(FILE, JSON.stringify(meta, null, 2) + "\n");
console.log(`client-metadata.json scope set (${OAUTH_SCOPE.split(" ").length} tokens)`);
