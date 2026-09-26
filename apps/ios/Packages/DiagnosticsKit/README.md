# DiagnosticsKit

`DiagnosticsKit` stores a small, device-local troubleshooting history for Hypo. Collection is off by
default. A user can enable it, inspect the saved-event count, export JSON, delete the history, or disable
collection from Settings. Disabling collection deletes the history.

The recorder retains at most 500 events for seven days. `DiagnosticOperation` and `DiagnosticCode` are
closed enums: call sites can record only reviewed operation, outcome, and reason tokens. Events cannot
carry free-form errors, analytics identifiers, account IDs, URLs, record payloads, location, or camera and
meter sensor values.

Run the package gate with:

```sh
swift format lint --strict --recursive Sources Tests
swift test --disable-sandbox -Xswiftc -warnings-as-errors
```
