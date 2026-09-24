#!/usr/bin/env bash
# Production acceptance gate — runs REAL checks on this server.
#
#   sudo ./deploy/final-verification.sh [--mode staging|production]
#        [--admin-email E]            enables Admin-driven catalog cycle test (password prompted / SPARKY_VERIFY_ADMIN_PASSWORD)
#        [--test-order]               places + cancels a COD test order (COD must be enabled)
#        [--payment-verified]         you completed the manual live payment + refund test (docs/PAYMENT.md)
#        [--prepare-reboot-test]      record boot id; reboot; run again to verify recovery
#
# Result lines: [PASS] [WARN] [FAIL] [SKIP]; "MANUAL" items need a human.
# Exit 0 only if there is no FAIL. PRODUCTION READY = YES only if no FAIL and
# no MANUAL item is outstanding. A Markdown report is written to
# /var/lib/sparky/verification-<timestamp>.md
set -Eeuo pipefail
DEPLOY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=deploy/lib/common.sh
. "$DEPLOY_DIR/lib/common.sh"
require_root
# never stop silently: an unexpected error is itself a verification failure
trap 'fail "verification ABORTED at line $LINENO (exit $?) — script or environment error; PRODUCTION READY = NO"; exit 2' ERR
# kernel boot id + PID 1 start time: changes on a VM reboot and on a container restart
boot_identity() { printf '%s:%s\n' "$(cat /proc/sys/kernel/random/boot_id)" "$(awk '{print $22}' /proc/1/stat)"; }
MODE="" ADMIN_EMAIL_ARG="" TEST_ORDER=0 PAYMENT_OK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE=$2; shift 2 ;;
    --admin-email) ADMIN_EMAIL_ARG=$2; shift 2 ;;
    --test-order) TEST_ORDER=1; shift ;;
    --payment-verified) PAYMENT_OK=1; shift ;;
    --prepare-reboot-test) boot_identity >"$SPARKY_STATE_DIR/reboot-test-bootid"; info "boot id recorded. Reboot now (sudo reboot), then run this script again."; exit 0 ;;
    *) die "unknown argument $1" ;;
  esac
done
MODE=${MODE:-$(conf_get "$SPARKY_INSTALL_CONF" SPARKY_MODE 2>/dev/null || echo staging)}
load_backend_env
db_parse
STORE_DOMAIN=$(conf_get "$SPARKY_INSTALL_CONF" STORE_DOMAIN)
API_DOMAIN=$(conf_get "$SPARKY_INSTALL_CONF" API_DOMAIN)
PK=$(cat "$SPARKY_VAR/publishable_key")
REPORT="$SPARKY_VAR/verification-$(date -u +%Y%m%dT%H%M%SZ).md"
FAILS=0 WARNS=0 MANUAL=0
rec() { printf -- '- [%s] %s\n' "$1" "$2" >>"$REPORT"; }
P() { pass "$*"; rec PASS "$*"; }
F() { FAILS=$((FAILS + 1)); fail "$*"; rec FAIL "$*"; }
W() { WARNS=$((WARNS + 1)); warn "$*"; rec WARN "$*"; }
M() { MANUAL=$((MANUAL + 1)); printf '%s[MANUAL]%s %s\n' "$C_Y" "$C_0" "$*"; rec MANUAL "$*"; }
S() { skip "$*"; rec SKIP "$*"; }
H() { printf '\n%s\n' "$1"; printf '\n## %s\n\n' "$1" >>"$REPORT"; }
store() { curl -fsS --max-time 20 -H "x-publishable-api-key: $PK" "http://127.0.0.1:9000$1"; }
q() { pg_env psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "$1"; }
{ echo "# Sparky final verification"; echo; echo "- date: $(date -u +%FT%TZ)"; echo "- mode: $MODE"; echo "- host: $(hostname) $(uname -m)"; echo "- release: $(readlink -f "$SPARKY_CURRENT")"; } >"$REPORT"
chmod 600 "$REPORT"
TLS=$(conf_get "$SPARKY_INSTALL_CONF" ENABLE_TLS 2>/dev/null || echo yes)
if [ "$TLS" = yes ]; then SC=https; else SC=http; fi
S_URL="$SC://$STORE_DOMAIN" A_URL="$SC://$API_DOMAIN"

H "PLATFORM"
[ "$(uname -m)" = aarch64 ] && P "ARM64 (aarch64) environment" || { [ "$MODE" = production ] && W "not aarch64 ($(uname -m))" || W "not aarch64 ($(uname -m)) — target is Ampere A1"; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)' && P "Node $(node -v) compatible (>=22.12)" || F "Node $(node -v) incompatible"
mv=$(jq -r .version "$SPARKY_CURRENT/apps/backend/.medusa/server/node_modules/@medusajs/medusa/package.json")
want=$(jq -r '.dependencies["@medusajs/medusa"]' "$SPARKY_CURRENT/apps/backend/package.json")
[ "$mv" = "$want" ] && P "Medusa $mv installed (locked version)" || F "Medusa installed $mv != locked $want"

H "HEALTH"
if "$DEPLOY_DIR/healthcheck.sh" >"$SPARKY_VAR/.hc.out" 2>&1; then P "healthcheck.sh: no failures"; else F "healthcheck.sh reported failures (see below)"; grep FAIL "$SPARKY_VAR/.hc.out" | sed 's/^/        /'; fi

H "REDIS INFRASTRUCTURE (no in-memory fallbacks)"
since=$(systemctl show -p ActiveEnterTimestamp --value sparky-medusa-server)
jl=$(journalctl -u sparky-medusa-server -u sparky-medusa-worker --since "$since" --no-pager 2>/dev/null || true)
for pat in "event-bus-redis' established" "workflow-engine-redis' established" 'locking-redis.{0,2} provider established' "Redis cache connection established"; do
  printf '%s' "$jl" | grep -qE "$pat" && P "log: $pat" || F "not found in logs since last start: $pat"
done
printf '%s' "$jl" | grep -qiE "local event bus|in-memory|inmemory" && F "logs mention a local/in-memory infrastructure module" || P "no local/in-memory infrastructure modules in logs"

H "DNS + TLS"
if [ "$TLS" != yes ]; then
  if [ "$MODE" = production ]; then F "TLS is disabled"; else W "TLS disabled (test/staging install without certificates)"; fi
fi
for d in $([ "$TLS" = yes ] && echo "$STORE_DOMAIN $API_DOMAIN"); do
  if curl -fsS -o /dev/null --max-time 15 "https://$d/robots.txt" 2>/dev/null || curl -fsS -o /dev/null --max-time 15 "https://$d/health" 2>/dev/null; then P "https://$d reachable with a valid certificate (public DNS path)"; else F "https://$d not reachable via public DNS with a valid certificate"; fi
done
if [ "$TLS" = yes ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$STORE_DOMAIN/" || true)
  [ "$code" = 301 ] && P "HTTP redirects to HTTPS" || F "http://$STORE_DOMAIN answered $code (expected 301)"
fi
curl -fsS -o /dev/null --max-time 20 "$A_URL/app" && P "Medusa Admin served at $A_URL/app" || F "Admin not reachable at $A_URL/app"

H "CATALOG"
region=$(store /store/regions | jq -r '.regions[0].id')
prods=$(store "/store/products?region_id=$region&limit=200&fields=id,handle,title,*variants.calculated_price,*images")
n=$(echo "$prods" | jq '.products | length')
[ "$n" -gt 0 ] && P "$n products visible through the Store API" || F "no products visible"
src=$(conf_get "$SPARKY_INSTALL_CONF" MIGRATION_SOURCE 2>/dev/null || echo skip)
shop_url=$(conf_get "$SPARKY_INSTALL_CONF" SHOPIFY_STORE_URL 2>/dev/null || true)
if [ "$src" = public ] && [ -n "$shop_url" ] && sj=$(curl -fsS --max-time 30 "$shop_url/products.json?limit=250" 2>/dev/null) && echo "$sj" | jq -e .products >/dev/null 2>&1; then
  sn=$(echo "$sj" | jq '.products | length')
  [ "$sn" = "$n" ] && P "product count matches Shopify ($sn)" || F "product count Medusa $n vs Shopify $sn — re-run migrate.sh --apply"
  mism=$(jq -rn --argjson m "$prods" --argjson s "$sj" '
    [ $s.products[] as $p | ($m.products[] | select(.handle == $p.handle)) as $x
      | select(($x.variants[0].calculated_price.calculated_amount) != ($p.variants[0].price|tonumber)
          or (($p.variants[0].compare_at_price // null) != null
              and ($p.variants[0].compare_at_price|tonumber) > ($p.variants[0].price|tonumber)
              and ($x.variants[0].calculated_price.original_amount) != ($p.variants[0].compare_at_price|tonumber)))
      | $p.handle ] | join(",")')
  [ -z "$mism" ] && P "prices and compare-at prices match Shopify for every product" || F "price mismatch vs Shopify: $mism"
  missing=$(jq -rn --argjson m "$prods" --argjson s "$sj" '[ $s.products[].handle as $h | select(([$m.products[].handle] | index($h)) == null) | $h ] | join(",")')
  [ -z "$missing" ] && P "every Shopify handle exists in Medusa (URLs preserved)" || F "missing handles: $missing"
else
  S "Shopify comparison skipped (source $src or Shopify not reachable)"
fi

H "IMAGES"
imgs=$(echo "$prods" | jq -r '.products[].images[].url' | sort -u)
total=0 badimg=0 cdn=0
while read -r u; do
  [ -n "$u" ] || continue
  total=$((total + 1))
  case "$u" in *cdn.shopify.com*) cdn=$((cdn + 1)) ;; esac
  ct=$(curl -fsS -o /dev/null -w '%{content_type}' --max-time 20 "$u" 2>/dev/null || echo fail)
  case "$ct" in image/*) ;; *) badimg=$((badimg + 1)); echo "        bad image: $u ($ct)" ;; esac
done <<<"$imgs"
[ "$badimg" = 0 ] && P "$total product images load with an image content-type" || F "$badimg of $total product images fail to load"
[ "$cdn" = 0 ] && P "no image depends on the Shopify CDN" || F "$cdn images still hosted on cdn.shopify.com"
noalt=$(q "select count(*) from image where deleted_at is null and coalesce(metadata->>'alt','') = ''")
[ "$noalt" = 0 ] && P "every product image has alt text" || W "$noalt images without alt text"

H "STOREFRONT, SEARCH, SEO"
h=$(curl -fsS --max-time 20 "$S_URL/" || true)
[ -n "$h" ] && P "home page served at $S_URL" || F "home page not served at $S_URL"
t=$(echo "$prods" | jq -r '.products[0].handle')
curl -fsS -o /dev/null "$S_URL/products/$t" && P "product page /products/$t" || F "product page failed"
word=$(echo "$prods" | jq -r '.products[0].title' | awk '{print $1}')
{ curl -fsS --max-time 20 "$S_URL/search?q=$(printf %s "$word" | jq -sRr @uri)" || true; } | grep -q 'card__title' && P "search returns results for \"$word\"" || F "search returned nothing for \"$word\""
{ curl -fsS --max-time 20 "$S_URL/sitemap.xml" || true; } | grep -q "/products/$t" && P "sitemap lists products" || F "sitemap incomplete"
robots=$(curl -fsS --max-time 20 "$S_URL/robots.txt" || true)
if [ "$MODE" = production ]; then
  echo "$robots" | grep -qE '^Disallow: /$' && F "robots.txt blocks the whole site (SITE_NOINDEX still true?)" || P "robots.txt allows crawling"
  echo "$h" | grep -qi 'name="robots" content="noindex' && F "home page has noindex" || P "no noindex on production pages"
  grep -q '^SITE_NOINDEX=false' "$SPARKY_STOREFRONT_ENV" && P "SITE_NOINDEX=false" || F "SITE_NOINDEX is not false"
else
  echo "$robots" | grep -qE '^Disallow: /$' && P "staging: robots.txt blocks crawlers" || W "staging site is crawlable"
fi
echo "$h" | grep -q '"@type":"Organization"' && P "Organization JSON-LD present" || W "Organization JSON-LD missing"
{ curl -fsS --max-time 20 "$S_URL/products/$t" || true; } | grep -q '"@type":"Product"' && P "Product JSON-LD present" || F "Product JSON-LD missing"
for pair in /collections/all:/catalog /pages/contact:/contact /policies/privacy-policy:/privacy; do
  from=${pair%%:*} to=${pair##*:}
  loc=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 20 "$S_URL$from" || true)
  case "$loc" in 30[18]*"$to") P "redirect $from → $to" ;; *) F "redirect $from answered: $loc" ;; esac
done

H "CHECKOUT / PAYMENT / SHIPPING"
provs=$(store "/store/payment-providers?region_id=$region" | jq -r '[.payment_providers[].id]|join(",")')
case ",$provs," in *,pp_system_default,*) F "no-money system payment provider is enabled" ;; *) P "no fake payment provider offered" ;; esac
case ",$provs," in *,pp_razorpay_razorpay,*) P "Razorpay enabled" ;; *) [ "$MODE" = production ] && F "Razorpay not enabled" || W "Razorpay not enabled" ;; esac
grep -q '^RAZORPAY_KEY_ID=rzp_live_' "$SPARKY_BACKEND_ENV" && P "Razorpay LIVE keys configured" || { [ "$MODE" = production ] && F "Razorpay live keys not configured" || W "Razorpay live keys not configured (staging)"; }
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST -H 'content-type: application/json' -H 'x-razorpay-signature: 00' --data '{"event":"payment.captured"}' "$A_URL/hooks/razorpay" || true)
if [ "$code" = 400 ]; then
  P "webhook endpoint rejects unsigned requests (400)"
elif [ "$code" = 503 ] && ! grep -q '^RAZORPAY_WEBHOOK_SECRET=.' "$SPARKY_BACKEND_ENV"; then
  [ "$MODE" = production ] && F "webhook endpoint disabled (RAZORPAY_WEBHOOK_SECRET not set)" || S "webhook endpoint disabled (503) — RAZORPAY_WEBHOOK_SECRET not set"
else
  F "webhook endpoint answered $code to a forged request"
fi
so=$(q "select count(*) from shipping_option where deleted_at is null")
[ "$so" -gt 0 ] && P "$so shipping option(s) configured" || F "no shipping options"
if [ "$PAYMENT_OK" = 1 ]; then
  date -u +%FT%TZ >"$SPARKY_STATE_DIR/payment-verified"
fi
[ -f "$SPARKY_STATE_DIR/payment-verified" ] && P "live payment test recorded as done ($(cat "$SPARKY_STATE_DIR/payment-verified"))" || M "complete one real Razorpay payment + refund on the live keys (docs/PAYMENT.md), then re-run with --payment-verified"
if [ "$TEST_ORDER" = 1 ]; then
  [ -n "$ADMIN_EMAIL_ARG" ] || die "--test-order needs --admin-email (the order is cancelled via Admin)"
  pw=${SPARKY_VERIFY_ADMIN_PASSWORD:-}
  [ -n "$pw" ] || { read -r -s -p "Admin password for $ADMIN_EMAIL_ARG: " pw; echo; export SPARKY_VERIFY_ADMIN_PASSWORD=$pw; }
  ADMIN_EMAIL="$ADMIN_EMAIL_ARG" ADMIN_PASSWORD="$pw" API_URL="$A_URL" PK="$PK" node "$DEPLOY_DIR/tests/cod-order-cycle.mjs" && P "COD test order placed, visible in Admin (authorized), cancelled" || F "COD order cycle failed"
else
  S "test order not placed (use --test-order with COD enabled)"
fi
[ -n "${SMTP_HOST:-}" ] && P "transactional email configured" || { [ "$MODE" = production ] && F "SMTP not configured (no order emails / password reset)" || W "SMTP not configured"; }

if [ -n "$ADMIN_EMAIL_ARG" ]; then
  H "ADMIN CATALOG CYCLE"
  pw=${SPARKY_VERIFY_ADMIN_PASSWORD:-}
  [ -n "$pw" ] || { read -r -s -p "Admin password for $ADMIN_EMAIL_ARG: " pw; echo; }
  if ADMIN_EMAIL="$ADMIN_EMAIL_ARG" ADMIN_PASSWORD="$pw" STORE_URL="$S_URL" API_URL="$A_URL" PK="$PK" node "$DEPLOY_DIR/tests/catalog-cycle.mjs"; then P "create/edit/price/sale/inventory/unpublish/republish/delete reflected on the storefront"; else F "admin catalog cycle failed"; fi
else
  M "run with --admin-email to verify Admin-driven catalog changes on this server"
fi

H "SECURITY"
public=$(ss -ltnH 2>/dev/null | awk '{print $4}' | grep -vE '^(127\.|\[::1\]|::1)' | sed -E 's/.*[:]//' | sort -u | tr '\n' ' ')
extra=$(echo "$public" | tr ' ' '\n' | grep -vE '^(22|80|443|)$' | tr '\n' ' ')
if [ -z "${extra// }" ]; then
  P "public listening ports: $public"
else
  for p in $extra; do
    who=$(ss -ltnpH "sport = :$p" 2>/dev/null | grep -o 'users:(("[^"]*"' | head -1 | cut -d'"' -f2 || true)
    F "unexpected public port $p (${who:-process not visible — another namespace/host?}) — close it or bind it to 127.0.0.1"
  done
fi
for f in "$SPARKY_BACKEND_ENV" "$SPARKY_STOREFRONT_ENV" "$SPARKY_SECRETS"; do
  perm=$(stat -c %a "$f")
  [ "${perm: -1}" = 0 ] && P "$f not world-readable ($perm)" || F "$f is world-readable ($perm)"
done
if node -e '
  const e=process.env, bad=["supersecret","password","123456","changeme"];
  for (const k of ["JWT_SECRET","COOKIE_SECRET"]) { const v=e[k]||""; if (v.length<32||bad.includes(v)) { console.log(k); process.exit(1) } }'; then P "JWT/cookie secrets strong"; else F "weak JWT/cookie secret"; fi
if grep -qE '^(RAZORPAY_API_BASE|SMTP_INSECURE_NO_TLS|SHOPIFY_ADMIN_API_BASE_TEST_ONLY)=' "$SPARKY_BACKEND_ENV" || grep -qE '^(IMAGES_ALLOW_LOCAL_IP|COOKIE_INSECURE)=true' "$SPARKY_STOREFRONT_ENV"; then
  if [ "$MODE" = production ]; then F "test-only overrides present in env files"; else W "test-only overrides present (staging/test only)"; fi
else P "no test-only overrides"; fi
sshd -T 2>/dev/null | grep -qi '^passwordauthentication no' && P "SSH password authentication disabled" || W "SSH password authentication is enabled"
sshd -T 2>/dev/null | grep -qiE '^permitrootlogin (no|prohibit-password|without-password)' && P "SSH root password login disabled" || W "SSH permits root password login"
if [ "$MODE" = production ]; then
  grep -q '^FILE_PROVIDER=s3' "$SPARKY_BACKEND_ENV" && P "product media on object storage" || F "FILE_PROVIDER is not s3"
fi
for pol in privacy terms shipping refunds; do
  st=$(sed -n 's/^status: //p' "$SPARKY_CURRENT/apps/storefront/content/policies/$pol.md" | head -1)
  if [ "$st" = approved ]; then P "policy $pol approved"; elif [ "$MODE" = production ]; then F "policy $pol not approved by the merchant (status: $st)"; else M "policy $pol needs merchant-approved text (status: $st)"; fi
done
audit_app() {
  local app=$1 out hi
  out=$(cd "$SPARKY_CURRENT/apps/$app" && npm audit --omit=dev --json 2>/dev/null || true)
  if ! hi=$(echo "$out" | jq -er '(.metadata.vulnerabilities.high // 0) + (.metadata.vulnerabilities.critical // 0)' 2>/dev/null); then
    W "npm audit ($app) could not run (registry unreachable?) — run it manually"
  elif [ "$hi" = 0 ]; then
    P "npm audit ($app, production deps): no high/critical advisories"
  else
    W "npm audit ($app): $hi high/critical advisories: $(echo "$out" | jq -r '[.vulnerabilities[] | select(.severity=="high" or .severity=="critical") | .name] | join(",")') — review (docs/SECURITY.md §Dependencies), do not auto-suppress"
  fi
}
audit_app backend
audit_app storefront

H "BACKUP / RESTORE / RECOVERY"
"$DEPLOY_DIR/backup.sh" --tag verification --quiet && P "backup created" || F "backup failed"
"$DEPLOY_DIR/restore.sh" --verify-latest >/dev/null 2>&1 && P "restore into a temporary database verified" || F "restore verification failed"
[ -f "$SPARKY_STATE_DIR/last-remote-backup" ] && P "off-machine backup present" || { [ "$MODE" = production ] && F "no off-machine backup (BACKUP_S3_BUCKET)" || W "no off-machine backup"; }
old=$(systemctl show -p MainPID --value sparky-medusa-worker)
kill -9 "$old"
sleep 12
new=$(systemctl show -p MainPID --value sparky-medusa-worker)
if systemctl is-active --quiet sparky-medusa-worker && [ "$new" != "$old" ] && wait_http http://127.0.0.1:9001/health 60; then P "crash recovery: worker killed (SIGKILL) and restarted automatically"; else F "worker did not recover after SIGKILL"; fi
if [ -f "$SPARKY_STATE_DIR/reboot-test-bootid" ]; then
  if [ "$(cat "$SPARKY_STATE_DIR/reboot-test-bootid")" != "$(boot_identity)" ]; then
    systemctl is-active --quiet sparky-medusa-server sparky-medusa-worker sparky-storefront nginx && { P "reboot test: all services came back after reboot"; date -u +%FT%TZ >"$SPARKY_STATE_DIR/reboot-verified"; } || F "services not active after reboot"
    rm -f "$SPARKY_STATE_DIR/reboot-test-bootid"
  else
    M "reboot pending: reboot now and re-run"
  fi
elif [ -f "$SPARKY_STATE_DIR/reboot-verified" ]; then
  P "reboot survival verified on $(cat "$SPARKY_STATE_DIR/reboot-verified")"
else
  M "reboot test not done: run with --prepare-reboot-test, reboot, run again"
fi

echo
{ echo; echo "## Result"; echo; echo "- FAIL: $FAILS"; echo "- WARN: $WARNS"; echo "- MANUAL outstanding: $MANUAL"; } >>"$REPORT"
if [ "$FAILS" = 0 ] && [ "$MANUAL" = 0 ] && [ "$MODE" = production ]; then
  pass "PRODUCTION READY = YES"
  echo "- PRODUCTION READY = YES" >>"$REPORT"
else
  warn "PRODUCTION READY = NO  (fail: $FAILS, manual outstanding: $MANUAL, warnings: $WARNS, mode: $MODE)"
  echo "- PRODUCTION READY = NO" >>"$REPORT"
fi
info "report: $REPORT"
if [ "$FAILS" != 0 ]; then exit 1; fi
