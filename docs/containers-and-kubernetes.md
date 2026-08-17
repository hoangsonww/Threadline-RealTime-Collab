# Containers and Kubernetes

Threadline has two portable, supported deployment modes:

- **Docker Compose** is a complete local environment: Next.js, the Express API, MongoDB, and Wrangler's local Durable Object runtime.
- **Kubernetes** deploys the stateless web and API containers. It continues to use MongoDB Atlas (or another managed MongoDB deployment) and the Cloudflare Worker in production.

The latter distinction is intentional. Durable Objects provide single-instance, globally coordinated room state. The `realtime` Docker image is a local development emulator, not a second production implementation that could diverge from Cloudflare's Durable Object behavior.

## Table of contents

- [Docker Compose](#docker-compose)
- [Image contracts](#image-contracts)
  - [Why the realtime image is not Alpine](#why-the-realtime-image-is-not-alpine)
- [Kubernetes prerequisites](#kubernetes-prerequisites)
- [Prepare a cluster](#prepare-a-cluster)
- [Validate and deploy](#validate-and-deploy)
- [More than one cluster](#more-than-one-cluster)

## Docker Compose

Install Docker Desktop, then run this from the repository root:

```bash
npm run docker:up
```

Open `http://localhost:3000`. Compose starts all four services and waits for MongoDB and the API health checks before starting dependent services.

```mermaid
graph TB
    subgraph compose["docker compose"]
        web["web<br/>Next.js, production build"]
        api["api<br/>Express"]
        realtime["realtime<br/>wrangler dev (local Worker + DO)"]
        mongo[("mongo<br/>named volume: mongo-data")]
    end
    Browser -->|"localhost:3000"| web
    web -->|"/api/identity/* rewrite"| api
    Browser -->|"WebSocket"| realtime
    api -->|"healthcheck gate"| mongo
    realtime -.->|"ingest webhook,<br/>dev secrets only"| api

    style mongo fill:#123524,stroke:#52e0a2,color:#fff
```

`depends_on` with `condition: service_healthy` is what makes "waits for health checks" literal — `web` and `realtime` don't start until `api`'s `/health` responds, and `api` doesn't start until Mongo accepts connections. This is the same topology as production (three planes, one Mongo), just with the Cloudflare Worker's local emulator standing in for the deployed one.

| Service  | Address                        | Purpose                                                          |
| -------- | ------------------------------ | ---------------------------------------------------------------- |
| Web      | `http://localhost:3000`        | Production-mode Next.js container with a same-origin API rewrite |
| API      | `http://localhost:4000/health` | Express API backed by the Compose MongoDB database               |
| Realtime | `http://localhost:8787/health` | Wrangler local Worker and Durable Object runtime                 |
| MongoDB  | internal only                  | Durable development data in the `mongo-data` named volume        |

The Compose configuration contains only intentionally non-secret development keys. It does not read your Cloudflare, Atlas, OIDC, or email credentials. Stop it with `npm run docker:down`. If you also want to discard the local MongoDB data, run `docker compose down --volumes`; that action deletes the Compose database volume.

If the normal `npm run dev` stack is already running, stop it before Compose because they use the same host ports. The image build alone can be checked without starting services:

```bash
npm run docker:build
```

## Image contracts

The API image is deliberately runtime-configured. Set its production configuration with platform secrets, never Docker build arguments:

```text
MONGODB_URI
ROOM_TICKET_SECRET
INTERNAL_INGEST_SECRET
OIDC_PRIVATE_JWK
AUTH_DELIVERY_WEBHOOK
AUTH_DELIVERY_SECRET
WEB_ORIGIN
OIDC_ISSUER
AUTH_ACTION_ORIGIN
COOKIE_SECURE=true
SENTRY_DSN            # optional — error/performance monitoring, inert if unset
```

Next.js substitutes `NEXT_PUBLIC_*` values during its build, so the web image needs its public configuration when it is built. `THREADLINE_API_ORIGIN` is server-only: it tells Next.js where to proxy `/api/identity/*` and must be reachable from the web container. `NEXT_PUBLIC_SENTRY_DSN` is optional — a build without it produces an image where Sentry stays inert at runtime.

```bash
docker build -f apps/web/Dockerfile \
  --build-arg THREADLINE_API_ORIGIN=http://threadline-api:4000 \
  --build-arg NEXT_PUBLIC_API_ORIGIN=/api/identity \
  --build-arg NEXT_PUBLIC_REALTIME_ORIGIN=https://threadline-realtime.<account>.workers.dev \
  --build-arg NEXT_PUBLIC_SENTRY_DSN=https://<key>@o<org-id>.ingest.us.sentry.io/<project-id> \
  -t threadline-web:1.0.0 .

docker build -f apps/api/Dockerfile -t threadline-api:1.0.0 .
```

### Why the realtime image is not Alpine

`apps/api` and `apps/web` build on `node:22-alpine`. `apps/realtime` deliberately does not — it builds on `node:22-bookworm-slim`, and changing that back to save image size will produce a container that cannot start.

The realtime image is the only one that runs a native binary. `wrangler dev --local` spawns **workerd** from `@cloudflare/workerd-linux-<arch>`, and those builds are dynamically linked against glibc. On Alpine, which uses musl, npm installs the package quite happily — the 130 MB binary is present, executable, and at the expected path — but `execve` fails because its ELF interpreter (`/lib/ld-linux-<arch>.so.1`) does not exist. Linux reports a missing interpreter as `ENOENT` **on the binary itself**, so the error names a file that is demonstrably there:

```text
Error: spawn /app/node_modules/@cloudflare/workerd-linux-arm64/bin/workerd ENOENT
```

The image still *builds* on Alpine. Nothing fails until a container is started, which is why `docker compose build` on its own cannot catch this class of defect — and why the `containers` CI job now starts the stack, waits for every healthcheck, and smoke-tests each service over HTTP rather than only building.

This only affects the local emulator. Production `apps/realtime` runs on Cloudflare's own infrastructure via `wrangler deploy` and never uses this image.

## Kubernetes prerequisites

The manifests are portable Kustomize YAML. A production cluster needs:

1. An ingress controller compatible with `networking.k8s.io/v1` (the supplied annotations target ingress-nginx).
2. TLS certificates for the web host and a public API host. `cert-manager` is a common way to provision these.
3. Metrics Server if you want the included CPU HorizontalPodAutoscalers to scale.
4. An externally reachable API hostname. Cloudflare Workers uses it for durable-event hand-off; the web container continues to proxy browser identity requests internally.
5. A managed MongoDB connection string. MongoDB is intentionally not deployed as a Kubernetes StatefulSet here: identity and room history need a database with backups, upgrades, and a clear durability plan.
6. A deployed Threadline Cloudflare Worker and a TURN service for production WebRTC.

The Kubernetes `Ingress` has two hosts by design:

- `threadline.example.invalid` routes public UI traffic to Next.js.
- `api.threadline.example.invalid` routes the authenticated Worker persistence webhook to Express.

Replace both placeholder hosts before applying. The browser talks to `/api/identity/*` on the web host, so the session cookie remains first-party even though the Worker calls the API host directly.

## Prepare a cluster

Build and push immutable images to a registry your cluster can pull from. The web build must refer to the externally deployed Worker URL, while its API proxy should use the in-cluster API service.

```bash
docker build -f apps/api/Dockerfile -t ghcr.io/your-organization/threadline-api:1.0.0 .
docker build -f apps/web/Dockerfile \
  --build-arg THREADLINE_API_ORIGIN=http://threadline-api:4000 \
  --build-arg NEXT_PUBLIC_API_ORIGIN=/api/identity \
  --build-arg NEXT_PUBLIC_REALTIME_ORIGIN=https://threadline-realtime.<account>.workers.dev \
  -t ghcr.io/your-organization/threadline-web:1.0.0 .
docker push ghcr.io/your-organization/threadline-api:1.0.0
docker push ghcr.io/your-organization/threadline-web:1.0.0
```

Copy the production overlay or edit its image names, version tags, public origins, and ingress hosts. Do not use the `.example.invalid` values in a real deployment.

Generate the stable OIDC private JWK once, then create the namespace-scoped secret. Keep that JWK for the lifetime of the issuer; replacing it invalidates existing signed tokens.

```bash
npm run generate:oidc-key --workspace=@threadline/api > /tmp/threadline-oidc-private.jwk
kubectl create namespace threadline-production --dry-run=client -o yaml | kubectl apply -f -
kubectl -n threadline-production create secret generic threadline-secrets \
  --from-literal=MONGODB_URI='mongodb+srv://…' \
  --from-literal=ROOM_TICKET_SECRET="$(openssl rand -hex 32)" \
  --from-literal=INTERNAL_INGEST_SECRET="$(openssl rand -hex 32)" \
  --from-file=OIDC_PRIVATE_JWK=/tmp/threadline-oidc-private.jwk \
  --from-literal=AUTH_DELIVERY_WEBHOOK='https://your-email-worker.example/send' \
  --from-literal=AUTH_DELIVERY_SECRET="$(openssl rand -hex 32)"
```

`SENTRY_DSN` is deliberately not in that command — `api-deployment.yaml` references it as an `optional: true` secret key, so the pod starts identically whether or not it's present. Add it the same way, `--from-literal=SENTRY_DSN='https://<key>@o<org-id>.ingest.us.sentry.io/<project-id>'`, only if you want error/performance monitoring active; the container never fails to start over a missing key.

Store the two generated secrets in your password manager or secret manager. Set the same `ROOM_TICKET_SECRET` in Cloudflare as `ROOM_TICKET_SECRET`, and set the same `INTERNAL_INGEST_SECRET` in Cloudflare as `PERSISTENCE_SECRET`. Set the Worker `PERSISTENCE_WEBHOOK` to the public API host:

```text
https://api.<your-host>/v1/internal/room-events
```

The Kubernetes secret is intentionally not a repository manifest. Use External Secrets, Sealed Secrets, or your platform's secret integration when available.

## Validate and deploy

The repository validates both Kustomize overlays without needing a live cluster:

```bash
npm run k8s:validate
```

After customizing the production overlay, review rendered YAML before applying it:

```bash
kubectl kustomize infra/kubernetes/overlays/production
kubectl diff -k infra/kubernetes/overlays/production
kubectl apply -k infra/kubernetes/overlays/production
kubectl -n threadline-production rollout status deployment/threadline-api
kubectl -n threadline-production rollout status deployment/threadline-web
```

The base includes non-root containers, read-only filesystems (each with a writable `emptyDir` mounted at `/tmp`, the one path either runtime needs to write to), health probes, PodDisruptionBudgets, CPU autoscaling, and a soft topology spread constraint per deployment (`whenUnsatisfiable: ScheduleAnyway`) so a multi-node cluster prefers not to land every replica of the same service on one node — a single-node cluster, like the development overlay's, still schedules everything without issue. Start with the development overlay for a one-replica verification deployment; it shares the same production safeguards but lowers replicas.

## More than one cluster

Threadline can use multiple clusters for web/API capacity, but the clusters must be deliberately configured as one logical deployment:

1. Build the web image with one public web origin and the same public Cloudflare Worker URL.
2. Give every cluster the same MongoDB deployment, `OIDC_PRIVATE_JWK`, `ROOM_TICKET_SECRET`, and `INTERNAL_INGEST_SECRET`.
3. Put a global load balancer or API gateway in front of each cluster's public API ingress, then set the Worker `PERSISTENCE_WEBHOOK` to that global URL. A cluster-local Service name cannot be reached by Cloudflare.
4. Route the public web hostname through your global traffic manager. Keep the browser's `/api/identity/*` rewrite pointed at its local `threadline-api` Service.
5. Use the same TLS certificate strategy and ensure every cluster receives secret rotations before switching the Worker secret.

This is active-active for the stateless web/API plane. The Cloudflare Durable Object remains the single authoritative owner for each room, so no cross-cluster room-leader election or Redis synchronization is required.

```mermaid
graph TB
    Browser["Browser"]
    GLB["Global traffic manager<br/>(web hostname)"]
    GW["Global load balancer / API gateway<br/>(one public API URL)"]

    subgraph c1["Cluster 1"]
        w1["web pods"]
        a1["api pods"]
    end
    subgraph c2["Cluster 2"]
        w2["web pods"]
        a2["api pods"]
    end

    Atlas[("Shared MongoDB Atlas")]
    Worker["Cloudflare Worker<br/>(one deployment, all clusters)"]

    Browser --> GLB
    GLB --> w1
    GLB --> w2
    w1 -->|"local rewrite"| a1
    w2 -->|"local rewrite"| a2
    a1 --> Atlas
    a2 --> Atlas
    Browser -->|"WebSocket, ticket signed<br/>with the shared ROOM_TICKET_SECRET"| Worker
    Worker -->|"PERSISTENCE_WEBHOOK<br/>points at GW, not either cluster directly"| GW
    GW --> a1
    GW --> a2

    style Worker fill:#2b2140,stroke:#8a63ff,color:#fff
    style Atlas fill:#123524,stroke:#52e0a2,color:#fff
```

The Worker only ever knows about one API URL — the gateway's — never a cluster-local Kubernetes `Service` name, which Cloudflare's edge cannot resolve or route to. Every cluster shares the same `ROOM_TICKET_SECRET` and `INTERNAL_INGEST_SECRET` for exactly the reason in the diagram: a ticket issued by cluster 1 must verify correctly against the one Worker deployment, and an ingest webhook the Worker sends might land on either cluster through the gateway.
