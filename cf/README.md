# Cloudflare D1 Backend

This folder adds a Cloudflare Workers + D1 backend that mirrors the existing `/api/*` endpoints.

## Setup

1) Create a D1 database and note its ID.
2) Update `cf/wrangler.toml` with your `database_id`.
3) Apply the schema:

```bash
wrangler d1 execute glass-todo --file=cf/schema.sql
```

## Deploy

```bash
wrangler deploy
```

## Frontend config

Set `apiBaseUrl` in `public/config.json` to your Worker URL, for example:

```
https://your-worker.your-account.workers.dev
```
