# Handwerk Hamburg-West — Static Site Generator

Generates a deployable static site from the lead CSV:

- **`/public/index.html`** — map hub (Leaflet + OpenStreetMap) with all 63 businesses as pins, filterable by Stadtteil and Gewerk.
- **`/public/{slug}/`** — one individual, responsive demo site per business (hero, services, about, rating, contact form, Google-Maps button). Layout, navigation, service display, color palette, and typography are selected deterministically per business, so every site looks distinct but rebuilds are reproducible.

## Requirements

- Node.js 18+
- The CSV file in the project root (already present):
  `Lead-Liste Hamburg-West (Google Maps Verifiziert) - Lead-Liste Hamburg-West (Google Maps Verifiziert).csv`

## Build

```
npm install
npm run build
```

The first (cold) build takes a few minutes:

1. **Scraping** — each accessible business website is fetched once; visible text becomes the "Über uns" section, and large images are downloaded into the site's `assets/` folder. Competitor directory pages (rows marked `Konkurenz` and known lead portals) are never fetched; those sites use generated SVG hero images and template text instead.
2. **Geocoding** — every address is resolved via Nominatim (OpenStreetMap) at 1 request/second. Addresses that cannot be resolved get a deterministic fallback position inside the Hamburg-West bounding box, marked "(ungefähre Lage)" on the map.

Everything is cached in `.cache/` (scraped HTML, downloaded assets, geocode results), so subsequent builds finish in seconds and work offline. Delete `.cache/` to force a full refresh.

## Deploy to Vercel

The repo is set up to build `public/` automatically on Vercel.

```
npx vercel deploy --prod
```

## Local preview

```
npx serve public -l 3000
```

## Notes

- Ratings like `5,0 (1)` from the CSV render as fractional golden SVG stars; rows with `keine` omit the rating section entirely.
- The contact forms are front-end demos: HTML5 validation plus an `alert("Nachricht gesendet – Demo")` on submit. No data is sent anywhere.
- All pages carry `<meta name="robots" content="noindex">` since these are demo previews.
- Fonts are loaded from Google Fonts (preconnect, `display=swap`); the map hub uses system fonts and the Leaflet CDN.
