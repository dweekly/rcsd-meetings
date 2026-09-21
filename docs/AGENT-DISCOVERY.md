# Agent discovery

Human catalog pages are English and Spanish. The agent skill and field reference
use one English instruction set, with guidance to answer in the user's language.

## Published surfaces

| Surface | Purpose and status |
| --- | --- |
| `/catalog/`, `/catalogo/` | Crawlable dataset families, source metadata, Schema.org DataCatalog / Dataset / DataDownload, and query guidance. |
| `/catalog/index.md`, `/catalogo/index.md` | Explicit Markdown alternatives linked from the corresponding HTML pages. |
| `/catalog.json` | Machine catalog. Distribution `_metadata` retains recorded source, check date and method; null means absent. No fabricated freshness or blanket license for third-party records. |
| `/llms.txt` | Generated overview linking the catalog and skill. A convention, not a guarantee of crawler adoption. |
| `/.well-known/api-catalog` | [RFC 9727](https://www.rfc-editor.org/rfc/rfc9727.html) Linkset, with actual JSON and MCP endpoints, documentation links, required media type and discovery Link header. |
| `/.well-known/agent-skills/index.json` | [Cloudflare's discovery proposal](https://github.com/cloudflare/agent-skills-discovery-rfc), v0.2.0: named skill, description and SHA-256 digest. Experimental. |
| `/.well-known/skills/index.json` | Compatibility alias with the same index. The proposal's canonical path uses `agent-skills`. |
| `/.well-known/server-card.json` | [Experimental MCP Server Card](https://github.com/modelcontextprotocol/ext-server-card), from the JSON the Worker uses for identity. Clients enumerate tools at runtime. |
| `https://mcp.rcsd.info/mcp/server-card` | Worker route at the recommended experimental location; supports GET and HEAD. |
| `/.well-known/ai-catalog.json` | [Draft AI Catalog](https://github.com/Agent-Card/ai-catalog) linking the card and dataset catalog. |
| `/.well-known/mcp.json` | Copyable `mcpServers` client configuration. Not a standardized discovery schema; client formats vary. |
| HTTP Link | API catalog, site description, and a URI-named skill discovery relation on Pages responses. The skill relation is a project hint, not a registered standard. |
| HTTP Content-Signal | `search=yes, ai-input=yes`: welcomes search and inference/agent use. No training preference or third-party copyright change. |

The generator runs inside `build-homepage.mjs`, covering both the normal build
and pipeline. `npm run build:discovery` runs it independently. Maintain dataset
families in `scripts/lib/discovery-datasets.mjs`; large policy, transcript and
warrant corpora are fetched through indexes on demand. Edit the skill in
`templates/rcsd-data-web/SKILL.md`. The field schema is copied from the canonical
plugin reference. Generated files should not be edited directly.

## Formats not implemented

`/.well-known/agent-card.json` describes an [A2A server](https://a2a-protocol.org/v0.3.0/specification/).
RCSD implements MCP, not A2A tasks/messages. A fake A2A card would misdirect clients.
`/.well-known/acp.json` is ambiguous across ACP proposals, including commerce;
RCSD has no corresponding ACP implementation. These paths should return 404.

Do not label HTML as Markdown or add `Vary: Accept` without actually negotiating
representations. The explicit Markdown catalog works independently of edge conversion.

## Operator rollout

Committing site files cannot enable account settings, DNS or registry listings.

1. Deploy the MCP Worker, data-host Worker and Pages changes together. The MCP Worker changes its
   identifier to `info.rcsd/open-data`, retaining `RCSD Open Data` as the display
   title. Check clients that cache preferences by server name. Use the existing
   staged Pages release process and its provenance gates.
2. Enable [Cloudflare Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/)
   if the plan supports it (current docs: Pro, Business, Enterprise). Dashboard:
   AI Crawl Control → Markdown for Agents. API:
   `PATCH /zones/{zone_id}/settings/content_converter` with `{"value":"on"}`.
   Verify a GET with `Accept: text/markdown` returns Markdown and `Vary: Accept`.
   The origin Content-Signal overrides the converter's defaults.
3. Audit managed robots.txt, AI Crawl Control, WAF and bot challenges on
   `rcsd.info`, `data.rcsd.info` and `mcp.rcsd.info`. Repository robots.txt alone
   does not prove edge access. Test ordinary requests and relevant crawler user
   agents. Prefer scoped changes over disabling unrelated security controls.
4. Verify the data-host Worker's catalog headers and redirects after its separate
   deployment. Pages `_headers` do not configure the other hosts. Already-cached
   directory indexes may retain their old headers until their cache TTL expires.
5. Publish the remote server to the [official MCP Registry](https://github.com/modelcontextprotocol/registry/blob/main/docs/guides/publishing/publish-server.md).
   Its `server.json` schema and ownership verification are separate from the
   experimental Server Card. Client-directory inclusion requires a real listing.
6. Submit the updated sitemap in Search Console. Track indexing, referral/citation
   traffic, successful JSON retrieval and MCP tool use, rather than just hits to
   discovery files. Search remains an important entry point for agents.

## DNS-AID experiment

[DNS-AID draft-02](https://datatracker.ietf.org/doc/html/draft-mozleywilliams-dnsop-dnsaid-02)
is an Internet-Draft, not an Internet Standard. It helps clients that already
know the organizational domain; it is not a global search index.

The proposed RCSD service name is `_rcsd._mcp._agents.rcsd.info`, targeting
`mcp.rcsd.info`, port 443, through SVCB. Its capability descriptor must preserve
the actual Streamable HTTP path `/mcp`; the DNS hostname alone does not encode
that path. Choose a DNS-AID client/version and verify Cloudflare's supported
SVCB parameters and experimental key encodings before creating records.

Do not advertise `alpn="mcp"` unless the TLS endpoint negotiates it: ordinary
HTTPS endpoints generally negotiate `h2` or `http/1.1`. Draft protocol hints and
TLS ALPN are not interchangeable. `_index._agents.rcsd.info` is only useful with
an implemented index protocol; the draft leaves that schema out of scope.
Check DNSSEC before claiming authenticated discovery. Probe one service through
a recursive resolver, fetch its card, initialize MCP and list tools before
expanding. This build changes no DNS records.

## Verification

`npm run test:discovery` checks download paths, provenance fidelity, Linkset
coverage, skill digest, bilingual discovery, shared card and deterministic output.
`npm run test:links` checks site links; run `npm run search:index` first if the
gitignored Pagefind bundle is absent.

After deployment, check GET and HEAD, MIME types, Link headers, CORS, skill digest,
and actual downloaded JSON:

```sh
curl -fsSI https://rcsd.info/.well-known/api-catalog
curl -fsS -H 'Accept: application/linkset+json' https://rcsd.info/.well-known/api-catalog
curl -fsS https://rcsd.info/.well-known/agent-skills/index.json
curl -fsSI https://rcsd.info/.well-known/agent-skills/rcsd-data-web/SKILL.md
curl -fsS https://mcp.rcsd.info/mcp/server-card
curl -fsS -H 'Accept: text/markdown' https://rcsd.info/catalog/
```

Proposal formats and source documentation were checked on 2026-09-21. Recheck
upstream schemas when upgrading. These additions improve access and discovery
opportunities; they cannot guarantee adoption or ranking.
