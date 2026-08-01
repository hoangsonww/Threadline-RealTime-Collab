# Deploying Threadline

Threadline uses three production runtimes by design.

| Component       | Target                     | Required configuration                                                                                                                                          |
| --------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`      | Vercel                     | `NEXT_PUBLIC_API_ORIGIN`, `NEXT_PUBLIC_REALTIME_ORIGIN`                                                                                                         |
| `apps/api`      | Any always-on Node 22 host | `MONGODB_URI`, `OIDC_ISSUER`, `WEB_ORIGIN`, `OIDC_PRIVATE_JWK`, `ROOM_TICKET_SECRET`, `INTERNAL_INGEST_SECRET`, `AUTH_DELIVERY_WEBHOOK`, `AUTH_DELIVERY_SECRET` |
| `apps/realtime` | Cloudflare Workers         | `ROOM_TICKET_SECRET`, `PERSISTENCE_WEBHOOK=<api>/v1/internal/room-events`, `PERSISTENCE_SECRET`                                                                 |

For Docker Compose and Kubernetes—including one or more clusters—see [`containers-and-kubernetes.md`](containers-and-kubernetes.md). Kubernetes self-hosts only the stateless web/API plane; Cloudflare remains the production owner of room Durable Objects.

## Production checklist

1. Provision MongoDB Atlas with a dedicated least-privilege application user and set `MONGODB_URI`.
2. Generate an RSA signing JWK exactly once with `npm run generate:oidc-key --workspace=@threadline/api`, store its JSON as `OIDC_PRIVATE_JWK`, then deploy the Express container behind HTTPS. Set `OIDC_ISSUER` to its public canonical URL and `COOKIE_SECURE=true`.
3. Deploy the Durable Object service with `npm run deploy --workspace=@threadline/realtime`; set secrets with `wrangler secret put`.
4. Deploy `apps/web` to Vercel and configure both public origins using HTTPS URLs.
5. Configure a TURN service for real-world WebRTC connectivity. The current browser client is intentionally compatible with an ICE server list from `NEXT_PUBLIC_ICE_SERVERS`.
6. Configure `AUTH_DELIVERY_WEBHOOK` and `AUTH_DELIVERY_SECRET` to a transactional-email worker. It receives the recipient and one-time action URL for password reset and email verification. The API fails fast in production when this delivery path is missing.
7. The initial `threadline-web` OIDC redirect is seeded as `<WEB_ORIGIN>/oidc/callback`; add additional first-party clients directly to `oauth_clients`. Exact matching is enforced.
8. Run the same checks as CI: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run build`.

Use sibling HTTPS domains for `WEB_ORIGIN` and the API (for example, `app.example.com` and `id.example.com`) so the HttpOnly browser session cookie remains same-site. Never put MongoDB, OIDC, room-ticket, email-delivery, or TURN credentials in `NEXT_PUBLIC_*` environment variables.

## Zero-cost public preview

You can publish Threadline without buying a domain by using provider URLs. This is suitable for a portfolio release or early testers, with free-tier limits and possible cold starts.

| Component | Free host                      | Example URL                                 |
| --------- | ------------------------------ | ------------------------------------------- |
| Web       | Vercel Hobby                   | `threadline-web.vercel.app`                 |
| API       | Render Free Docker Web Service | `threadline-api.onrender.com`               |
| Database  | MongoDB Atlas Free cluster     | persistent Atlas connection                 |
| Realtime  | Cloudflare Workers Free        | `threadline-realtime.<account>.workers.dev` |

### Keep browser authentication same-origin

Free-provider hostnames do not share a cookie site. The web app includes a Vercel rewrite at `/api/identity/*` so its session cookie is first-party to the Vercel URL. Configure the Vercel project with:

```text
THREADLINE_API_ORIGIN=https://threadline-api.onrender.com
NEXT_PUBLIC_API_ORIGIN=/api/identity
NEXT_PUBLIC_REALTIME_ORIGIN=https://threadline-realtime.<account>.workers.dev
```

Set the API configuration to:

```text
NODE_ENV=production
WEB_ORIGIN=https://threadline-web.vercel.app
OIDC_ISSUER=https://threadline-web.vercel.app/api/identity
COOKIE_SECURE=true
MONGODB_URI=<Atlas connection string>
ROOM_TICKET_SECRET=<long random value>
INTERNAL_INGEST_SECRET=<different long random value>
OIDC_PRIVATE_JWK=<output from generate:oidc-key>
AUTH_DELIVERY_WEBHOOK=<email delivery endpoint>
AUTH_DELIVERY_SECRET=<long random value>
```

Do not expose `THREADLINE_API_ORIGIN` to the browser. The rewrite relays browser traffic to Render while retaining the Vercel session-cookie origin.

### Render API deployment

Create a free **Web Service** from the repository, select Docker, leave the repository root as the build context, and use `apps/api/Dockerfile` as the Dockerfile path. Add the API variables above. The API has no local persistent state; Atlas retains user and room data when Render restarts. A free Render Web Service sleeps after 15 minutes of inactivity, so its first request after idle can take about a minute.

### Cloudflare realtime configuration

Set `PERSISTENCE_WEBHOOK` to `https://threadline-api.onrender.com/v1/internal/room-events`. Set the Worker `ROOM_TICKET_SECRET` to the API's `ROOM_TICKET_SECRET`, and Worker `PERSISTENCE_SECRET` to the API's `INTERNAL_INGEST_SECRET`.
