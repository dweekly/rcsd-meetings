#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { headMeta, siteNav, siteFooter } from './html-parts.mjs';
import { DATASETS } from './lib/discovery-datasets.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://rcsd.info';
const DATA = 'https://data.rcsd.info/json/';
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const json = value => JSON.stringify(value, null, 2) + '\n';
function sourceLinks(metadata) {
  const urls = [...new Set(JSON.stringify(metadata.source || '').match(/https?:\/\/[^\\\s"<>]+/g) || [])];
  return urls.map(url => `<a href="${escape(url)}">${escape(url)}</a>`).join('<br>');
}
const write = (path, text) => {
  const dest = resolve(ROOT, 'docs', path);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, text);
};

function expand(pattern) {
  if (!pattern.includes('*')) return [pattern];
  const dir = dirname(pattern);
  const [prefix, suffix] = basename(pattern).split('*');
  const files = readdirSync(resolve(ROOT, 'data', dir))
    .filter(f => f.startsWith(prefix) && f.endsWith(suffix)).sort()
    .map(f => dir === '.' ? f : `${dir}/${f}`);
  if (!files.length) throw new Error(`Empty discovery dataset: ${pattern}`);
  return files;
}

export function buildAgentDiscovery() {
  const datasets = DATASETS.map(([id, en, es, patterns]) => ({
    id, en, es, files: patterns.flatMap(expand).map(file => {
      const data = JSON.parse(readFileSync(resolve(ROOT, 'data', file), 'utf8'));
      // Preserve source metadata as supplied; never substitute the build clock.
      const m = data._metadata || {};
      return { file, metadata: Object.fromEntries(['source', 'scrapedAt', 'method']
        .filter(key => m[key] !== undefined).map(key => [key, m[key]])) };
    }),
  }));
  const catalog = {
    '@context': 'https://schema.org', '@type': 'DataCatalog', '@id': `${SITE}/catalog/#catalog`,
    name: 'RCSD Open Data catalog', alternateName: 'Catálogo de datos abiertos de RCSD',
    description: 'Independent public-records catalog for Redwood City School District, California. English and Spanish research entry points with official-source provenance in the linked datasets.',
    _metadata: {
      source: 'https://github.com/dweekly/rcsd-meetings/blob/main/scripts/lib/discovery-datasets.mjs',
      scrapedAt: null,
      method: 'Generated from the curated dataset inventory and local JSON files. Distribution metadata is copied from each file; null means not recorded. This catalog does not independently verify source freshness.',
    },
    url: `${SITE}/catalog/`, inLanguage: ['en', 'es'],
    publisher: { '@type': 'Person', name: 'David Weekly', url: 'https://david.weekly.org' },
    dataset: datasets.map(d => ({
      '@type': 'Dataset', '@id': `${SITE}/catalog/#${d.id}`, name: d.en, alternateName: d.es,
      description: `${d.en}. Independently compiled RCSD public records; consult each download's source metadata, reporting period and limitations before use.`,
      url: `${SITE}/catalog/#${d.id}`, isAccessibleForFree: true,
      spatialCoverage: { '@type': 'Place', name: 'Redwood City, California, United States' },
      includedInDataCatalog: { '@id': `${SITE}/catalog/#catalog` },
      distribution: d.files.map(({ file, metadata }) => ({ '@type': 'DataDownload', name: file, encodingFormat: 'application/json', contentUrl: DATA + file,
        _metadata: { source: null, scrapedAt: null, method: null, ...metadata },
      })),
    })),
  };
  write('catalog.json', json(catalog));

  const guides = {
    en: {
      title: 'Data catalog & agent guide', route: 'catalog', alternate: 'catalogo',
      intro: 'Public JSON datasets for researching Redwood City School District. This is an independent community project, not an official district website. No account or API key is required.',
      help: 'Choose the smallest relevant dataset. Cite its official source and reporting year. Source-check dates below come from the files; missing dates mean unknown freshness. Machine summaries, translations and transcripts may contain errors. Suppressed cells are not zero.',
      links: 'Machine-readable catalog', skill: 'Research skill (English)', schema: 'Field schema (English)', mcp: 'Connect an MCP client',
      metadata: 'Source metadata as recorded (source / checked / method)', missing: 'No source-check metadata in this file; consult the source fields and research guide.',
      example: 'Example: find a school', next: 'Fetch schools.json, identify the school slug or CDS code, then join the matching school and year in a SARC or CDE dataset. For board documents, start with attachment-index.json; document-index.json contains only classified documents.',
    },
    es: {
      title: 'Catálogo de datos y guía para agentes', route: 'catalogo', alternate: 'catalog',
      intro: 'Datos JSON públicos para investigar el Distrito Escolar de Redwood City. Este es un proyecto comunitario independiente, no el sitio oficial del distrito. No se requiere cuenta ni clave de API.',
      help: 'Elija el conjunto de datos más pequeño que responda a su pregunta. Cite la fuente oficial y el año de los datos. Las fechas de verificación provienen de los archivos; si faltan, la actualidad es desconocida. Los resúmenes, traducciones y transcripciones automáticos pueden contener errores. Las celdas suprimidas no son cero.',
      links: 'Catálogo legible por máquinas', skill: 'Guía para agentes (inglés)', schema: 'Esquema de campos (inglés)', mcp: 'Conectar un cliente MCP',
      metadata: 'Metadatos originales (fuente / verificación / método)', missing: 'Este archivo no incluye metadatos de verificación; consulte sus campos de fuente y la guía.',
      example: 'Ejemplo: buscar una escuela', next: 'Descargue schools.json, identifique el código de escuela o CDS y seleccione la misma escuela y año en los datos SARC o CDE. Para documentos de la mesa directiva, empiece por attachment-index.json; document-index.json solo contiene documentos clasificados.',
    },
  };
  for (const lang of ['en', 'es']) {
    const t = guides[lang];
    const localCatalog = lang === 'en' ? catalog : {
      ...catalog, name: catalog.alternateName, description: t.intro, url: `${SITE}/catalogo/`,
      dataset: catalog.dataset.map(d => ({ ...d, name: d.alternateName, description: d.alternateName, url: d.url.replace('/catalog/', '/catalogo/') })),
    };
    const markdown = `# ${t.title}\n\n${t.intro}\n\n${t.help}\n\n- [${t.links}](${SITE}/catalog.json)\n- [${t.skill}](${SITE}/.well-known/agent-skills/rcsd-data-web/SKILL.md)\n- [${t.schema}](${SITE}/agents/data-schema.md)\n- [${t.mcp}](${SITE}/mcp/${lang === 'es' ? 'es/' : ''})\n\n## ${t.example}\n\n${t.next}\n\n\`\`\`sh\ncurl -fsS https://data.rcsd.info/json/schools.json\n\`\`\`\n\n` + datasets.map(d => `## ${d[lang]}\n\n` + d.files.map(({ file }) => `- [${file}](${DATA}${file})`).join('\n')).join('\n\n') + '\n';
    write(`${t.route}/index.md`, markdown);
    const sections = datasets.map(d => `<section id="${d.id}"><h2>${escape(d[lang])}</h2><ul>${d.files.map(({ file, metadata }) => `<li><a href="${DATA}${file}">${escape(file)}</a><details><summary>${t.metadata}</summary>${Object.keys(metadata).length ? `<p>${sourceLinks(metadata)}</p><pre>${escape(json(metadata))}</pre>` : `<p>${t.missing}</p>`}</details></li>`).join('\n')}</ul></section>`).join('\n');
    write(`${t.route}/index.html`, `<!doctype html>\n<html lang="${lang}"><head>${headMeta({
      title: `${t.title} — RCSD`, description: t.intro, canonical: `${SITE}/${t.route}/`,
      ogLocale: lang === 'en' ? 'en_US' : 'es_US',
      hreflang: [{ lang: 'en', href: `${SITE}/catalog/` }, { lang: 'es', href: `${SITE}/catalogo/` }],
      extraHead: `<link rel="alternate" type="text/markdown" href="/${t.route}/index.md">\n<link rel="api-catalog" href="/.well-known/api-catalog">`,
      jsonLd: `<script type="application/ld+json">${json(localCatalog).replace(/</g, '\\u003c')}</script>`,
      pageCSS: 'main{max-width:900px;margin:2rem auto;padding:0 1.25rem;overflow-wrap:anywhere}h1{line-height:1.2}h2{margin-top:2rem}li{margin:.7rem 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem}summary{cursor:pointer;font-size:.85rem}section{scroll-margin-top:6rem}p{line-height:1.6}',
    })}</head><body>${siteNav({ lang, altLangHref: `/${t.alternate}/` })}<main><h1>${t.title}</h1><p>${t.intro}</p><p>${t.help}</p><ul><li><a href="/catalog.json">${t.links}</a></li><li><a href="/.well-known/agent-skills/rcsd-data-web/SKILL.md">${t.skill}</a></li><li><a href="/agents/data-schema.md">${t.schema}</a></li><li><a href="/mcp/${lang === 'es' ? 'es/' : ''}">${t.mcp}</a></li><li><a href="/${t.route}/index.md">Markdown</a></li></ul><h2>${t.example}</h2><p>${t.next}</p><pre>curl -fsS https://data.rcsd.info/json/schools.json</pre>${sections}</main>${siteFooter({ lang })}</body></html>\n`);
  }

  const skill = readFileSync(resolve(ROOT, 'templates/rcsd-data-web/SKILL.md'));
  const skillPath = '/.well-known/agent-skills/rcsd-data-web/SKILL.md';
  write(skillPath.slice(1), skill);
  const description = skill.toString().match(/^description: (.+)$/m)[1];
  write('.well-known/agent-skills/index.json', json({
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills: [{ name: 'rcsd-data-web', type: 'skill-md', description, url: SITE + skillPath, digest: `sha256:${createHash('sha256').update(skill).digest('hex')}` }],
  }));
  // Compatibility alias only; the canonical proposal uses agent-skills/.
  write('.well-known/skills/index.json', readFileSync(resolve(ROOT, 'docs/.well-known/agent-skills/index.json')));
  mkdirSync(resolve(ROOT, 'docs/agents'), { recursive: true });
  copyFileSync(resolve(ROOT, 'plugin/skills/rcsd-data/references/data-schema.md'), resolve(ROOT, 'docs/agents/data-schema.md'));

  const endpoints = [
    { anchor: 'https://mcp.rcsd.info/mcp',
      'service-desc': [{ href: `${SITE}/.well-known/server-card.json`, type: 'application/mcp-server-card+json' }],
      'service-doc': [{ href: `${SITE}/mcp/`, type: 'text/html', hreflang: ['en'] }, { href: `${SITE}/mcp/es/`, type: 'text/html', hreflang: ['es'] }],
    },
    ...datasets.flatMap(d => d.files.map(({ file }) => ({ anchor: DATA + file,
      'service-doc': [{ href: `${SITE}/catalog/#${d.id}`, type: 'text/html' }],
      'service-meta': [{ href: `${SITE}/catalog.json`, type: 'application/ld+json' }],
    }))),
  ];
  write('.well-known/api-catalog', json({ linkset: [{ anchor: `${SITE}/.well-known/api-catalog`, item: endpoints.map(e => ({ href: e.anchor })) }, ...endpoints] }));
  // A copyable client configuration, explicitly not an MCP-standard discovery schema.
  write('.well-known/mcp.json', json({ mcpServers: { 'rcsd-open-data': { url: 'https://mcp.rcsd.info/mcp' } } }));
  const card = readFileSync(resolve(ROOT, 'workers/mcp-server/server-card.json'));
  write('.well-known/server-card.json', card);
  write('.well-known/ai-catalog.json', json({ specVersion: '1.0', entries: [
    { identifier: 'urn:air:rcsd.info:mcp:open-data', type: 'application/mcp-server-card+json', url: `${SITE}/.well-known/server-card.json` },
    { identifier: 'urn:air:rcsd.info:dataset:catalog', type: 'application/ld+json', url: `${SITE}/catalog.json` },
  ] }));
  console.log(`Built agent discovery: ${datasets.length} dataset families, ${endpoints.length - 1} JSON downloads, EN/ES catalogs and skill index.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildAgentDiscovery();
