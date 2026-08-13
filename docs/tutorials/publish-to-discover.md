---
title: Publish to Discover
description: Publish an opt-in setup record and verify its public profile.
---

# Publish to Discover

Discover lists setups whose owners explicitly publish an `app.graycard.setup` record. This tutorial publishes that small index record without moving your underlying gear out of your PDS.

## 1. Review the public view

Sign in and open your profile. Check the gear and galleries that are already public in your repo. Publishing to Discover makes the setup easier to find; it does not change record visibility or create a private-data boundary.

## 2. Open the publishing form

Open the command palette and choose **Publish my setup to Discover**. Enter a name and, optionally, a summary and featured gallery. Review the gear selection; setup records accept at most 200 gear references.

The form writes this registry anchor exactly:

```text
https://hypo.graycard.app/ns/registry/1
```

That stable URL is the backlink target used by discovery. Do not substitute the application home page.

## 3. Publish

Confirm the form. Hypo creates an `app.graycard.setup` record with `registry`, `name`, `createdAt`, and the optional fields you supplied.

Open **Discover** and search for the setup. Hypo asks Constellation for records whose `.registry` field points to the anchor, then reads each matching setup from its author's PDS. The public profile and Discover work without signing in.

The setup record is committed before Discover queries the external backlink index. If the listing is not yet visible, refresh the Discover result rather than publishing a duplicate record.

## 4. Update or remove the listing

Open the publishing form again to edit the listing. Hypo updates the same record key, preserves `createdAt`, adds `updatedAt`, and supplies the current CID as `swapRecord`. A concurrent edit therefore causes a conflict instead of a silent overwrite.

Use **Unpublish** to delete the setup record. The linked gear records remain in your repo; the Discover backlink disappears when the index observes the deletion.

The result is an opt-in pointer, not a copied profile. The [no-backend explanation](../explanation/no-backend.md) describes why Discover can work this way.
