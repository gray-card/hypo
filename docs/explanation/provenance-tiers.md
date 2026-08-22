---
title: Provenance tiers
description: How Hypo records assertion source, field-specific evidence, product documents, and observed execution.
---

# Provenance tiers

Hypo's **provenance ladder** represents evidence at the narrowest level supported by the source. It has four useful tiers.

## 1. Record-level assertion

`app.graycard.defs#provenance` answers how and when a value or record was asserted. Its source values distinguish `manual` entry, `imported-exif` photo metadata, `inferred` values, `analysis`, `batch-rule`, and `workflow-template`; confidence is `certain`, `likely`, or `guess`. The object may also name `assertedAt`, `assertedBy`, and a note. Records imported from a `.frames` capture log use that note to identify their source without treating the file as EXIF.

This tier is appropriate when one method accounts for the record as a whole.

## 2. Field-level assertion

`fieldProvenance` pairs a field path with its own provenance. A camera make might come from imported EXIF while aperture was entered manually and a scene label came from analysis. One record-level label would erase those differences.

This tier is about who or what asserted a field, not about a manufacturer's published specification.

## 3. Specification evidence

Catalog records may carry `productDocument` and `specSource`. A product document identifies the publisher, edition, revision, language, retrieval date, and linked asset. A specification source names the fields supported by that exact document, plus page, table, method, and note.

This tier supports claims such as “maximum aperture is stated on page 14 of revision C.” Linking a generic product page without naming supported fields does not provide the same evidence.

## 4. Planned and observed execution

Process records separate published, planned, and observed values. On each development stage, `publishedTimeSeconds` retains source data; `plannedTimeSeconds`, `timeBasis`, and `temperatureSetpoint` retain the selected plan; and `actualTimeSeconds` and `actualTemperature` record the run. The stage's `sourceDocument`, `sourceSpec`, `recipe`, and notes, together with session provenance, explain why the plan was chosen.

This tier prevents an observation from being rewritten as a recommendation, or a recommendation from being mistaken for what happened.

## Choosing a tier

Use the least elaborate tier that preserves the evidential distinction. Add field provenance when fields genuinely differ in origin. Add document-level support for externally checkable catalog specifications. Keep planned and observed values separate whenever execution can depart from the source.

Missing provenance means “not represented,” not “manual and certain.” Clients should avoid inventing a stronger interpretation.
