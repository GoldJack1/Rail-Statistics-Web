# Train drawings

Layout: `<class>/<sub-class>/<operator>/_rules.json` plus the SVGs it names. Every SVG is 40 high, any width, one image per whole unit.

`_rules.json`:
- `toc`: Darwin TOC codes the rules apply to.
- `liveries.<id>.file`: the SVG.
- `liveries.<id>.units`: unit or loco numbers, ranges allowed (`68019-68032`). Wins over `classes`.
- `liveries.<id>.classes`: matches any unit of that class for the TOC (the fallback livery).

Build and deploy: `node rail-core/scripts/build-drawings.mjs`, then `rail-core/scripts/deploy-drawings.sh dev|prod`.
