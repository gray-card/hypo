---
"hypo": patch
"@hypo/web": patch
"@hypo/sync": patch
"@hypo/schema-runtime": patch
"@hypo/ui": patch
---

Keep gallery uploads from using temporary record URIs, retry writes that race a concurrent outbox flush, and reopen IndexedDB connections that close before a record or schema-custody transaction starts. Report a failed local queue write instead of presenting it as saved, and give people clear next steps for common storage, sync, and conflict errors.
