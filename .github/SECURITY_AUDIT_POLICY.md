# Dependency audit policy

Hypo is a static application without a server-side runtime. Release CI separates dependencies that ship with the application from tools used only to build, test, and document it.

## Production dependencies

`npm audit --omit=dev --audit-level=low` is a blocking release gate. A release must have no known production dependency vulnerabilities at any severity. An exception requires a documented risk assessment, an expiration date, and approval in the release pull request.

## Development dependencies

`npm audit --audit-level=high` runs on every pull request and release. Its findings remain visible in the job log and workflow summary but are advisory because development-only dependency trees can contain vulnerabilities that do not affect the deployed bundle and cannot be resolved independently of upstream tools.

A high- or critical-severity development finding must still be reviewed before release. It blocks release when the affected code executes on untrusted repository content, handles release credentials, alters generated artifacts, or can affect the deployed output. Otherwise, the pull request should identify the affected tool, explain why the deployed application is not exposed, and link the upstream remediation issue when one exists.

The policy must be revisited if Hypo adds a backend, server-side rendering, installable desktop code, or another runtime beyond the static browser application.
