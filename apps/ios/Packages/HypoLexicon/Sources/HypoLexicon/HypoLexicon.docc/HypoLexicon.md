# `HypoLexicon`

Use generated Swift values for the `app.graycard.*` metadata model.

## Overview

HypoLexicon is generated from the repository's canonical AT Protocol Lexicons. It provides `Codable`, `Hashable`, and `Sendable` record values, typed AT identifiers and dates, the pinned release metadata, and runtime validation against the generated schema index.

The generated types are a client binding, not a second schema source. Field meanings, limits, and resolved references live in the [canonical Hypo Lexicon reference](https://hypo.graycard.app/docs/reference/lexicons/).

## Topics

### Identify and validate records

- ``NSID``
- ``ATURI``
- ``ATProtoDate``
- ``GeneratedRecordNSID``
- ``GeneratedLexiconValidator``

### Release evidence

- ``LexiconRelease``
- ``GeneratedLexiconMetadata``

### Consumable chronology

- ``FilmRollMilestones``
- ``ChemistryMilestones``
- ``ConsumableLifecycleValidator``
