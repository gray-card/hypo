# Releasing Hypo

Hypo releases are immutable `v*` tags on commits already contained in `main`. Merging a pull request runs CI but does not deploy production.

## Prepare the release

1. Confirm every pull request intended for the release is merged to `main` and that the required **CI / Release gates** check passed.
2. Set the root package version to the intended semantic version and update `CHANGELOG.md`. Changesets may prepare this as a version pull request.
3. Review schema compatibility and migrations, including fixture coverage for any changed `app.graycard.*` record.
4. Review the production and development dependency audit results under [the dependency audit policy](./SECURITY_AUDIT_POLICY.md).
5. Merge the version pull request and wait for CI on `main` to pass.

## Ship the release

From an up-to-date local `main`, create and push the matching tag:

```sh
git switch main
git pull --ff-only origin main
git tag -a v1.0.0 -m "Hypo 1.0.0"
git push origin v1.0.0
```

The **Release Hypo** workflow verifies that (i) the tag is a semantic version, (ii) it matches `package.json`, and (iii) its commit is contained in `origin/main`. It then reruns all release gates, deploys the validated artifact to GitHub Pages, and creates the GitHub Release. A failed gate leaves production unchanged.

After the workflow succeeds, verify the public application, `/docs/`, OAuth login, a fixture-independent read path, and the GitHub Release notes.

## Repository settings

Protect `main` with pull requests and the **CI / Release gates** check. Protect `v*` tags from updates or deletion, and configure the `github-pages` environment with required reviewers if production deployment needs manual approval.
