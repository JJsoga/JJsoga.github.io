import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

// Inspect the actual static output after `npm run build`, independently of Astro components.
const site = 'https://jjsoga.github.io/';
const root = new URL('../', import.meta.url);
const read = (path, encoding) => readFile(new URL(path, root), encoding);
const decode = value => value.replace(/&(?:amp|quot|apos|lt|gt|#39|#x27);/g, entity => ({
  '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&#39;': "'", '&#x27;': "'",
})[entity]);
const attributes = tag => Object.fromEntries(Array.from(
  tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g),
  match => [match[1].toLowerCase(), decode(match[2] ?? match[3])],
));
const tags = (html, name) => Array.from(html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi')), match => attributes(match[0]));
const text = value => decode(value.replace(/<[^>]+>/g, '').trim());
const only = (items, description) => {
  assert.equal(items.length, 1, `${description}: expected exactly one, found ${items.length}`);
  return items[0];
};
const meta = (head, key) => only(tags(head, 'meta').filter(item => item.name === key || item.property === key), key).content;
const link = (head, rel) => tags(head, 'link').filter(item => item.rel?.split(/\s+/).includes(rel));
const entities = value => {
  if (Array.isArray(value)) return value.flatMap(entities);
  if (!value || typeof value !== 'object') return [];
  return [value, ...Object.values(value).flatMap(entities)];
};
const isWebsite = entity => [entity['@type']].flat().includes('WebSite');
let checks = 0;
const pass = name => { checks++; console.log(`PASS ${name}`); };

for (const page of [
  { file: 'index.html', path: '', title: 'Hexin Chen', lang: 'en', translated: true, home: true },
  { file: 'zh/index.html', path: 'zh/', title: '陈鹤鑫', lang: 'zh-CN', translated: true },
  { file: 'play/index.html', path: 'play/', title: 'Play | Hexin Chen', lang: 'en', translated: false },
]) {
  const html = await read(`dist/${page.file}`, 'utf8');
  const head = only(Array.from(html.matchAll(/<head\b[^>]*>([\s\S]*?)<\/head>/gi)), `${page.path || '/'} head`)[1];
  const title = text(only(Array.from(head.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)), 'title')[1]);
  assert.equal(title, page.title, `${page.file}: document title`);
  assert.equal(meta(head, 'og:title'), page.title, `${page.file}: Open Graph title`);
  assert.equal(meta(head, 'twitter:title'), page.title, `${page.file}: Twitter title`);
  assert.equal(meta(head, 'og:site_name'), 'JJsoga', `${page.file}: website brand`);
  assert.equal(only(tags(html, 'html'), 'html').lang, page.lang, `${page.file}: language`);
  const canonical = new URL(page.path, site).href;
  assert.equal(only(link(head, 'canonical'), 'canonical').href, canonical, `${page.file}: absolute canonical`);
  assert.equal(meta(head, 'og:url'), canonical, `${page.file}: social URL`);

  const alternates = link(head, 'alternate').filter(item => item.hreflang);
  assert.deepEqual(alternates.map(item => [item.hreflang, item.href]).sort(), page.translated ? [
    ['en', site], ['zh-CN', new URL('zh/', site).href], ['x-default', site],
  ].sort() : [], `${page.file}: language links only for existing translations`);

  const icons = link(head, 'icon');
  const svg = only(icons.filter(icon => icon.type === 'image/svg+xml'), 'SVG favicon');
  const png = only(icons.filter(icon => icon.type === 'image/png'), 'PNG favicon');
  assert.equal(new URL(svg.href, canonical).href, new URL('favicon.svg', site).href);
  assert.equal(svg.sizes, 'any', `${page.file}: scalable SVG favicon`);
  assert.equal(new URL(png.href, canonical).href, new URL('favicon.png', site).href);
  assert.equal(png.sizes, '96x96', `${page.file}: PNG dimensions advertised correctly`);

  const header = only(Array.from(html.matchAll(/<header\b([^>]*)>([\s\S]*?)<\/header>/gi))
    .filter(match => attributes(match[1]).class?.split(/\s+/).includes('site-header')), 'site header')[2];
  const spans = Array.from(header.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi));
  const brandText = className => text(only(spans.filter(span => attributes(span[1]).class?.split(/\s+/).includes(className)), className)[2]);
  const personalName = page.lang === 'zh-CN' ? '陈鹤鑫' : 'Hexin Chen';
  assert.equal(brandText('brand-name'), personalName, `${page.file}: visible personal name`);
  assert.equal(brandText('brand-mark'), 'HC', `${page.file}: original navigation monogram`);
  const brand = only(tags(header, 'a').filter(item => item.class?.split(/\s+/).includes('brand')), 'brand link');
  assert.equal(brand['aria-label'], `${personalName} — ${page.translated ? (page.lang === 'zh-CN' ? '返回顶部' : 'back to top') : 'home'}`,
    `${page.file}: accessible personal name`);
  if (!page.translated) {
    assert.match(html, /<option\b[^>]*value="mark"[^>]*>HC mark<\/option>/, 'HC sample label');
    assert.match(html, /<figcaption\b[^>]*>HC mark<\/figcaption>/, 'HC sample caption');
    const sample = only(tags(html, 'img').filter(item => item.alt === 'HC monogram'), 'accessible HC sample');
    assert.equal(new URL(sample.src, canonical).href, new URL('favicon.svg', site).href);
  }
  if (page.translated) {
    assert.equal(text(only(Array.from(html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)), 'personal heading')[1]), page.title,
      `${page.file}: personal name remains the main heading`);
  }

  const structuredData = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))
    .filter(script => attributes(script[1]).type === 'application/ld+json')
    .flatMap(script => entities(JSON.parse(script[2])))
    .filter(isWebsite);
  assert.equal(structuredData.length, page.home ? 1 : 0, `${page.file}: one WebSite entity on the root homepage`);
  if (page.home) {
    assert.equal(structuredData[0].name, 'JJsoga');
    assert.equal(structuredData[0].alternateName, 'Hexin Chen');
    assert.equal(structuredData[0].url, site);
    assert.ok(html.includes('href="/play/"'), 'homepage links to Play');
  }
  pass(`${page.path || '/'} titles, branding, canonical, languages, icons, and structured data`);
}

const png = await read('dist/favicon.png');
assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'valid PNG signature');
assert.equal(png.toString('ascii', 12, 16), 'IHDR', 'PNG begins with an image header');
assert.equal(png.readUInt32BE(16), 96, 'PNG favicon width');
assert.equal(png.readUInt32BE(20), 96, 'PNG favicon height');
assert.deepEqual(png, await read('public/favicon.png'), 'built PNG matches the source asset');
const svg = await read('dist/favicon.svg', 'utf8');
assert.match(svg, /<svg\b/, 'SVG favicon exists');
assert.match(svg, /(?:aria-label\s*=\s*["'][^"']*\bHC\b[^"']*["']|<title\b[^>]*>[^<]*\bHC\b[^<]*<\/title>)/i,
  'SVG exposes the HC monogram name');
assert.equal(svg, await read('public/favicon.svg', 'utf8'), 'built SVG matches the source asset');
assert.deepEqual(await sharp(png).ensureAlpha().raw().toBuffer(),
  await sharp(Buffer.from(svg)).resize(96, 96).ensureAlpha().raw().toBuffer(),
  'PNG contains the restored HC artwork, not a stale icon variant');
pass('96 × 96 PNG and accessible HC vector assets match in the build');

// Frozen before this iteration: 53 bytes, no newline. This file must remain deployable unchanged.
const verificationFile = 'google27b0d059cbe490c6.html';
const verification = await read(`public/${verificationFile}`);
assert.equal(verification.toString('utf8'), `google-site-verification: ${verificationFile}`);
assert.equal(createHash('sha256').update(verification).digest('hex'),
  'aafdc5e559773b726976499bbddb6ce1b09caa34a352717a2aa45b503f412137');
assert.deepEqual(await read(`dist/${verificationFile}`), verification, 'built Google verification is byte-for-byte unchanged');
pass('Google ownership verification is unchanged in source and build');
console.log(`${checks} generated-site checks passed.`);
