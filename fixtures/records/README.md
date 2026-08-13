# Panproto conformance records

These small records are versioned with the lexicon suite by the Panproto sidecar. They exercise
data staging and provide the first inputs for future migration-law checks. They are fixtures, not
records copied from a user repository.

The web fixture PDS loads each `*.json` file from this directory into the dedicated
`records.graycard.test` identity (`did:plc:graycard-record-fixtures`). A filename supplies the
record key and the record's `$type` supplies its collection. This keeps the Panproto corpus and the
browser-facing contract corpus identical without changing the existing `alice.test` seed records.
