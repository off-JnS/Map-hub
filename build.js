/**
 * build.js — Static site generator for Hamburg-West trade businesses.
 *
 * Reads the lead CSV, enriches each business (website scrape + asset download,
 * Nominatim geocoding — both cached in .cache/), then generates:
 *   - /public/index.html            Leaflet map hub with Stadtteil/Gewerk filters
 *   - /public/{slug}/index.html     one bespoke, responsive demo site per business
 *
 * Usage: node build.js
 * All variant choices are deterministic (seeded by slug) so rebuilds are stable.
 */

const path = require('path');
const fs = require('fs-extra');
const csv = require('csv-parser');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CSV_FILE = path.join(
  __dirname,
  'Lead-Liste Hamburg-West (Google Maps Verifiziert) - Lead-Liste Hamburg-West (Google Maps Verifiziert).csv'
);
const CACHE_DIR = path.join(__dirname, '.cache');
const HTML_CACHE = path.join(CACHE_DIR, 'html');
const ASSET_CACHE = path.join(CACHE_DIR, 'assets');
const GEO_CACHE_FILE = path.join(CACHE_DIR, 'geocode.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LeadSiteBuilder/1.0 (contact: official.jns.on@gmail.com)';

// Lead-portal directories: never scrape these, they host competitor content.
const DOMAIN_BLOCKLIST = [
  'sanitaerfinden.com',
  'malerfinder.de',
  'elektrikerportal.com',
  'fliesenleger.io',
  'bodenlegerfinden.com',
];

const MAX_IMAGES_PER_SITE = 6;
const MIN_IMAGE_BYTES = 15 * 1024;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

// Hamburg-West bounding box for the geocode fallback.
const FALLBACK_CENTER = { lat: 53.58, lon: 9.88 };
const FALLBACK_SPREAD = 0.05;

// ---------------------------------------------------------------------------
// Trade palettes, glyphs, services
// ---------------------------------------------------------------------------

const TRADES = {
  sanitaer: {
    label: 'Sanitär & Heizung',
    primary: '#0B5E7E',
    accent: '#A8D5E2',
    deep: '#063A4F',
    textOnPrimary: '#FFFFFF',
    glyph:
      'M38 18c-5 0-9 4-9 9 0 1.2.2 2.3.7 3.3L15 45l6 6 14.7-14.7c1 .5 2.1.7 3.3.7 5 0 9-4 9-9 0-1-.2-2-.5-2.9l-6.4 6.4-4.6-4.6 6.4-6.4c-.9-.3-1.9-.5-2.9-.5z',
    services: [
      'Badsanierung',
      'Rohrreinigung',
      'Heizungsinstallation',
      'Wartung & Service',
      '24h-Notdienst',
      'Leckortung',
    ],
  },
  elektro: {
    label: 'Elektro',
    primary: '#F5A623',
    accent: '#1A1A1A',
    deep: '#1A1A1A',
    textOnPrimary: '#1A1A1A',
    glyph: 'M36 12 20 36h9l-3 16 16-24h-9l3-16z',
    services: [
      'Elektroinstallation',
      'E-Check & Prüfung',
      'Smart Home',
      'Beleuchtungstechnik',
      'Zähler- & Sicherungsanlagen',
      'Notdienst',
    ],
  },
  dach: {
    label: 'Dachdecker',
    primary: '#B65F3A',
    accent: '#E8D5B7',
    deep: '#7A3D22',
    textOnPrimary: '#FFFFFF',
    glyph: 'M32 14 10 34h6v16h32V34h6L32 14zm0 8 12 11v13H20V33l12-11z',
    services: [
      'Neueindeckung',
      'Dachreparatur',
      'Flachdachabdichtung',
      'Dachrinnen & Fallrohre',
      'Sturmschadenbeseitigung',
      'Dachfenster & Gauben',
    ],
  },
  maler: {
    label: 'Maler',
    primary: '#4A3F6B',
    accent: '#D8D0E8',
    deep: '#2E2745',
    textOnPrimary: '#FFFFFF',
    glyph:
      'M16 14h28v10H16V14zm30 2h6v14H30v6h4v14h-8V32h-2v-8h22v-4h-0z M26 36h8v14h-8V36z',
    services: [
      'Innenanstrich',
      'Fassadenanstrich',
      'Tapezierarbeiten',
      'Lackierarbeiten',
      'Spachteltechnik',
      'Schimmelsanierung',
    ],
  },
  fliesen: {
    label: 'Fliesen & Boden',
    primary: '#2E6E65',
    accent: '#CFE8E4',
    deep: '#1C4640',
    textOnPrimary: '#FFFFFF',
    glyph:
      'M14 14h16v16H14V14zm20 0h16v16H34V14zM14 34h16v16H14V34zm20 0h16v16H34V34z',
    services: [
      'Fliesenverlegung',
      'Badgestaltung',
      'Bodenbeläge',
      'Natursteinarbeiten',
      'Reparatur & Austausch',
      'Fugensanierung',
    ],
  },
  tischler: {
    label: 'Tischlerei',
    primary: '#6B4F32',
    accent: '#7D9B76',
    deep: '#46331F',
    textOnPrimary: '#FFFFFF',
    glyph:
      'M12 20h40v6H12v-6zm4 10h32v4H16v-4zm-4 8h40v6H12v-6zm8-24h24v4H20v-4z',
    services: [
      'Möbelbau nach Maß',
      'Innenausbau',
      'Türen & Fenster',
      'Einbauschränke',
      'Reparaturen',
      'Holzterrassen',
    ],
  },
  galabau: {
    label: 'Garten- & Landschaftsbau',
    primary: '#3E7C4F',
    accent: '#DCE8D0',
    deep: '#26522F',
    textOnPrimary: '#FFFFFF',
    glyph:
      'M32 12c-8 10-14 16-14 24 0 8 6 14 14 14s14-6 14-14c0-8-6-14-14-24zm-2 34c-4-1-7-4-7-9h4c0 3 1 5 3 6v3z',
    services: [
      'Gartengestaltung',
      'Baumpflege & Fällung',
      'Pflasterarbeiten',
      'Zaunbau',
      'Rasen- & Grünpflege',
      'Teich- & Wegebau',
    ],
  },
  bau: {
    label: 'Bau & Sanierung',
    primary: '#56677A',
    accent: '#C0392B',
    deep: '#37434F',
    textOnPrimary: '#FFFFFF',
    glyph:
      'M14 40h14v10H14V40zm16 0h14v10H30V40zM22 26h14v10H22V26zm16 0h12v10H38V26zM14 26h4v10h-4V26zm16-14h14v10H30V12zm-16 0h12v10H14V12z',
    services: [
      'Rohbau & Maurerarbeiten',
      'Sanierung & Umbau',
      'Putzarbeiten',
      'Trockenbau',
      'Betonarbeiten',
      'Kernbohrungen',
    ],
  },
  allgemein: {
    label: 'Handwerk',
    primary: '#1F3A5F',
    accent: '#3E8E8E',
    deep: '#12233B',
    textOnPrimary: '#FFFFFF',
    glyph:
      'M40 14l-6 6 10 10 6-6-10-10zM12 42l16-16 10 10-16 16H12V42z',
    services: [
      'Beratung vor Ort',
      'Fachgerechte Ausführung',
      'Reparatur & Wartung',
      'Kostenvoranschlag',
      'Termintreue Umsetzung',
    ],
  },
};

function tradeKeyFor(gewerk) {
  const g = gewerk.toLowerCase();
  if (/heizung|sanit|klempner/.test(g)) return 'sanitaer';
  if (/elektr/.test(g)) return 'elektro';
  if (/dachdeck/.test(g)) return 'dach';
  if (/maler|putz/.test(g)) return 'maler';
  if (/fliesen|boden/.test(g)) return 'fliesen';
  if (/tischler/.test(g)) return 'tischler';
  if (/galabau|garten/.test(g)) return 'galabau';
  if (/bau|sanierung|maurer/.test(g)) return 'bau';
  return 'allgemein';
}

// Five distinct typographic voices. Each pair declares its heading fallback
// class, the display weight for h1, and tracking tuned to the face. Body
// families load 400/600/700 so semibold and bold render true, never synthesized
// (Atkinson Hyperlegible only ships 400/700; 600 resolves to real 700).
const FONT_PAIRS = [
  {
    heading: 'Bricolage Grotesque',
    body: 'Atkinson Hyperlegible',
    gf: 'family=Bricolage+Grotesque:wght@700;800&family=Atkinson+Hyperlegible:wght@400;700',
    hFall: 'sans-serif',
    h1w: 800,
    h1track: '-0.015em',
  },
  {
    heading: 'Zilla Slab',
    body: 'Karla',
    gf: 'family=Zilla+Slab:wght@700&family=Karla:wght@400;600;700',
    hFall: 'serif',
    h1w: 700,
    h1track: '0',
  },
  {
    heading: 'Big Shoulders Display',
    body: 'Source Sans 3',
    gf: 'family=Big+Shoulders+Display:wght@700;800&family=Source+Sans+3:wght@400;600;700',
    hFall: 'sans-serif',
    h1w: 800,
    h1track: '0.005em',
  },
  {
    heading: 'Archivo',
    body: 'Cabin',
    gf: 'family=Archivo:wght@700;900&family=Cabin:wght@400;600;700',
    hFall: 'sans-serif',
    h1w: 900,
    h1track: '-0.02em',
  },
  {
    heading: 'Bitter',
    body: 'Public Sans',
    gf: 'family=Bitter:wght@700&family=Public+Sans:wght@400;600;700',
    hFall: 'serif',
    h1w: 700,
    h1track: '0',
  },
];

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseRating(raw) {
  if (!raw || /keine/i.test(raw)) return null;
  const m = raw.match(/(\d+)[,.](\d+)\s*\((\d+)\)/);
  if (!m) return null;
  return { stars: parseFloat(`${m[1]}.${m[2]}`), count: parseInt(m[3], 10) };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Minimal image dimension reader: PNG, JPEG, GIF, WebP.
function imageSize(buf) {
  try {
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    if (buf.length > 10 && buf[0] === 0x47 && buf[1] === 0x49) {
      return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    }
    if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const fmt = buf.toString('ascii', 12, 16);
      if (fmt === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
      if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (fmt === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
      }
    }
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let off = 2;
      while (off < buf.length - 8) {
        if (buf[off] !== 0xff) { off++; continue; }
        const marker = buf[off + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { w: buf.readUInt16BE(off + 7), h: buf.readUInt16BE(off + 5) };
        }
        off += 2 + buf.readUInt16BE(off + 2);
      }
    }
  } catch (e) { /* fall through */ }
  return null;
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

function readCsv() {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(CSV_FILE)
      .pipe(
        csv({
          mapHeaders: ({ header }) =>
            header.replace(/^﻿/, '').replace(/\s+/g, ' ').trim(),
        })
      )
      .on('data', (r) => rows.push(r))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function normalizeRow(row) {
  const name = (row['Betrieb / Firma'] || '').trim();
  const slug = slugify(name);
  const phoneRaw = (row['Telefon'] || '').trim();
  return {
    gewerk: (row['Gewerk'] || '').trim(),
    stadtteil: (row['Stadtteil'] || '').trim(),
    name,
    slug,
    adresse: (row['Adresse'] || '').trim(),
    telefon: /\d/.test(phoneRaw) ? phoneRaw : '',
    rating: parseRating((row['Sterne / Bew.'] || '').trim()),
    mapsLink: (row['Maps Link'] || '').trim(),
    websiteStatus: (row['Website'] || '').trim(),
    websiteLink: (row['Website Link'] || '').trim(),
    tradeKey: tradeKeyFor((row['Gewerk'] || '').trim()),
  };
}

// ---------------------------------------------------------------------------
// Enrichment: scrape + assets
// ---------------------------------------------------------------------------

function isScrapable(biz) {
  if (!biz.websiteLink) return false;
  if (/konkurenz|konkurrenz/i.test(biz.websiteStatus)) return false;
  try {
    const host = new URL(biz.websiteLink).hostname.replace(/^www\./, '');
    if (DOMAIN_BLOCKLIST.some((d) => host === d || host.endsWith('.' + d))) return false;
  } catch (e) {
    return false;
  }
  return true;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 10000) {
  return fetch(url, {
    redirect: 'follow',
    timeout: timeoutMs,
    headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
    ...opts,
  });
}

async function getSiteHtml(biz) {
  const cacheFile = path.join(HTML_CACHE, `${biz.slug}.html`);
  const missFile = path.join(HTML_CACHE, `${biz.slug}.miss`);
  if (await fs.pathExists(cacheFile)) return fs.readFile(cacheFile, 'utf8');
  if (await fs.pathExists(missFile)) return null;
  try {
    const res = await fetchWithTimeout(biz.websiteLink);
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.includes('html')) throw new Error(`status ${res.status} type ${type}`);
    const html = await res.text();
    await fs.outputFile(cacheFile, html);
    return html;
  } catch (e) {
    console.log(`  scrape miss: ${biz.slug} (${e.message})`);
    await fs.outputFile(missFile, e.message);
    return null;
  }
}

function extractAbout(html, biz) {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, noscript').remove();
  const ban = [
    /cookie/i,
    /datenschutz/i,
    /impressum/i,
    /startseite/i,
    /übersicht/i,
    /navigation/i,
    /weiter/i,
    /mehr/i,
  ];
  const paras = [];
  $('p, li').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t.length < 80 || t.length > 900) return;
    if (t.includes('|')) return;
    if (ban.some((re) => re.test(t))) return;
    const letters = (t.match(/[A-Za-zÄÖÜäöüß]/g) || []).length;
    const upper = (t.match(/[A-ZÄÖÜ]/g) || []).length;
    if (letters < 40) return;
    if (upper / Math.max(letters, 1) > 0.45) return;
    paras.push(t);
  });
  if (!paras.length) return null;
  const g = biz.gewerk.toLowerCase().split(/[^a-zäöüß]+/)[0] || '';
  paras.sort((a, b) => {
    const score = (t) =>
      (g && t.toLowerCase().includes(g) ? 2 : 0) +
      (/hamburg/i.test(t) ? 1 : 0) +
      Math.min(t.length / 400, 1) +
      (/[.!?]/.test(t) ? 0.2 : 0);
    return score(b) - score(a);
  });
  const sentences = paras[0].match(/[^.!?]+[.!?]+/g) || [paras[0]];
  let about = sentences.slice(0, 3).join(' ').trim();
  if (about.length > 480) about = about.slice(0, 477).trimEnd() + '…';
  if (about.length < 120 || /(^|[.!?]\s)(\w{1,3}\b)/.test(about) || about.includes('|')) return null;
  return about;
}

function extractMediaUrls(html, baseUrl) {
  const $ = cheerio.load(html);
  const imgs = new Set();
  const videos = new Set();
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (!src || src.startsWith('data:')) return;
    try { imgs.add(new URL(src, baseUrl).href); } catch (e) { /* skip */ }
  });
  $('video[src], video source[src]').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (!src) return;
    try { videos.add(new URL(src, baseUrl).href); } catch (e) { /* skip */ }
  });
  return { imgs: [...imgs], videos: [...videos] };
}

async function downloadAssets(biz, media) {
  const dir = path.join(ASSET_CACHE, biz.slug);
  const manifestFile = path.join(dir, 'manifest.json');
  if (await fs.pathExists(manifestFile)) return fs.readJson(manifestFile);

  await fs.ensureDir(dir);
  const manifest = { images: [], videos: [] };

  for (const url of media.imgs) {
    if (manifest.images.length >= MAX_IMAGES_PER_SITE) break;
    try {
      const res = await fetchWithTimeout(url, {}, 15000);
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !type.startsWith('image/') || type.includes('svg')) continue;
      const buf = await res.buffer();
      if (buf.length < MIN_IMAGE_BYTES) continue;
      const dim = imageSize(buf);
      if (!dim || dim.w < 400 || dim.h < 250) continue;
      const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('gif') ? 'gif' : 'jpg';
      const file = `img-${manifest.images.length + 1}.${ext}`;
      await fs.writeFile(path.join(dir, file), buf);
      manifest.images.push({ file, w: dim.w, h: dim.h, bytes: buf.length });
    } catch (e) { /* skip broken asset */ }
  }

  for (const url of media.videos.slice(0, 1)) {
    try {
      const res = await fetchWithTimeout(url, {}, 20000);
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !type.startsWith('video/')) continue;
      const buf = await res.buffer();
      if (buf.length > MAX_VIDEO_BYTES) continue;
      const ext = type.includes('webm') ? 'webm' : 'mp4';
      const file = `video-1.${ext}`;
      await fs.writeFile(path.join(dir, file), buf);
      manifest.videos.push({ file, bytes: buf.length });
    } catch (e) { /* skip */ }
  }

  await fs.writeJson(manifestFile, manifest);
  return manifest;
}

const FALLBACK_ABOUT = [
  (b) =>
    `${b.name} ist Ihr Fachbetrieb für ${b.gewerk} in Hamburg-${b.stadtteil}. Wir stehen für saubere, termingerechte Arbeit und faire Preise. Ob kleine Reparatur oder großes Projekt – wir beraten Sie persönlich und finden die passende Lösung.`,
  (b) =>
    `Als ${b.gewerk}-Betrieb aus ${b.stadtteil} sind wir seit Jahren für Kundinnen und Kunden in Hamburg-West im Einsatz. Qualität, Zuverlässigkeit und ehrliche Beratung stehen bei ${b.name} an erster Stelle. Überzeugen Sie sich selbst – wir freuen uns auf Ihre Anfrage.`,
  (b) =>
    `Handwerk mit Herz aus ${b.stadtteil}: ${b.name} übernimmt Arbeiten rund um ${b.gewerk} – schnell, sorgfältig und zum fairen Preis. Von der ersten Beratung bis zur Abnahme haben Sie bei uns immer einen festen Ansprechpartner.`,
];

async function enrich(biz) {
  const trade = TRADES[biz.tradeKey];
  const rng = mulberry32(hashString(biz.slug + ':about'));
  let about = null;
  let manifest = { images: [], videos: [] };

  if (isScrapable(biz)) {
    const html = await getSiteHtml(biz);
    if (html) {
      about = extractAbout(html, biz);
      const media = extractMediaUrls(html, biz.websiteLink);
      manifest = await downloadAssets(biz, media);
    }
  }

  if (!about) about = pick(rng, FALLBACK_ABOUT)(biz);
  return { ...biz, about, assets: manifest, trade };
}

// ---------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------

async function geocodeAll(businesses) {
  await fs.ensureDir(CACHE_DIR);
  const cache = (await fs.pathExists(GEO_CACHE_FILE)) ? await fs.readJson(GEO_CACHE_FILE) : {};
  for (const biz of businesses) {
    const key = biz.adresse;
    if (cache[key] !== undefined) continue;
    const q = encodeURIComponent(`${biz.adresse}, Hamburg, Germany`);
    try {
      const res = await fetchWithTimeout(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&q=${q}`,
        {},
        15000
      );
      const data = res.ok ? await res.json() : [];
      cache[key] = data.length ? { lat: +data[0].lat, lon: +data[0].lon } : null;
      console.log(`  geocode ${cache[key] ? 'ok  ' : 'MISS'}: ${biz.adresse}`);
    } catch (e) {
      console.log(`  geocode ERR : ${biz.adresse} (${e.message})`);
      cache[key] = null;
    }
    await fs.writeJson(GEO_CACHE_FILE, cache, { spaces: 0 });
    await sleep(1100); // Nominatim rate-limit policy: max 1 req/s
  }

  for (const biz of businesses) {
    const hit = cache[biz.adresse];
    if (hit) {
      biz.lat = hit.lat;
      biz.lon = hit.lon;
      biz.geoApprox = false;
    } else {
      const rng = mulberry32(hashString(biz.slug + ':geo'));
      biz.lat = FALLBACK_CENTER.lat + (rng() * 2 - 1) * FALLBACK_SPREAD;
      biz.lon = FALLBACK_CENTER.lon + (rng() * 2 - 1) * FALLBACK_SPREAD;
      biz.geoApprox = true;
    }
  }
}

// ---------------------------------------------------------------------------
// SVG placeholder hero
// ---------------------------------------------------------------------------

function placeholderSvg(trade) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 700" width="1200" height="700" role="img" aria-label="${escapeHtml(trade.label)}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${trade.primary}"/>
      <stop offset="1" stop-color="${trade.deep}"/>
    </linearGradient>
    <pattern id="p" width="64" height="64" patternUnits="userSpaceOnUse">
      <path d="M0 64 64 0" stroke="rgba(255,255,255,0.06)" stroke-width="2"/>
    </pattern>
  </defs>
  <rect width="1200" height="700" fill="url(#g)"/>
  <rect width="1200" height="700" fill="url(#p)"/>
  <g transform="translate(510,260) scale(2.8)" fill="rgba(255,255,255,0.55)">
    <path d="${trade.glyph}"/>
  </g>
</svg>`;
}

// ---------------------------------------------------------------------------
// Sub-site generation
// ---------------------------------------------------------------------------

function chooseVariants(biz) {
  const rng = mulberry32(hashString(biz.slug));
  const richness = (biz.assets.images.length ? 1 : 0) + (biz.assets.videos.length ? 1 : 0) + (biz.rating && biz.rating.count >= 10 ? 1 : 0);
  const tier = richness >= 2 ? 2 : richness === 1 ? 1 : 0;
  return {
    hero: Math.floor(rng() * 4) + 1,
    nav: Math.floor(rng() * 3) + 1,
    servicesLayout: Math.floor(rng() * 4) + 1,
    fonts: FONT_PAIRS[Math.floor(rng() * FONT_PAIRS.length)],
    serviceItems: shuffle(rng, biz.trade.services).slice(0, 4 + Math.floor(rng() * 3)).slice(0, biz.trade.services.length),
    tier,
  };
}

const SITE_TIERS = [
  {
    label: 'Basic',
    note: 'Demo · 2 Revisionsrunden inkl.',
    badgeClass: 'tier-badge--basic',
    loader: false,
  },
  {
    label: 'Professional',
    note: 'Demo · Priority Support & Launch',
    badgeClass: 'tier-badge--professional',
    loader: true,
  },
  {
    label: 'Premium',
    note: 'Demo · Priority Support & Launch',
    badgeClass: 'tier-badge--premium',
    loader: true,
  },
];

function businessSchemaHtml(biz) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: biz.name,
    description: `${biz.name}: ${biz.trade.label} in Hamburg-${biz.stadtteil}.`,
    telephone: biz.telefon || undefined,
    address: {
      '@type': 'PostalAddress',
      streetAddress: biz.adresse,
      addressLocality: 'Hamburg',
      addressRegion: biz.stadtteil,
      addressCountry: 'DE',
    },
    areaServed: `Hamburg-${biz.stadtteil}`,
  };
  if (biz.rating) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Number(biz.rating.stars.toFixed(1)),
      ratingCount: biz.rating.count,
    };
  }
  return `<script type="application/ld+json">${JSON.stringify(schema, null, 2)}</script>`;
}

function factCard(value, label) {
  return `<div class="dataplate__cell"><span class="dataplate__num">${value}</span><span class="dataplate__label mono">${label}</span></div>`;
}

function quickFactsHtml(biz, variants) {
  const tier = SITE_TIERS[variants.tier];
  const ratingValue = biz.rating ? `${String(biz.rating.stars.toFixed(1)).replace('.', ',')} / 5` : 'keine Angabe';
  const ratingLabel = biz.rating ? `${biz.rating.count} Google-Bewertungen` : 'Google-Bewertungen';
  const mediaCount = biz.assets.images.length + biz.assets.videos.length;
  const facts = [
    factCard(ratingValue, ratingLabel),
    factCard(String(variants.serviceItems.length), 'Leistungen im Fokus'),
    factCard(String(mediaCount), 'Medien aus der Altseite'),
    factCard(escapeHtml(`Hamburg-${biz.stadtteil}`), 'Stadtteil'),
  ].join('');

  return `<section class="section section--flush">
   <div class="container">
     <div class="dataplate dataplate--site">
       <span class="dataplate__rivet dataplate__rivet--tl" aria-hidden="true"></span>
       <span class="dataplate__rivet dataplate__rivet--tr" aria-hidden="true"></span>
       <span class="dataplate__rivet dataplate__rivet--bl" aria-hidden="true"></span>
       <span class="dataplate__rivet dataplate__rivet--br" aria-hidden="true"></span>
       <p class="dataplate__title mono">Schnellüberblick · ${escapeHtml(tier.label)}-Demo</p>
       <div class="dataplate__grid">${facts}</div>
     </div>
   </div>
 </section>`;
}

function starsSvg(stars) {
  const pct = Math.max(0, Math.min(100, (stars / 5) * 100));
  const starPath =
    'M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17l-6.2 3.9 1.6-7L2 9.2l7.1-.6L12 2z';
  const row = (fill) =>
    [0, 1, 2, 3, 4]
      .map((i) => `<path d="${starPath}" transform="translate(${i * 26},0)" fill="${fill}"/>`)
      .join('');
  return `<span class="stars" role="img" aria-label="${String(stars).replace('.', ',')} von 5 Sternen">
  <svg width="130" height="24" viewBox="0 0 130 24" aria-hidden="true">${row('#D5D5D5')}</svg>
  <svg class="stars-fill" style="clip-path: inset(0 ${100 - pct}% 0 0)" width="130" height="24" viewBox="0 0 130 24" aria-hidden="true">${row('#F0B400')}</svg>
</span>`;
}

function faviconHref(trade) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${trade.primary}"/><path d="${trade.glyph}" fill="${trade.textOnPrimary}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function heroImageTag(biz, cls) {
  const img = biz.heroImage;
  return `<img class="${cls}" src="${img.src}" alt="${escapeHtml(biz.name)} – ${escapeHtml(biz.trade.label)}" width="${img.w}" height="${img.h}" loading="eager" fetchpriority="high" decoding="async">`;
}

function navHtml(biz, v) {
  const links = [
    ['#leistungen', 'Leistungen'],
    ['#ueber-uns', 'Über uns'],
    ['#kontakt', 'Kontakt'],
  ];
  const linkList = links.map(([h, t]) => `<li><a href="${h}">${t}</a></li>`).join('');
  const burger = `<button class="nav-toggle" aria-label="Menü öffnen" aria-expanded="false" aria-controls="site-menu"><span></span><span></span><span></span></button>`;
  if (v === 1) {
    return `<header class="nav nav-sticky"><div class="nav-inner"><a class="brand" href="#top">${escapeHtml(biz.name)}</a>${burger}</div><nav><ul id="site-menu" class="menu">${linkList}</ul></nav></header>`;
  }
  if (v === 2) {
    return `<header class="nav nav-inline"><div class="nav-inner"><a class="brand" href="#top">${escapeHtml(biz.name)}</a><nav><ul id="site-menu" class="menu menu-inline">${linkList}</ul></nav>${burger}</div></header>`;
  }
  return `<header class="nav nav-drawer"><div class="nav-inner"><a class="brand" href="#top">${escapeHtml(biz.name)}</a>${burger}</div><nav><ul id="site-menu" class="menu drawer">${linkList}</ul></nav></header>`;
}

function heroHtml(biz, v) {
  const tagline = `${escapeHtml(biz.gewerk)} – Ihr zuverlässiger Partner in ${escapeHtml(biz.stadtteil)}`;
  const meta = [
    `${escapeHtml(biz.trade.label)}`,
    biz.rating ? `${String(biz.rating.stars.toFixed(1)).replace('.', ',')} ★` : 'Google-Bewertung offen',
    `${biz.assets.images.length} Bilder`,
  ].map((item) => `<span>${item}</span>`).join('');
  const inner = `<h1>${escapeHtml(biz.name)}</h1>
      <p class="hero-kicker mono">${escapeHtml(biz.stadtteil)} · ${escapeHtml(biz.trade.label)}</p>
      <p class="hero-tagline">${tagline}</p>
      <div class="hero-cta">
        ${biz.telefon ? `<a class="btn btn-primary" href="tel:${biz.telefon.replace(/\s+/g, '')}">Jetzt anrufen</a>` : ''}
        <a class="btn btn-ghost" href="#kontakt">Anfrage senden</a>
      </div>`;
  const metaHtml = `<div class="hero__meta mono">${meta}</div>`;
  if (v === 1) {
    return `<section class="hero hero-fullbleed" id="top">${heroImageTag(biz, 'hero-img')}<div class="hero-overlay"><div class="hero-content">${inner}${metaHtml}</div></div></section>`;
  }
  if (v === 2) {
    return `<section class="hero hero-split" id="top"><div class="hero-media">${heroImageTag(biz, 'hero-img')}</div><div class="hero-content">${inner}${metaHtml}</div></section>`;
  }
  if (v === 3) {
    return `<section class="hero hero-diagonal" id="top"><div class="hero-media">${heroImageTag(biz, 'hero-img')}</div><div class="hero-content">${inner}${metaHtml}</div></section>`;
  }
  return `<section class="hero hero-bar" id="top"><div class="hero-content">${inner}${metaHtml}</div><a class="btn btn-float" href="#kontakt" aria-label="Zum Kontaktformular springen">Kontakt<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-left:6px"><path d="M12 4v16m0 0-6-6m6 6 6-6"/></svg></a></section>`;
}

const SERVICE_ICON =
  '<svg class="svc-icon" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.15"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function servicesHtml(biz, v, items) {
  const title = '<h2>Unsere Leistungen</h2>';
  if (v === 1) {
    const cells = items
      .map((s) => `<div class="svc-cell">${SERVICE_ICON}<span>${escapeHtml(s)}</span></div>`)
      .join('');
    return `<section class="section services" id="leistungen"><div class="wrap">${title}<div class="svc-grid">${cells}</div></div></section>`;
  }
  if (v === 2) {
    const rows = items
      .map(
        (s, i) =>
          `<div class="acc-item"><button class="acc-btn" aria-expanded="false" aria-controls="acc-${i}">${escapeHtml(s)}<span class="acc-mark" aria-hidden="true">+</span></button><div class="acc-panel" id="acc-${i}" hidden><p>${escapeHtml(s)} – fachgerecht ausgeführt von ${escapeHtml(biz.name)}. Sprechen Sie uns an für ein unverbindliches Angebot.</p></div></div>`
      )
      .join('');
    return `<section class="section services" id="leistungen"><div class="wrap">${title}<div class="accordion">${rows}</div></div></section>`;
  }
  if (v === 3) {
    const cards = items
      .map((s) => `<article class="svc-card">${SERVICE_ICON}<h3>${escapeHtml(s)}</h3></article>`)
      .join('');
    return `<section class="section services" id="leistungen"><div class="wrap">${title}<div class="svc-scroller" tabindex="0" aria-label="Leistungen – horizontal scrollbar">${cards}</div></div></section>`;
  }
  const checks = items
    .map((s) => `<li>${SERVICE_ICON}<span>${escapeHtml(s)}</span></li>`)
    .join('');
  return `<section class="section services" id="leistungen"><div class="wrap">${title}<ul class="svc-checklist">${checks}</ul></div></section>`;
}

function galleryHtml(biz, heroUsesImage) {
  const start = heroUsesImage ? 1 : 0;
  const extras = biz.assets.images.slice(start, start + 3);
  const videos = biz.assets.videos;
  if (!extras.length && !videos.length) return '';
  const figs = extras
    .map(
      (img) =>
        `<img src="assets/${img.file}" alt="Einblick in die Arbeit von ${escapeHtml(biz.name)}" width="${img.w}" height="${img.h}" loading="lazy" decoding="async">`
    )
    .join('');
  const vids = videos
    .map(
      (v) =>
        `<video class="gallery-video" controls preload="metadata" aria-label="Video von ${escapeHtml(biz.name)}"><source src="assets/${v.file}"></video>`
    )
    .join('');
  return `<section class="section gallery" aria-label="Galerie"><div class="wrap gallery-grid">${figs}${vids}</div></section>`;
}

function aboutHtml(biz) {
  return `<section class="section about" id="ueber-uns"><div class="wrap"><h2>Über uns</h2><p>${escapeHtml(biz.about)}</p></div></section>`;
}

function ratingHtml(biz) {
  if (!biz.rating) return '';
  const label = `${String(biz.rating.stars.toFixed(1)).replace('.', ',')} von 5`;
  return `<section class="section rating" id="bewertungen"><div class="wrap"><h2>Das sagen unsere Kunden</h2><div class="rating-row">${starsSvg(biz.rating.stars)}<p class="rating-text"><strong>${label}</strong> · ${biz.rating.count} ${biz.rating.count === 1 ? 'Bewertung' : 'Bewertungen'} auf Google</p></div><a class="btn btn-outline" href="${escapeHtml(biz.mapsLink)}" target="_blank" rel="noopener">Auf Google Maps ansehen</a></div></section>`;
}

function contactHtml(biz) {
  const email = `info@${biz.slug}.de`;
  return `<section class="section contact" id="kontakt"><div class="wrap">
  <h2>Kontakt</h2>
  <div class="contact-grid">
    <div class="contact-info">
      <p class="contact-addr">${escapeHtml(biz.adresse)}, Hamburg-${escapeHtml(biz.stadtteil)}</p>
      ${biz.telefon ? `<a class="contact-line" href="tel:${biz.telefon.replace(/\s+/g, '')}" aria-label="Anrufen: ${escapeHtml(biz.telefon)}"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.2.4 2.4.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/></svg>${escapeHtml(biz.telefon)}</a>` : ''}
      <a class="contact-line" href="mailto:${email}"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>${email}</a>
      <a class="btn btn-primary btn-maps" href="${escapeHtml(biz.mapsLink)}" target="_blank" rel="noopener"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" style="vertical-align:-3px;margin-right:6px"><path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>Route auf Google Maps</a>
    </div>
    <form class="contact-form" aria-label="Kontaktformular">
      <label for="cf-name">Name</label>
      <input id="cf-name" name="name" type="text" required autocomplete="name">
      <label for="cf-email">E-Mail</label>
      <input id="cf-email" name="email" type="email" required autocomplete="email">
      <label for="cf-msg">Nachricht</label>
      <textarea id="cf-msg" name="message" rows="4" required></textarea>
      <button class="btn btn-primary" type="submit">Nachricht senden</button>
    </form>
  </div>
</div></section>`;
}

function footerHtml(biz) {
  return `<footer class="footer"><div class="wrap"><p>© ${new Date().getFullYear()} ${escapeHtml(biz.name)} · Hamburg-${escapeHtml(biz.stadtteil)}</p><p class="footer-note">Demo-Webseite – unverbindliche Vorschau.</p></div></footer>`;
}

function subSiteHtml(biz, variants) {
  const t = biz.trade;
  const tier = SITE_TIERS[variants.tier];
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(biz.name)} – ${escapeHtml(t.label)} in Hamburg-${escapeHtml(biz.stadtteil)}</title>
<meta name="description" content="${escapeHtml(biz.name)}: ${escapeHtml(t.label)} in Hamburg-${escapeHtml(biz.stadtteil)}. Jetzt Kontakt aufnehmen.">
<meta name="robots" content="noindex">
<meta name="theme-color" content="${t.primary}">
${businessSchemaHtml(biz)}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(biz.name)}">
<meta property="og:title" content="${escapeHtml(biz.name)} – ${escapeHtml(t.label)} in Hamburg-${escapeHtml(biz.stadtteil)}">
<meta property="og:description" content="${escapeHtml(biz.name)}: ${escapeHtml(t.label)} in Hamburg-${escapeHtml(biz.stadtteil)}.">
<meta property="og:locale" content="de_DE">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${faviconHref(t)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${variants.fonts.gf}&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
</head>
<body>
${tier.loader ? `<div class="page-loader" aria-hidden="true"><p class="page-loader__word">${escapeHtml(biz.name)}</p></div>` : ''}
<div class="tier-badge ${tier.badgeClass}" role="note" aria-label="Demo-Website, Paket: ${tier.label}">
  <span class="tier-badge__tier">${tier.label}</span>
  <span class="tier-badge__note">${tier.note}</span>
</div>
<a class="skip-link" href="#main">Zum Inhalt springen</a>
${navHtml(biz, variants.nav)}
<main id="main">
${heroHtml(biz, variants.hero)}
${quickFactsHtml(biz, variants)}
${servicesHtml(biz, variants.servicesLayout, variants.serviceItems)}
${aboutHtml(biz)}
${galleryHtml(biz, variants.hero !== 4)}
${ratingHtml(biz)}
${contactHtml(biz)}
</main>
${footerHtml(biz)}
<script src="script.js" defer></script>
</body>
</html>`;
}

function subSiteCss(biz, variants) {
  const t = biz.trade;
  const f = variants.fonts;
  return `/* Generated for ${biz.name} — variants: hero ${variants.hero}, nav ${variants.nav}, services ${variants.servicesLayout} */
:root {
  --c-primary: ${t.primary};
  --c-accent: ${t.accent};
  --c-deep: ${t.deep};
  --c-on-primary: ${t.textOnPrimary};
  --c-text: #22262a;
  --c-bg: #ffffff;
  --c-bg-soft: color-mix(in srgb, ${t.accent} 22%, white);
  --font-heading: '${f.heading}', ${f.hFall};
  --font-body: '${f.body}', system-ui, sans-serif;
  --wrap: min(100vw - 2rem, 1200px);
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
body { font-family: var(--font-body); color: var(--c-text); background: var(--c-bg); line-height: 1.6; }
::selection { background: var(--c-primary); color: var(--c-on-primary); }
:focus-visible { outline: 3px solid var(--c-primary); outline-offset: 2px; }
.skip-link { position: absolute; left: -9999px; top: 0; z-index: 100; background: var(--c-deep); color: #fff; padding: 0.7em 1.2em; border-radius: 0 0 8px 0; font-weight: 700; text-decoration: none; }
.skip-link:focus-visible { left: 0; }
h1, h2, h3 { font-family: var(--font-heading); line-height: 1.15; color: var(--c-deep); }
h1 { font-size: clamp(1.9rem, 5.5vw, 3.4rem); font-weight: ${f.h1w}; letter-spacing: ${f.h1track}; }
h2 { font-size: clamp(1.4rem, 3.5vw, 2.2rem); margin-bottom: clamp(1rem, 3vw, 1.8rem); }
img { max-width: 100%; height: auto; display: block; }
.wrap { width: var(--wrap); margin-inline: auto; }
.section { padding: clamp(2.5rem, 7vw, 5rem) 0; }
.btn { display: inline-block; padding: 0.8em 1.6em; border-radius: 6px; font-weight: 700; text-decoration: none; border: none; cursor: pointer; font-size: 1rem; font-family: var(--font-body); transition: transform 0.15s, box-shadow 0.15s; }
.btn:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,0.18); }
.btn-primary { background: var(--c-primary); color: var(--c-on-primary); }
.btn-ghost { background: rgba(255,255,255,0.14); color: #fff; border: 2px solid rgba(255,255,255,0.7); }
.btn-outline { background: transparent; color: var(--c-deep); border: 2px solid var(--c-primary); }
.section--flush { padding-top: 0; }
.page-loader { position: fixed; inset: 0; z-index: 120; display: grid; place-items: center; background: linear-gradient(135deg, color-mix(in srgb, var(--c-deep) 92%, black), var(--c-primary)); color: #fff; animation: loader-fade 1.4s ease 1s forwards; pointer-events: none; }
.page-loader__word { font-family: var(--font-heading); font-size: clamp(1.4rem, 4vw, 2.2rem); letter-spacing: 0.12em; text-transform: uppercase; }
@keyframes loader-fade { to { opacity: 0; visibility: hidden; } }
.tier-badge { position: fixed; top: 1rem; right: 1rem; z-index: 110; display: inline-flex; flex-direction: column; gap: 0.1rem; padding: 0.7rem 0.9rem; border-radius: 999px; background: rgba(255,255,255,0.92); color: var(--c-deep); box-shadow: 0 12px 30px rgba(0,0,0,0.14); backdrop-filter: blur(14px); min-width: 132px; text-align: left; }
.tier-badge__tier { font-family: var(--font-heading); font-size: 0.95rem; font-weight: 800; line-height: 1; }
.tier-badge__note { font-size: 0.72rem; line-height: 1.25; opacity: 0.78; }
.tier-badge--basic { border: 1px solid color-mix(in srgb, var(--c-primary) 20%, white); }
.tier-badge--professional { border: 1px solid color-mix(in srgb, var(--c-primary) 35%, white); }
.tier-badge--premium { border: 1px solid color-mix(in srgb, var(--c-primary) 50%, white); }
.dataplate { position: relative; padding: clamp(1.2rem, 3vw, 1.8rem); border: 1px solid rgba(0,0,0,0.08); border-radius: 16px; background: linear-gradient(180deg, rgba(255,255,255,0.9), #fff); box-shadow: 0 20px 50px rgba(0,0,0,0.08); overflow: hidden; }
.dataplate--site { margin-top: -2rem; }
.dataplate__title { font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.72; margin-bottom: 1rem; }
.dataplate__grid { display: grid; gap: 0.8rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.dataplate__cell { background: var(--c-bg-soft); border-radius: 12px; padding: 0.95rem 1rem; min-height: 92px; display: flex; flex-direction: column; justify-content: space-between; gap: 0.35rem; }
.dataplate__num { font-family: var(--font-heading); font-size: clamp(1.2rem, 3vw, 1.7rem); font-weight: 800; color: var(--c-deep); line-height: 1; }
.dataplate__label { font-size: 0.78rem; opacity: 0.72; letter-spacing: 0.04em; text-transform: uppercase; }
.hero-kicker { display: inline-flex; align-items: center; gap: 0.45rem; margin-bottom: 0.7rem; font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.8; }
.hero__meta { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1.2rem; }
.hero__meta span { display: inline-flex; align-items: center; border-radius: 999px; padding: 0.5rem 0.8rem; background: rgba(255,255,255,0.16); border: 1px solid rgba(255,255,255,0.18); backdrop-filter: blur(10px); font-size: 0.8rem; }
.nav { background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,0.08); position: sticky; top: 0; z-index: 50; }
.nav-inner { width: var(--wrap); margin-inline: auto; display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-height: 60px; }
.brand { font-family: var(--font-heading); font-weight: 700; color: var(--c-deep); text-decoration: none; font-size: clamp(1rem, 2.5vw, 1.25rem); padding-block: 0.5rem; }
.nav-toggle { background: none; border: none; cursor: pointer; width: 44px; height: 44px; display: grid; place-content: center; gap: 5px; }
.nav-toggle span { display: block; width: 24px; height: 3px; background: var(--c-deep); border-radius: 2px; transition: transform 0.2s, opacity 0.2s; }
.nav-toggle[aria-expanded="true"] span:nth-child(1) { transform: translateY(8px) rotate(45deg); }
.nav-toggle[aria-expanded="true"] span:nth-child(2) { opacity: 0; }
.nav-toggle[aria-expanded="true"] span:nth-child(3) { transform: translateY(-8px) rotate(-45deg); }
.menu { list-style: none; display: none; flex-direction: column; background: #fff; padding: 0.5rem 0 1rem; }
.menu.open { display: flex; }
.menu a { display: block; padding: 0.75rem 1.25rem; color: var(--c-text); text-decoration: none; font-weight: 600; }
.menu a:hover { color: var(--c-primary); }
${variants.nav === 2 ? `@media (min-width: 768px) {
  .nav-inline .nav-toggle { display: none; }
  .nav-inline .menu-inline { display: flex !important; flex-direction: row; padding: 0; background: none; }
}` : ''}
${variants.nav === 3 ? `.nav-drawer .drawer { position: fixed; inset: 0 30% 0 0; max-width: 320px; background: #fff; box-shadow: 4px 0 24px rgba(0,0,0,0.2); padding-top: 4rem; transform: translateX(-105%); transition: transform 0.25s ease; display: flex; z-index: 40; }
.nav-drawer .drawer.open { transform: translateX(0); }` : ''}
.hero { position: relative; color: #fff; }
.hero h1 { color: inherit; margin-bottom: 0.6rem; }
.hero-tagline { font-size: clamp(1.05rem, 2.6vw, 1.4rem); margin-bottom: 1.5rem; opacity: 0.95; }
.hero-cta { display: flex; flex-wrap: wrap; gap: 0.8rem; }
.hero-img { width: 100%; height: 100%; object-fit: cover; }
${{
    1: `.hero-fullbleed { min-height: min(88vh, 720px); display: grid; }
.hero-fullbleed .hero-img { position: absolute; inset: 0; z-index: 0; }
.hero-overlay { position: relative; z-index: 1; display: grid; place-items: center; text-align: center; background: linear-gradient(rgba(10,14,18,0.55), rgba(10,14,18,0.55)); padding: clamp(3rem, 10vw, 6rem) 1rem; }
.hero-overlay .hero-cta { justify-content: center; }`,
    2: `.hero-split { display: grid; background: var(--c-deep); }
.hero-split .hero-media { min-height: 260px; }
.hero-split .hero-content { padding: clamp(2rem, 6vw, 4.5rem); align-self: center; }
@media (min-width: 820px) { .hero-split { grid-template-columns: 1fr 1fr; min-height: min(78vh, 640px); } .hero-split .hero-media { order: 0; } }`,
    3: `.hero-diagonal { background: var(--c-deep); overflow: hidden; }
.hero-diagonal .hero-media { clip-path: polygon(0 0, 100% 0, 100% 78%, 0 100%); max-height: 480px; }
.hero-diagonal .hero-content { padding: clamp(2rem, 6vw, 4rem) 1rem clamp(3rem, 8vw, 5rem); width: var(--wrap); margin-inline: auto; }
@media (min-width: 900px) { .hero-diagonal { display: grid; grid-template-columns: 1.1fr 1fr; } .hero-diagonal .hero-media { clip-path: polygon(0 0, 100% 0, 78% 100%, 0 100%); max-height: none; } .hero-diagonal .hero-content { align-self: center; } }`,
    4: `.hero-bar { background: linear-gradient(135deg, var(--c-deep), color-mix(in srgb, var(--c-primary) 45%, var(--c-deep))); padding: clamp(3.5rem, 10vw, 6.5rem) 1rem; }
.hero-bar .hero-content { width: var(--wrap); margin-inline: auto; }
.btn-float { position: fixed; right: 1rem; bottom: 1rem; z-index: 60; background: var(--c-primary); color: var(--c-on-primary); box-shadow: 0 8px 24px rgba(0,0,0,0.3); border-radius: 999px; }`,
  }[variants.hero]}
.services { background: var(--c-bg-soft); }
.svc-icon { color: var(--c-primary); flex-shrink: 0; }
${{
    1: `.svc-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: clamp(0.8rem, 2.5vw, 1.5rem); }
.svc-cell { display: flex; align-items: center; gap: 0.8rem; background: #fff; border-radius: 10px; padding: clamp(0.9rem, 2.5vw, 1.4rem); font-weight: 600; box-shadow: 0 2px 10px rgba(0,0,0,0.06); }`,
    2: `.accordion { display: grid; gap: 0.6rem; }
.acc-btn { width: 100%; display: flex; justify-content: space-between; align-items: center; background: #fff; border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; padding: 1rem 1.2rem; font: 600 1rem var(--font-body); cursor: pointer; text-align: left; }
.acc-btn[aria-expanded="true"] { background: var(--c-primary); color: var(--c-on-primary); }
.acc-btn[aria-expanded="true"] .acc-mark { transform: rotate(45deg); }
.acc-mark { font-size: 1.3rem; transition: transform 0.2s; }
.acc-panel { padding: 0.9rem 1.2rem; background: #fff; border-radius: 0 0 8px 8px; }`,
    3: `.svc-scroller { display: flex; gap: 1rem; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 0.8rem; }
.svc-card { scroll-snap-align: start; flex: 0 0 min(72vw, 240px); background: #fff; border-radius: 12px; padding: 1.4rem; box-shadow: 0 2px 10px rgba(0,0,0,0.06); }
.svc-card h3 { font-size: 1.05rem; margin-top: 0.7rem; }`,
    4: `.svc-checklist { list-style: none; display: grid; gap: 0.7rem; max-width: 640px; }
.svc-checklist li { display: flex; align-items: center; gap: 0.8rem; font-weight: 600; font-size: clamp(1rem, 2.4vw, 1.15rem); background: #fff; padding: 0.8rem 1.1rem; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.06); }`,
  }[variants.servicesLayout]}
.about p { max-width: 68ch; font-size: clamp(1rem, 2.4vw, 1.12rem); }
.gallery { padding-top: 0; }
.gallery-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); }
.gallery-grid img { border-radius: 10px; width: 100%; height: 220px; object-fit: cover; }
.gallery-video { border-radius: 10px; width: 100%; background: var(--c-deep); aspect-ratio: 16 / 9; }
.rating { background: var(--c-bg-soft); text-align: center; }
.rating-row { display: flex; flex-direction: column; align-items: center; gap: 0.6rem; margin-bottom: 1.4rem; }
.stars { position: relative; display: inline-block; width: 130px; height: 24px; }
.stars svg { position: absolute; inset: 0; }
.contact-grid { display: grid; gap: clamp(1.5rem, 4vw, 3rem); }
@media (min-width: 820px) { .contact-grid { grid-template-columns: 1fr 1.2fr; } }
.contact-info { display: flex; flex-direction: column; gap: 0.9rem; align-items: flex-start; }
.contact-addr { font-weight: 600; }
.contact-line { display: inline-flex; align-items: center; gap: 0.6rem; color: var(--c-deep); font-weight: 600; text-decoration: none; }
.contact-line:hover { color: var(--c-primary); }
.btn-maps { margin-top: 0.5rem; }
.contact-form { display: grid; gap: 0.45rem; background: var(--c-bg-soft); padding: clamp(1.2rem, 3.5vw, 2rem); border-radius: 12px; }
.contact-form label { font-weight: 600; font-size: 0.95rem; }
.contact-form input, .contact-form textarea { font: 1rem var(--font-body); padding: 0.7em 0.9em; border: 1px solid rgba(0,0,0,0.25); border-radius: 6px; background: #fff; margin-bottom: 0.6rem; }
.contact-form input:focus-visible, .contact-form textarea:focus-visible { outline: 3px solid var(--c-primary); outline-offset: 1px; }
.footer { background: var(--c-deep); color: #fff; padding: 1.6rem 0; text-align: center; font-size: 0.92rem; }
.footer a { color: inherit; }
.footer-note { opacity: 0.75; margin-top: 0.3rem; }
`;
}

function subSiteJs() {
  return `// Nav toggle, accordion, demo contact form.
(function () {
  var toggle = document.querySelector('.nav-toggle');
  var menu = document.getElementById('site-menu');
  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      var open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
    });
    menu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        menu.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('click', function (e) {
      if (menu.classList.contains('open') && !menu.contains(e.target) && !toggle.contains(e.target)) {
        menu.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('open')) {
        menu.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });
  }

  document.querySelectorAll('.acc-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var panel = document.getElementById(btn.getAttribute('aria-controls'));
      var expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      if (panel) panel.hidden = expanded;
    });
  });

  // Native HTML5 validation blocks invalid submits; this only fires when valid.
  var form = document.querySelector('.contact-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      alert('Nachricht gesendet – Demo');
      form.reset();
    });
  }
})();
`;
}

async function generateSubSite(biz) {
  const outDir = path.join(PUBLIC_DIR, biz.slug);
  const assetsDir = path.join(outDir, 'assets');
  await fs.ensureDir(assetsDir);

  // Copy downloaded assets; pick the largest image as hero, else write SVG placeholder.
  const cacheDir = path.join(ASSET_CACHE, biz.slug);
  for (const img of biz.assets.images) {
    await fs.copy(path.join(cacheDir, img.file), path.join(assetsDir, img.file));
  }
  for (const vid of biz.assets.videos) {
    await fs.copy(path.join(cacheDir, vid.file), path.join(assetsDir, vid.file));
  }

  if (biz.assets.images.length) {
    // Largest image first: it becomes the hero, the rest feed the gallery.
    biz.assets.images.sort((a, b) => b.w * b.h - a.w * a.h);
    const hero = biz.assets.images[0];
    biz.heroImage = { src: `assets/${hero.file}`, w: hero.w, h: hero.h };
  } else {
    await fs.writeFile(path.join(assetsDir, 'hero.svg'), placeholderSvg(biz.trade));
    biz.heroImage = { src: 'assets/hero.svg', w: 1200, h: 700 };
  }

  const variants = chooseVariants(biz);
  await fs.writeFile(path.join(outDir, 'index.html'), subSiteHtml(biz, variants));
  await fs.writeFile(path.join(outDir, 'style.css'), subSiteCss(biz, variants));
  await fs.writeFile(path.join(outDir, 'script.js'), subSiteJs());
}

// ---------------------------------------------------------------------------
// Hub generation
// ---------------------------------------------------------------------------

function hubHtml() {
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Handwerksbetriebe Hamburg-West – Übersicht</title>
<meta name="description" content="Interaktive Karte: Handwerksbetriebe in Hamburg-West (Lurup, Osdorf, Eidelstedt, Stellingen, Bahrenfeld, Schnelsen).">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#1F3A5F">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%231F3A5F'/%3E%3Cpath d='M32 10c-8 0-14 6.2-14 14 0 10.4 14 28 14 28s14-17.6 14-28c0-7.8-6-14-14-14zm0 19a5 5 0 1 1 0-10 5 5 0 0 1 0 10z' fill='%23fff'/%3E%3C/svg%3E">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<link rel="stylesheet" href="hub.css">
</head>
<body>
<header class="topbar">
  <div class="topbar__title">
    <h1>Handwerk Hamburg-West</h1>
    <p>63 Betriebe · Live-Karte · filterbar nach Stadtteil und Gewerk</p>
  </div>
  <div class="filters">
    <label for="f-stadtteil" class="visually-hidden">Stadtteil filtern</label>
    <select id="f-stadtteil" aria-label="Stadtteil filtern"><option value="">Alle Stadtteile</option></select>
    <label for="f-gewerk" class="visually-hidden">Gewerk filtern</label>
    <select id="f-gewerk" aria-label="Gewerk filtern"><option value="">Alle Gewerke</option></select>
    <span id="count" class="count" role="status"></span>
  </div>
</header>
<div id="map" role="application" aria-label="Karte der Handwerksbetriebe"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script src="hub.js" defer></script>
</body>
</html>`;
}

function hubCss() {
  return `* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; }
body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; display: flex; flex-direction: column; height: 100vh; height: 100dvh; }
::selection { background: #1F3A5F; color: #fff; }
:focus-visible { outline: 3px solid #F0B400; outline-offset: 2px; }
.topbar { background: linear-gradient(135deg, #1F3A5F, #274b77); color: #fff; padding: 0.85rem clamp(0.8rem, 3vw, 1.5rem); display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem 1.2rem; z-index: 1000; box-shadow: 0 2px 8px rgba(0,0,0,0.25); }
.topbar__title { margin-right: auto; }
.topbar__title h1 { font-size: clamp(1.05rem, 2.8vw, 1.4rem); }
.topbar__title p { font-size: 0.88rem; opacity: 0.86; margin-top: 0.15rem; }
.filters { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.filters select { font-size: 0.95rem; padding: 0.5em 0.7em; border-radius: 999px; border: none; max-width: 46vw; }
.count { font-size: 0.9rem; opacity: 0.95; white-space: nowrap; padding: 0.45em 0.75em; border-radius: 999px; background: rgba(255,255,255,0.12); }
#map { flex: 1; min-height: 0; width: 100%; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.popup h3 { margin-bottom: 0.15rem; font-size: 1rem; }
.popup p { margin: 0.1rem 0; font-size: 0.88rem; color: #444; }
.popup .stars-line { color: #b58900; font-size: 0.88rem; }
.popup a.popup-btn { display: inline-block; margin-top: 0.5rem; background: #1F3A5F; color: #fff; padding: 0.45em 0.9em; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 0.9rem; }
`;
}

function hubJs(businesses) {
  const data = businesses.map((b) => ({
    name: b.name,
    slug: b.slug,
    gewerk: b.gewerk,
    tradeLabel: b.trade.label,
    stadtteil: b.stadtteil,
    adresse: b.adresse,
    lat: +b.lat.toFixed(6),
    lon: +b.lon.toFixed(6),
    approx: b.geoApprox,
    stars: b.rating ? b.rating.stars : null,
    count: b.rating ? b.rating.count : null,
  }));
  return `// Map hub: markers + Stadtteil/Gewerk filters.
var BUSINESSES = ${JSON.stringify(data, null, 0)};
var TOTAL = BUSINESSES.length;

var map = L.map('map').setView([53.585, 9.9], 12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

var markers = BUSINESSES.map(function (b) {
  var stars = b.stars !== null
    ? '<p class="stars-line">★ ' + String(b.stars.toFixed(1)).replace('.', ',') + ' (' + b.count + ')</p>'
    : '';
  var addr = esc(b.adresse) + (b.approx ? ' <em>(ungefähre Lage)</em>' : '');
  var html = '<div class="popup"><h3>' + esc(b.name) + '</h3>' +
    '<p>' + esc(b.tradeLabel) + ' · ' + esc(b.stadtteil) + '</p>' +
    '<p>' + addr + '</p>' + stars +
    '<a class="popup-btn" href="./' + b.slug + '/index.html">Zur Website</a></div>';
  var m = L.marker([b.lat, b.lon]);
  m.bindPopup(html);
  if (b.approx) m.bindTooltip(esc(b.adresse) + ' (ungefähre Lage)');
  m.biz = b;
  return m;
});

var selStadtteil = document.getElementById('f-stadtteil');
var selGewerk = document.getElementById('f-gewerk');
var countEl = document.getElementById('count');

function fillOptions(sel, values) {
  values.sort(function (a, b) { return a.localeCompare(b, 'de'); }).forEach(function (v) {
    var o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  });
}
fillOptions(selStadtteil, Array.from(new Set(BUSINESSES.map(function (b) { return b.stadtteil; }))));
fillOptions(selGewerk, Array.from(new Set(BUSINESSES.map(function (b) { return b.tradeLabel; }))));

function applyFilter() {
  var st = selStadtteil.value;
  var gw = selGewerk.value;
  var shown = 0;
  var bounds = [];
  markers.forEach(function (m) {
    var ok = (!st || m.biz.stadtteil === st) && (!gw || m.biz.tradeLabel === gw);
    if (ok) {
      if (!map.hasLayer(m)) m.addTo(map);
      bounds.push(m.getLatLng());
      shown++;
    } else if (map.hasLayer(m)) {
      map.removeLayer(m);
    }
  });
  countEl.textContent = shown + ' von ' + TOTAL + ' Betrieben';
  if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
}
selStadtteil.addEventListener('change', applyFilter);
selGewerk.addEventListener('change', applyFilter);
applyFilter();
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Reading CSV …');
  const raw = await readCsv();
  const businesses = raw.map(normalizeRow).filter((b) => b.name);
  console.log(`  ${businesses.length} businesses`);

  const slugs = new Set();
  for (const b of businesses) {
    if (slugs.has(b.slug)) throw new Error(`Duplicate slug: ${b.slug}`);
    slugs.add(b.slug);
  }

  await fs.ensureDir(HTML_CACHE);
  await fs.ensureDir(ASSET_CACHE);

  console.log('Enriching (scrape + assets, cached) …');
  const enriched = [];
  for (const biz of businesses) {
    enriched.push(await enrich(biz));
  }
  const scraped = enriched.filter((b) => b.assets.images.length).length;
  console.log(`  ${scraped} sites with downloaded images`);

  console.log('Geocoding (Nominatim, cached, 1.1 s/req on cold cache) …');
  await geocodeAll(enriched);
  const approx = enriched.filter((b) => b.geoApprox).length;
  console.log(`  ${enriched.length - approx} geocoded, ${approx} fallback positions`);

  console.log('Generating sites …');
  await fs.emptyDir(PUBLIC_DIR);
  for (const biz of enriched) {
    await generateSubSite(biz);
  }

  await fs.writeFile(path.join(PUBLIC_DIR, 'index.html'), hubHtml());
  await fs.writeFile(path.join(PUBLIC_DIR, 'hub.css'), hubCss());
  await fs.writeFile(path.join(PUBLIC_DIR, 'hub.js'), hubJs(enriched));

  console.log(`Done. ${enriched.length} sub-sites + hub in ${path.relative(__dirname, PUBLIC_DIR)}/`);
}

main().catch((e) => {
  console.error('BUILD FAILED:', e);
  process.exit(1);
});
