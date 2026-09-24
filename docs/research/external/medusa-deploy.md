# Medusa 2.21.1 production deployment (official guidance plus source checks)

Researched: 2026-09-24.

## Question

What is Medusa's current official self-hosted production setup? This covers:

- server and worker mode, and disabling the admin
- the build output and the `.medusa/server` install
- migrations and `predeploy`
- the exact Redis module configuration
- `redisUrl` (sessions), `admin.backendUrl` and `MEDUSA_BACKEND_URL`
- cookies behind a proxy
- DB pool options

## Findings

### Architecture (docs: "General Medusa Application Deployment Guide")

Deploy the following:

1. PostgreSQL.
2. Redis ("store the Medusa server's session").
3. The Medusa app **twice** from the same codebase: once in **server** mode (API and admin) and once in **worker** mode (subscribers and scheduled jobs).

The docs say a host needs "at least 2GB of RAM".

`projectConfig.workerMode` accepts `"shared"` (the default), `"worker"` or `"server"`. You can also use cluster mode (since 2.11.0): `npx medusa start --cluster 4 --servers 1 --workers 3`.

### Exact config snippets (verbatim from docs)

```ts
// medusa-config.ts — worker mode
module.exports = defineConfig({
  projectConfig: {
    // ...
    workerMode: process.env.MEDUSA_WORKER_MODE as "shared" | "worker" | "server",
  },
})
```

```ts
// disable admin in the worker
module.exports = defineConfig({
  // ...
  admin: {
    disable: process.env.DISABLE_MEDUSA_ADMIN === "true",
  },
})
```

```ts
// session store
module.exports = defineConfig({
  projectConfig: {
    // ...
    redisUrl: process.env.REDIS_URL,
  },
})
```

```jsonc
// package.json
"scripts": {
  // ...
  "predeploy": "medusa db:migrate"
},
```

```ts
// admin backend URL
module.exports = defineConfig({
  // ...
  admin: {
    // ...
    backendUrl: process.env.MEDUSA_BACKEND_URL,
  },
})
```

**Production modules.** This is the verbatim block from the deployment guide:

```ts
import { Modules } from "@medusajs/framework/utils"

module.exports = defineConfig({
  // ...
  modules: [
    {
      resolve: "@medusajs/medusa/caching",
      options: {
        providers: [
          {
            resolve: "@medusajs/caching-redis",
            id: "caching-redis",
            is_default: true,
            options: {
              redisUrl: process.env.CACHE_REDIS_URL,
            },
          },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: {
        redisUrl: process.env.REDIS_URL,
      },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: {
        redis: {
          // Note: This was `url` before v2.12.2
          // It's now deprecated in favor of `redisUrl`
          redisUrl: process.env.REDIS_URL,
        },
      },
    },
    {
      resolve: "@medusajs/medusa/locking",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/locking-redis",
            id: "locking-redis",
            is_default: true,
            options: {
              redisUrl: process.env.LOCKING_REDIS_URL,
            },
          },
        ],
      },
    },
  ],
})
```

The Redis Event Module page suggests these `jobOptions` for production:

```ts
{
  resolve: "@medusajs/medusa/event-bus-redis",
  options: {
    redisUrl: process.env.EVENTS_REDIS_URL,
    jobOptions: {
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 3600, count: 1000 },
    },
  },
},
```

**Option keys per module** (docs tables):

- **event-bus-redis:** `redisUrl` (required), `redisOptions` (ioredis), `queueName` (default `events-queue`), `queueOptions`, `workerOptions`, `jobOptions` (BullMQ).
- **workflow-engine-redis:** everything goes under `options.redis`:
  - `redisUrl` (v2.12.2+; `url` is deprecated) or `pubsub: { url, options }`
  - `queueName` (default `medusa-workflows`), `jobQueueName` (default `medusa-workflows-jobs`)
  - `redisOptions` (`options` is deprecated)
  - `queueOptions`, `workerOptions`
  - `mainQueueOptions`, `mainWorkerOptions`, `jobQueueOptions`, `jobWorkerOptions`, `cleanerQueueOptions`, `cleanerWorkerOptions`
  - The loader in 2.21.1 reads **only** `options.redis` (verified in `packages/modules/workflow-engine-redis/src/loaders/redis.ts`); see issue #16697.
- **locking-redis provider:** `redisUrl` (required), `redisOptions`, `namespace` (default `medusa_lock:`), `waitLockingTimeout` (5 s), `defaultRetryInterval` (20 ms), `maximumRetryInterval` (1000 ms), `backoffFactor` (2). The service identifier is `lp_locking-redis`.
- **caching-redis provider:** `redisUrl` (required), `ttl` (3600 s), `prefix`, `compressionThreshold` (1024 bytes), `redisOptions` (v2.18+).
  - The Caching Module page says the caching feature is behind the **`MEDUSA_FF_CACHING=true`** feature flag. Source confirms `default_val: false`, "[WIP]".
  - `@medusajs/medusa/caching-redis` is also exported by `@medusajs/medusa` (Cloud's defineConfig uses that path).
- **projectConfig session Redis:** `redisUrl`, `redisPrefix` (prepended to `sess:`), `redisOptions` (ioredis).
  - defineConfig adds a default `retryStrategy`: exponential backoff up to 4 s plus jitter.
  - Session Redis is **not** shared with the modules; each module needs its own URL (they can all point at the same Redis instance).

**For reference:** Medusa Cloud's own config, from `define-config.ts`, registers the following when `REDIS_URL` is set:

- `@medusajs/medusa/workflow-engine-redis` with `{ redis: { url } }`
- `@medusajs/medusa/cache-redis` (the deprecated `Modules.CACHE`)
- `@medusajs/medusa/event-bus-redis` with `workerOptions: { concurrency: 1 }`
- locking-redis
- the caching module with caching-redis only if `CACHE_REDIS_URL` is set

### Build and start (docs: "Build Medusa Application")

- `npx medusa build` writes `.medusa/server`, which contains:
  - `public/admin` (the admin build; publicly served)
  - `src` (compiled code)
  - `medusa-config.js`
  - `instrumentation.js`
  - `package.json` and a lockfile
- "You need to run these steps every time you run the `build` command, since the `.medusa/server` directory is recreated each time":
  1. `cd .medusa/server && npm install`
  2. Environment variables: use system env in production. Locally, `cp ../../.env .env.production`, because `NODE_ENV=production` loads `.env.production`.
  3. `export NODE_ENV=production`
  4. `npm run start`
- Only `.{ts,js,tsx,jsx}` files are compiled and copied. Copy other runtime assets with a `postbuild` script.
- `npx medusa build --admin-only` writes the admin to `.medusa/admin` for separate hosting.
- Start commands from the deploy guide:
  - Server: `cd .medusa/server && npm install && npm run predeploy && npm run start`
  - Worker: `cd .medusa/server && npm install && npm run start` (no migrations)
- Environment variables:
  - Server: `COOKIE_SECRET`, `JWT_SECRET` (required in production, otherwise startup throws), `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS` (comma-separated), `DISABLE_MEDUSA_ADMIN=false`, `MEDUSA_WORKER_MODE=server`, `PORT=9000`, `DATABASE_URL`, `REDIS_URL`, `MEDUSA_BACKEND_URL`.
  - Worker: the same secrets, `DISABLE_MEDUSA_ADMIN=true`, `MEDUSA_WORKER_MODE=worker`.
- Admin environment variables are **inlined at build time**.
- Health check: `GET <APP_URL>/health` returns `OK`. The admin is at `/app`.
- Create an admin user with `npx medusa user -e <email> -p <password>`.
- `db:migrate` also syncs links; the docs say "run migrations and sync links".

### Cookies, sessions and the proxy (source: `packages/core/framework/src/http/express-loader.ts`, 2.21.1)

```ts
export function resolveSessionCookieSecurity({ isProduction, isStaging }) {
  if (isProduction || isStaging) {
    return { sameSite: "lax", secure: true }
  }
  return { sameSite: false, secure: false }
}
// session: { name: sessionOptions?.name ?? "connect.sid", resave: true, rolling: false,
//   saveUninitialized: false, proxy: true, secret: sessionOptions?.secret ?? http?.cookieSecret,
//   cookie: { sameSite, secure, maxAge: sessionOptions?.ttl ?? 10h, ...cookieOptions } }
app.set("trust proxy", 1)
```

- Medusa already sets `trust proxy = 1` and `express-session` `proxy: true`. Behind nginx, cookies with `secure: true` work **only if nginx sends `X-Forwarded-Proto https`**.
- `trust proxy 1` trusts exactly one hop. With Cloudflare in front of nginx, the effective client IP and protocol come from the nearest hop. UNVERIFIED how this interacts with rate limiting.
- The docs table says the production default for `sameSite` is `"none"`, but **2.21.1 source returns `"lax"`**. Trust the source.
- `projectConfig.cookieOptions` (since 2.8.5) overrides these settings, for example `domain` for a shared parent domain.
- The docs warn that cookie auth in production "only works if the client application is served from the same domain as the Medusa server". Serve the admin from the API domain, which is the default `/app`.

### DB pool (docs `databaseDriverOptions`)

```ts
databaseDriverOptions: {
  connection: { ssl: false /* or { rejectUnauthorized } */ },
  pool: { min: 2, max: 10, idleTimeoutMillis: 30000, reapIntervalMillis: 1000, createRetryIntervalMillis: 200 },
  idle_in_transaction_session_timeout: 60000,
  // since 2.18: dynamicPassword, expirationChecker
}
```

**Verified in source** (`packages/core/framework/src/database/pg-connection-loader.ts`):

- `pool` is read from **`databaseDriverOptions.pool`**, a sibling of `connection`, even though the docs TypeList shows it nested under `connection`.
- The keys read are `min` (default **2** in the loader; the docs say 1), `max`, `idleTimeoutMillis`, `reapIntervalMillis` and `createRetryIntervalMillis`.
- `createPgConnection` adds `propagateCreateError: false`, `connectionTimeoutMillis` 5000, `keepAlive: true` and `keepAliveInitialDelayMillis` 10000. The last three can be overridden via `databaseDriverOptions.connection.*`.
- The knex default `max` is 10.

For a local Postgres without TLS, do not set `ssl`. For TLS with `rejectUnauthorized: false`, the docs also say to append `?ssl_mode=disable` to `DATABASE_URL`.

### Other relevant projectConfig keys

- `http.storeRelationsLimit` (default 3, since 2.20)
- `http.restrictedFields.store` (default `["order","orders"]`)
- `http.compression`
- `http.authMethodsPerActor` (the `user` default is `["emailpass"]`, applied since 2.21.1)
- `sessionOptions.{name,resave,rolling,saveUninitialized,secret,ttl}`

## Sources

- https://docs.medusajs.com/learn/deployment/general (repo: `www/apps/book/app/learn/deployment/general/page.mdx`)
- https://docs.medusajs.com/learn/production/worker-mode
- https://docs.medusajs.com/learn/build
- https://docs.medusajs.com/learn/configurations/medusa-config
- https://docs.medusajs.com/resources/infrastructure-modules/event/redis
- https://docs.medusajs.com/resources/infrastructure-modules/workflow-engine/redis
- https://docs.medusajs.com/resources/infrastructure-modules/locking/redis
- https://docs.medusajs.com/resources/infrastructure-modules/caching and `/caching/providers/redis`
- Source (medusajs/medusa at 7b3fe04, version 2.21.1):
  - `packages/core/framework/src/http/express-loader.ts`
  - `packages/core/utils/src/common/define-config.ts`
  - `packages/modules/workflow-engine-redis/src/loaders/redis.ts`
  - `packages/medusa/src/feature-flags/caching.ts`
- Issue https://github.com/medusajs/medusa/issues/16697

## Confidence

- **High:** snippets were copied from the docs sources in the repo matching 2.21.1, and the cookie logic was read from source.
- **High:** `pool` placement (verified in source; the docs TypeList is misleading).

## Implications for us

1. Two systemd services, `medusa-server` and `medusa-worker`, from the same `.medusa/server` build. Environment:
   - server: `MEDUSA_WORKER_MODE=server`, `DISABLE_MEDUSA_ADMIN=false`
   - worker: `MEDUSA_WORKER_MODE=worker`, `DISABLE_MEDUSA_ADMIN=true`
   - both: `NODE_ENV=production`
   - Run `npm run predeploy` (`medusa db:migrate`) **once** per deploy, before restarting both services.
2. A single local Redis 7 can back everything:
   - `REDIS_URL` for sessions, the event bus and the workflow engine (**nested `redis.redisUrl`**)
   - `LOCKING_REDIS_URL` for locking
   - Optionally use separate DB numbers (`/0`, `/1`, `/2`) to isolate keys.
   - Do not enable `MEDUSA_FF_CACHING` at launch.
3. nginx must send `X-Forwarded-Proto $scheme`, `X-Forwarded-For` and `Host`. Otherwise admin login fails, because secure cookies are not set over what Express sees as http.
4. Set `admin.backendUrl` to the public API URL at **build time**. It is inlined into the admin bundle.
5. With about 12 GB RAM on Always Free A1 (2 OCPU), run server, worker, Next.js, Postgres and Redis on one VM. Set `pool.max` to about 10 per process and Postgres `max_connections` to at least 50.
