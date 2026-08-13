---
title: Getting started with Hypo
description: Add film reserve, load a physical roll, start a shoot, and log a frame.
---

# Getting started with Hypo

This tutorial follows one film roll from reserve to its first exposure. You will create three linked records: a stockpile for film you own, a roll for one physical cartridge, and an exposure for one frame.

## 1. Add film to reserve

Sign in, open **Library**, and select **Film**. Add a stockpile, choose the film stock and format, and enter the quantity you own.

The stockpile is an `app.graycard.instance.filmStockpile` record. Its `stock` field points to a reusable film-stock type; `quantity` counts unopened or otherwise unallocated rolls. The format belongs here because a stock may be sold in several formats.

## 2. Load one roll

Find the new reserve row and select **Load**. Give the roll a label and, if appropriate, choose the camera that now contains it.

Hypo creates an `app.graycard.instance.filmRoll`, links it back through `stockpile`, and decrements the reserve quantity. A selected camera and `loadedAt` distinguish the physical roll from the stock type.

If you are documenting a roll that was loaded elsewhere, use the option to add an existing roll instead. Do not create a second stockpile merely to represent that history.

## 3. Start a shoot

Open the **Shoots** section and add a shoot. Select the camera, lens, and loaded roll, then save it. This produces an `app.graycard.session.capture` record that can group many exposures and, later, photos.

Open the shoot and select **Log**. The shot logger keeps the selected gear and advances the frame number between entries, which makes repeated logging quick.

## 4. Log the first frame

Enter the exposure details you know and select **Log frame**. Aperture, shutter duration, filter, meter reading, and notes are optional; `createdAt` is the only required exposure field. Use the multiple-exposure control when another exposure belongs to the same physical frame.

The result is an `app.graycard.instance.exposure` linked to the shoot and roll. Its `frame` identifies the frame within that roll.

## 5. Check offline behavior

Disconnect the network before logging another frame. Hypo should report that the shot was logged offline. Reconnect and wait for the sync notice.

The offline entry is a queued create operation in IndexedDB. Hypo assigns it a temporary `outbox://` URI, then records the committed AT-URI after the PDS accepts it. This queue currently covers shot logging; do not assume that every application write has the same offline guarantee.

You now have the minimum connected chain for a roll: film-stock type → stockpile → physical roll → shoot → exposure. Continue with [Import + EXIF](./import-and-exif.md) when scans or digital files are ready.
