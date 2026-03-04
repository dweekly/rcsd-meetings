# Contributing

Thanks for your interest in improving RCSD meeting transparency! Contributions are welcome.

## Ways to contribute

- **Data corrections** — Fix errors in meeting dates, agenda items, or links
- **New data sources** — Add scraping for additional public data (e.g., budget documents, enrollment data)
- **UI improvements** — Enhance the generated HTML page (accessibility, mobile, search)
- **Pipeline improvements** — Better timestamp mapping, transcript processing, or build tooling
- **Adaptation guides** — Help other districts set up their own meeting index

## Getting started

```bash
git clone https://github.com/dweekly/rcsd-meetings.git
cd rcsd-meetings
npm install
cp .env.example .env  # add ANTHROPIC_API_KEY for timestamp mapping
npm run build          # rebuild data + HTML from existing sources
```

For PDF link extraction, you also need:
```bash
python3 -m venv .venv
.venv/bin/pip install pymupdf
```

## Pull requests

1. Fork and create a feature branch from `main`
2. Make your changes
3. Run `npm run build` to verify nothing breaks
4. Open a PR with a clear description of what changed and why

Keep PRs focused — one logical change per PR.

## Data updates

The `sources/` directory contains files manually synced from other repositories. If you notice stale data, open an issue rather than modifying `sources/` directly.

The `data/` directory contains generated JSON. If you're fixing data, fix the source or the script that generates it rather than editing JSON by hand.

## Reporting issues

- **Data errors**: Include the meeting date and what's wrong
- **Broken links**: Include the URL and where you found it
- **Script failures**: Include the full error output and your Node.js version

## Code style

No formal linter is configured. Match the existing style: ES modules, 2-space indent, single quotes, JSDoc headers on every script.
