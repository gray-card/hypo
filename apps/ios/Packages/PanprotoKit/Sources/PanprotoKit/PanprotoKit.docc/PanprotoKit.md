# `PanprotoKit`

Load Hypo's pinned ATProto schemas and reviewed migration chains through Panproto 0.70.1.

## Overview

PanprotoKit is the iOS application's value-only boundary around Panproto. It restores bundled
structural schemas, validates ATProto records through the binding's I/O registry, interprets
record release labels, and runs reviewed migrations. Engine handles remain internal to this
package.

The application bundles artifacts assembled from the whole lexicon suite. It does not assemble
cross-file lexicons or generate migration chains at runtime.

Panproto projects schema versions; it does not replace the schema reference. Use the
[canonical Hypo Lexicon reference](https://hypo.graycard.app/docs/reference/lexicons/) for the fields that current
clients write.

### Essentials

- <doc:Pinning-and-bumping-the-lexicons>

## Topics

### Schema inspection

- ``PanprotoSchemaChecking``
- ``PanprotoSchemaInspector``
- ``PanprotoSchemaRelease``
- ``PanprotoSchemaReport``

### Record migration

- ``PanprotoRecordMigrating``
- ``PanprotoRecordMigrator``
- ``PanprotoMigrationArtifact``
- ``PanprotoRecordProjection``
- ``PanprotoOpaqueComplement``

### Release interpretation

- ``PanprotoReleaseInterpretation``
- ``PanprotoReleaseEvidence``

### Failures

- ``PanprotoFault``
- ``PanprotoFaultDomain``
