graph TD
  A[Azure DevOps Pipeline] -->|Deploy vía Wrangler| B(Cloudflare Edge)
  B --> C[Cloudflare Pages: Frontend]
  B --> D[Cloudflare Workers: Backend API]
  D --> E[(Cloudflare D1: SQL DB)]
  D --> F((Cloudflare Metrics / APM))