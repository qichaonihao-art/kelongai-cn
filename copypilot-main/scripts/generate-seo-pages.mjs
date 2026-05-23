import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seoPages, seoRoutes, siteName, siteOrigin } from '../src/seo-pages.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const indexPath = path.join(distDir, 'index.html');
const indexHtml = await readFile(indexPath, 'utf8');

for (const page of seoPages) {
  const targetDir = path.join(distDir, ...page.path.split('/').filter(Boolean));
  const targetPath = page.path === '/' ? indexPath : path.join(targetDir, 'index.html');
  const extensionlessPath = page.path === '/' ? null : path.join(distDir, `${page.path.replace(/^\//, '')}.html`);
  const html = renderHtml(indexHtml, page);
  if (page.path !== '/') await mkdir(targetDir, { recursive: true });
  await writeFile(targetPath, html, 'utf8');
  if (extensionlessPath) {
    await mkdir(path.dirname(extensionlessPath), { recursive: true });
    await writeFile(extensionlessPath, html, 'utf8');
  }
}

await writeFile(path.join(distDir, 'sitemap.xml'), renderSitemap(), 'utf8');
await writeFile(path.join(distDir, 'sitemap.txt'), renderSitemapText(), 'utf8');
await writeFile(path.join(distDir, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${siteOrigin}/sitemap.xml\nSitemap: ${siteOrigin}/sitemap.txt\n`, 'utf8');

function renderHtml(baseHtml, page) {
  const canonical = `${siteOrigin}${page.path}`;
  const title = `${page.title} | ${siteName}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: page.h1,
    url: canonical,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web',
    description: page.description,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD'
    }
  };
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: page.faqs.map(([question, answer]) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: answer
      }
    }))
  };

  const extraHead = [
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta name="keywords" content="${escapeHtml(page.keywords.join(', '))}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(siteName)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(page.description)}" />`,
    `<script type="application/ld+json">${escapeScriptJson(jsonLd)}</script>`,
    `<script type="application/ld+json">${escapeScriptJson(faqJsonLd)}</script>`
  ].join('\n    ');

  return baseHtml
    .replace(/<html[^>]*>/, `<html lang="${page.htmlLang}">`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(page.description)}" />`)
    .replace('</head>', `    ${extraHead}\n  </head>`);
}

function renderSitemap() {
  const pageByPath = Object.fromEntries(seoPages.map((page) => [page.path, page]));
  const urls = seoRoutes.map((route) => {
    const page = pageByPath[route];
    return [
    '  <url>',
    `    <loc>${escapeXml(`${siteOrigin}${route}`)}</loc>`,
    `    <lastmod>${page?.updated || '2026-05-18'}</lastmod>`,
    '    <changefreq>weekly</changefreq>',
    `    <priority>${route === '/' ? '1.0' : route.startsWith('/en/') ? '0.7' : '0.8'}</priority>`,
    '  </url>'
    ].join('\n');
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function renderSitemapText() {
  return `${seoRoutes.map((route) => `${siteOrigin}${route}`).join('\n')}\n`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeXml(value) {
  return escapeHtml(value).replace(/'/g, '&apos;');
}

function escapeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
