# ADR-0003: A `Repository` interface with in-memory and MongoDB implementations

## Status

Accepted

## Date

2026-08-01

## Context

`apps/api` needs a database in production (users, sessions, rooms, calendar, durable room events, OIDC state) but also needs to be trivially runnable — for local development and for the test suite — without requiring a live database connection as a precondition for doing any work at all.

## Decision

Define a single `Repository` interface (`apps/api/src/repository.ts`) covering every persistence operation the API needs, and provide two implementations: `MemoryRepository` (plain in-process `Map`s) and `MongoRepository` (real MongoDB Atlas driver calls). `createApp()` takes a `Repository` as a constructor option; route handlers in `application.ts` only ever call methods on that interface, never import the MongoDB driver directly. `apps/api/src/index.ts` chooses `MongoRepository` when `MONGODB_URI` is set and falls back to `MemoryRepository` otherwise (refusing to fall back in production — see [`../security.md`](../security.md#boot-time-validation)).

```mermaid
classDiagram
    class Repository {
        <<interface>>
        +getUserByEmail(email)
        +createRoom(room, member)
        +incrementRateLimit(key, windowMs)
        +...every other persistence op
    }
    class MemoryRepository {
        -Map users
        -Map rateLimits
        +...implements Repository
    }
    class MongoRepository {
        -Collection~User~ users
        -Collection~RateLimitEntry~ rateLimits
        +...implements Repository, backed by Atlas
    }
    Repository <|.. MemoryRepository
    Repository <|.. MongoRepository
    MemoryRepository <-- "app.test.ts (supertest)"
    MongoRepository <-- "production (createApp() in index.ts)"
```

`incrementRateLimit` is a real example of the tax mentioned in Consequences below, paid in practice: adding it meant implementing it identically in both classes — an in-memory `Map` bucket in `MemoryRepository`, an atomic Mongo aggregation-pipeline `$inc` in `MongoRepository` — before either the rate limiter or its own regression test could exist. See [`../security.md`](../security.md#rate-limits) for why that method needed to exist at all.

## Alternatives Considered

### Mock the MongoDB driver in tests

- Pros: Tests would exercise the exact same `MongoRepository` code path as production.
- Cons: Mocking a real database driver is slow to set up correctly and brittle to keep in sync with driver behavior changes; still doesn't give you a genuinely simple local dev mode without standing up a database.
- Rejected: `MemoryRepository` gives both a fast, dependency-free test suite (`apps/api/src/app.test.ts` runs against it directly with `supertest`) and a fast local dev loop, for less total effort than maintaining a mock.

### Always require a database, even locally (e.g. SQLite fallback, or a bundled MongoDB binary)

- Pros: Slightly closer parity between local and production storage engines.
- Cons: Adds a real dependency (an embedded database, or a binary to download/manage) just to run `npm install && npm run dev`; still isn't the _actual_ production engine, so parity is illusory anyway.
- Rejected: `MemoryRepository`'s simplicity is worth more than that illusory parity, especially since the interface boundary already guarantees route logic can't accidentally depend on Mongo-specific behavior.

## Consequences

- Every route handler is, by construction, decoupled from the specific storage engine — the same `application.ts` code runs against Atlas in production and a `Map` in tests, with zero conditional logic for which one is active.
- New persistence operations require updating the interface _and_ both implementations in lockstep — a real but small tax, enforced by TypeScript (an implementation missing a method fails to compile).
- Local dev data doesn't survive a process restart when using `MemoryRepository` — a common point of confusion; see [`../troubleshooting.md`](../troubleshooting.md#local-data-users-rooms-sessions-disappears-after-editing-api-code).
- `MongoRepository.connect()` is also where all production indexes are created (unique email, unique refresh-token hash, a TTL index on account-action tokens, etc.) — schema/index management lives in this one file rather than a separate migration tool.
