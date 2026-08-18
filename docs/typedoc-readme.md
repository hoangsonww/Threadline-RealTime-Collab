---
title: Overview
---

# Threadline API reference

This is the generated symbol-level reference for Threadline's three services. It is produced by TypeDoc directly from the TypeScript sources on `main`, so it cannot drift from the code — if a signature here is wrong, the code is wrong.

It is **not** the place to start. Start with [the repository README](https://github.com/hoangsonww/Threadline-RealTime-Collab#readme) for what Threadline is, and with [`docs/architecture.md`](https://github.com/hoangsonww/Threadline-RealTime-Collab/blob/main/docs/architecture.md) for how the three services fit together. Come here when you already know which module you need and want the exact types.

## The three packages

| Package | Runtime | What it owns |
| --- | --- | --- |
| **`@threadline/api`** | Node (Express 5) | Identity, authorization, and durable persistence. Every ABAC decision in the system is made here, in `policy.ts`. |
| **`@threadline/realtime`** | Cloudflare Workers (workerd) | One Durable Object per room: WebRTC signalling, presence, and the live event fan-out. Verifies room tickets independently rather than trusting the API's word. |
| **`@threadline/web`** | Browser (Next.js) | The client. Only `lib/` is documented here — the App Router pages and the component tree are a view hierarchy, not a module API, and [`docs/frontend.md`](https://github.com/hoangsonww/Threadline-RealTime-Collab/blob/main/docs/frontend.md) covers them instead. |

## Reading this reference with the trust model in mind

Threadline's central design claim is that the three services **do not trust each other's enforcement**. That has a direct consequence for how to read these pages: a function being exported from `@threadline/api` does not mean the realtime tier may assume its result. Each boundary re-verifies.

The symbols where that matters most:

- **`policy`** — `canRoom` and `canOrganization` are the only sanctioned way to make an authorization decision about a room or organization resource. A route handler that decides for itself is a bug, whatever it concludes.
- **`security`** — session handling, hashing, and the room-ticket signing primitives. The ticket signed here is verified again, independently, inside the Durable Object.
- **`repository`** — the persistence port. Route handlers depend on this interface rather than on MongoDB, which is the decision recorded in [ADR 0003](https://github.com/hoangsonww/Threadline-RealTime-Collab/blob/main/docs/decisions/0003-repository-interface.md).
- **`domain`** — the shared vocabulary. If a term here disagrees with [`docs/glossary.md`](https://github.com/hoangsonww/Threadline-RealTime-Collab/blob/main/docs/glossary.md), the type wins and the glossary is stale.

## Related documentation

- [Architecture](https://github.com/hoangsonww/Threadline-RealTime-Collab/blob/main/docs/architecture.md) — how the three services fit together and why they are split that way
- [Security](https://github.com/hoangsonww/Threadline-RealTime-Collab/blob/main/docs/security.md) — the trust model, the secrets inventory, and every re-verified boundary
- [Realtime protocol](https://github.com/hoangsonww/Threadline-RealTime-Collab/blob/main/docs/realtime.md) — the Durable Object message contract
- [HTTP API](https://github.com/hoangsonww/Threadline-RealTime-Collab/blob/main/docs/api.md) — routes, ABAC, and the OpenAPI specification
- [Architecture decision records](https://github.com/hoangsonww/Threadline-RealTime-Collab/tree/main/docs/decisions) — the decisions that produced this shape, and what each one cost

## Regenerating this

```bash
npm run docs        # build into docs/api-reference/
npm run docs:serve  # build, then serve it on http://localhost:8080
npm run docs:watch  # rebuild on change
```

This site is published from `main` at **<https://hoangsonww.github.io/Threadline-RealTime-Collab/>** by the `Documentation` workflow, which rebuilds it on every push that touches the sources or `docs/`.

The same workflow exports the OpenAPI specification alongside this reference, at [`openapi/openapi.json`](https://hoangsonww.github.io/Threadline-RealTime-Collab/openapi/openapi.json) — the same document the running API serves, so it can be pointed at a client generator or an API explorer without cloning anything.

`docs/api-reference/` is generated output and is not committed. CI rebuilds it on every push to `main` and publishes it to GitHub Pages.
