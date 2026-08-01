# Threadline

Threadline is a room-centered collaboration workspace for distributed engineering teams. A room is both the live session and its durable record: people meet, share context, capture decisions, and retain the artifacts after the call.

## What is included

- A polished Next.js workspace with authentication screens, a room dashboard, room creation, chat, shared notes, a drawable whiteboard, file metadata, an activity timeline, and browser media/screen-share controls.
- An Express service that exposes identity, sessions, room access tickets, PAT management, and a first-party OIDC authorization-code-with-PKCE provider.
- A Cloudflare Worker with one Durable Object per room for room presence, signaling, live events, and batched durable event hand-off.

## Local setup

```bash
npm install
cp apps/realtime/.dev.vars.example apps/realtime/.dev.vars
npm run dev
```

Open `http://localhost:3000`. `npm run dev` starts all three local services with their correct connections:

| Service  | URL                     | Local behavior                                                           |
| -------- | ----------------------- | ------------------------------------------------------------------------ |
| Web      | `http://localhost:3000` | Next.js UI, connected to the local API and Worker                        |
| API      | `http://localhost:4000` | Express identity and room API using the in-memory development repository |
| Realtime | `http://localhost:8787` | Wrangler's local Worker and Durable Object runtime                       |

The local Worker receives the matching development secrets from `apps/realtime/.dev.vars`; that file is ignored by Git. Stop the combined stack with `Ctrl+C`. To run individual services, use `npm run dev:api:local`, `npm run dev:realtime:local`, or `npm run dev:web:local`.

Prefer containers? `npm run docker:up` starts the web app, API, MongoDB, and Wrangler's local Durable Object runtime together. The complete Docker and Kubernetes operating guide is in [`docs/containers-and-kubernetes.md`](docs/containers-and-kubernetes.md).

## Architecture

| Plane                | Runtime                    | Job                                                         |
| -------------------- | -------------------------- | ----------------------------------------------------------- |
| User interface       | Next.js on Vercel          | Session-aware UI and browser collaboration tools            |
| Identity and records | Express + MongoDB Atlas    | Auth, OIDC, PATs, room permissions, durable artifacts       |
| Live coordination    | Cloudflare Durable Objects | Presence, signaling, ephemeral room state, broadcast events |
| Peer media           | WebRTC                     | Audio, video, screen share, and direct data transfer        |

The API accepts `MONGODB_URI` when Atlas is ready. The in-memory repository is deliberate for local bootstrapping and is replaced at one boundary in `apps/api/src/repository.ts`.

For production, the API validates its mandatory settings at boot: Atlas, HTTPS origins, stable RSA signing JWK, separate room and ingestion secrets, and an authenticated delivery webhook for recovery/verification email. Generate a signing JWK once with `npm run generate:oidc-key --workspace=@threadline/api`; deployment details are in [`docs/deployment.md`](docs/deployment.md).

For a zero-cost public preview, use the Vercel same-origin API rewrite described in the deployment guide. It lets browser authentication work across free Vercel, Render, MongoDB Atlas, and Cloudflare URLs without purchasing a domain.
