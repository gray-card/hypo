import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_BODY_LIMIT = 50 * 1024 * 1024;
const RECORD_CODEC = 0x71; // dag-cbor
const BLOB_CODEC = 0x55; // raw
const DEFAULT_VERSIONED_RECORDS_PATH = resolve("fixtures/records");

export const VERSIONED_FIXTURE_HANDLE = "records.graycard.test";
export const VERSIONED_FIXTURE_REPO = "did:plc:graycard-record-fixtures";

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function base32(bytes) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let buffer = 0;
  let output = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(buffer << (5 - bits)) & 31];
  return output;
}

function cidForBytes(bytes, codec) {
  const digest = createHash("sha256").update(bytes).digest();
  // CIDv1 + codec + sha2-256 multihash. Both codecs used here have one-byte
  // varints, so the representation can stay dependency-free.
  return `b${base32(Buffer.concat([Buffer.from([0x01, codec, 0x12, 0x20]), digest]))}`;
}

export function deterministicRecordCid(record) {
  return cidForBytes(Buffer.from(stableJson(record)), RECORD_CODEC);
}

export function deterministicBlobCid(bytes) {
  return cidForBytes(Buffer.from(bytes), BLOB_CODEC);
}

function encodeCursor(context) {
  return Buffer.from(JSON.stringify(context)).toString("base64url");
}

function decodeCursor(cursor, expected) {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      decoded.repo !== expected.repo ||
      decoded.collection !== expected.collection ||
      decoded.reverse !== expected.reverse ||
      typeof decoded.rkey !== "string"
    ) {
      throw new Error("cursor context does not match this query");
    }
    return decoded.rkey;
  } catch {
    throw new XrpcError(400, "InvalidRequest", "Invalid listRecords cursor");
  }
}

class XrpcError extends Error {
  constructor(status, error, message) {
    super(message);
    this.status = status;
    this.error = error;
  }
}

function required(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new XrpcError(400, "InvalidRequest", `Missing required parameter: ${name}`);
  }
  return value;
}

function requiredRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new XrpcError(400, "InvalidRequest", "record must be a JSON object");
  }
  return value;
}

function recordKey(repo, collection, rkey) {
  return `${repo}\u0000${collection}\u0000${rkey}`;
}

function recordView(entry) {
  return { uri: entry.uri, cid: entry.cid, value: clone(entry.value) };
}

function repoCommit(repo, records) {
  const snapshot = [...records.values()]
    .filter((entry) => entry.repo === repo)
    .sort((left, right) =>
      `${left.collection}\u0000${left.rkey}`.localeCompare(`${right.collection}\u0000${right.rkey}`),
    )
    .map(({ collection, rkey, cid }) => ({ collection, rkey, cid }));
  return deterministicRecordCid({ records: snapshot });
}

async function readBody(request, maxBytes = DEFAULT_BODY_LIMIT) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new XrpcError(413, "PayloadTooLarge", "Request body exceeds fixture limit");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const body = await readBody(request);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new XrpcError(400, "InvalidRequest", "Request body must be valid JSON");
  }
}

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "content-length": body.length,
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
}

function noContent(response) {
  response.writeHead(200, {
    "access-control-allow-origin": "*",
    "content-length": "0",
  });
  response.end();
}

function seedEntries(seed) {
  if (Array.isArray(seed)) return seed;
  if (Array.isArray(seed?.records)) return seed.records;
  return [];
}

async function loadVersionedRecordSeed(directory) {
  const filenames = (await readdir(directory))
    .filter((filename) => filename.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));
  const records = await Promise.all(
    filenames.map(async (filename) => {
      const value = JSON.parse(await readFile(join(directory, filename), "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.$type !== "string") {
        throw new TypeError(`Versioned fixture ${filename} must contain an object with a $type`);
      }
      return {
        repo: VERSIONED_FIXTURE_REPO,
        collection: value.$type,
        rkey: filename.slice(0, -".json".length),
        value,
      };
    }),
  );
  return {
    identities: { [VERSIONED_FIXTURE_HANDLE]: VERSIONED_FIXTURE_REPO },
    records,
  };
}

function mergeSeeds(seed, addition) {
  return {
    identities: {
      ...(!Array.isArray(seed) && seed?.identities),
      ...addition.identities,
    },
    records: [...seedEntries(seed), ...addition.records],
  };
}

/**
 * An in-process, dependency-free subset of a PDS for contract and browser tests.
 * Use createFixturePds() for the usual start/stop lifecycle.
 */
export class FixturePds {
  constructor({ host = DEFAULT_HOST, port = 0, seed, identities = {} } = {}) {
    this.host = host;
    this.requestedPort = port;
    this.port = null;
    this.server = null;
    this.initialSeed = clone(seed);
    this.initialIdentities = clone(identities);
    this.records = new Map();
    this.identities = new Map();
    this.nextRkey = 1;
    this.nextMutation = 1;
    this.reset();
  }

  get origin() {
    if (this.port === null) throw new Error("Fixture PDS has not been started");
    return `http://${this.host}:${this.port}`;
  }

  get url() {
    return this.origin;
  }

  resolveRepo(repo) {
    return this.identities.get(repo) ?? repo;
  }

  reset(seed = this.initialSeed) {
    this.records.clear();
    this.identities = new Map(Object.entries(this.initialIdentities || {}));
    this.nextRkey = 1;
    this.nextMutation = 1;
    if (seed !== undefined) this.seed(seed);
    return this;
  }

  seed(seed) {
    if (!seed || typeof seed !== "object") {
      throw new TypeError("Fixture seed must be a JSON object or record array");
    }
    if (!Array.isArray(seed) && seed.identities) {
      for (const [handle, did] of Object.entries(seed.identities)) {
        this.identities.set(handle, did);
      }
    }
    for (const fixture of seedEntries(seed)) {
      const repo = this.resolveRepo(required(fixture.repo, "repo"));
      const collection = required(fixture.collection, "collection");
      const rkey = required(fixture.rkey, "rkey");
      const value = clone(fixture.value ?? fixture.record);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`Seed record ${collection}/${rkey} must contain an object value`);
      }
      this.storeRecord(repo, collection, rkey, value);
    }
    return this;
  }

  storeRecord(repo, collection, rkey, value) {
    const uri = `at://${repo}/${collection}/${rkey}`;
    const entry = {
      repo,
      collection,
      rkey,
      uri,
      cid: deterministicRecordCid(value),
      value: clone(value),
    };
    this.records.set(recordKey(repo, collection, rkey), entry);
    return entry;
  }

  entry(repo, collection, rkey) {
    return this.records.get(recordKey(this.resolveRepo(repo), collection, rkey));
  }

  allocateRkey(repo, collection) {
    while (true) {
      const rkey = `fixture${String(this.nextRkey++).padStart(6, "0")}`;
      if (!this.entry(repo, collection, rkey)) return rkey;
    }
  }

  /**
   * Simulates an out-of-band client edit. With no record/patch/mutate argument,
   * a stable fixture-only marker is added so the CID always changes.
   */
  mutateRecord({ repo, collection, rkey, record, patch, mutate } = {}) {
    repo = this.resolveRepo(required(repo, "repo"));
    collection = required(collection, "collection");
    rkey = required(rkey, "rkey");
    const current = this.entry(repo, collection, rkey);
    if (!current) throw new XrpcError(400, "RecordNotFound", "Record not found");

    let value;
    if (typeof mutate === "function") value = mutate(clone(current.value));
    else if (record !== undefined) value = record;
    else if (patch !== undefined) value = { ...current.value, ...patch };
    else {
      value = {
        ...current.value,
        $fixtureMutation: `mutation-${String(this.nextMutation++).padStart(6, "0")}`,
      };
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Mutated record must be an object");
    }
    return recordView(this.storeRecord(repo, collection, rkey, value));
  }

  async start() {
    if (this.server) return this;
    this.server = createServer((request, response) => {
      this.handle(request, response).catch((error) => this.handleError(error, response));
    });
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server?.off("listening", onListening);
        this.server = null;
        reject(error);
      };
      const onListening = () => {
        this.server?.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.requestedPort, this.host);
    });
    this.port = this.server.address().port;
    return this;
  }

  async close() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.port = null;
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  async handle(request, response) {
    response.setHeader("access-control-allow-origin", "*");
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-headers": "atproto-proxy, authorization, content-type, dpop",
        "access-control-allow-methods": "GET, POST, OPTIONS",
      });
      response.end();
      return;
    }

    const url = new URL(request.url, this.origin);
    if (url.pathname === "/__fixture__/health" && request.method === "GET") {
      json(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/__fixture__/reset" && request.method === "POST") {
      this.reset();
      json(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/__fixture__/mutate" && request.method === "POST") {
      json(response, 200, this.mutateRecord(await readJson(request)));
      return;
    }

    const prefix = "/xrpc/";
    if (!url.pathname.startsWith(prefix)) {
      throw new XrpcError(404, "NotFound", "Unknown fixture PDS route");
    }
    const method = url.pathname.slice(prefix.length);
    if (request.method === "GET") {
      await this.handleQuery(method, url.searchParams, response);
      return;
    }
    if (request.method === "POST") {
      await this.handleProcedure(method, request, response);
      return;
    }
    throw new XrpcError(405, "MethodNotAllowed", "Unsupported HTTP method");
  }

  async handleQuery(method, params, response) {
    if (method === "com.atproto.identity.resolveHandle") {
      const handle = required(params.get("handle"), "handle");
      const did = this.identities.get(handle);
      if (!did) throw new XrpcError(400, "HandleNotFound", `Unknown handle: ${handle}`);
      json(response, 200, { did });
      return;
    }

    if (method === "com.atproto.sync.getLatestCommit") {
      const did = this.resolveRepo(required(params.get("did"), "did"));
      const cid = repoCommit(did, this.records);
      json(response, 200, { cid, rev: cid.slice(-13) });
      return;
    }

    const repo = this.resolveRepo(required(params.get("repo"), "repo"));
    if (method === "com.atproto.repo.describeRepo") {
      const collections = [
        ...new Set([...this.records.values()].filter((entry) => entry.repo === repo).map((entry) => entry.collection)),
      ].sort();
      json(response, 200, { did: repo, collections });
      return;
    }

    const collection = required(params.get("collection"), "collection");
    if (method === "com.atproto.repo.getRecord") {
      const rkey = required(params.get("rkey"), "rkey");
      const entry = this.entry(repo, collection, rkey);
      if (!entry) throw new XrpcError(400, "RecordNotFound", "Record not found");
      json(response, 200, recordView(entry));
      return;
    }

    if (method === "com.atproto.repo.listRecords") {
      const rawLimit = params.get("limit");
      const limit = rawLimit === null ? 50 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new XrpcError(400, "InvalidRequest", "limit must be an integer from 1 to 100");
      }
      const reverse = params.get("reverse") === "true";
      const rkeyStart = params.get("rkeyStart");
      const rkeyEnd = params.get("rkeyEnd");
      const context = { repo, collection, reverse };
      const cursor = params.get("cursor");
      const after = cursor ? decodeCursor(cursor, context) : null;
      let entries = [...this.records.values()].filter(
        (entry) => entry.repo === repo && entry.collection === collection,
      );
      entries.sort((a, b) => (a.rkey < b.rkey ? -1 : a.rkey > b.rkey ? 1 : 0));
      if (reverse) entries.reverse();
      entries = entries.filter((entry) => {
        if (rkeyStart !== null && entry.rkey < rkeyStart) return false;
        if (rkeyEnd !== null && entry.rkey > rkeyEnd) return false;
        if (after !== null) return reverse ? entry.rkey < after : entry.rkey > after;
        return true;
      });
      const page = entries.slice(0, limit);
      const output = { records: page.map(recordView) };
      if (entries.length > limit) {
        output.cursor = encodeCursor({ ...context, rkey: page.at(-1).rkey });
      }
      json(response, 200, output);
      return;
    }

    throw new XrpcError(404, "MethodNotFound", `Unsupported XRPC query: ${method}`);
  }

  async handleProcedure(method, request, response) {
    if (method === "com.atproto.repo.uploadBlob") {
      const bytes = await readBody(request);
      const mimeType = request.headers["content-type"] || "application/octet-stream";
      json(response, 200, {
        blob: {
          $type: "blob",
          ref: { $link: deterministicBlobCid(bytes) },
          mimeType,
          size: bytes.length,
        },
      });
      return;
    }

    const input = await readJson(request);
    const repo = this.resolveRepo(required(input.repo, "repo"));

    if (method === "com.atproto.repo.applyWrites") {
      if (!Array.isArray(input.writes) || input.writes.length === 0) {
        throw new XrpcError(400, "InvalidRequest", "writes must be a non-empty array");
      }
      const currentCommit = repoCommit(repo, this.records);
      if (input.swapCommit !== undefined && input.swapCommit !== currentCommit) {
        throw new XrpcError(400, "InvalidSwap", "swapCommit does not match the current repo commit");
      }

      // Stage the complete batch in isolation. Assignment happens only after
      // every operation succeeds, mirroring applyWrites' all-or-nothing contract.
      const stagedRecords = new Map([...this.records].map(([key, entry]) => [key, clone(entry)]));
      let stagedNextRkey = this.nextRkey;
      const stagedEntry = (collection, rkey) => stagedRecords.get(recordKey(repo, collection, rkey));
      const allocateStagedRkey = (collection) => {
        while (true) {
          const rkey = `fixture${String(stagedNextRkey++).padStart(6, "0")}`;
          if (!stagedEntry(collection, rkey)) return rkey;
        }
      };
      const stageRecord = (collection, rkey, value) => {
        const uri = `at://${repo}/${collection}/${rkey}`;
        const entry = {
          repo,
          collection,
          rkey,
          uri,
          cid: deterministicRecordCid(value),
          value: clone(value),
        };
        stagedRecords.set(recordKey(repo, collection, rkey), entry);
        return entry;
      };

      const results = [];
      for (const write of input.writes) {
        if (!write || typeof write !== "object" || Array.isArray(write)) {
          throw new XrpcError(400, "InvalidRequest", "Each write must be a JSON object");
        }
        const collection = required(write.collection, "writes[].collection");
        if (write.$type === "com.atproto.repo.applyWrites#create") {
          const rkey = write.rkey === undefined ? allocateStagedRkey(collection) : required(write.rkey, "rkey");
          if (stagedEntry(collection, rkey)) {
            throw new XrpcError(400, "RecordAlreadyExists", "Record already exists");
          }
          const entry = stageRecord(collection, rkey, requiredRecord(write.value));
          results.push({
            $type: "com.atproto.repo.applyWrites#createResult",
            uri: entry.uri,
            cid: entry.cid,
          });
          continue;
        }

        const rkey = required(write.rkey, "rkey");
        const current = stagedEntry(collection, rkey);
        if (write.$type === "com.atproto.repo.applyWrites#update") {
          if (!current) throw new XrpcError(400, "RecordNotFound", "Record not found");
          const entry = stageRecord(collection, rkey, requiredRecord(write.value));
          results.push({
            $type: "com.atproto.repo.applyWrites#updateResult",
            uri: entry.uri,
            cid: entry.cid,
          });
          continue;
        }
        if (write.$type === "com.atproto.repo.applyWrites#delete") {
          if (!current) throw new XrpcError(400, "RecordNotFound", "Record not found");
          stagedRecords.delete(recordKey(repo, collection, rkey));
          results.push({ $type: "com.atproto.repo.applyWrites#deleteResult" });
          continue;
        }
        throw new XrpcError(400, "InvalidRequest", `Unsupported applyWrites operation: ${write.$type}`);
      }

      this.records = stagedRecords;
      this.nextRkey = stagedNextRkey;
      const cid = repoCommit(repo, stagedRecords);
      json(response, 200, { commit: { cid, rev: cid.slice(-13) }, results });
      return;
    }

    const collection = required(input.collection, "collection");

    if (method === "com.atproto.repo.createRecord") {
      const rkey = input.rkey === undefined ? this.allocateRkey(repo, collection) : required(input.rkey, "rkey");
      if (this.entry(repo, collection, rkey)) {
        throw new XrpcError(400, "RecordAlreadyExists", "Record already exists");
      }
      const entry = this.storeRecord(repo, collection, rkey, requiredRecord(input.record));
      json(response, 200, { uri: entry.uri, cid: entry.cid });
      return;
    }

    const rkey = required(input.rkey, "rkey");
    const current = this.entry(repo, collection, rkey);
    if (method === "com.atproto.repo.putRecord") {
      if (input.swapRecord !== undefined && current?.cid !== input.swapRecord) {
        throw new XrpcError(400, "InvalidSwap", "swapRecord does not match the current CID");
      }
      const entry = this.storeRecord(repo, collection, rkey, requiredRecord(input.record));
      json(response, 200, { uri: entry.uri, cid: entry.cid });
      return;
    }

    if (method === "com.atproto.repo.deleteRecord") {
      if (!current) throw new XrpcError(400, "RecordNotFound", "Record not found");
      if (input.swapRecord !== undefined && current.cid !== input.swapRecord) {
        throw new XrpcError(400, "InvalidSwap", "swapRecord does not match the current CID");
      }
      this.records.delete(recordKey(repo, collection, rkey));
      noContent(response);
      return;
    }

    throw new XrpcError(404, "MethodNotFound", `Unsupported XRPC procedure: ${method}`);
  }

  handleError(error, response) {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    if (error instanceof XrpcError) {
      json(response, error.status, { error: error.error, message: error.message });
      return;
    }
    json(response, 500, { error: "InternalServerError", message: error?.message ?? "Fixture error" });
  }
}

export async function createFixturePds({
  seedPath,
  versionedRecordsPath = DEFAULT_VERSIONED_RECORDS_PATH,
  ...options
} = {}) {
  let seed = options.seed;
  if (seedPath !== undefined) {
    if (seed !== undefined) throw new TypeError("Use either seed or seedPath, not both");
    seed = JSON.parse(await readFile(seedPath, "utf8"));
  }
  if (versionedRecordsPath !== false) {
    seed = mergeSeeds(seed, await loadVersionedRecordSeed(versionedRecordsPath));
  }
  const fixture = new FixturePds({ ...options, seed });
  return fixture.start();
}
