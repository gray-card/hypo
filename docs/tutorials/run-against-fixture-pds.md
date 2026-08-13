---
title: Run against the fixture PDS
description: Start the deterministic test PDS, sign in through the E2E runtime, and inspect a write.
---

# Run against the fixture PDS

This developer tutorial runs Hypo against the repository's deterministic PDS subset. It is useful for interface work because the seed, CIDs, and conflict behavior are repeatable.

## 1. Install and start both servers

From the repository root, install dependencies once:

```bash
npm install
```

Start the fixture in one terminal:

```bash
node tests/fixture-pds/server.js --port 2584
```

Start Vite in E2E mode in another:

```bash
npm run dev -- --mode e2e
```

Open `http://127.0.0.1:5173`. E2E mode injects the fixture origin and activates the local OAuth/agent adapters. It is intentionally limited to development.

## 2. Sign in with the seed identity

Enter `alice.test` and sign in. The fixture resolves that handle to `did:plc:alice`. The library should show three seeded camera instances, including the black and silver bodies.

Check the server directly:

```bash
curl 'http://127.0.0.1:2584/xrpc/com.atproto.repo.listRecords?repo=did%3Aplc%3Aalice&collection=app.graycard.instance.camera'
```

## 3. Exercise a write

Open **Shoots**, log a frame in the seeded fixture shoot, and list exposure records:

```bash
curl 'http://127.0.0.1:2584/xrpc/com.atproto.repo.listRecords?repo=did%3Aplc%3Aalice&collection=app.graycard.instance.exposure'
```

To restore the seed without restarting either server:

```bash
curl -X POST http://127.0.0.1:2584/__fixture__/reset
```

## 4. Run the automated scenario

Stop the manually started servers, or leave them running so Playwright can reuse them, then run:

```bash
npm run test:e2e
```

The suite verifies seeded login, offline shot replay, and a stale `swapRecord` conflict. Playwright starts both servers automatically when they are absent.

The fixture has no production OAuth, commit history, federation, persistence, or server-side lexicon validation. Use the [Fixture PDS API](../reference/fixture-pds-api.md) as its complete contract.
