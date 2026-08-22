---
title: Understand offline sync
description: Read Hypo's pending, retry, and needs-attention states.
---

# Understand offline sync

Hypo uses an **offline outbox**: each supported edit updates the on-device view and stores a write operation before any network request begins. This lets the field logger and development-session writer continue when the PDS is unreachable.

Queued operations are retried when Hypo returns to the foreground, when the connection becomes available, or during an opportunistic iOS background refresh. iOS decides when to grant background time, so opening Hypo while connected still gives the queue its most predictable opportunity to run. A pending item is not evidence that data has been lost.

## Retry and needs attention

A temporary network failure uses bounded backoff. **Retry now** asks Hypo to reset that wait and try the shared queue again.

A write moves to **Needs attention** when retrying could overwrite a remote change or when the server rejects it permanently. The conflict view retains the local operation and the available remote evidence. You can:

- **Discard my change** to discard the local write and restore the cached remote value; or
- **Use my version** to queue the local value against the latest remote CID.

Rebasing is appropriate only after you inspect the two versions. It does not merge fields automatically.

Creates use a stable record key and a no-record condition. If the app is interrupted after the PDS commits a create but before the local queue records success, the retry can recognize the already-created record rather than duplicating it.

## Local storage and the PDS

The local cache is not a second account server. Once a queued write succeeds, the record in your PDS is authoritative.
