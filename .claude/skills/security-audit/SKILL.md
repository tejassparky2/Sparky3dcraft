---
name: security-audit
description: Audit the codebase and a running server for secret leaks, exposed ports, weak config, dependency advisories, payment-integrity and auth issues. Use before every release and after changes to auth, payments, uploads, deploy scripts or dependencies.
---

# Security audit

## Procedure
1. **Secrets in git:**
   ```bash
   git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$'    # must be empty
   git grep -nIE 'rzp_(live|test)_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|shpat_[a-f0-9]{16,}|sk_live_'   # must be empty
   ```
   Also scan history for newly added files: `git log -p --since=… | grep -E …`.
2. **Dependencies:**
   ```bash
   cd apps/backend && npm audit --omit=dev --json | jq .metadata.vulnerabilities
   cd apps/storefront && npm audit --omit=dev --json | jq .metadata.vulnerabilities
   ```
   Triage each high or critical finding: is it reachable in production? Is a patched version available? Record the result in docs/SECURITY.md §Dependencies. Fix only with a reviewed `overrides` entry or an upgrade via the medusa-research skill. **Never `npm audit fix --force`.**
3. **Payment integrity review:**
   - `src/modules/razorpay/service.ts`: server-side payment fetch, amount and currency match, `notes.session_id` match
   - `src/api/hooks/razorpay/route.ts`: raw-body HMAC, timing-safe comparison, event-id ledger, 400 on a bad signature
   - no path marks an order paid from client input
4. **Input and auth review:**
   - personalization middleware strips unknown metadata
   - uploads are content-sniffed and size-limited, stored privately, with an Admin-only download
   - `/store/orders/:id` is guarded in the storefront
   - no `dangerouslySetInnerHTML` without `sanitize`
5. **Env validation:** `npm run test:unit` covers `env.unit.spec.ts`. Weak secrets, wildcard CORS and test overrides must be refused in production.
6. **Server** (`sudo ./deploy/final-verification.sh`, SECURITY section):
   - public ports are exactly 22, 80 and 443
   - env file modes
   - secret strength
   - SSH password and root login
   - policies approved
   - npm audit

## Expected evidence
- Command outputs pasted into the release notes: empty secret scans, audit counts with triage, the verification SECURITY section with 0 FAIL.

## Failure handling
- **Leaked secret:** rotate it at the provider **first** (Razorpay, OCI, SMTP, Shopify). Then remove it from the repo. History rewriting needs the owner's decision.
- **Exposed port:** bind the service to 127.0.0.1. Never "fix" it with a firewall rule alone.
- **Any bypass of payment verification** is a release blocker.
