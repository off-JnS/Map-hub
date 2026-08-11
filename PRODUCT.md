# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Statischer Site-Generator: `build.js` (Node.js, Template-Literals, kein Framework) erzeugt `public/` — Leaflet-Karten-Hub plus eine Demo-Site pro Betrieb. Deploy-Ziel: Vercel (statisch). **Alle Design-/Inhaltsänderungen gehören in `build.js`; `public/` wird bei jedem Build überschrieben.**

## Users

- **Primärnutzer:** Der Betreiber (Freelancer, Website-Akquise) selbst. Er zeigt die Demo-Sites **live im Verkaufsgespräch** (Anruf/Termin) einem Handwerksbetrieb aus der Lead-Liste. Die Site unterstützt seinen Pitch; sie muss auf einem Bildschirm neben dem Gespräch sofort beeindrucken.
- **Sekundäres Publikum:** Der Inhaber des Handwerksbetriebs, der seine eigene (Demo-)Website vorgeführt bekommt — typischerweise ein Betrieb ohne Website oder mit veralteter Website.

## Product Purpose

Lead-Generierung für Website-Dienstleistungen: 63 verifizierte Handwerksbetriebe in Hamburg-West (Lurup, Osdorf, Eidelstedt, Stellingen, Bahrenfeld, Schnelsen, Eimsbüttel) erhalten je eine fertige, individuelle Demo-Website. Erfolg = der Lead erkennt im Gespräch den Wert („so könnte Ihre Website aussehen") und beauftragt die echte Website.

## Positioning

Kein generisches Mockup, sondern eine bereits gebaute, unter der eigenen Firma laufende Website mit echten Daten des Betriebs (Name, Adresse, Telefon, Google-Bewertung, teils gescrapte Texte/Fotos der Altwebsite). Der Pitch zeigt ein fertiges Produkt, keine Skizze.

## Operating Context

- Quelle der Wahrheit: CSV-Lead-Liste im Projektroot (Gewerk, Stadtteil, Kontakt, Google-Rating, Maps-Link, Alt-Website).
- Build cached Scraping/Geocoding in `.cache/`; Rebuilds sind deterministisch (Seed = Business-Slug).
- Hub (`/`) = Karten-Dashboard über alle 63 Betriebe mit Stadtteil-/Gewerk-Filter — Arbeits- und Präsentationsoberfläche des Betreibers.
- Demo-Sites werden im Gespräch auf Desktop und Mobil gezeigt; Responsivität ist Teil des Verkaufsarguments.

## Capabilities and Constraints

- **Demo wird echte Site:** Bei Kauf wird die Demo zur Live-Website ausgebaut (Inhalte/Fotos ersetzen, Domain aufschalten). Der Generator muss diesen Upgrade-Pfad sauber halten: valides HTML/CSS/JS pro Site, keine Wegwerf-Hacks.
- Kontaktformulare sind reine Front-End-Demos (`alert`), E-Mails sind Dummy-Adressen (`info@{slug}.de`) — vor Live-Gang zu ersetzen.
- Alle Seiten `noindex` (Demos dürfen nicht ranken).
- Konkurrenz-Portale (sanitaerfinden, malerfinder, elektrikerportal u. a.) werden nie gescraped oder verlinkt.
- Keine erfundenen Fakten auf Demo-Sites: keine falschen Bewertungen, Zertifikate, Referenzen oder Leistungsversprechen über die CSV-/Scrape-Daten hinaus; generische Über-uns-Platzhaltertexte sind als solche unkritisch, werden aber vor Live-Gang ersetzt.
- Komponentensystem mit deterministischen Varianten (4 Hero-Layouts, 3 Navigationsmuster, 4 Leistungs-Darstellungen, 4 Font-Paare, Gewerk-gebundene Farbpaletten) — jede Demo soll individuell wirken, nicht wie Serienware.

## Brand Commitments

- Betreiber-Branding erscheint **nur im Hub** (Dashboard-Kopf/Fußzeile), nicht auf den Demo-Sites der Betriebe. Name/Kontakt des Betreibers: **noch nicht erfasst (offen)**.
- Demo-Sites tragen ausschließlich die Identität des jeweiligen Handwerksbetriebs; Footer-Hinweis „Demo-Webseite – unverbindliche Vorschau" bleibt bis zum Live-Gang.

## Evidence on Hand

- `Lead-Liste Hamburg-West (Google Maps Verifiziert) - *.csv` — 63 verifizierte Betriebe mit echten Google-Bewertungen.
- `.cache/html/` — 35 gescrapte Alt-Websites; 29 Demo-Sites mit echtem Über-uns-Text, 20 mit heruntergeladenen Fotos.
- `.cache/geocode.json` — alle 63 Adressen erfolgreich geocodet.
- Keine Testimonials, Referenzen oder Preise des Betreibers vorhanden — nicht erfinden.

## Product Principles

1. **Der Pitch-Moment zählt:** Jede Demo muss im ersten Viewport überzeugen — der Betreiber hat im Gespräch Sekunden, nicht Minuten.
2. **Echte Daten schlagen Attrappe:** Wo CSV/Scrape echte Inhalte liefern (Rating, Fotos, Texte), sichtbar einsetzen; wo nicht, ehrliche Platzhalter statt erfundener Fakten.
3. **Individuell statt Serie:** Zwei Betriebe desselben Gewerks dürfen nebeneinander gezeigt nie wie dasselbe Template wirken.
4. **Upgrade-fähig bauen:** Jede Demo ist der Rohbau der späteren echten Website — Code-Qualität entsprechend.
5. **Generator ist die Quelle:** Verbesserungen skalieren nur über `build.js`; Einzel-Site-Handarbeit ist verloren beim nächsten Build.
