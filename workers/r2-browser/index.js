/**
 * Cloudflare Worker: R2 directory browser for data.rcsd.info
 *
 * - Serves R2 objects with correct Content-Type
 * - Renders directory listings for paths ending in /
 * - Machine-readable JSON listings at /index.json and /<dir>/index.json
 * - Styled consistently with rcsd.info
 */

const MIME_TYPES = {
  pdf: 'application/pdf',
  json: 'application/json',
  html: 'text/html',
  txt: 'text/plain',
  csv: 'text/csv',
  xml: 'application/xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  vtt: 'text/vtt',
};

function guessMime(key) {
  const ext = key.split('.').pop()?.toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(d) {
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

function renderDirectory(prefix, objects, prefixes) {
  const path = prefix ? `/${prefix}` : '/';
  const title = prefix ? `/${prefix}` : 'data.rcsd.info';
  const breadcrumbs = buildBreadcrumbs(prefix);

  const rows = [];

  // Parent directory link
  if (prefix) {
    const cleanPrefix = prefix.replace(/\/$/, '');
    const parent = cleanPrefix.split('/').slice(0, -1).join('/');
    const parentHref = parent ? `/${parent}/` : '/';
    rows.push(`<tr class="dir"><td><a href="${parentHref}">..</a></td><td></td><td></td></tr>`);
  }

  // Sub-directories
  for (const p of prefixes) {
    const name = p.replace(prefix, '').replace(/\/$/, '');
    rows.push(`<tr class="dir"><td><a href="/${p}">${name}/</a></td><td></td><td></td></tr>`);
  }

  // Files
  for (const obj of objects) {
    const name = obj.key.replace(prefix, '');
    if (!name || name.includes('/')) continue;
    rows.push(`<tr><td><a href="/${obj.key}">${name}</a></td><td class="size">${formatSize(obj.size)}</td><td class="date">${formatDate(obj.uploaded)}</td></tr>`);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — RCSD Open Data</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Fraunces:wght@300;400;600&display=swap" rel="stylesheet">
<style>
  :root {
    --green-deep: #1a3a2a;
    --green-mid: #2d5a3f;
    --green-light: #4a8c6a;
    --cream: #faf8f4;
    --cream-dark: #f2efe8;
    --text: #2a2a28;
    --text-secondary: #5a5a56;
    --text-muted: #6b6b64; /* >=4.5:1 on cream/white (WCAG AA small text); keep in sync with html-parts.mjs */
    --rule: #d4d0c8;
    --rule-light: #e8e4dc;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { font-size: 16px; background: var(--cream); }
  body {
    font-family: 'IBM Plex Mono', monospace;
    color: var(--text);
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--green-mid); text-decoration: none; }
  a:hover { color: var(--green-deep); text-decoration: underline; }

  .site-nav {
    background: #1a2e1a;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }
  .site-nav-inner {
    max-width: 960px;
    margin: 0 auto;
    padding: 0 2rem;
    display: flex;
    align-items: center;
  }
  .site-nav-tabs { display: flex; gap: 0; }
  .site-nav-tab {
    font-size: 0.65rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    text-decoration: none;
    color: rgba(255,255,255,0.45);
    padding: 0.7rem 1rem;
    border-bottom: 2px solid transparent;
    transition: color 0.2s;
  }
  .site-nav-tab:hover { color: rgba(255,255,255,0.8); }
  .site-nav-tab.active { color: #fff; border-bottom-color: var(--green-light); }

  .header {
    background: var(--cream-dark);
    border-bottom: 1px solid var(--rule);
    padding: 1.5rem 2rem;
  }
  .header-inner {
    max-width: 960px;
    margin: 0 auto;
  }
  .header h1 {
    font-family: 'Fraunces', serif;
    font-size: 1.1rem;
    font-weight: 400;
    color: var(--green-deep);
  }
  .breadcrumbs {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-top: 0.3rem;
  }
  .breadcrumbs a { color: var(--green-mid); }

  .content {
    max-width: 960px;
    margin: 0 auto;
    padding: 1rem 2rem 4rem;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }
  th {
    text-align: left;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    padding: 0.8rem 0.5rem 0.4rem;
    border-bottom: 2px solid var(--rule);
  }
  td {
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid var(--rule-light);
  }
  tr:hover { background: var(--cream-dark); }
  tr.dir a::before { content: '📁 '; }
  .size, .date { color: var(--text-muted); white-space: nowrap; }
  .size { text-align: right; width: 80px; }
  .date { width: 100px; }

  .footer {
    max-width: 960px;
    margin: 0 auto;
    padding: 2rem;
    border-top: 1px solid var(--rule);
    text-align: center;
    font-size: 0.75rem;
    color: var(--text-muted);
    font-style: italic;
  }
  .footer a { color: var(--green-mid); }

  @media (max-width: 640px) {
    .header, .content { padding-left: 1rem; padding-right: 1rem; }
    .date { display: none; }
  }
</style>
</head>
<body>

<nav class="site-nav">
  <div class="site-nav-inner">
    <div class="site-nav-tabs">
      <a href="https://rcsd.info/" class="site-nav-tab">Home</a>
      <a href="https://rcsd.info/meetings/" class="site-nav-tab">Meetings</a>
      <a href="https://rcsd.info/district/" class="site-nav-tab">District</a>
      <a href="/" class="site-nav-tab active">Data</a>
      <a href="https://github.com/dweekly/rcsd-meetings" class="site-nav-tab">Code</a>
    </div>
  </div>
</nav>

<div class="header">
  <div class="header-inner">
    <h1>RCSD Open Data Files</h1>
    <div class="breadcrumbs">${breadcrumbs}</div>
  </div>
</div>

<div class="content">
  <table>
    <thead><tr><th>Name</th><th class="size">Size</th><th class="date">Modified</th></tr></thead>
    <tbody>
${rows.join('\n')}
    </tbody>
  </table>
</div>

<footer class="footer">
  <p>Public data archive for the <a href="https://rcsd.info">Redwood City School District</a>. Source: <a href="https://github.com/dweekly/rcsd-meetings">GitHub</a>. Contact: <a href="mailto:team@rcsd.info">team@rcsd.info</a></p>
</footer>

</body>
</html>`;
}

function buildBreadcrumbs(prefix) {
  const parts = ['<a href="/">data.rcsd.info</a>'];
  if (prefix) {
    const segments = prefix.replace(/\/$/, '').split('/');
    let path = '';
    for (const seg of segments) {
      path += seg + '/';
      parts.push(`<a href="/${path}">${seg}</a>`);
    }
  }
  return parts.join(' / ');
}

// 5 min: fresh enough to pick up new uploads, cheap enough to list repeatedly
const INDEX_CACHE_SECONDS = 300;

// Machine-readable directory index, one level deep (clients walk subdirectories
// via the "prefixes" array). Served at /index.json (root) and /<dir>/index.json.
async function renderIndexJson(bucket, prefix, corsHeaders) {
  const prefixes = [];
  const objects = [];
  let cursor;
  // list() pages at 1000 keys; cap pages so a huge prefix can't run away
  for (let page = 0; page < 10; page++) {
    const listed = await bucket.list({ prefix, delimiter: '/', cursor });
    for (const p of listed.delimitedPrefixes || []) prefixes.push(p);
    for (const obj of listed.objects || []) {
      objects.push({
        key: obj.key,
        size: obj.size,
        uploaded: obj.uploaded ? obj.uploaded.toISOString() : null,
      });
    }
    if (!listed.truncated) {
      cursor = undefined;
      break;
    }
    cursor = listed.cursor;
  }
  prefixes.sort();
  objects.sort((a, b) => a.key.localeCompare(b.key));
  // A nonexistent directory and an empty one look identical to list(); only
  // the bucket root may legitimately be object-empty. Everything else 404s so
  // typo'd paths aren't cached as valid-but-empty listings.
  if (prefix !== '' && prefixes.length === 0 && objects.length === 0) {
    return new Response(JSON.stringify({ error: 'not found', prefix }), {
      status: 404,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
    });
  }
  const body = {
    prefix,
    generated: new Date().toISOString(),
    truncated: Boolean(cursor),
    prefixes,
    objects,
  };
  return new Response(JSON.stringify(body, null, 1), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${INDEX_CACHE_SECONDS}`,
      ...corsHeaders,
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let key = decodeURIComponent(url.pathname.slice(1)); // strip leading /

    // CORS headers for JSON files
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Expose-Headers': 'Link, Content-Signal',
      'Link': '<https://rcsd.info/.well-known/api-catalog>; rel="api-catalog", <https://rcsd.info/catalog.json>; rel="describedby"; type="application/ld+json"',
      'Content-Signal': 'search=yes, ai-input=yes',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (key === '.well-known/api-catalog' || key === '.well-known/ai-catalog.json') {
      return new Response(null, { status: 302, headers: {
        ...corsHeaders, Location: `https://rcsd.info/${key}`,
      } });
    }

    // Synthesized JSON directory listing (e.g. /index.json, /json/index.json).
    // A real R2 object with the same key takes precedence (falls through below).
    if (key === 'index.json' || key.endsWith('/index.json')) {
      const cacheKey = new Request(`${url.origin}/${key}`);
      const cached = await caches.default.match(cacheKey);
      if (cached) return cached;
      const real = await env.BUCKET.head(key);
      if (!real) {
        const prefix = key.slice(0, -'index.json'.length); // '' at the root
        const response = await renderIndexJson(env.BUCKET, prefix, corsHeaders);
        ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
        return response;
      }
    }

    // Root or directory listing (path ends in / or is empty)
    if (!key || key.endsWith('/')) {
      const prefix = key;
      const listed = await env.BUCKET.list({ prefix, delimiter: '/' });

      const prefixes = (listed.delimitedPrefixes || []).sort();
      const objects = (listed.objects || []).sort((a, b) => a.key.localeCompare(b.key));

      const html = renderDirectory(prefix, objects, prefixes);
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
      });
    }

    // Try to serve the object
    const object = await env.BUCKET.get(key);
    if (!object) {
      // Maybe it's a directory without trailing slash — check for objects with this prefix
      const check = await env.BUCKET.list({ prefix: key + '/', delimiter: '/', limit: 1 });
      if ((check.objects?.length || 0) > 0 || (check.delimitedPrefixes?.length || 0) > 0) {
        return Response.redirect(`${url.origin}/${key}/`, 301);
      }
      return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers({
      'Content-Type': object.httpMetadata?.contentType || guessMime(key),
      'ETag': object.httpEtag,
      ...corsHeaders,
    });

    if (object.size != null) {
      headers.set('Content-Length', object.size);
    }

    // Cache immutable documents for 1 year, others for 1 hour
    const immutable = /\.(pdf|png|jpg|jpeg|mp4|webm)$/i.test(key);
    headers.set('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');

    return new Response(object.body, { headers });
  },
};
