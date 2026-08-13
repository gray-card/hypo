---
title: Swap concurrency
description: Why Hypo uses record CIDs as compare-and-swap guards and parks stale offline writes.
---

# Swap concurrency

An AT-URI identifies a record location; its CID identifies one value at that location. Hypo uses the CID as a **swap guard** when updating a record.

Suppose an editor reads CID `A`, while another client writes a new value with CID `B`. If the first editor later sends `putRecord` with `swapRecord: A`, the PDS rejects it because `A` is no longer current. Without that guard, the older editor could silently replace the newer value.

Preserving the record key and changing the CID provides both identity and revision:

- gallery membership, scene, capture, and workflow links keep the same AT-URI;
- clients can detect that the value changed; and
- a stale edit becomes an explicit conflict.

The `@hypo/pds` adapter maps a failed swap to `SwapConflict`, carrying the expected CID. Online editors can leave the form open and ask the user to reload or reconcile.

## Offline conflict parking

An offline `put` cannot know whether its base CID remains current when connectivity returns. The sync outbox therefore preserves `swapRecord` with the queued operation. If replay encounters a swap failure, the operation moves from `pending` to `conflict` rather than entering the retry loop.

The caller may then discard the local operation or rebase it against a newly read record. Network errors are different: they use exponential backoff because the expected record revision has not yet been disproved.

Create operations have no prior CID. Hypo gives them temporary local URIs and acknowledges the committed AT-URI after replay. Deletes may also carry a swap guard when the caller has a known current CID.

Swap guards prevent lost updates at one record boundary. They do not make a sequence of writes into a multi-record transaction. A workflow that updates several records must still tolerate partial completion and retry each step idempotently where possible.
