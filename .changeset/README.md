# Changesets

Run `npm run changeset` for any user-visible change. Select `@hypo/web` and each other
affected `@hypo/*` workspace, choose the SemVer impact, and describe the change in
release-note language. Do not select the root `hypo` package: Changesets only versions
workspace packages. `npm run version-packages` synchronizes the root release version
and changelog from `@hypo/web` and updates the lockfile. Merging the automated version PR updates package versions and
`CHANGELOG.md`. After that PR passes CI and is merged to `main`, create the matching
`v*` tag from `main` as described in `.github/RELEASING.md`. The tag reruns the release
gates before it deploys the static site and creates the GitHub Release.
