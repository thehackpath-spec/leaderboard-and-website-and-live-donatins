# Leaderboard Donation Hub

Cloudflare Worker and Durable Object for storing leaderboard snapshots and broadcasting leaderboard and donation updates over WebSockets.

## Setup

1. Install Node.js and run `npm install`.
2. For local development, copy `.dev.vars.example` to `.dev.vars` and set your own secret.
3. For deployment, run `npx wrangler secret put SECRET` and enter your own secret.
4. Run `npm run deploy`.

Public endpoints:

- `GET /api/state` returns the latest leaderboard snapshot.
- `GET /api/stream` opens the WebSocket stream.

Authenticated endpoints require `Authorization: Bearer <your SECRET>`:

- `POST /api/leaderboards` updates the donated and raised leaderboards.
- `POST /api/donations` broadcasts a donation event.

The Durable Object binding and migration are defined in `wrangler.toml`. Do not commit `.dev.vars` or any secret value.
