# Releasing Hypo

Hypo releases are immutable `v*` tags on the current `main` commit. Every fully green `main` push deploys the application and documentation; tags publish GitHub Releases but never receive deployment permission.

## Prepare the release

1. Confirm every pull request intended for the release is merged to `main` and that the required **CI / Release gates** check passed.
2. Set the root package version to the intended semantic version and update `CHANGELOG.md`. Changesets may prepare this as a version pull request.
3. Review schema compatibility and migrations, including fixture coverage for any changed `app.graycard.*` record.
4. Review the production and development dependency audit results under [the dependency audit policy](./SECURITY_AUDIT_POLICY.md).
5. Merge the version pull request and wait for both CI and the **Deploy GitHub Pages** job on `main` to pass.

## Ship the release

From an up-to-date local `main`, create and push the matching tag:

```sh
git switch main
git pull --ff-only origin main
git tag -a v1.0.0 -m "Hypo 1.0.0"
git push origin v1.0.0
```

The **Release Hypo** workflow verifies that (i) the tag is a semantic version, (ii) it matches `package.json`, and (iii) it points to the current `origin/main` commit. It then reruns all release gates and creates the GitHub Release. Pages deployment is performed only by the green `main` CI run that precedes the tag.

After the workflow succeeds, verify the public application, `/docs/`, OAuth login, a fixture-independent read path, and the GitHub Release notes.

## Repository settings

Protect `main` with pull requests and the **CI / Release gates** check. Protect `v*` tags from updates or deletion. Configure the `github-pages` environment to allow only the `main` branch, with required reviewers if production deployment needs manual approval.
