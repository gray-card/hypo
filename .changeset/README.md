# Changesets

Run `npm run changeset` for any user-visible change. Select `hypo` and each affected
`@hypo/*` workspace, choose the SemVer impact, and describe the change in release-note
language. Merging the automated version PR updates package versions and
`CHANGELOG.md`. After that PR passes CI and is merged to `main`, create the matching
`v*` tag from `main` as described in `.github/RELEASING.md`. The tag reruns the release
gates before it deploys the static site and creates the GitHub Release.
