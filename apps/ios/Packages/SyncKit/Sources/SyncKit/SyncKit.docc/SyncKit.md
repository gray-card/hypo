# `SyncKit`

Synchronize local-first Hypo records with an authenticated AT Protocol repository.

## Overview

SyncKit owns the durable outbox state machine, transport scheduling, CID-guarded updates, conflict parking, hydration, Panproto projection, and reference reconciliation. Repository ownership scopes prevent one signed-in account from flushing or inspecting another account's queued work.

The package preserves records through migration and transport; it does not redefine them. Consult the [canonical Lexicon reference](https://hypo.graycard.app/docs/reference/lexicons/) for record fields and the [swap-concurrency explanation](https://hypo.graycard.app/docs/explanation/swap-concurrency) for the conflict model.

## Topics

### Queue and flush

- ``SyncEngine``
- ``OutboxStateMachine``
- ``SyncTransport``
- ``FlushReport``

### Network and migration boundaries

- ``ATProtoSyncTransport``
- ``PanprotoProductionComposition``
- ``PanprotoHydrationCoordinator``

### Conflicts and scheduling

- ``SyncConflictResolving``
- ``SyncFlushScheduling``
- ``SyncBackgroundRefreshAdapter``
