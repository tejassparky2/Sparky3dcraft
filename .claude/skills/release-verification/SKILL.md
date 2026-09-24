---
name: release-verification
description: Decide whether a build is releasable and produce the evidence-backed final report (VERIFIED / ASSUMED / BLOCKED BY EXTERNAL CREDENTIAL / NOT TESTED). Use before tagging a release, before cutover, and whenever someone asks "is it production ready?".
---

# Release verification

"PRODUCTION READY = YES" may only be stated when `deploy/final-verification.sh`, run in
**production mode on the production server**, reports it with 0 FAIL and 0 MANUAL.
Anything else is NO. Name the blockers.

## Procedure
1. Code gates (local):
   ```bash
   cd apps/backend && npm run typecheck && npm run test:unit && npm run build
   cd apps/storefront && npm run typecheck && npm run lint && npm run build && npx playwright test
   bash tests/integration/shopify-import.sh
   shellcheck -x -S warning deploy/*.sh deploy/lib/*.sh deploy/scripts/*.sh
   ```
2. Security gate: run the security-audit skill.
3. Server gates on staging, then production:
   - `healthcheck.sh`
   - `final-verification.sh --admin-email … --test-order`
   - the reboot test
   - `restore.sh --verify-latest`
4. Manual gates: go through `docs/release/RELEASE-CHECKLIST.md` sections A–D with evidence.
5. Update `docs/release/FINAL-REPORT.md`. Every claim goes into exactly one bucket:
   - **VERIFIED:** you ran it, and the evidence (command and result) is cited.
   - **ASSUMED:** believed true from documentation, not executed here.
   - **BLOCKED BY EXTERNAL CREDENTIAL:** needs keys, accounts or merchant input that are not available.
   - **NOT TESTED:** possible to test, but not done yet.

## Expected evidence
- The verification report file (`/var/lib/sparky/verification-*.md`).
- Test summaries.
- A checklist with links or screenshots.

## Failure handling
- **A FAIL anywhere** means NO. Fix it and re-run the whole gate, not just the failed check.
- **A MANUAL item** stays open until someone performs it and records evidence. Never tick it on someone's behalf.
- **Never soften a result.** "Should work" is ASSUMED, not VERIFIED.
