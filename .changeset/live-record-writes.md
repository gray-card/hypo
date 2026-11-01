---
"hypo": patch
"@hypo/web": patch
"@hypo/sync": patch
"@hypo/schema-runtime": patch
"@hypo/ui": patch
---

Keep gallery uploads from using temporary record URIs, retry writes that race a concurrent outbox flush, and reopen IndexedDB connections that close before a record or schema-custody transaction starts. Never silently replace a failed browser database with a volatile queue. Report failed local queue writes instead of presenting them as saved, and give people clear next steps for common storage, sync, and conflict errors.
