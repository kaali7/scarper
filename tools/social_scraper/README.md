# Social Scraper Engine (Public & Ban-Proof)

Zero-login, ban-proof social media enrichment and lead intelligence.

## 🎯 Why This Architecture?
Traditional scrapers that log in to Instagram or LinkedIn get banned within hours because anti-bot systems monitor session activity, device fingerprints, and rate limits.

This engine completely circumvents account bans by using two 100% legal, non-login techniques:
1. **Public Instagram Inspection**: Fetches public profile OpenGraph metadata and JSON-LD schemas anonymously. Since no account is ever logged in, **0 accounts can be banned**.
2. **Search Engine Dorking (LinkedIn)**: Queries public search engine indices (`site:linkedin.com/company/ ...`) to extract company URLs, employee size ranges, industries, and headquarters without hitting LinkedIn login barriers.

---

## 🚀 CLI Usage

### 1. Instagram Profile Inspector
Inspect public follower count, verified badge, bio, and business contact email:
```bash
# Via direct handle
python -m tools.social_scraper.main instagram starbucks

# Via full URL with JSON output
python -m tools.social_scraper.main instagram "https://www.instagram.com/bluetokaicoffee" --json
```

### 2. LinkedIn Company Dorker
Find company profile URL, employee count, and headquarters outside login gates:
```bash
python -m tools.social_scraper.main linkedin "Blue Tokai Coffee Roasters" --location "Mumbai"
```

### 3. Batch CSV Enrichment
Enrich existing scraped leads with Instagram follower counts and bios:
```bash
python -m tools.social_scraper.main batch --platform instagram --input leads.csv --col instagram_handle
```

---

## 🛠️ Integration with Unified Tools Dispatcher
You can also run all social commands via the project's root `tools.py`:
```bash
python tools.py run social instagram starbucks
python tools.py run social linkedin "Third Wave Coffee"
```
