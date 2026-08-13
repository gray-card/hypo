---
title: Build the documentation
description: Produce the static Docusaurus site under docs/site/build.
---

# Build the documentation

Refresh generated pages and build the static site:

```bash
node scripts/generate-lexicon-docs.mjs
npm exec docusaurus -- build docs/site
```

The build output is `docs/site/build/`. The Docusaurus configuration sets `baseUrl` to `/docs/`, so publish that directory at `https://hypo.graycard.app/docs/`.

To inspect the production output locally:

```bash
npm exec docusaurus -- serve docs/site
```

The deploy job should run the generator and build before it copies or uploads the output. A build with broken internal links fails because `onBrokenLinks` and `onBrokenMarkdownLinks` are set to `throw`.
