# `LibraryFeature`

Browse a local companion view of gear and consumables, then perform a small set of field writes.

## Overview

LibraryFeature combines cached user records with the bundled catalog. It supports read-mostly browsing, loading a roll from stockpile, and adding camera or lens instances from a catalog selection. Other editing paths open web Hypo rather than introducing a second partial editor.

Quick-add writes the same [`instance.camera`](https://hypo.graycard.app/docs/reference/lexicons/app.graycard.instance.camera), [`instance.lens`](https://hypo.graycard.app/docs/reference/lexicons/app.graycard.instance.lens), and [`instance.filmRoll`](https://hypo.graycard.app/docs/reference/lexicons/app.graycard.instance.filmRoll) records as web Hypo.

## Topics

### Browse

- ``LibraryProviding``
- ``LibraryItem``
- ``LibraryCategory``
- ``LibraryFeatureModel``

### Field writes

- ``LibraryFieldAction``
- ``FilmRollLoadRequest``
- ``GearQuickAddRequest``
- ``QueuedLibraryFieldWriter``
