# ADR-004: Server/worker split, and Redis for every infrastructure module

- **Status:** accepted (2026-09-24)

## Question
Which Medusa infrastructure modules and process layout do we use in production?

## Current evidence (Medusa 2.21.1)
Production requires Redis-backed modules. The in-memory defaults are for development only:
- `event-bus-redis` `{ redisUrl }`
- `workflow-engine-redis` `{ redis: { redisUrl } }`. It **must be nested**: a top-level `redisUrl` type-checks but fails at boot (#16697).
- `locking` with the `locking-redis` provider
- `projectConfig.redisUrl` for sessions

Other findings:
- Core caching (`MEDUSA_FF_CACHING`) is still a WIP flag, and invalidation has an open out-of-memory issue (#16474).
- The deprecated `cache-redis` is still needed by the auth module for OAuth/MFA across processes (#16498).
- Worker mode `MEDUSA_WORKER_MODE=server|worker` runs two processes from one build.

## Sources
- `docs/research/external/medusa-deploy.md`, `medusa-release-notes.md`
- https://docs.medusajs.com/learn/production/worker-mode
- https://docs.medusajs.com/resources/infrastructure-modules/event/redis , /workflow-engine/redis , /locking/redis , /caching
- Issues #16697, #16474, #16498, #15835

## Options
1. A single shared process with in-memory modules.
2. A single process with Redis modules.
3. Server and worker processes with Redis modules.

## Chosen
Option 3:
- Separate Redis logical DBs: 0 sessions, 1 events, 2 workflows, 3 locks, 4 cache.
- `caching-redis` registered, but the core caching flag is left **off**.
- `cache-redis` registered for auth.
- Redis runs with `maxmemory-policy noeviction` (BullMQ requires it) and AOF persistence.

## Reason
- Webhook processing, subscribers and scheduled jobs run on the worker, so request latency isn't affected.
- Redis locking makes cart completion safe across processes.
- In-memory modules lose events on restart and don't coordinate across processes.

## Tradeoffs
- Two Node processes use about 1.5–3.5 GB of RAM together, which fits in 12 GB.
- Redis becomes a hard dependency. `medusa-config.ts` refuses to start without `REDIS_URL` in production.

## Impact
`apps/backend/medusa-config.ts`, `deploy/systemd/sparky-medusa-{server,worker}.service`, `deploy/redis/sparky.conf`.

## Verification
`final-verification.sh`, section REDIS:
- the logs show event-bus-redis, workflow-engine-redis, locking-redis and the Redis cache connected
- there are no in-memory or local infrastructure modules

It passed on the staging container. Worker SIGKILL → automatic restart was verified too.
