# AGENTS.md

Persistent notes for agents working in this repo.

## What this project is

DISCIPLINE is a static website plus a browser extension that share one score.
It blocks adult-content domains and turns clean days into XP, levels and streaks.

## Architecture rules

- `public/lib/{engine,blocklist,state}.js` are the single source of truth for
  scoring and the blocklist. They are written as classic scripts that also
  `require()` cleanly in Node, so the website, the extension and the tests all
  use the same code. Never copy this logic elsewhere.
- The website must keep working with no extension: it falls back to
  `localStorage`. The extension, when present, is the source of truth and the
  website reads it over the postMessage bridge in `extension/content.js`.
- The extension build copies `public/lib/*` into each target, so the built
  output in `dist/` is generated, never hand-edited. Run `npm run build`.

## Commands

```bash
npm test          # node:test suites in tests/
npm start         # static preview server on http://localhost:12000
npm run build     # writes dist/chrome (MV3) and dist/firefox (MV2)
```

Zero runtime dependencies. Node built-ins only.

## Gotchas

- GitHub Pages serves `public/` at a subpath (`/discipline/`), so every asset
  reference in the HTML must stay relative. Never introduce a leading `/`.
- Firefox uses MV2 with `browser.*`; Chrome uses MV3 with `chrome.*`. Code reads
  the namespace through `typeof browser !== 'undefined' ? browser : chrome`.
- Declarative Net Request rules are built at runtime in `extension/rulebuilder.js`
  from the blocklist; there is no static rules JSON. The redirect target must be
  an absolute URL from `runtime.getURL`, not a relative path.
- A GitHub App installation token cannot create repositories under a user
  account, and the OpenHands AI app has no Pages permission, so the Pages API
  returns `Resource not accessible by integration`. The workflow therefore
  publishes `public/` to the `gh-pages` branch with `contents: write` instead of
  using `actions/deploy-pages`.
- GitHub Pages is configured to serve the `gh-pages` branch. The live site is
  https://m3l0nbyte.github.io/discipline/ and updates on every push to `main`.
