# Web Enricher Engine

Lightweight, high-speed website and contact extractor for lead generation.

## 🎯 Features
- Visits target websites and checks key contact subpages (`/contact`, `/about`, `/contact-us`, `/about-us`, `/get-in-touch`).
- Extracts official email addresses (filters out fake/tracking emails).
- Extracts phone numbers and direct WhatsApp chat links (`wa.me`, `api.whatsapp.com`).
- Discovers social media profile links (Instagram, Facebook, LinkedIn, Twitter/X, YouTube, TikTok).
- Multi-threaded batch CSV enrichment for Google Maps leads.

---

## 🚀 CLI Usage

### Single Website Lookup:
```bash
python -m tools.web_enricher.main --url https://example.com --json
```

### Batch CSV Lead Enrichment:
Enrich an existing Google Maps scraper CSV with verified email addresses and WhatsApp numbers:
```bash
python -m tools.web_enricher.main --input "thane_coffee_shops.csv" --url-col website --threads 8
```

---

## 🛠️ Integration with Root Dispatcher:
```bash
python tools.py run enrich --url https://example.com
```
