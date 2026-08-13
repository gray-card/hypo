---
title: Log shots offline
description: Queue exposure records without a network and verify their later sync.
---

# Log shots offline

Hypo's current offline write path covers the shot logger. Prepare the shoot while online so its camera, lens, roll, and existing frame history are available locally.

1. Open **Library**, select **Shoots**, and open the intended shoot's logger.
2. Disconnect the device or switch the browser to offline mode.
3. Enter the frame data and select **Log frame**.
4. Wait for the status message confirming that the shot was logged offline.
5. Reconnect and keep Hypo open until the sync notice appears.
6. Reopen the shoot and confirm that its shot count increased.

The logger writes an `app.graycard.instance.exposure` operation to IndexedDB before attempting the network. A create receives a temporary `outbox://` URI; after the PDS accepts it, the outbox stores an acknowledgement from that URI to the committed AT-URI.

Failed network attempts back off from one second to at most five minutes. Returning online, making the page visible, enqueuing another operation, or the periodic scheduler may trigger another flush. Do not clear site data while shots remain queued.

Offline success means **durably queued on this browser**, not committed to the PDS. Confirm the later sync notice before treating another device as up to date. Other Hypo editors may still require a live connection.
