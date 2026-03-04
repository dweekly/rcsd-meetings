# Security Policy

## Scope

This project processes and publishes publicly available government meeting data. It does not handle authentication, user accounts, or private data.

Potential security concerns include:

- **API key exposure** — The `.env` file contains an Anthropic API key used for timestamp mapping
- **Dependency vulnerabilities** — npm packages may have known CVEs
- **Scraping scripts** — Scripts that fetch from external APIs could be affected by upstream changes

## Reporting a vulnerability

If you discover a security issue (e.g., a committed secret, a dependency with a critical CVE, or a script vulnerability), please report it privately:

**Email:** david@weekly.org

Please include:
- Description of the vulnerability
- Steps to reproduce or proof of concept
- Suggested fix if you have one

I will acknowledge receipt within 48 hours and aim to resolve critical issues within 7 days.

## What not to report

- Public data appearing in this repo (that's the point)
- Rate limiting or access restrictions on Simbli/BoardDocs/YouTube (those are upstream concerns)
