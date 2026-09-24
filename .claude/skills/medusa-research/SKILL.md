---
name: medusa-research
description: Research Medusa v2, Next.js, Razorpay, OCI or Node version facts before changing code or upgrading. Use before any dependency/version change, before using an unfamiliar Medusa API, or when docs and behaviour disagree.
---

# Medusa research

Rule: RESEARCH → FIND CURRENT SOURCE → VERIFY → IMPLEMENT. Community posts are evidence, not authority.

## Procedure
1. **Pin the question.** Write it down, for example "Does 2.22 change the Store API allowlist for /store/products?"
2. **Current versions (primary sources):**
   ```bash
   npm view @medusajs/medusa dist-tags version time --json | head -40
   npm view next dist-tags
   npm view @medusajs/medusa@<ver> engines
   ```
3. **Release notes for EVERY version between current and target:**
   https://github.com/medusajs/medusa/releases/tag/v<ver>. Record breaking changes, security fixes, migrations and flags.
4. **Docs:** https://docs.medusajs.com (use `llms.txt` to find pages). **Source when the docs are ambiguous:** read `node_modules/@medusajs/<pkg>/dist/...` of the pinned version.
5. **Known issues:** search GitHub issues for the module name and the error text. Note whether each issue is open or closed and the fix version.
6. **Advisories:** `npm audit --omit=dev --json` in `apps/backend` and `apps/storefront`, plus https://github.com/medusajs/medusa/security/advisories.
7. **Record the result:**
   - Update `docs/research/external/<topic>.md` (with sources and date) and `docs/research/VERSIONS.md`.
   - Add or update an ADR in `docs/research/decisions/` using the sections Question, Current evidence, Sources, Options, Chosen, Reason, Tradeoffs, Impact, Verification.

## Validation
- Every claim in the ADR has a URL or a file path with a line number.
- For a version bump, run:
  ```bash
  cd apps/backend && npm run typecheck && npm run test:unit && npm run build
  cd apps/storefront && npm run typecheck && npm run lint && npm run build
  npx playwright test   # full E2E on the local stack
  ```

## Expected evidence
An ADR or research note dated today, listing the versions checked and the commands run with their outcomes.

## Failure handling
- If a source can't be found, mark the claim **UNVERIFIED** in the note and do not build on it.
- If the release notes show a breaking change you can't test, do not upgrade. Record it in `docs/research/RISKS.md`.
- Never use a preview/snapshot/canary tag in production.
