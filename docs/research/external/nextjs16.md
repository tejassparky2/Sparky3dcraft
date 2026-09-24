# Next.js 16 (16.3.6) self-hosting and API changes

Researched: 2026-09-24.

Docs were read from the `vercel/next.js` repo at tag **v16.3.6** (commit a758ffc, 2026-09-22), `docs/01-app/**`. These are the same files served at nextjs.org/docs.

## Question

What do we need to know to self-host Next 16? This covers:

- build and start, `output: 'standalone'`
- the caching model (Cache Components, `use cache`, `cacheLife`, `cacheTag`, `revalidateTag`, `updateTag`)
- `middleware` → `proxy`
- async request APIs
- image optimization on arm64, `remotePatterns`
- the Node minimum, ESLint, and Turbopack defaults

## Findings

### Versions

- `next@16.3.6` is npm `latest`, published 2026-09-22.
- `engines.node: ">=20.9.0"`.
- Peer dependencies: `react`/`react-dom` `^18.2.0 || ^19.0.0`.
- Optional dependencies: `sharp ^0.35.4` and `@next/swc-linux-arm64-gnu` (and musl).
- Other dist-tags: canary `16.4.0-canary.43`, backport `15.5.26`.
- The upgrade guide lists these minimums:

  | Requirement | Details |
  |---|---|
  | Node.js 20.9+ | Minimum is now `20.9.0` (LTS); Node.js 18 is no longer supported |
  | TypeScript 5+ | Minimum is now `5.1.0` |
  | Browsers | Chrome 111+, Edge 111+, Firefox 111+, Safari 16.4+ |

- The **official Medusa Next.js starter is still on `next 15.3.9`**. It uses `src/middleware.ts` and `"lint": "next lint"` (raw package.json on main, 2026-09-24). Moving it to 16 is a migration.

### Build, start and Turbopack

- "Starting with Next.js 16, Turbopack is stable and used by default with `next dev` and `next build`." Scripts become just `next dev`, `next build` and `next start`.
- A custom `webpack` config makes `next build` **fail**. Your options are `--turbopack` (ignores the webpack config), migrating the config, or `next build --webpack`.
- `experimental.turbopack` moved to the top-level `turbopack` key.
- Turbopack filesystem cache is on by default for dev and build.
- `next dev` writes to `.next/dev`, and a lockfile prevents concurrent `next dev` or `next build` runs.
- `next build` no longer prints `size` or `First Load JS`, and **no longer runs lint**.

### `output: 'standalone'` (docs `output.mdx`)

```js
module.exports = { output: 'standalone' }
```

- This creates `.next/standalone` with a minimal `server.js` and the traced `node_modules`.
- "This minimal server does not copy the `public` or `.next/static` folders by default … can be copied … manually, after which `server.js` file will serve these automatically":

  ```bash
  cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/
  node .next/standalone/server.js       # PORT=8000 HOSTNAME=127.0.0.1 node server.js
  ```

- Use `outputFileTracingRoot`, `outputFileTracingIncludes` and `outputFileTracingExcludes` for monorepos or missed files.

### Self-hosting guide (`02-guides/self-hosting.mdx`)

- Put a reverse proxy such as nginx in front of the server.
- `next/image` optimization "works self-hosted with zero configuration when deploying using `next start`". On glibc Linux, see sharp's memory-allocator note (https://sharp.pixelplumbing.com/install#linux-memory-allocator).
- `NEXT_PUBLIC_*` variables are **inlined at build time**. Server variables are read at runtime on dynamic routes; use `await connection()` before reading `process.env` to force runtime evaluation.
- Cache: by default it lives in memory (50 MB) plus on disk. That is fine for **one** `next start` instance with a persistent disk. Multiple instances need `cacheHandler` or `cacheHandlers` plus `cacheMaxMemorySize: 0`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, `deploymentId`, and `refreshTags()` coordination.
- **Streaming behind nginx:** disable buffering, for example by sending the header `X-Accel-Buffering: no` via `headers()` in next.config, or with `proxy_buffering off`.
- Use `generateBuildId` or `deploymentId` for consistent build IDs across rebuilds.

### Async Request APIs (breaking)

"Starting with Next.js 16, synchronous access is fully removed":

- `cookies()`, `headers()` and `draftMode()` must be awaited.
- `params` in layout, page, route, default and the image/icon routes must be awaited.
- `searchParams` in page must be awaited.
- In `opengraph-image`, `twitter-image`, `icon` and `apple-icon`, `params` and `id` are Promises.
- The `sitemap({ id })` argument `id` is `Promise<string>`.

Codemod: `npx @next/codemod@canary next-async-request-api .`. Type helpers come from `npx next typegen`:

```tsx
export default async function Page(props: PageProps<'/blog/[slug]'>) {
  const { slug } = await props.params
  const query = await props.searchParams
}
```

### `middleware` → `proxy`

- "The `middleware` filename is deprecated, and has been renamed to `proxy`." Rename the file with `mv middleware.ts proxy.ts` and rename the export to `proxy`.
- Config flags were renamed, for example `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`. There is also `proxyClientMaxBodySize`.
- "The `edge` runtime is NOT supported in `proxy`. The `proxy` runtime is `nodejs`, and it cannot be configured." Setting `runtime` in a proxy file throws. To keep the Edge runtime, keep `middleware`.

```ts
// proxy.ts (project root or src/)
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
export function proxy(request: NextRequest) { /* ... */ return NextResponse.next() }
export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] }
```

Without a `matcher`, Proxy runs on every request, including `_next/static`, `_next/image` and `public/`.

### Caching model

**Cache Components is opt-in:** `cacheComponents: true` in next.config.

- It "enables component and function-level caching using the `use cache` directive. Data fetching is dynamic by default."
- It implements PPR, replacing `experimental.ppr`, which was removed together with `experimental.dynamicIO` and `experimental.useCache`.
- It requires the Node.js runtime.

**Without Cache Components, the "previous model" still applies:**

- "By default, `fetch` requests are not cached". Opt in with `cache: 'force-cache'`, `next: { revalidate, tags }`.
- `unstable_cache` and route segment config also still work.

**`'use cache'`:**

- Output is keyed by serialized arguments plus the build or `deploymentId`.
- It is stored in an **in-memory LRU** by default. Customize storage with `cacheHandlers`, or use `'use cache: remote'` / `'use cache: private'`.
- It **cannot** call `cookies()`, `headers()` or `searchParams`, including through nested helpers. Doing so throws the `next-request-in-use-cache` error at runtime, which can pass `next build` and then fail under `next start`.
- Arguments and return values must be serializable.

**`cacheLife`** (now stable; import `{ cacheLife, cacheTag } from 'next/cache'`, no `unstable_` prefix). Use it inside a `use cache` scope:

- `cacheLife('hours')` or `cacheLife({ stale, revalidate, expire })` (seconds).
- Presets (stale / revalidate / expire):

  | Profile | stale | revalidate | expire |
  |---|---|---|---|
  | `default` | 5 min | 15 min | never |
  | `seconds` | 30 s | 1 s | 1 min |
  | `minutes` | 5 min | 1 min | 1 h |
  | `hours` | 5 min | 1 h | 1 day |
  | `days` | 5 min | 1 day | 1 week |
  | `weeks` | 5 min | 1 week | 30 days |
  | `max` | 5 min | 30 days | 1 year |

- Custom profiles go in `next.config` under `cacheLife: { ... }`.

**`cacheTag(...tags: string[])`:** use it inside `'use cache'`. It requires `cacheComponents: true`.

**`revalidateTag`**, signature `revalidateTag(tag: string, profile: string | { expire?: number }): void`:

- Callable in Server Functions and Route Handlers, **not** in Client Components or Proxy.
- `'max'` is recommended (stale-while-revalidate). `{ expire: 0 }` means immediate expiry.
- "The single-argument form `revalidateTag(tag)` is deprecated", produces a TS error, and behaves like `{ expire: 0 }`.
- Tags are case-sensitive, at most **256 characters**.
- Tags are assigned via `fetch(url, { next: { tags: [...] } })` or `cacheTag`.

**`updateTag`**, signature `updateTag(tag: string): void`:

- Callable **only in Server Actions**, not in Route Handlers.
- Read-your-own-writes: the next request waits for fresh data.

**`refresh()`** (from `next/cache`) refreshes the client router from a Server Action.

### `next/image` changes in 16

| Setting | Change |
|---|---|
| `images.minimumCacheTTL` | Default is now **14400 s (4 h)**; it was 60 s |
| `images.imageSizes` | `16` removed |
| `images.qualities` | Default is now `[75]`; other values are coerced to the nearest allowed |
| `images.maximumRedirects` | Default is now 3 |
| `images.dangerouslyAllowLocalIP` | Must be `true` to optimize images from local or private IPs (blocked by default) |
| `images.localPatterns.search` | Required for local images with query strings |

- `images.domains` is deprecated. Use `remotePatterns`:

  ```js
  images: { remotePatterns: [new URL('https://example.com/account123/**')] }
  // or { protocol: 'https', hostname: 'example.com', port: '', pathname: '/account123/**', search: '' }
  ```

- `next/legacy/image` is deprecated.
- sharp on arm64: `sharp@0.35.x` publishes `@img/sharp-linux-arm64` and `@img/sharp-libvips-linux-arm64` prebuilt binaries (npm registry). No compile step is needed on Ampere with glibc (Ubuntu).

### ESLint

- "The `next lint` command has been removed. Use Biome or ESLint directly. `next build` no longer runs linting."
- The `eslint` key in next.config is removed.
- `@next/eslint-plugin-next` defaults to flat config. Setup:

  ```js
  // eslint.config.mjs
  import { defineConfig, globalIgnores } from 'eslint/config'
  import nextVitals from 'eslint-config-next/core-web-vitals'
  export default defineConfig([...nextVitals, globalIgnores(['.next/**','out/**','build/**','next-env.d.ts'])])
  ```

### Other removals and changes

- AMP removed.
- `serverRuntimeConfig` and `publicRuntimeConfig` removed; use environment variables.
- Parallel-route slots require a `default.js`.
- `unstable_rootParams` → `next/root-params`.
- `scroll-behavior` is no longer overridden unless `<html data-scroll-behavior="smooth">` is set.
- React 19.2 (View Transitions, `useEffectEvent`, Activity).
- `reactCompiler: true` is stable but opt-in.
- Build Adapters API is in alpha.
- Upgrade codemod: `npx @next/codemod@canary upgrade latest`. It handles the turbopack config, `next lint` → ESLint CLI, and middleware → proxy.

### Security

- OSV shows **0 advisories affecting `next@16.3.6`**.
- Recent ones were fixed before this version, for example **GHSA-2xp9-vwfh-vxw4** (RCE in the Image Optimization API via AVIF/libheif, fixed in 16.3.3 and 15.5.24) and several July 2026 SSRF, DoS and cache-confusion advisories. **Do not pin below 16.3.3.**

## Sources

- nextjs repo @ v16.3.6:
  - `docs/01-app/02-guides/upgrading/version-16.mdx`
  - `docs/01-app/02-guides/self-hosting.mdx`
  - `docs/01-app/03-api-reference/05-config/01-next-config-js/{output,cacheComponents,cacheHandlers,cacheLife}.mdx`
  - `docs/01-app/03-api-reference/04-functions/{revalidateTag,updateTag,cacheTag,cacheLife}.mdx`
  - `docs/01-app/03-api-reference/01-directives/use-cache.mdx`
  - `docs/01-app/03-api-reference/03-file-conventions/proxy.mdx`
  - `docs/01-app/03-api-reference/02-components/image.mdx`
  - `docs/01-app/03-api-reference/05-config/03-eslint.mdx`
  - `docs/01-app/02-guides/caching-without-cache-components.mdx`
- Public URLs:
  - https://nextjs.org/docs/app/guides/upgrading/version-16
  - https://nextjs.org/docs/app/guides/self-hosting
  - https://nextjs.org/docs/app/api-reference/config/next-config-js/output
  - https://nextjs.org/docs/app/api-reference/functions/revalidateTag
  - https://nextjs.org/docs/app/api-reference/functions/updateTag
  - https://nextjs.org/docs/app/api-reference/functions/cacheTag
  - https://nextjs.org/docs/app/api-reference/functions/cacheLife
  - https://nextjs.org/docs/app/api-reference/directives/use-cache
  - https://nextjs.org/docs/app/api-reference/file-conventions/proxy
  - https://nextjs.org/docs/app/api-reference/components/image
  - https://nextjs.org/docs/app/api-reference/config/eslint
- `npm view next@16.3.6 engines peerDependencies optionalDependencies`; `npm view sharp`
- https://raw.githubusercontent.com/medusajs/nextjs-starter-medusa/main/package.json
- OSV: https://api.osv.dev (query `next@16.3.6`; GHSA-2xp9-vwfh-vxw4)

## Confidence

- **High:** facts read from the version-matched docs source and registry metadata.

## Implications for us

1. Use Node 22 LTS and `next@16.3.6`. Plain `next build` uses Turbopack. Do not add a webpack config, or build with `--webpack` if you must.
2. Choose between `output: 'standalone'`, which needs the `public` and `.next/static` copy step, and plain `next start`. Standalone is smaller and fine on one VM.
   - Bind to `127.0.0.1:8000` behind nginx.
   - Add `X-Accel-Buffering: no` or `proxy_buffering off` for streaming.
3. When porting the Medusa starter (Next 15.3):
   - rename `src/middleware.ts` → `src/proxy.ts` and its `middleware` export → `proxy`. It already runs on Node, so region detection that calls the Medusa API still works.
   - await every `params`, `searchParams`, `cookies()` and `headers()`
   - replace `next lint` with the ESLint CLI flat config
   - add two-argument `revalidateTag(tag, 'max')` in route handlers or server actions, or `updateTag` in server actions for cart and customer read-your-writes
4. Keep `cacheComponents` **off** initially, since the starter uses `fetch` `next: { tags }` and `force-cache`. Adopt `use cache` plus `cacheTag` later. Note that `use cache` cannot read cookies, so cart and customer data must stay dynamic.
5. `images.remotePatterns` must include the OCI object URL host, for example `{ protocol:'https', hostname:'objectstorage.<region>.oraclecloud.com', pathname:'/n/<ns>/b/<bucket>/o/**' }`, and the Medusa backend host if it serves files.
   - The 4 h `minimumCacheTTL` default helps stay under OCI's 50k requests per month.
   - If `quality` props other than 75 are used, add them to `images.qualities`.
