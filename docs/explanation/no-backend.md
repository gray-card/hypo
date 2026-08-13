---
title: A static app, not an application backend
description: How Hypo delegates identity, storage, public reads, and discovery without operating a data service.
---

# A static app, not an application backend

Hypo's **no-backend boundary** means that the project does not operate a server that owns user sessions, stores application records, or mediates ordinary reads and writes. The deployed artifact is HTML, JavaScript, CSS, and catalog data.

After OAuth, the browser talks to the user's PDS. `app.graycard.*` records, Grain galleries, photos, EXIF, and uploaded blobs remain in that repository. A write does not first pass through a Hypo database, and a public profile reads the subject's public records without requiring a Hypo account.

This design makes the PDS the durable authority. It also keeps record URIs meaningful outside one installation: another compatible client can read the same AT-URI and lexicon value.

## Services are not the same as a Hypo backend

The browser still calls network services:

- the account's PDS for authenticated repository operations and blob reads;
- atproto identity and public-appview endpoints for handle and public-profile resolution;
- Constellation for backlinks used by Discover;
- Wikidata for optional concept search and catalog identifiers; and
- static map and catalog hosts for presentation data.

These dependencies perform their own bounded roles. None is a Hypo-controlled store of the user's private application state.

Discover is the case most likely to look like a hidden backend. A published `app.graycard.setup` record links to a fixed registry URL. Constellation answers “which records link to this anchor?”, and Hypo then hydrates each result from its author's PDS. Thus cross-network enumeration requires an index, but Hypo does not operate a second canonical setup database.

## Consequences

First, self-hosting is primarily a static-hosting and OAuth-metadata problem. Second, availability follows several services: the app shell may load while a PDS, identity resolver, or backlink index is unavailable. Third, local-first queues must eventually reconcile with the PDS because local storage is not a new authority.

The boundary does not imply that every feature works offline or that every external service is interchangeable. It names where Hypo's application state and trust are not placed.
