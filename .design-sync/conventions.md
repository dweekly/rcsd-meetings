# rcsd.info design system (styles-only)

This project carries the visual identity of **rcsd.info** (Redwood City School District open-data site): design tokens, self-hosted fonts, and the site's recurring CSS patterns. There is **no component bundle** — build UI with plain HTML/JSX styled by this stylesheet's classes and tokens. No CSS framework, no utility classes; the vocabulary below is the entire idiom.

## Setup

Load `styles.css` — it @imports the fonts, tokens, and patterns. No provider or wrapper is needed. Set page background `var(--cream)` (the stylesheet does this on `html`/`body`), body text in Newsreader.

## Type system (three faces, strict roles)

- **Fraunces** (serif display) — headings only: `h1` weight 300, section `h2` weight 400 color `var(--green-deep)`, card titles weight 600.
- **Newsreader** (serif) — all body text; the base is 17px, line-height 1.65.
- **IBM Plex Mono** — data and labels: uppercase micro-labels (`font-size: 0.55–0.75rem; letter-spacing: 0.03–0.08em; text-transform: uppercase`), table headers, numbers in tables, badges, pill links. Anything that reads as "data" is mono.

## Color tokens (use these, never hex)

`--green-deep #1a3a2a` (headings, hero bg) · `--green-mid #2d5a3f` (links) · `--green-light #4a8c6a` (accents, bars) · `--green-pale` / `--green-wash #f0f6ed` (tint backgrounds) · `--cream #faf8f4` (page bg) · `--cream-dark` (panel bg) · `--amber #c4842d` + `--amber-light` · `--coral #c45d4a` + `--coral-light` (accent/badge washes) · `--text #2a2a28` · `--text-secondary` · `--text-muted #6b6b64` (AA-safe muted) · `--rule #d4d0c8` / `--rule-light` (hairlines).

Contrast rule: `--amber`/`--coral` fail AA as text on their washes — badges use darkened text `#7a4f12` / `#9c3f2e` instead.

## Pattern vocabulary (real classes in `patterns.css`)

- Layout: `.content` (960px column) · `.hero` > `.hero-inner` (deep-green header w/ radial glows), `.hero-stats` > `.hero-stat` (`-value` Fraunces, `-label` mono)
- Headings: `.section-head` + `.section-rule` (hairline under each section)
- Cards: `.school-grid` (auto-fill 200px) > `.school-card` (white, 1px `--rule-light` border, no radius, hover: green border + soft shadow) with `.school-card-header`, `.school-name-link`, `.school-details`, `.school-label`
- Badges: `.school-badges` > `.school-badge` + `--neighborhood` / `--choice` / `--community`
- Buttons/links: `.school-links a` (mono pill, 4px radius, cream bg, green-wash hover) — the site's only button style
- Lists: `.nav-link-item`, `.event-row` (`.event-date-inline` mono date, `.event-text`), `.resource-item`
- Tables: `.table-wrap` > `table`; `thead th` mono uppercase w/ 2px `--green-deep` rule; `td.num` right-aligned mono; `tr.total-row`; `.bar-cell` > `.bar.bar-green|.bar-amber` for inline data bars
- Panels: `.ai-section` (cream-dark bordered mono panel)
- Bilingual: `.bi-row` > `.bi-en` (right-aligned) + `.bi-es` (left, hairline divider) — the site is EN/ES; prefer bilingual layouts where content warrants
- Site chrome: `.site-nav` (near-black green `#1a2e1a`, mono uppercase tabs, active tab green underline) and `.site-footer` in the base stylesheet

Aesthetic: editorial/print, hairline rules over boxes, square corners (radius only on pills/badges/bars), generous whitespace, no heavy shadows.

## Where the truth lives

Read `styles.css` and its imports (`tokens/colors.css`, `patterns.css`, `fonts/fonts.css`) before styling. Preview cards in `components/foundations/` show the vocabulary rendered.

## Idiomatic example

```html
<div class="content">
  <div class="section-head">
    <h2>Enrollment by School</h2>
    <p>2025–26 CALPADS census</p>
    <div class="section-rule"></div>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>School</th><th class="num">Students</th><th>Share</th></tr></thead>
      <tbody>
        <tr><td class="school-name">Roosevelt</td><td class="num">438</td>
            <td class="bar-cell"><span class="bar bar-green" style="width:60px"></span>12%</td></tr>
        <tr class="total-row"><td>Total</td><td class="num">6,214</td><td></td></tr>
      </tbody>
    </table>
  </div>
  <div class="school-links"><a href="#">Details</a> <a href="#">Source PDF</a></div>
</div>
```
