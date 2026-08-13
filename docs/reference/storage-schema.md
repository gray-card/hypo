---
title: Local storage schema
description: IndexedDB stores, entries, indexes, and migration keys used by the sync package.
---

# Local storage schema

`@hypo/sync` stores local-first state in IndexedDB database `hypo-sync`, version `1`. `MemoryDatabase` implements the same interface for tests and environments without IndexedDB.

## Object stores

| Store            | Key            | Indexes                                     | Contents                               |
| ---------------- | -------------- | ------------------------------------------- | -------------------------------------- |
| `ops`            | operation `id` | `repo`, `status`, `[repo,status,createdAt]` | Pending and conflict-parked writes     |
| `records`        | record `uri`   | `collection`, `[repo,collection]`           | Cached repo records                    |
| `catalog-shards` | shard `key`    | none                                        | Cached catalog payloads                |
| `kv`             | entry `key`    | none                                        | Migration markers and acknowledgements |

## Operation entries

Every queued operation includes `id`, `repo`, `collection`, `status`, `createdAt`, `attempts`, and `nextAttemptAt`. `lastAttemptAt` and `lastError` appear after a failed attempt.

The operation variants are:

- `create`: `record`, optional `rkey`, and a temporary `outbox://` URI;
- `put`: `uri`, `rkey`, `record`, expected `swapRecord`, and optional conflict data;
- `delete`: `uri`, `rkey`, optional `swapRecord`, and optional conflict data.

Status is `pending` or `conflict`. Transient failures retry with exponential backoff from one second to a five-minute cap. A swap failure is parked as a conflict until the caller rebases or discards it.

Create acknowledgements map `ack:temp-uri:<tempUri>` to the committed AT-URI. Outbox flushing is serialized per repo with the Web Locks name `hypo:outbox-v2:<repo>` when Web Locks are available.

## Other entries

A cached record stores `uri`, `cid`, `repo`, `collection`, `record`, and `updatedAt`. A catalog-shard entry stores `key`, `data`, `updatedAt`, and optional `etag`. A key-value entry is the open `{key,value}` pair used by internal protocols.

## Legacy migration

`migrateLegacyOutbox` moves create operations from `localStorage` key `hypo:outbox:<repo>` into IndexedDB. It verifies every operation identifier and the final count before clearing the source. Completion is recorded under `migration:localstorage-outbox-v1:<repo>`, making the migration idempotent.

Application code should use the database and outbox interfaces rather than opening these stores directly. A future database version may change indexes or entry shapes while preserving that package contract.
