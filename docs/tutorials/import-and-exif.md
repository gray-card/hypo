---
title: Import + EXIF
description: Create a gallery, upload photos, extract EXIF, and attach capture gear.
---

# Import + EXIF

This tutorial creates a Grain gallery from local image files. Hypo uploads resized display images, reads EXIF from the original files, and can attach one set of capture defaults to the whole gallery.

## 1. Prepare your library

Add the camera, lens, and film roll used for the photos to **Library**. These are owned-instance records. Their catalog types contain reusable model specifications.

This distinction matters at import: EXIF stores model strings, while capture links identify your particular body, lens, and roll.

## 2. Create a gallery

Choose **New gallery**, enter a title and optional description, then select one or more image files. Under **Link gear**, choose the camera, lens, and film roll that apply to the set. Leave a field empty when the set is mixed.

Select **Create gallery**. For each file, Hypo:

1. renders a JPEG no larger than 2000 × 2000 and targets roughly 900 KB;
2. uploads that image blob to your PDS;
3. creates `social.grain.photo` and `social.grain.gallery.item` records;
4. reads EXIF from the original file, because canvas rendering strips it; and
5. creates `social.grain.photo.exif` when at least one supported tag was found.

Hypo validates the resulting Grain record before writing it. The uploaded blob
must be an image no larger than Grain's 1 MB limit, and the record must include
its aspect ratio. If the browser cannot decode or reduce a file safely, Hypo
reports the problem and does not upload the original. EXIF extraction is best
effort and never blocks the upload.

## 3. Inspect one photo

Open the gallery and select a photo. Check make, model, lens, aperture, exposure time, ISO, 35 mm-equivalent focal length, flash, and original capture time.

EXIF numeric values are stored as integers scaled by 1,000,000. Thus an f-number of `2.8` is stored as `2800000`; the editor converts it back to a readable value. See [Measures and EXIF projection](../explanation/measures-and-exif.md) for why the shared model's native measurements use a different shape.

## 4. Resolve model strings to owned gear

When EXIF make and model strings match catalog types in your library, Hypo suggests corresponding owned camera and lens instances. Confirm the intended instance, especially when you own two bodies of the same model.

If an EXIF label differs from the catalog label, edit the camera or lens type and add the EXIF spelling under **Alternative names**. The field accepts comma- or newline-separated names. Matching ignores case and punctuation and accepts token-order differences, such as `Nikkor AI 50mm f/1.4` versus `Nikkor 50mm f/1.4 AI`. Use an explicit alternative name for vocabulary differences such as `pre-AI` versus `non-AI`.

Capture links are stored in `app.graycard.photo.capture`. Gallery defaults apply to every photo unless a per-photo capture record overrides them. Projecting capture data into EXIF fills missing model, focal-length, aperture, or ISO fields by default; it does not overwrite observed EXIF unless you explicitly choose overwrite behavior.

You now have both representations: portable EXIF fields for Grain clients and structured `app.graycard.*` references for provenance and workflows.
