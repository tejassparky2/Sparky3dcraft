# ADR-010: Medusa Admin served on the API domain

- **Status:** accepted (2026-09-24)

## Question
Where does the merchant reach Medusa Admin?

## Current evidence
- Medusa serves the built Admin at `/app` from the server process.
- `admin.backendUrl` is inlined at build time.
- Production cookies are `secure`, and Medusa sets `trust proxy`, so nginx must send `X-Forwarded-Proto`.

## Sources
- `docs/research/external/medusa-deploy.md`

## Options
1. `https://api.<domain>/app` (same origin as the Admin API).
2. A separate `admin.<domain>` with a static build.

## Chosen
Option 1. The worker runs with `DISABLE_MEDUSA_ADMIN=true`.

## Reason
- Same origin as the Admin API, so no cross-site cookie or CORS configuration for the Admin.
- One certificate name fewer.

## Tradeoffs
- The Admin UI shares rate limits and exposure with the API. Mitigated by nginx rate limits on `/auth/` and strong admin credentials.
- An IP allowlist for `/app` is possible later.

## Impact
nginx `api-locations.conf`, `ADMIN_CORS`, installer questions.

## Verification
- `final-verification.sh` checks that Admin is served at `<scheme>://<api>/app`.
- The catalog-cycle test logs in through the Admin API.
