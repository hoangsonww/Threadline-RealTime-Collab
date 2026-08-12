# Threadline architecture

Threadline is a room-centered engineering collaboration product. Its core design separates durable workspace records, live room coordination, and peer-to-peer media so that each concern can scale and fail independently.

This is the repository-level architecture reference. It describes the system as implemented, including its important operational constraints and current gaps. Topic-specific material lives in [docs/](docs/), especially [the detailed architecture reference](docs/architecture.md), [the API reference](docs/api.md), [realtime and WebRTC notes](docs/realtime.md), [the security model](docs/security.md), and the [architecture decisions](docs/decisions/README.md).

## Contents

- [System at a glance](#system-at-a-glance)
- [Design goals and boundaries](#design-goals-and-boundaries)
- [Repository map](#repository-map)
- [Runtime topology](#runtime-topology)
- [State ownership and consistency](#state-ownership-and-consistency)
- [Frontend architecture](#frontend-architecture)
- [API architecture](#api-architecture)
- [Identity, credentials, and authorization](#identity-credentials-and-authorization)
- [Data model and storage](#data-model-and-storage)
- [Realtime architecture](#realtime-architecture)
- [WebRTC media and file transfer](#webrtc-media-and-file-transfer)
- [Critical request and event flows](#critical-request-and-event-flows)
- [Deployment and configuration](#deployment-and-configuration)
- [Reliability and observability](#reliability-and-observability)
- [Testing and delivery](#testing-and-delivery)
- [Architectural trade-offs and current limitations](#architectural-trade-offs-and-current-limitations)
- [Further reading](#further-reading)

## System at a glance

Threadline is not a monolith split into arbitrary services. Each plane owns a different kind of state:

| Plane | Implementation | Owns | Does not own |
| --- | --- | --- | --- |
| Experience | [apps/web](apps/web) — Next.js App Router, React client components | Navigation, rendering, browser device state, WebRTC peer objects, ephemeral UI state | User sessions, authorization decisions, room history, room presence |
| Durable application | [apps/api](apps/api) — Express 5, MongoDB repository | Identity, sessions, organizations, membership, room metadata, calendar, audit data, OIDC, durable event history | WebSocket connections, WebRTC media, per-room live presence |
| Live coordination | [apps/realtime](apps/realtime) — Cloudflare Worker and one Durable Object per room | Socket membership, signaling relay, a bounded recent-event cache, retry queue for durable delivery | MongoDB access, general browser authentication, media forwarding |
| Direct peer data plane | Browser WebRTC mesh | Audio, video, screen streams, SCTP file data channels | Authorization, durable storage, signaling rendezvous |

~~~mermaid
flowchart TB
    Browser["Participant browser"]

    subgraph Web["Experience plane: apps/web"]
        UI["Next.js UI<br/>client components"]
        Mesh["PeerMesh<br/>RTCPeerConnection per remote peer"]
    end

    subgraph Durable["Durable application plane: apps/api"]
        API["Express API<br/>auth, ABAC, REST, OIDC"]
        Repo["Repository interface"]
        Mongo[("MongoDB<br/>durable records")]
    end

    subgraph Live["Live coordination plane: apps/realtime"]
        Worker["Cloudflare Worker<br/>route + DO lookup"]
        RoomDO["RoomDurableObject<br/>one deterministic instance per room"]
        DOStore[("Durable Object SQLite<br/>recent events + delivery queue")]
    end

    Peer["Another participant's browser"]
    Relay["STUN / TURN<br/>operator-provided"]

    Browser --> UI
    UI -->|"HTTPS: cookie or PAT"| API
    API --> Repo --> Mongo
    UI -->|"WebSocket: short-lived room ticket"| Worker --> RoomDO
    RoomDO <--> DOStore
    RoomDO -->|"authenticated durable-event webhook"| API
    Mesh <-->|"P2P media + data channel"| Peer
    Mesh -.->|"ICE candidate gathering;<br/>TURN only when configured"| Relay

    style Mongo fill:#123524,stroke:#52e0a2,color:#fff
    style RoomDO fill:#2b2140,stroke:#8a63ff,color:#fff
    style Mesh fill:#1c2b3a,stroke:#5ca4ff,color:#fff
~~~

The practical result is intentionally asymmetric:

- A web or API deployment may have many stateless instances.
- A room always has one logical realtime coordinator, addressed as the Durable Object ID generated from its room ID.
- Live media does not traverse the web app, API, Worker, or Durable Object.
- MongoDB is the authoritative history and authorization record; a Durable Object only keeps a bounded local cache and a delivery outbox.

## Design goals and boundaries

### Why three services

A conventional stateless Express service is a poor owner for a room's live participant map. With more than one API instance, an in-memory map would split the room across instances. Redis, sticky sessions, leader election, or a managed realtime broker could compensate, but each introduces another distributed coordination system to operate.

Durable Objects provide the primitive Threadline actually requires: a single, addressable, serialized owner for a room. The API therefore remains horizontally scalable and database-backed, while realtime state has one owner without Threadline implementing its own room-leader layer.

The WebRTC mesh makes a different trade: it eliminates a media server for small collaborative rooms, at the cost of quadratic total peer connections. That trade is deliberate and bounded; it is not an SFU replacement.

### Trust boundaries

The browser is untrusted. It may call endpoints, hold its own ticket, and send arbitrary WebSocket payloads, but it cannot grant itself a server-side capability.

~~~mermaid
flowchart LR
    B["Untrusted browser"]
    W["Next.js origin<br/>same-origin API rewrite"]
    A["API boundary"]
    D["Durable Object boundary"]
    M[("MongoDB")]

    B -->|"HttpOnly session cookie<br/>or Bearer PAT"| W
    W -->|"forwards request and credentials"| A
    B -->|"HS256 room ticket<br/>room-scoped, 120 seconds"| D
    D -->|"x-threadline-ingest shared secret"| A
    A --> M

    A --- A1["Revalidates session/PAT and ABAC<br/>for every protected action"]
    D --- D1["Verifies ticket signature and room_id<br/>before accepting a socket"]
    A --- A2["Revalidates event author ABAC<br/>after ingest-secret verification"]

    style B fill:#3a1f24,stroke:#ff7b85,color:#fff
    style D fill:#2b2140,stroke:#8a63ff,color:#fff
~~~

No trust boundary delegates enforcement to the previous one:

1. The API decides whether a session holder may read a room or join it live before issuing a ticket.
2. The Durable Object independently verifies the ticket cryptographically and verifies that its room claim matches the URL.
3. When a Durable Object asks the API to persist an event, the API validates both the ingress secret and the named event author's current room write permission.
4. Client-side button visibility is only a user-experience hint. API and Durable Object checks remain authoritative.

## Repository map

~~~text
Threadline/
├── apps/
│   ├── web/                    Next.js 16 / React 19 application
│   │   ├── app/                App Router routes, metadata, PWA routes
│   │   ├── components/         Client workspace, room, auth, and settings UI
│   │   ├── lib/api.ts          Single browser API client
│   │   └── lib/peer-mesh.ts    WebRTC perfect-negotiation mesh
│   ├── api/                    Express application
│   │   ├── src/application.ts  App factory, middleware, routes, OIDC
│   │   ├── src/policy.ts       Organization and room ABAC decisions
│   │   ├── src/repository.ts   Repository contract; memory and Mongo adapters
│   │   ├── src/domain.ts       Durable domain types and scopes
│   │   ├── src/security.ts     Hashing, tokens, JWK signing
│   │   └── src/index.ts        Environment validation and runtime boot
│   └── realtime/               Worker and RoomDurableObject
│       ├── src/index.ts        WebSocket protocol, persistence outbox
│       └── wrangler.toml       DO binding, migration, Worker vars
├── docs/                       Detailed docs, screenshots, ADRs
├── infra/
│   ├── docker/                 Local Worker development fixture
│   └── kubernetes/             Kustomize base and overlays
├── compose.yaml                Complete local four-service topology
└── .github/workflows/          Quality, image, and deployment validation
~~~

The root package is an npm workspace repository. Each app has an independent package manifest and lifecycle scripts, while the root coordinates formatting, linting, typechecking, tests, builds, Compose, and Kustomize validation.

~~~mermaid
flowchart LR
    Domain["domain.ts<br/>framework-free types"] --> Repo["repository.ts<br/>Repository contract"]
    Domain --> Policy["policy.ts<br/>ABAC functions"]
    Security["security.ts<br/>crypto and OIDC signer"] --> App["application.ts<br/>Express factory"]
    Repo --> App
    Policy --> App
    Domain --> App
    App --> Index["index.ts<br/>configured runtime entry"]
    Memory["MemoryRepository<br/>tests and no-DB local mode"] -.-> Repo
    Mongo["MongoRepository<br/>production adapter"] -.-> Repo

    style Repo fill:#1c2b3a,stroke:#5ca4ff,color:#fff
~~~

This dependency direction matters: route handlers depend on the Repository contract, not on MongoDB. That makes HTTP-level API tests run against a real Express app without starting a database and keeps the application portable across Node, Vercel, containers, and Kubernetes.

## Runtime topology

### Browser-facing topology

The normal production topology exposes two browser-facing origins:

- The web origin hosts the Next.js UI and can proxy API traffic at /api/identity/*.
- The realtime origin accepts WebSocket upgrades at /rooms/:roomId.

The browser does not need to reach the API's canonical origin directly when the same-origin rewrite is used. This keeps the HttpOnly session cookie first-party to the UI hostname. The Worker is intentionally different: its WebSocket uses a room ticket, never the browser session cookie.

~~~mermaid
sequenceDiagram
    participant B as Browser
    participant W as Web origin / Next.js
    participant A as Canonical API origin
    participant R as Cloudflare Worker
    participant D as Room Durable Object

    B->>W: HTTPS /app/rooms/:roomId
    B->>W: HTTPS /api/identity/v1/auth/me (cookie)
    W->>A: Rewrite to /v1/auth/me (cookie forwarded)
    A-->>W: Identity and organizations
    W-->>B: JSON
    B->>W: POST /api/identity/v1/rooms/:roomId/ticket (cookie)
    W->>A: Rewrite ticket request
    A-->>W: Signed room ticket
    W-->>B: Ticket
    B->>R: WSS /rooms/:roomId?ticket=...
    R->>D: idFromName(roomId).fetch(request)
    D-->>B: room.ready; then presence and room messages
~~~

### Local and portable deployment topologies

Docker Compose is a complete local topology: Next.js, Express, MongoDB, and Wrangler's local Durable Object runtime. It uses development-only secrets and a named MongoDB volume. The realtime Docker image is a local emulator, not a supported self-hosted production substitute for Durable Objects.

Kubernetes deploys the stateless web and API planes. MongoDB stays external and Cloudflare remains the production owner of Durable Objects. Both web and API deployments have probes, non-root security contexts, read-only filesystems with a writable /tmp volume, pod disruption budgets, soft topology spreading, and CPU-based HPA definitions.

~~~mermaid
flowchart TB
    subgraph Compose["Docker Compose: local"]
        CWeb["web :3000"]
        CApi["api :4000"]
        CDO["realtime :8787<br/>Wrangler local"]
        CMongo[("mongo<br/>named volume")]
    end
    subgraph Production["Production: logical shape"]
        PWeb["Web instances"]
        PApi["API instances"]
        PDO["Cloudflare Durable Objects"]
        PMongo[("Managed MongoDB")]
    end

    CWeb --> CApi --> CMongo
    CWeb --> CDO
    CDO --> CApi
    PWeb --> PApi --> PMongo
    PWeb --> PDO
    PDO --> PApi

    style CDO fill:#2b2140,stroke:#8a63ff,color:#fff
    style PDO fill:#2b2140,stroke:#8a63ff,color:#fff
    style CMongo fill:#123524,stroke:#52e0a2,color:#fff
    style PMongo fill:#123524,stroke:#52e0a2,color:#fff
~~~

## State ownership and consistency

Threadline keeps several kinds of state, each with an explicit owner and recovery behavior.

| State | Authoritative owner | Lifetime | Recovery / consistency model |
| --- | --- | --- | --- |
| Browser UI selections, canvas pixels, local device streams | Browser tab | Tab/session | Lost on refresh unless reflected in a persisted event |
| Session, membership, room metadata, calendar, tokens, audit | MongoDB via API | Durable | Repository is authoritative |
| Current room participants | One RoomDurableObject | While sockets exist | Rebuilt from hibernatable WebSocket attachments after object wake-up |
| Recent live room events | Durable Object SQLite key recent_events | Bounded to latest 250 | Sent as latest 100 in room.ready; convenience cache, not system history |
| Pending durable-event deliveries | Durable Object SQLite keys prefixed delivery: | Until accepted by API | Retried by a 30-second Durable Object alarm |
| Durable room event timeline | MongoDB via API | Durable | API event listing and organization activity read this history |
| A/V, screen media, files | Browser peer mesh | Connection/session | Direct transfer; deliberately not stored by Threadline |

~~~mermaid
stateDiagram-v2
    [*] --> LiveOnly: browser sends room event
    LiveOnly --> Broadcast: Durable Object broadcasts now
    Broadcast --> Cached: append to recent_events (latest 250)
    Cached --> Queued: create delivery:<uuid> if webhook + secret configured
    Queued --> Delivered: API returns success; delete queue item
    Queued --> RetryAlarm: network or non-2xx failure
    RetryAlarm --> Queued: Durable Object alarm after 30 seconds
    Delivered --> DurableHistory: API passes actor ABAC and writes Mongo RoomEvent

    Broadcast --> Ephemeral: cursor, signal, whiteboard
    Ephemeral --> [*]: no cache or Mongo history for cursor and signal;<br/>whiteboard is broadcast but intentionally not durably recorded
~~~

The delivery outbox protects against transient failures without delaying room broadcast. Its implementation is best-effort at-least-once rather than exactly-once: a delivery is deleted only after a successful response, and there is no event idempotency key shared with MongoDB. A timeout after the API persists an event can therefore result in a duplicate retry. Consumers should not assume durable room events are de-duplicated by the persistence path.

## Frontend architecture

### Route and session gate

The root layout provides global fonts, theme synchronization, the PWA service-worker registration, metadata, and a skip link. Public pages include landing, registration, login, and account-recovery flows. All /app/* pages are wrapped by [WorkspaceGate](apps/web/components/workspace-gate.tsx).

~~~mermaid
flowchart TD
    Route["Navigate to /app/*"] --> Gate["WorkspaceGate<br/>GET /v1/auth/me"]
    Gate --> Result{"Response"}
    Result -->|"401"| Login["Redirect to /login<br/>with returnTo"]
    Result -->|"authenticated; 0 organizations"| Onboard["Redirect to /onboarding<br/>with returnTo"]
    Result -->|"authenticated; organization exists"| Workspace["Render requested workspace page"]
    Result -->|"other failure"| Error["Show reachable-error state"]
~~~

The gate is intentionally client-side. It is a navigation and loading control, not an authorization boundary. Every API request remains independently authenticated and authorized.

### App shell and organization selection

Most workspace surfaces compose [AppShell](apps/web/components/app-shell.tsx), a sidebar, a topbar, and a feature component. Organization-sensitive routes use an org query convention, allowing a selected workspace to be preserved in links. The current UI requests identity in more than one component instead of using a shared cache; that is a performance simplification, not a second identity model.

### Browser API client

[lib/api.ts](apps/web/lib/api.ts) provides apiFetch:

- It builds URLs from NEXT_PUBLIC_API_ORIGIN.
- It always sends credentials: include so the first-party session cookie accompanies browser requests.
- It adds JSON content type when there is a body.
- It converts non-2xx responses into ApiError with the API message and status.

NEXT_PUBLIC_* values are substituted during the Next.js build. A successful web process and a 200 response from / do not prove that browser API or realtime configuration was present when the image was built.

### Room workspace

[RoomWorkspace](apps/web/components/room-workspace.tsx) merges an initial durable snapshot with a realtime stream:

1. On page load it concurrently fetches identity, the room, and persisted room events.
2. Joining calls the API for a fresh room ticket, then opens the WebSocket.
3. room.ready provides current participants and the Durable Object's bounded recent cache.
4. Live editor, chat, timeline, whiteboard, and presence events update the mounted UI.
5. Closing the active socket triggers capped exponential reconnection: 1s, 2s, 4s, and so on up to 15s. Each retry requests a new ticket.

The whiteboard canvas stays mounted even while its tab is hidden. Incoming strokes are applied imperatively to the canvas with no separate stroke log; unmounting it off-tab would permanently lose remote strokes.

## API architecture

### Application construction and middleware

The API entry point validates runtime configuration, selects a Mongo or in-memory repository, creates an OIDC signer, and injects those dependencies into createApp. The default export supports Vercel's handler model; ordinary Node, Docker, and Kubernetes launch the listener themselves.

~~~mermaid
flowchart LR
    Env["Environment"] --> Validate["index.ts<br/>validate origins, secrets, JWK, port"]
    Validate --> Choose{"MONGODB_URI?"}
    Choose -->|"yes"| MongoRepo["MongoRepository.connect()<br/>indexes and OIDC client seed"]
    Choose -->|"no, non-production"| MemoryRepo["MemoryRepository"]
    MongoRepo --> Signer["OidcSigner"]
    MemoryRepo --> Signer
    Signer --> Factory["createApp(options)"]
    Factory --> Express["Express application<br/>export default / HTTP listener"]
~~~

The middleware order in [application.ts](apps/api/src/application.ts) is architectural:

1. Helmet applies baseline response protection while allowing cross-origin resources required by the API documentation pages.
2. CORS accepts the configured web origin plus explicitly configured additional origins and allows credentials.
3. Pino HTTP logs requests while redacting Authorization, Cookie, and Set-Cookie fields.
4. The body limit is 1 MB for JSON and URL-encoded data.
5. Mongo-backed fixed-window rate limits protect registration, login, password-reset requests, email-verification requests, and invite-code joins.
6. Unsafe requests that use the browser session cookie must have an allowed Origin, providing a CSRF boundary.
7. Routes parse input with Zod; unexpected failures are reported to Sentry when configured and return a generic 500 response.

### API surfaces

| Surface | Authentication accepted | Main responsibility |
| --- | --- | --- |
| Browser account and session endpoints | Session cookie where needed | Register, login, logout, session listing/revocation, password changes, recovery, email verification |
| Workspace and room REST endpoints | Session or PAT where a resource scope is required | Organizations, invite codes, memberships, rooms, calendar, room-event history, activity |
| Personal access token management | Session only | Create, list, and revoke scoped automation tokens |
| Internal ingest | Ingest shared secret plus event-author ABAC | Persist room events emitted by Durable Objects |
| First-party OIDC provider | Session for authorization; OIDC token as applicable | Discovery, JWKS, Authorization Code plus PKCE, refresh rotation, revoke, introspect, userinfo |
| Documentation and health | Anonymous | Swagger UI, ReDoc, OpenAPI JSON, /health |

The API publishes OpenAPI 3.1 at /openapi.json and serves browser documentation at /api-docs and /api-docs/redoc. API-documentation HTML uses a deliberately narrow separate CSP.

## Identity, credentials, and authorization

### Credential inventory

~~~mermaid
flowchart TB
    Browser["Browser or automation"]
    Session["threadline_session<br/>opaque cookie"]
    PAT["tl_pat_*<br/>opaque Bearer token"]
    Ticket["HS256 room ticket<br/>JWT, 2 minutes"]
    OidcCode["OAuth authorization code<br/>opaque, 5 minutes"]
    Refresh["OIDC refresh token<br/>opaque, 30 days"]
    Access["OIDC access / ID token<br/>RS256 JWT, 15 minutes"]

    Browser --> Session --> API["API"]
    Browser --> PAT --> API
    API --> Ticket --> DO["Room Durable Object"]
    API --> OidcCode
    OidcCode --> API
    API --> Refresh
    Refresh --> API
    API --> Access

    style Ticket fill:#2b2140,stroke:#8a63ff,color:#fff
    style Access fill:#1c2b3a,stroke:#5ca4ff,color:#fff
~~~

| Credential | Server storage / verification | Scope and expiry |
| --- | --- | --- |
| Browser session | Random token is SHA-256 hashed in Session; raw value is HttpOnly, SameSite=Lax cookie | 30-day expiry; last-used timestamp is updated on authenticated use; individually revocable |
| PAT | SHA-256 hash, prefix, scopes, optional expiry, revocation state | Bearer token beginning tl_pat_; only scope-eligible endpoints accept it |
| Room ticket | API signs HS256 with ROOM_TICKET_SECRET; Durable Object verifies same secret | One user, one room_id, one effective room role; expires in 120 seconds |
| OIDC authorization code | Hash persisted once and consumed with find-and-delete semantics | PKCE S256 bound, client and redirect bound; expires in 5 minutes |
| OIDC refresh token | Hash persisted and consumed on every refresh | Single-use rotation; new token gets a new 30-day expiry |
| OIDC JWTs | OidcSigner signs RS256; public key served through JWKS | Access and ID tokens expire in 15 minutes |
| Account-action token | SHA-256 hash persisted and consumed once | Password-reset or email-verification type; expires in 1 hour |

Passwords are stored separately as Argon2id hashes with explicit memory, time, and parallelism parameters. The raw password hash is never included in a public user response. Personal access token secrets, raw session values, and raw action values are similarly never stored as plaintext.

### Authorization model

Threadline uses ABAC rather than an ID-based rule. A decision considers organization membership, organization role, explicit delegated attributes, room visibility and classification, plus optional room-specific membership.

~~~mermaid
flowchart TD
    Request["Caller requests room action"] --> OrgMember{"Organization<br/>membership exists?"}
    OrgMember -- no --> Deny["Deny"]
    OrgMember -- yes --> Explicit{"Explicit room<br/>membership?"}
    Explicit -- yes --> RoomRole["Use explicit owner / host / member / viewer role"]
    Explicit -- no --> OrgAdmin{"Org owner or admin?"}
    OrgAdmin -- yes --> Host["Effective role: host"]
    OrgAdmin -- no --> Visible{"visibility is organization<br/>and classification is not confidential?"}
    Visible -- yes --> Member["Effective role: member"]
    Visible -- no --> Deny
    RoomRole --> Action["Evaluate action"]
    Host --> Action
    Member --> Action
    Action --> Read["read / join_live: any effective role"]
    Action --> Write["write: any role except viewer"]
    Action --> Manage["manage: org owner/admin, delegated canManageMembers,<br/>or explicit room owner"]
~~~

Organization action rules are complementary:

| Action | Granted to |
| --- | --- |
| Read organization | Any organization member |
| Create room | Owner, admin, or member with canCreateRooms |
| Manage organization members | Owner, admin, or member with canManageMembers |
| Schedule calendar events | Owner, admin, or member with canSchedule |
| View or regenerate invite code | Owner/admin, or a member only when allowMemberInvites is enabled |

The API re-runs these rules for each protected route. PAT scopes limit which API surface can be used, then ABAC still decides whether the associated user may act on the specific organization or room.

## Data model and storage

### Logical model

MongoDB collections mirror the domain types in [domain.ts](apps/api/src/domain.ts). The central tenant relationship is User → Membership → Organization, with Room and CalendarEvent belonging to an organization.

~~~mermaid
erDiagram
    USER ||--|| CREDENTIAL : has
    USER ||--o{ SESSION : opens
    USER ||--o{ PERSONAL_ACCESS_TOKEN : creates
    USER ||--o{ MEMBERSHIP : holds
    ORGANIZATION ||--o{ MEMBERSHIP : contains
    ORGANIZATION ||--o{ ROOM : owns
    ROOM ||--o{ ROOM_MEMBERSHIP : grants
    USER ||--o{ ROOM_MEMBERSHIP : receives
    ORGANIZATION ||--o{ CALENDAR_EVENT : schedules
    ROOM o|--o{ CALENDAR_EVENT : links
    ROOM ||--o{ ROOM_EVENT : records
    USER o|--o{ ROOM_EVENT : acts_in
    USER o|--o{ AUDIT_LOG : acts_in
    USER ||--o{ AUTHORIZATION_CODE : authorizes
    OAUTH_CLIENT ||--o{ AUTHORIZATION_CODE : receives
    USER ||--o{ REFRESH_TOKEN : owns
    OAUTH_CLIENT ||--o{ REFRESH_TOKEN : issues
    USER ||--o{ ACCOUNT_ACTION_TOKEN : redeems

    USER {
        string id
        string email
        string username
        string displayName
    }
    ORGANIZATION {
        string id
        string name
        string slug
        string joinCode
        boolean allowMemberInvites
    }
    MEMBERSHIP {
        string orgId
        string userId
        string role
        object attributes
    }
    ROOM {
        string id
        string orgId
        string visibility
        string classification
    }
    ROOM_MEMBERSHIP {
        string roomId
        string userId
        string role
    }
    ROOM_EVENT {
        string roomId
        string type
        object payload
        string actorId
        date createdAt
    }
~~~

### Collection responsibilities

| Collection / type | Important behavior |
| --- | --- |
| users and credentials | User identity and separately stored password / verification state |
| sessions | Opaque browser session record with token hash, user agent, hashed IP, expiry, last use, revocation |
| orgs and memberships | Top-level tenant, self-service join code, base role, explicit delegated attributes |
| rooms and room_members | Room metadata plus explicit room role; confidentiality and restriction require this relationship for ordinary members |
| calendar_events | Organization events, optionally room-linked; visibility is filtered through room read access |
| room_events | Durable timeline; room creation writes directly, all live events arrive through internal ingest |
| personal_access_tokens | Hash only, display prefix, selected scopes, expiry/revocation/last-use |
| oauth_clients, auth_codes, refresh_tokens | First-party OIDC client configuration, PKCE authorization code exchange, rotate-on-use refresh lifecycle |
| account_action_tokens | Single-use reset and verification actions; TTL indexed |
| audit_logs | Sensitive mutations with actor, action, target, optional safe metadata; no read endpoint yet |
| rate_limits | Atomic route-plus-hashed-IP bucket; TTL indexed cleanup |

MongoRepository creates unique indexes for email, session hash, PAT hash, authorization-code hash, account-action-token hash, organization join code, organization membership, and room membership. It creates TTL indexes for account-action expiration and rate-limit bucket reset; it also indexes room-events by room and time and calendar events by organization and start time.

The repository seed updates the first-party threadline-web OIDC client's redirect URI on each boot, rather than only on first insertion. This avoids stranding the fixed client on a previous WEB_ORIGIN after a deployment move.

## Realtime architecture

### Routing and object lifecycle

The Worker exposes only:

- GET /health, which identifies the deployed realtime service.
- /rooms/:roomId, which resolves a deterministic Durable Object ID from roomId and forwards the request.

The RoomDurableObject accepts a normal HTTP request with a valid ticket and returns a JSON snapshot, or accepts a WebSocket upgrade. It stores room_id and recent_events in its SQLite-backed Durable Object storage. Hibernatable WebSocket attachments preserve participant identity while an object is evicted; on wake-up, the object rebuilds its presence map by reading open sockets and their attachments.

~~~mermaid
stateDiagram-v2
    [*] --> Constructed: route reaches idFromName(roomId)
    Constructed --> Restoring: blockConcurrencyWhile
    Restoring --> Ready: load room_id, recent_events;<br/>rebuild participants from socket attachments
    Ready --> SocketAccepted: verified ticket + WebSocket upgrade
    SocketAccepted --> Broadcasting: room.ready, presence, participant.joined
    Broadcasting --> Ready
    Ready --> Message: hibernatable socket message
    Message --> Ready: validate, broadcast, optionally record
    Ready --> Closing: socket close or error
    Closing --> Ready: rebuild excluding closing socket;<br/>broadcast presence; record participant.left
    Ready --> Alarm: queued deliveries remain
    Alarm --> Ready: retry every queued delivery
~~~

Presence is represented by per-socket attachment data but keyed in the in-memory participant map by user ID. The service broadcasts a full presence list after join, leave, and screen-share state changes. It excludes the closing socket during rebuild because platform socket enumeration may still temporarily include a socket whose close handler is already running.

### WebSocket protocol

All client messages must be valid JSON strings no larger than 64 KB. Unknown message types are ignored. Malformed JSON, binary input, or oversized messages close the socket with a policy/protocol error.

| Client type | Routing / persistence behavior | Viewer permission |
| --- | --- | --- |
| heartbeat | Direct response with server timestamp | Allowed |
| signal | Forward only to the requested user ID | Allowed |
| cursor | Broadcast, not stored | Allowed |
| chat | Broadcast and deliver to durable history | Rejected |
| editor | Broadcast and deliver to durable history | Rejected |
| whiteboard | Broadcast only, intentionally not stored | Rejected |
| screen-share | Updates participant state, broadcasts message and new presence, persists | Rejected |
| timeline | Broadcast and persists; reserved by current web UI | Rejected |

Server messages include:

| Server type | Meaning |
| --- | --- |
| room.ready | Initial participant identity, complete current participant list, and most recent cached events |
| presence | Full participant list after a membership or screen-share change |
| signal | A relayed WebRTC offer, answer, or ICE candidate with server-stamped sender |
| chat, editor, whiteboard, screen-share, timeline | Relayed client event with server-stamped sender and timestamp |
| heartbeat | Reply for the matching client heartbeat |

The Durable Object does not validate event payload schemas beyond message shape, size, type, and viewer write restrictions. This is appropriate for a transport coordinator but means UI and future protocol consumers must treat event payloads as untrusted data.

### Durable event hand-off

~~~mermaid
sequenceDiagram
    autonumber
    participant C as Connected client
    participant D as Room Durable Object
    participant S as DO SQLite
    participant A as API internal ingest
    participant M as MongoDB

    C->>D: chat / editor / screen-share / timeline
    D->>D: role and message validation
    D-->>C: broadcast immediately to every connected socket
    D->>S: save bounded recent_events
    D->>S: save delivery:<uuid>
    D->>A: POST internal/room-events + x-threadline-ingest
    A->>A: verify shared secret, reload actor room access, ABAC write check
    A->>M: insert RoomEvent
    A-->>D: 202 Accepted
    D->>S: delete delivery:<uuid>

    alt webhook failure or non-2xx
        D->>S: retain delivery
        D->>D: schedule alarm for 30 seconds
        D->>A: retry queued delivery later
    end
~~~

For local-only ephemeral messages:

- signal carries SDP and ICE negotiation material, never media.
- cursor is live UI state only.
- whiteboard strokes are intentionally not sent to MongoDB because they are high-frequency; the web client keeps the canvas mounted to preserve live remote strokes.

When PERSISTENCE_WEBHOOK or PERSISTENCE_SECRET is missing, the Durable Object still supports live rooms but does not enqueue delivery to the API. That produces a working room with incomplete durable history, so health endpoints alone cannot validate the feature end-to-end.

## WebRTC media and file transfer

### Mesh shape

Each [PeerMesh](apps/web/lib/peer-mesh.ts) owns one RTCPeerConnection per remote user and one file data channel per peer. The Durable Object relays only the negotiation messages used to establish connections.

~~~mermaid
graph LR
    subgraph Room["Three-person room"]
        A["Browser A"]
        B["Browser B"]
        C["Browser C"]
    end
    DO["Room Durable Object<br/>signaling only"]
    TURN["TURN relay<br/>not currently wired into app configuration"]

    A <-->|"audio/video/screenshare<br/>file data channel"| B
    A <-->|"audio/video/screenshare<br/>file data channel"| C
    B <-->|"audio/video/screenshare<br/>file data channel"| C
    A -. "offer, answer, ICE" .-> DO
    B -. "offer, answer, ICE" .-> DO
    C -. "offer, answer, ICE" .-> DO
    A -. "fallback path when configured" .-> TURN
    B -. "fallback path when configured" .-> TURN
    C -. "fallback path when configured" .-> TURN

    style DO fill:#2b2140,stroke:#8a63ff,color:#fff
~~~

### Negotiation

PeerMesh implements the WebRTC perfect-negotiation shape:

- A stable lexical user-ID comparison decides which peer is polite during signaling glare.
- The peer with the lower user ID creates the initial data channel; negotiationneeded sends the offer.
- An incoming offer lazily creates the peer connection when necessary, applies the remote description, and produces an answer.
- ICE candidates are relayed by signal messages.
- Every track or data-channel change triggers negotiationneeded, including a device stream granted after the initial peer connection exists.

Existing clients receive only a presence broadcast when someone joins; the joining client receives room.ready. The UI therefore attempts peer connection from both room.ready and presence, using a known-peer set to avoid duplicate initiations. This closes the join-order bug where neither browser offered for a pair.

~~~mermaid
sequenceDiagram
    participant A as Browser A, lower user ID
    participant D as Room Durable Object
    participant B as Browser B

    Note over A,B: A learns B from room.ready or B learns A from presence
    A->>A: connect(B, initiator=true); create data channel
    A->>D: signal offer for B
    D->>B: signal from A
    B->>B: ensure peer; set remote offer; create answer
    B->>D: signal answer for A
    D->>A: signal from B
    A->>A: set remote answer
    par ICE exchange
        A->>D: candidate for B
        D->>B: candidate
    and
        B->>D: candidate for A
        D->>A: candidate
    end
    Note over A,B: DTLS + SCTP complete; media and files flow P2P
~~~

### Media lifecycle

Camera and microphone are obtained only when the participant chooses to join with camera or turns video on. PeerMesh applies local streams by audio/video sender slot, allowing a camera track to be replaced by a screen track or cleared with replaceTrack(null).

~~~mermaid
stateDiagram-v2
    [*] --> NoLocalMedia
    NoLocalMedia --> CameraAndMic: getUserMedia accepted
    CameraAndMic --> SharingScreen: getDisplayMedia;<br/>publish screen video + existing mic track
    SharingScreen --> CameraAndMic: user stops share or video track ends;<br/>restore camera stream
    SharingScreen --> NoLocalMedia: no camera stream to restore
    CameraAndMic --> NoLocalMedia: leave room; stop tracks and close mesh
~~~

File transfer uses each open data channel:

1. Send a JSON file-header message.
2. Send 16 KiB binary chunks to every open peer channel.
3. Send a JSON file-end message.
4. Reassemble a File from received chunks in each browser.

Files are encrypted through WebRTC transport and are not stored by Threadline. There is currently no transfer acknowledgement, progress reporting, or persisted file catalog.

## Critical request and event flows

### Open a room

~~~mermaid
sequenceDiagram
    autonumber
    participant B as Browser / RoomWorkspace
    participant A as API
    participant M as MongoDB
    participant D as Room Durable Object

    par Initial durable page data
        B->>A: GET auth/me (session)
        A->>M: session and user lookup
        A-->>B: user and organizations
    and
        B->>A: GET rooms/:id and GET rooms/:id/events
        A->>M: room, org membership, room membership, history
        A-->>B: room, role, durable events
    end
    B->>A: POST rooms/:id/ticket (session only)
    A->>M: reload room access and effective role
    A->>A: sign HS256 ticket with room_id, sub, username, role, 2m exp
    A-->>B: ticket
    B->>D: WebSocket upgrade with ticket in URL query
    D->>D: verify HS256 signature and matching room_id
    D->>D: accept hibernatable socket, attach participant
    D-->>B: room.ready with participants and cached events
    D-->>B: presence broadcast
    D->>D: queue participant.joined for durable hand-off
~~~

### Authenticate an API request

~~~mermaid
flowchart TD
    R["Protected API route"] --> Cookie{"threadline_session cookie?"}
    Cookie -- yes --> Session["SHA-256 hash lookup<br/>not expired or revoked"]
    Cookie -- no or invalid --> Bearer{"Bearer token starts tl_pat_?"}
    Session --> User["Load user; update session lastUsedAt"]
    Bearer -- yes --> Pat["SHA-256 hash lookup<br/>not expired or revoked"]
    Bearer -- no --> Reject["401 unauthorized"]
    Pat --> PatUser["Load user; update token lastUsedAt"]
    User --> Scope{"Route requires scope?"}
    PatUser --> Scope
    Scope -- "PAT lacks scope/admin:*" --> ScopeReject["403 insufficient_scope"]
    Scope --> ABAC["Load resource relationships;<br/>evaluate ABAC"]
    ABAC --> Decision{"Allowed?"}
    Decision -- yes --> Handler["Execute route handler"]
    Decision -- no --> Forbidden["403 forbidden"]
~~~

Cookie-only endpoints such as session management and PAT creation never accept a PAT, even if the PAT declares administrative scope. That prevents an automation token from creating more automation credentials or managing a browser-session inventory.

### OIDC Authorization Code with PKCE

~~~mermaid
sequenceDiagram
    participant C as First-party client
    participant B as Browser
    participant A as Threadline OIDC provider
    participant M as MongoDB

    C->>B: Redirect to /oauth/authorize with S256 challenge, state, nonce
    B->>A: GET authorize
    alt no browser session
        A-->>B: Redirect to web login with returnTo
    else session exists
        A->>M: validate first-party client, exact redirect, allowed scopes
        A->>M: save hashed one-time authorization code
        A-->>B: Redirect with raw code and state
        B-->>C: callback
        C->>A: POST token with raw code and verifier
        A->>M: atomically consume hash; verify PKCE/client/redirect/expiry
        A->>M: save hashed refresh token
        A-->>C: RS256 access token, ID token, refresh token
    end
~~~

## Deployment and configuration

### Configuration ownership

| Value | Read by | Set when | Purpose / safety rule |
| --- | --- | --- | --- |
| NEXT_PUBLIC_API_ORIGIN | Browser bundle | Web build | Browser-visible API base; usually /api/identity |
| NEXT_PUBLIC_REALTIME_ORIGIN | Browser bundle | Web build | Browser-visible Worker HTTP(S) origin, converted to ws(s) by UI |
| THREADLINE_API_ORIGIN | Next.js server | Web build | Server-only rewrite target; never expose to browser |
| MONGODB_URI | API runtime | Runtime | Durable store connection; required in production |
| WEB_ORIGIN | API runtime | Runtime | Allowed browser origin and redirect target; bare origin |
| OIDC_ISSUER | API runtime | Runtime | API's own canonical bare origin; appears in JWT issuer claims |
| OIDC_PRIVATE_JWK | API runtime | Runtime | Stable RSA private JWK; changing it invalidates previously signed JWT verification |
| ROOM_TICKET_SECRET | API runtime and Worker secret | Runtime / Worker secret | Must be exactly identical; API signs and Durable Object verifies room tickets |
| INTERNAL_INGEST_SECRET / PERSISTENCE_SECRET | API runtime and Worker secret | Runtime / Worker secret | Same secret under different names; authenticates durable event hand-off |
| PERSISTENCE_WEBHOOK | Worker variable | Worker deploy | Public API internal-ingest URL |
| AUTH_DELIVERY_WEBHOOK and AUTH_DELIVERY_SECRET | API runtime | Runtime | Optional outbound password-reset/email-verification delivery integration |
| SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN | API runtime / web build | Respective lifecycle | Optional monitoring; SDKs remain inert without DSNs |

~~~mermaid
flowchart LR
    API["API runtime"]
    Worker["Worker deployment"]
    WebBuild["Web build"]

    Ticket["ROOM_TICKET_SECRET"] --- API
    Ticket --- Worker
    Ingest["INTERNAL_INGEST_SECRET<br/>PERSISTENCE_SECRET"] --- API
    Ingest --- Worker
    Hook["PERSISTENCE_WEBHOOK"] --> Worker
    Public["NEXT_PUBLIC_API_ORIGIN<br/>NEXT_PUBLIC_REALTIME_ORIGIN"] --> WebBuild
    Rewrite["THREADLINE_API_ORIGIN"] --> WebBuild

    style Ticket fill:#3a1f24,stroke:#ff7b85,color:#fff
    style Ingest fill:#3a1f24,stroke:#ff7b85,color:#fff
~~~

Two cross-platform secret pairs cannot be checked at deployment time by this codebase. A service can report healthy while tickets are rejected or event history is silently absent. Deployment must test the seam, not merely each /health endpoint.

The supplied Kubernetes ConfigMaps contain placeholder OIDC_ISSUER values with an /api/identity path. Before applying them, replace that value with the API's bare public origin, for example https://api.example.com. API boot validation rejects issuer values containing a path; the rewrite path is browser routing, not the OIDC issuer identity.

### Production boot checks

For a non-preview production API boot:

- MONGODB_URI and OIDC_PRIVATE_JWK are mandatory.
- ROOM_TICKET_SECRET and INTERNAL_INGEST_SECRET must be present and at least 32 characters.
- WEB_ORIGIN and OIDC_ISSUER must be HTTPS bare origins, without paths.
- Additional origins must be HTTPS, except loopback HTTP for a deliberate hybrid-development exception.
- If an account-action delivery webhook is configured, its delivery secret is required.

The in-memory repository and automatically generated signing key are allowed only outside production. This ensures a production restart cannot silently discard state or change its signing key.

## Reliability and observability

### What health checks prove

| Endpoint / check | Proves | Does not prove |
| --- | --- | --- |
| API GET /health | Process booted and passed startup validation | Cross-plane secrets match; a real room can be joined |
| Worker GET /health | Worker is deployed and routable | Ticket verification works; persistence webhook works |
| Web GET / | Web build serves | Public environment variables were embedded correctly |
| End-to-end room smoke test | Auth, API rewrite, ticket, Worker, and socket behavior agree | Media can traverse every customer network; event retry duplicates are absent |
| Fetch durable events after a live message | Event ingest reached API and passed author ABAC | Exactly-once delivery |

~~~mermaid
flowchart TD
    H["Check /health on API, Worker, and web"] --> All{"All healthy?"}
    All -- no --> Plane["Investigate the failed plane"]
    All -- yes --> Flow["Register diagnostic user; create room;<br/>connect two browser contexts; send chat"]
    Flow --> Socket{"WebSocket and broadcast work?"}
    Socket -- no --> Seam1["Check web build config, WEB_ORIGIN,<br/>and ROOM_TICKET_SECRET pair"]
    Socket -- yes --> History["Fetch room events from fresh API request"]
    History --> Durable{"Chat exists in durable history?"}
    Durable -- no --> Seam2["Check PERSISTENCE_WEBHOOK and<br/>ingest-secret pair"]
    Durable -- yes --> Healthy["Cross-plane room flow is healthy"]
~~~

The API initializes Sentry before other app modules. Unexpected route failures are captured, while expected Zod input failures return a 422 response without being reported as application errors. Pino logs redact credentials. The Worker writes delivery failures to console and retries on a Durable Object alarm.

### Failure behavior

| Failure | User-visible behavior | Retained state / recovery |
| --- | --- | --- |
| API is unavailable before join | Workspace / room load shows error; ticket cannot be minted | No new live entry; retry browser request after API recovery |
| Worker unavailable | Room connect error followed by client reconnect attempts | Existing durable data remains in MongoDB |
| Ticket secret mismatch | WebSocket rejected as invalid ticket | Reconfigure matching API/Worker secret; mint a new ticket |
| API ingest unavailable | Current users continue to see live broadcasts | DO retains delivery records and retries every 30 seconds |
| Ingest secret mismatch | Live room works but every durable delivery is rejected and retried | Correct matching secret; queued deliveries retry |
| Durable Object hibernates | No intended user-visible interruption | Rebuild participant map from socket attachments and reload cached events |
| Direct peer path fails | Live media/files may not connect despite room presence and chat | Configure TURN and pass ICE servers into PeerMesh |

## Testing and delivery

The automated suite intentionally favors behaviors at service boundaries:

| Area | Coverage |
| --- | --- |
| API | Vitest plus Supertest integration tests against createApp and MemoryRepository; includes auth, room access, rate limits, events, and OIDC behavior |
| Realtime | Vitest through Cloudflare's Worker test pool, exercising the Worker/DO runtime model |
| Quality | Prettier, ESLint, TypeScript across workspaces |
| Build | All workspace builds; web is a standalone Next.js output |
| Deployment inputs | Docker Compose build/config and Kustomize rendering for development and production overlays |

~~~mermaid
flowchart LR
    Commit["Push or pull request"] --> Preflight["npm ci / workspace discovery"]
    Preflight --> Static["Format and lint"]
    Preflight --> Types["Typecheck"]
    Static --> Tests["API and Worker tests"]
    Types --> Tests
    Tests --> Build["Workspace builds"]
    Build --> Containers["Docker Compose validation and image builds"]
    Build --> K8s["Kustomize overlay validation"]
    Containers --> Publish["Main/manual: publish web, API, Worker images"]
    Publish --> Scan["Informational image scan"]
~~~

The largest quality gap is browser automation. The repository has manually validated multiple isolated browser sessions, device/media behavior, and WebRTC transfer, but it does not currently run a web-component suite or multi-context Playwright end-to-end flow in CI. That is the highest-leverage path for preventing regressions in login-to-room-to-history behavior.

## Architectural trade-offs and current limitations

| Decision / constraint | Consequence |
| --- | --- |
| Full WebRTC mesh, no SFU | Appropriate for small engineering rooms; per-participant bandwidth and CPU grow with every additional peer, and total connections grow quadratically |
| TURN not wired through current web configuration | The default public STUN server will not establish sessions on every symmetric-NAT or locked-down corporate network |
| Event outbox has no idempotency key | Reliable retry favors durability but can duplicate a durable event after an ambiguous successful API request |
| Whiteboard state is transient | Strokes are available live only; a refresh or new participant cannot reconstruct prior board content |
| Files are direct-transfer only | No server cost or retained files, but no durable artifact catalog, delivery confirmation, or recovery |
| Membership changes do not revoke issued room tickets | A valid ticket may continue to open its room until its short 120-second expiry; existing open sockets retain their ticket-derived role |
| Realtime authorization is ticket-derived | The Durable Object does not query MongoDB on each message; current room permissions are rechecked when durable events are ingested, not before every ephemeral relay |
| Optional account-action delivery | The API can issue reset/verification actions without a configured email service; the endpoint response remains privacy-preserving but no message is delivered |
| Audit records have no read UI | Sensitive actions are captured for future operations work but are not visible to administrators in the product |
| Defined messages/artifacts PAT scopes are unused | They can be selected on a PAT, but no current REST endpoint checks them because chat and files are live-only |

The accompanying ADRs explain why the four most consequential choices were accepted:

- [ADR-0001: one Durable Object per room](docs/decisions/0001-durable-objects-for-realtime.md)
- [ADR-0002: WebRTC mesh rather than SFU](docs/decisions/0002-webrtc-mesh-not-sfu.md)
- [ADR-0003: repository interface](docs/decisions/0003-repository-interface.md)
- [ADR-0004: three authentication surfaces](docs/decisions/0004-three-auth-surfaces.md)
- [ADR-0005: SQLite-backed hibernatable Durable Object](docs/decisions/0005-sqlite-hibernatable-durable-object.md)
- [ADR-0006: self-service workspace membership](docs/decisions/0006-self-service-workspace-membership.md)

## Further reading

- [Detailed architecture](docs/architecture.md) — fuller ER diagram and focused request sequences
- [Frontend architecture](docs/frontend.md) — route tree, UI composition, client behaviors
- [API reference](docs/api.md) — endpoints, PAT scopes, OIDC sequence
- [Realtime and RTC](docs/realtime.md) — protocol detail, hibernation edge cases, screen sharing
- [Security model](docs/security.md) — secret inventory, CSP, rate limits, credential storage
- [Deployment](docs/deployment.md) and [containers/Kubernetes](docs/containers-and-kubernetes.md) — supported runtime configurations
- [Operations](docs/operations.md) — health checks, incident history, production findings
- [Testing](docs/testing.md) — suite boundaries and manually verified flows
- [Roadmap](docs/roadmap.md) — planned work and explicit non-goals
