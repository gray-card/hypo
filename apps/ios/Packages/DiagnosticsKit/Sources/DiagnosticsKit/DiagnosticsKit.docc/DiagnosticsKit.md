# `DiagnosticsKit`

Record bounded, opt-in operational evidence on the device.

## Overview

DiagnosticsKit stores reviewed category, operation, outcome, code, and duration tokens. It rejects arbitrary text and URLs, remains disabled by default, and keeps events local until a person exports or deletes them. It is a support tool, not an analytics system.

## Topics

### Record and export

- ``LocalDiagnosticsRecorder``
- ``DiagnosticsRecording``
- ``DiagnosticEvent``
- ``DiagnosticsExport``

### Reviewed vocabulary

- ``DiagnosticCategory``
- ``DiagnosticOperation``
- ``DiagnosticOutcome``
- ``DiagnosticCode``
