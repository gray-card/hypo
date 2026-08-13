---
title: Run the documentation locally
description: Start the Docusaurus development server from the repository root.
---

# Run the documentation locally

Install dependencies and refresh the generated reference pages:

```bash
npm install
node scripts/generate-lexicon-docs.mjs
```

Then start Docusaurus with `docs/site` as its site directory:

```bash
npm exec docusaurus -- start docs/site
```

The development server watches the handwritten documents and site components. Rerun the generator after changing a file under `lexicons/`; generated pages are not updated by Docusaurus itself.

The production site uses `/docs/` as its base URL. The development server may show the site at `/docs/` or redirect there, depending on the installed Docusaurus 3 minor version.
