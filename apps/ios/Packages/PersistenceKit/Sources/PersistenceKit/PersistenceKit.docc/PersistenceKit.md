# `PersistenceKit`

Persist cached records, durable outbox operations, migration complements, and parked conflicts.

## Overview

PersistenceKit defines one actor-safe store boundary with SwiftData, file-backed, and in-memory implementations. Mutations can be observed as ordered changes, which lets SyncKit project status without making feature packages depend on a storage engine.

## Topics

### Store boundary

- ``PersistenceStore``
- ``SwiftDataPersistenceStore``
- ``FilePersistenceStore``
- ``InMemoryPersistenceStore``
- ``PersistenceChange``

### Durable sync state

- ``CachedRecord``
- ``OutboxOperation``
- ``ParkedConflict``
- ``PanprotoComplement``
- ``PersistenceSnapshot``
