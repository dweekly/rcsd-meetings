# design-sync notes — rcsd.info

Fresh as of 2026-07-08.

- **This repo is not a component design system.** No React, no Storybook, no
  `dist/`. User chose a **styles-only sync** (2026-07-08): tokens, fonts, base
  CSS, curated patterns, and three hand-authored foundation preview cards.
- **Build:** `node .design-sync/build-bundle.mjs` → `.design-sync/ds-bundle/`
  (gitignored). Tokens/base CSS import live from `scripts/html-parts.mjs`;
  `patterns.css` is hand-curated from `scripts/build-homepage.mjs` and
  `scripts/build-district.mjs` — **on re-sync, diff those builders against
  patterns.css and re-copy drifted blocks.**
- **Verification (2026-07-08):** all three cards (Colors, Typography,
  Patterns) rendered via local static serve + Playwright screenshots; fonts
  load through relative urls; only console noise is a favicon 404.
- **Conventions vocabulary validated** against built CSS (34 classes,
  16 tokens, zero missing) on 2026-07-08.
- **No `_ds_sync.json`** is produced — no converter recipe for this shape, so
  future syncs simply re-verify (correct per the skill).
- Upload path: first sync into a fresh empty project → incremental path,
  though the bundle is small enough to push in one batch.
