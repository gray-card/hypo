---
title: Lexicon code-generation decision
description: Why Hypo uses a small repository-owned generator instead of lex-cli output.
---

# Lexicon code-generation decision

**Status:** accepted

**Decision date:** 2026-08-11

## Context

Hypo needs more than TypeScript record interfaces. We refer to the complete required output as the **lexicon artifact surface** (LAS): (i) record and referenced-object types, (ii) open `knownValues` unions, (iii) a generated NSID tree and collection-kind lists, (iv) runtime validators, and (v) documentation data with resolved cross-file references. A field rename must change this surface deterministically so that stale consumers fail during generation, type checking, or tests.

The adoption spike compared two alternatives: [`@atproto/lex-cli`-style API generation](https://github.com/bluesky-social/atproto/tree/main/packages/lex-cli) and a repository-owned generator. `lex-cli` exposes API, server, schema-object, and Markdown generators; Hypo would still require a second pass for the namespace tree, UI metadata checks, runtime-validation policy, and the documentation index. This would leave two generated representations of the same 63-file suite.

## Decision

Hypo uses `scripts/generate-lexicons.mjs` as the single LAS generator. The script loads the entire `lexicons/` tree, rejects unresolved local and cross-NSID references, then emits TypeScript reference names in `packages/lexicon/src/generated.ts` and the namespace tree in `packages/lexicon/src/namespaces.ts`. The generated runtime resolves those references while validating records. It enforces required fields, types, the enumerated union branches Hypo currently uses, integer and collection bounds, declared string limits, and URI, AT-URI, and datetime formats. `scripts/generate-lexicon-docs.mjs` reads the same source tree and resolves references for the generated pages and navigation data.

CI reruns both generators and rejects a diff. Thus the checked-in artifacts remain reviewable, while the lexicon JSON remains the source of truth.

## Consequences

First, the application avoids generated XRPC code that would duplicate `@hypo/pds`. Second, Hypo owns the validator's treatment of open [`knownValues`](https://atproto.com/specs/lexicon): these values are suggestions, so unfamiliar strings remain valid. Third, changes to AT Protocol lexicon semantics may require a corresponding generator update; the focused codegen tests are the regression boundary for that work.

A potential worry is that a repository-owned generator may drift from upstream semantics. While the generated tests cover the constraints Hypo currently uses, they cannot establish parity with every future lexicon feature. Thus, generation must fail on unresolved refs, while runtime validation must reject unknown record NSIDs. And every newly adopted schema feature must land with a validator test before Hypo relies on it.
