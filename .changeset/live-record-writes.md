---
"hypo": patch
"@hypo/web": patch
"@hypo/sync": patch
"@hypo/schema-runtime": patch
---

Keep gallery uploads from using temporary record URIs, retry writes that race a concurrent outbox flush, and reopen IndexedDB connections that close before a record or schema-custody transaction starts.
