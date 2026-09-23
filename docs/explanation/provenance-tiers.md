---
title: Provenance tiers
description: How Hypo records assertion source, field-specific evidence, product documents, and observed execution.
---

# Provenance tiers

Hypo's **provenance ladder** represents evidence at the narrowest level supported by the source. It has four useful tiers.

## 1. Record-level assertion

`app.graycard.defs#provenance` answers how and when a value or record was asserted. Its source values distinguish manual entry, direct observation, EXIF import, inference, analysis, reconciliation, privacy-preserving transformation, batch rules, and workflow templates; confidence is `certain`, `likely`, or `guess`. The object may also name `assertedAt`, `assertedBy`, a method, supporting evidence, and a note. Records imported from a `.frames` capture log use that evidence to identify their source without treating the file as EXIF.

This tier is appropriate when one method accounts for the record as a whole.

## 2. Field-level assertion

`fieldProvenance` pairs a value or relationship with its own provenance. A camera make might come from imported EXIF while aperture was entered manually and a scene label came from analysis. One record-level label would erase those differences.

New records identify a target with an RFC 6901 JSON Pointer in `field`; legacy top-level field names remain valid. When the target is one member of a relationship array, `relationship` stores the stable serialized member—normally an AT-URI—rather than an array index. Reordering the array thus does not move the assertion to another member. `valueDigest`, when present, binds the assertion to the canonical encoded value. A client that observes a digest mismatch must label the assertion **stale** and exclude it from effective provenance until the user confirms or replaces it.

Field provenance supplements record provenance. The narrow field or relationship assertion wins for its target; record provenance remains the fallback for every unannotated value. Several field-provenance entries may support one target when their value digests agree. If they disagree, none silently wins: the client presents a conflict. A manual override adds a new user-attributed assertion and retains upstream evidence; reverting the override restores the highest-precedence upstream value rather than deleting its history.

This tier is about who or what asserted a field, not about a manufacturer's published specification.

## Evidence references and privacy

An assertion may point to an ATProto record, a public external source, or a content digest for a local file. A digest identifies evidence without publishing a device path. `withheld` and `unavailable` evidence kinds are affirmative states: the former says that evidence exists but must remain private; the latter says that the source can no longer be opened. A privacy transformation records the public result as `transformed`, names the method when safe, and may retain a redacted or withheld evidence reference. Publishing provenance must never require publishing the private source value.

## 3. Specification evidence

Catalog records may carry `productDocument` and `specSource`. A product document identifies the publisher, edition, revision, language, retrieval date, and linked asset. A specification source names the fields supported by that exact document, plus page, table, method, and note.

This tier supports claims such as “maximum aperture is stated on page 14 of revision C.” Linking a generic product page without naming supported fields does not provide the same evidence.

## 4. Planned and observed execution

Process records separate selected source values from observed values. On each development stage, `publishedTimeSeconds` and `temperatureSetpoint` retain the plan; `actualTimeSeconds` and `actualTemperature` record the run. The stage's `sourceDocument`, `sourceSpec`, and `recipe`, together with session provenance, explain why the plan was chosen.

This tier prevents an observation from being rewritten as a recommendation, or a recommendation from being mistaken for what happened.

## Choosing a tier

Use the least elaborate tier that preserves the evidential distinction. Add field provenance when fields genuinely differ in origin. Add document-level support for externally checkable catalog specifications. Keep planned and observed values separate whenever execution can depart from the source.

Missing provenance means “not represented,” not “manual and certain.” Clients should avoid inventing a stronger interpretation.
