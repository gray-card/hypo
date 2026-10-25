# Temporary production dependency audit exceptions

The exceptions below are authorized under
[`SECURITY_AUDIT_POLICY.md`](./SECURITY_AUDIT_POLICY.md). The production audit
wrapper accepts only the exact advisory URLs listed in
`scripts/audit-production.mjs`; it fails on any additional finding and after an
exception's expiration date. Merging the release pull request constitutes the
required approval.

## GHSA-mrhx-c7xc-m3w5 — Zod uncontrolled resource consumption

- **Affected dependency:** `zod@3.25.76`, through the production ATProto API and
  browser OAuth clients
- **Severity and impact:** high-severity availability risk. A sufficiently large,
  invalid array reaching an affected Zod array validator may exhaust memory and
  crash the browser tab. The advisory reports no confidentiality or integrity
  impact.
- **Exposure:** an attacker must cause Hypo to validate an oversized response
  from an ATProto service, such as a PDS or OAuth endpoint. Hypo does not run a
  server process, so the affected resource is the user's isolated browser tab.
- **Mitigations:** Hypo reads paginated repository collections with bounded page
  sizes, applies independent lexicon validation to records it writes, and does
  not expose a public server endpoint that accepts arbitrary validation payloads.
- **Why it is not patched here:** the current `@atproto/*` runtime packages
  declare Zod 3. Forcing Zod 4.6.6 or later would move those authentication and
  protocol libraries outside their supported dependency range. No patched Zod 3
  release is available.
- **Resolution:** update the ATProto API and OAuth client as soon as their
  supported dependency graph includes a patched Zod release, then remove the
  exception and audit wrapper entry.
- **Owner:** Hypo maintainers
- **Expires:** 2026-11-30

References: [GitHub advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[ATProto validator-tracking issue](https://github.com/bluesky-social/atproto/issues/4503).
