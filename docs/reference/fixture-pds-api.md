---
title: Fixture PDS API
description: Deterministic AT Protocol subset and control endpoints for end-to-end tests.
---

# Fixture PDS API

The fixture PDS is a deterministic, in-memory test server. Start it with:

```bash
node tests/fixture-pds/server.js --port 2584
```

It binds to `127.0.0.1` by default. `FIXTURE_PDS_PORT` supplies the port when `--port` is absent. The initial data comes from `tests/fixture-pds/seed.json`.

## XRPC surface

| Method | Endpoint                                   | Important parameters or body fields                                                 |
| ------ | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| GET    | `/xrpc/com.atproto.identity.resolveHandle` | `handle`                                                                            |
| GET    | `/xrpc/com.atproto.repo.describeRepo`      | `repo`                                                                              |
| GET    | `/xrpc/com.atproto.repo.getRecord`         | `repo`, `collection`, `rkey`                                                        |
| GET    | `/xrpc/com.atproto.repo.listRecords`       | `repo`, `collection`, optional `limit`, `cursor`, `reverse`, `rkeyStart`, `rkeyEnd` |
| POST   | `/xrpc/com.atproto.repo.createRecord`      | repo-write request body                                                             |
| POST   | `/xrpc/com.atproto.repo.putRecord`         | repo-write request body, optional `swapRecord`                                      |
| POST   | `/xrpc/com.atproto.repo.deleteRecord`      | repo-write request body, optional `swapRecord`                                      |
| POST   | `/xrpc/com.atproto.repo.uploadBlob`        | raw request bytes and `Content-Type`                                                |

Record CIDs are deterministic over stable JSON; blob CIDs are deterministic over the raw bytes. Record listing is ordered by record key. `limit` defaults to 50 and must be an integer from 1 through 100. Cursors are opaque and bound to their listing context.

When `swapRecord` is supplied, `putRecord` and `deleteRecord` compare it with the current CID. A stale value returns HTTP 400 with `error: "InvalidSwap"`.

## Fixture controls

These endpoints are deliberately outside XRPC:

| Method | Endpoint              | Effect                                                                    |
| ------ | --------------------- | ------------------------------------------------------------------------- |
| GET    | `/__fixture__/health` | Returns `{ "ok": true }`                                                  |
| POST   | `/__fixture__/reset`  | Restores the original seed                                                |
| POST   | `/__fixture__/mutate` | Replaces or patches a selected record to create external-change scenarios |

The mutation body identifies `repo`, `collection`, and `rkey`, then supplies a replacement `record`, a `patch`, or the fixture's default mutation marker.

## Deliberate omissions

This server is not a general PDS. It has no production OAuth, repository commits, firehose, lexicon validation, account management, persistence, or federation. CORS and JSON error responses exist to support browser tests. The request-body limit is 50 MiB.

Use it to test Hypo's API adapter, offline replay, and swap-conflict behavior. Use a real development account for behavior that depends on services outside this subset.
