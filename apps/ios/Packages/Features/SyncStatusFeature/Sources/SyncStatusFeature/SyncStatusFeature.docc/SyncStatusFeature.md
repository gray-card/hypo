# `SyncStatusFeature`

Explain queued writes and conflicts for the active repository account.

## Overview

SyncStatusFeature turns durable persistence and transport state into an account-scoped status screen. A person can retry queued work, inspect a parked conflict, keep the remote value, or retry a local edit against the latest CID. Signed-out state and a different account's operations are not projected.

## Topics

### Status projection

- `SyncStatusSnapshot`
- `SyncStatusProjection`
- `PendingSyncItem`
- `SyncConflictItem`

### Service and presentation

- `SyncStatusServicing`
- `SyncKitStatusService`
- `SyncStatusFeatureModel`
- `SyncStatusFeatureView`
