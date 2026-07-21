#!/usr/bin/env node
/**
 * Generate blog index and post pages (EN + ES) from templates and blog-posts.json.
 * EN: /blog/{slug}/ (posts)
 * ES: /blog/{slugEs}/ (posts)
 * Both languages share the /blog/ path prefix.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { headMeta, siteNav, siteFooter } from './html-parts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const posts = JSON.parse(readFileSync(resolve(ROOT, 'data/blog-posts.json'), 'utf-8'));

// Sort posts reverse-chronological
posts.sort((a, b) => b.date.localeCompare(a.date));

// ---- Page-specific CSS (shared by index + posts) ----
const blogCSS = `
  /* ---- POST HEADER ---- */
  .post-header {
    background: var(--green-deep);
    color: var(--cream);
    position: relative;
    overflow: hidden;
  }
  .post-header::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at 20% 80%, rgba(74,140,106,0.3) 0%, transparent 60%),
      radial-gradient(ellipse at 80% 20%, rgba(196,132,45,0.15) 0%, transparent 50%);
    pointer-events: none;
  }
  .post-header-inner {
    max-width: 720px;
    margin: 0 auto;
    padding: 4rem 2rem 3rem;
    position: relative;
  }
  .post-meta {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    color: rgba(255,255,255,0.5);
    margin-bottom: 1rem;
    display: flex;
    gap: 1rem;
  }
  .post-meta a {
    color: rgba(255,255,255,0.7);
    text-decoration: none;
  }
  .post-meta a:hover { color: #fff; }
  .post-header h1 {
    font-family: 'Fraunces', Georgia, serif;
    font-size: clamp(1.8rem, 4vw, 2.8rem);
    font-weight: 300;
    line-height: 1.15;
    color: #fff;
    font-optical-sizing: auto;
  }
  .post-subtitle {
    margin-top: 1.2rem;
    font-size: 0.95rem;
    color: rgba(255,255,255,0.6);
    line-height: 1.6;
    font-style: italic;
    max-width: 560px;
  }

  /* ---- POST BODY ---- */
  .post-content {
    max-width: 720px;
    margin: 0 auto;
    padding: 0 2rem 4rem;
  }
  .post-body {
    padding-top: 2rem;
  }
  .post-body section {
    margin-bottom: 2.5rem;
  }
  .post-body h2 {
    font-family: 'Fraunces', Georgia, serif;
    font-size: clamp(1.3rem, 2.5vw, 1.7rem);
    font-weight: 400;
    color: var(--green-deep);
    margin-bottom: 1rem;
    line-height: 1.25;
    font-optical-sizing: auto;
  }
  .post-body p {
    margin-bottom: 1rem;
    max-width: none;
    line-height: 1.7;
  }
  .post-body ul, .post-body ol {
    margin: 0.8rem 0 1.2rem 1.5rem;
    line-height: 1.65;
  }
  .post-body li {
    margin-bottom: 0.4rem;
  }
  .post-body code {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.88em;
    background: var(--cream-dark);
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
  }
  .post-body a {
    color: var(--green-mid);
    text-decoration-color: var(--rule);
    text-underline-offset: 2px;
  }
  .post-body a:hover {
    color: var(--green-deep);
    text-decoration-color: var(--green-mid);
  }
  /* AI content disclosure callout — use on posts drafted by AI */
  .ai-disclosure {
    background: var(--cream-dark);
    border-left: 3px solid var(--green-mid);
    border-radius: 4px;
    padding: 0.85rem 1.1rem;
    margin: 0 0 2rem;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.82rem;
    line-height: 1.55;
    color: var(--ink-soft, #444);
  }

  /* ---- BLOG INDEX ---- */
  .blog-header {
    background: var(--green-deep);
    color: var(--cream);
    position: relative;
    overflow: hidden;
  }
  .blog-header::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at 20% 80%, rgba(74,140,106,0.3) 0%, transparent 60%),
      radial-gradient(ellipse at 80% 20%, rgba(196,132,45,0.15) 0%, transparent 50%);
    pointer-events: none;
  }
  .blog-header-inner {
    max-width: 720px;
    margin: 0 auto;
    padding: 3.5rem 2rem 2.5rem;
    position: relative;
  }
  .blog-header h1 {
    font-family: 'Fraunces', Georgia, serif;
    font-size: clamp(1.8rem, 4vw, 2.6rem);
    font-weight: 300;
    color: #fff;
    line-height: 1.2;
    font-optical-sizing: auto;
  }
  .blog-header p {
    margin-top: 0.8rem;
    font-size: 0.9rem;
    color: rgba(255,255,255,0.55);
    font-style: italic;
    line-height: 1.6;
  }
  .blog-list {
    max-width: 720px;
    margin: 0 auto;
    padding: 2rem 2rem 4rem;
  }
  .blog-post-card {
    display: block;
    padding: 1.5rem 0;
    border-bottom: 1px solid var(--rule-light);
    text-decoration: none;
    color: inherit;
    transition: background 0.15s;
  }
  .blog-post-card:first-child {
    border-top: 1px solid var(--rule-light);
  }
  .blog-post-card:hover {
    background: var(--green-wash);
    margin: 0 -1rem;
    padding-left: 1rem;
    padding-right: 1rem;
  }
  .blog-card-date {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    text-transform: uppercase;
  }
  .blog-card-title {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--green-deep);
    margin-top: 0.3rem;
    line-height: 1.3;
  }
  .blog-card-excerpt {
    font-size: 0.88rem;
    color: var(--text-secondary);
    margin-top: 0.5rem;
    line-height: 1.55;
  }

  /* ---- RESPONSIVE ---- */
  @media (max-width: 640px) {
    html { font-size: 15px; }
    .post-header-inner { padding: 3rem 1.2rem 2rem; }
    .post-content { padding: 0 1.2rem 3rem; }
    .blog-header-inner { padding: 2.5rem 1.2rem 2rem; }
    .blog-list { padding: 1.5rem 1.2rem 3rem; }
  }`;

// ---- Helpers ----
function formatDate(dateStr, lang) {
  const d = new Date(dateStr + 'T12:00:00');
  if (lang === 'es') {
    const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    return `${d.getDate()} de ${months[d.getMonth()]} de ${d.getFullYear()}`;
  }
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function blogPostingJsonLd(post, lang) {
  const isEn = lang === 'en';
  const slug = isEn ? post.slug : post.slugEs;
  return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": ${JSON.stringify(post.title[lang])},
  "description": ${JSON.stringify(post.description[lang])},
  "datePublished": "${post.date}",
  "author": {
    "@type": "Person",
    "name": "${post.author}",
    "url": "${post.authorUrl}"
  },
  "publisher": {
    "@type": "Organization",
    "name": "RCSD Open Data",
    "url": "https://rcsd.info"
  },
  "url": "https://rcsd.info/blog/${slug}/",
  "inLanguage": "${isEn ? 'en' : 'es'}",
  "mainEntityOfPage": "https://rcsd.info/blog/${slug}/"
}
</script>`;
}

// ---- Generate individual post pages ----
for (const post of posts) {
  for (const lang of ['en', 'es']) {
    const isEn = lang === 'en';
    const slug = isEn ? post.slug : post.slugEs;
    const altSlug = isEn ? post.slugEs : post.slug;
    const outDir = `docs/blog/${slug}`;
    const outFile = `${outDir}/index.html`;
    const canonical = `https://rcsd.info/blog/${slug}/`;
    const altHref = `/blog/${altSlug}/`;

    const bodyContent = readFileSync(
      resolve(ROOT, 'templates/blog', post.template[lang]),
      'utf-8'
    );

    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
${headMeta({
  title: `${post.title[lang]} — RCSD Open Data`,
  description: post.description[lang],
  canonical,
  ogLocale: isEn ? 'en_US' : 'es_US',
  ogImageKey: `blog-${slug}`,
  hreflang: [
    { lang: 'en', href: `https://rcsd.info/blog/${post.slug}/` },
    { lang: 'es', href: `https://rcsd.info/blog/${post.slugEs}/` },
  ],
  jsonLd: blogPostingJsonLd(post, lang),
  pageCSS: blogCSS,
})}
</head>
<body>

${siteNav({ activePage: 'blog', lang, altLangHref: altHref })}

${bodyContent}

${siteFooter({ lang })}

</body>
</html>`;

    mkdirSync(resolve(ROOT, outDir), { recursive: true });
    writeFileSync(resolve(ROOT, outFile), html);
    console.log(`Wrote ${outFile}`);
  }
}

// ---- Generate index pages ----
for (const lang of ['en', 'es']) {
  const isEn = lang === 'en';
  const outDir = isEn ? 'docs/blog' : 'docs/blog/es';
  const outFile = `${outDir}/index.html`;
  const canonical = isEn ? 'https://rcsd.info/blog/' : 'https://rcsd.info/blog/es/';
  const altHref = isEn ? '/blog/es/' : '/blog/';

  const postCards = posts.map(post => {
    const slug = isEn ? post.slug : post.slugEs;
    const href = `/blog/${slug}/`;
    return `    <a href="${href}" class="blog-post-card">
      <div class="blog-card-date">${formatDate(post.date, lang)}</div>
      <div class="blog-card-title">${post.title[lang]}</div>
      <div class="blog-card-excerpt">${post.excerpt[lang]}</div>
    </a>`;
  }).join('\n');

  const indexTitle = 'Blog';
  const indexSubtitle = isEn
    ? 'Updates on the rcsd.info open data project.'
    : 'Novedades del proyecto de datos abiertos rcsd.info.';

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
${headMeta({
  title: `${indexTitle} — RCSD Open Data`,
  description: isEn
    ? 'Blog posts about the rcsd.info open data project for the Redwood City School District.'
    : 'Posts del blog sobre el proyecto de datos abiertos rcsd.info para el Distrito Escolar de Redwood City.',
  canonical,
  ogLocale: isEn ? 'en_US' : 'es_US',
  ogImageKey: `page-blog${isEn ? '' : '-es'}`,
  hreflang: [
    { lang: 'en', href: 'https://rcsd.info/blog/' },
    { lang: 'es', href: 'https://rcsd.info/blog/es/' },
  ],
  pageCSS: blogCSS,
})}
</head>
<body>

${siteNav({ activePage: 'blog', lang, altLangHref: altHref })}

<header class="blog-header">
  <div class="blog-header-inner">
    <h1>${indexTitle}</h1>
    <p>${indexSubtitle}</p>
  </div>
</header>

<div class="blog-list">
${postCards}
</div>

${siteFooter({ lang })}

</body>
</html>`;

  mkdirSync(resolve(ROOT, outDir), { recursive: true });
  writeFileSync(resolve(ROOT, outFile), html);
  console.log(`Wrote ${outFile}`);
}
