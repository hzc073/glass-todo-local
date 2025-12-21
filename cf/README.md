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

## Push notifications (optional)

This backend supports Web Push notifications with a cron trigger.

### 1) Apply updated schema

```bash
wrangler d1 execute glass-todo --file=cf/schema.sql
```

### 2) Set VAPID keys (recommended for production)

Generate keys:

```bash
npx web-push generate-vapid-keys
```

Ensure dependencies are installed (web-push is required):

```bash
npm install
```

Set them as secrets or vars:

```bash
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_SUBJECT
```

If you leave them empty, the worker will generate and store keys in D1 on first run.

### 3) Cron trigger

`cf/wrangler.toml` includes a cron schedule (`* * * * *`) to scan reminders every minute.
