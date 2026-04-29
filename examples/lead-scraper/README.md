# Lead Scraper

Country + business type -> public lead table with emails as CSV-ready JSON.

## Run

```bash
PORT=15401 node examples/lead-scraper/server.mjs
curl -X POST http://127.0.0.1:15401/lead-scraper/run -H 'content-type: application/json' -d '{"country":"Germany","business_type":"dentists","limit":5}'
```
