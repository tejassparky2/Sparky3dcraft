#!/usr/bin/env bash
# Sparky health check.
#   sudo ./deploy/healthcheck.sh          full check (creates one test cart)
#   sudo ./deploy/healthcheck.sh --quiet  periodic mode for the systemd timer:
#                                         no cart creation, prints only problems
# Exit code: 0 = no FAIL, 1 = at least one FAIL.
set -Eeuo pipefail
DEPLOY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=deploy/lib/common.sh
. "$DEPLOY_DIR/lib/common.sh"
QUIET=0
[ "${1:-}" = --quiet ] && QUIET=1
require_root

FAILS=0 WARNS=0
section() { [ "$QUIET" = 1 ] || printf '\n%s\n' "$1"; }
ok() { [ "$QUIET" = 1 ] || pass "$*"; }
bad() {
  FAILS=$((FAILS + 1))
  fail "$*"
}
meh() {
  WARNS=$((WARNS + 1))
  warn "$*"
}

load_backend_env
db_parse
STORE_DOMAIN=$(conf_get "$SPARKY_INSTALL_CONF" STORE_DOMAIN 2>/dev/null || echo "")
API_DOMAIN=$(conf_get "$SPARKY_INSTALL_CONF" API_DOMAIN 2>/dev/null || echo "")
PK=$(cat "$SPARKY_VAR/publishable_key" 2>/dev/null || true)
api() { curl -fsS --max-time 15 -H "x-publishable-api-key: $PK" -H 'content-type: application/json' "$@"; }

section "SYSTEM"
load1=$(cut -d' ' -f1 /proc/loadavg)
cpus=$(nproc)
memavail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
diskfree=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
[ "$(uname -m)" = aarch64 ] && ok "arch aarch64" || meh "arch $(uname -m) (production target is aarch64)"
awk -v l="$load1" -v c="$cpus" 'BEGIN{exit !(l < c*2)}' && ok "load $load1 on $cpus CPUs" || meh "high load $load1 on $cpus CPUs"
[ "$memavail" -gt 500 ] && ok "memory available ${memavail} MB" || bad "low memory: ${memavail} MB available"
[ "$diskfree" -gt 3 ] && ok "disk free ${diskfree} GB" || bad "low disk: ${diskfree} GB free"

section "NODE"
if node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)' 2>/dev/null; then ok "node $(node -v) ($(node -p process.arch))"; else bad "node missing or < 22.12"; fi

section "POSTGRES"
if pg_env psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "select 1" >/dev/null 2>&1; then
  ok "connected to $DB_NAME"
  conns=$(pg_env psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "select count(*) from pg_stat_activity")
  maxc=$(pg_env psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "show max_connections")
  [ "$conns" -lt $((maxc * 8 / 10)) ] && ok "connections $conns/$maxc" || meh "connections $conns/$maxc"
  locks=$(pg_env psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "select count(*) from pg_locks where not granted")
  [ "$locks" = 0 ] && ok "no waiting locks" || meh "$locks waiting locks"
  size=$(pg_env psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "select pg_size_pretty(pg_database_size(current_database()))")
  ok "database size $size"
  stale=$(pg_env psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "select count(*) from pg_stat_user_tables where n_dead_tup > 10000 and n_dead_tup > n_live_tup and coalesce(last_autovacuum,last_vacuum) < now() - interval '7 days'")
  [ "$stale" = 0 ] && ok "autovacuum keeping up" || meh "$stale tables with many dead tuples and no recent vacuum"
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ':5432$' | grep -vqE '^(127\.0\.0\.1|\[::1\]):5432$'; then bad "PostgreSQL listens on a public interface"; else ok "listening on loopback only"; fi
else
  bad "cannot connect to PostgreSQL"
fi

section "REDIS"
RPW=${REDIS_URL#redis://:}
RPW=${RPW%%@*}
if [ "$(REDISCLI_AUTH=$RPW redis-cli -h 127.0.0.1 ping 2>/dev/null)" = PONG ]; then
  ok "ping with password"
  mem=$(REDISCLI_AUTH=$RPW redis-cli -h 127.0.0.1 info memory | awk -F: '/^used_memory_human/ {print $2}' | tr -d '\r')
  ok "used memory $mem"
  [ "$(REDISCLI_AUTH=$RPW redis-cli -h 127.0.0.1 config get maxmemory-policy | tail -1)" = noeviction ] && ok "maxmemory-policy noeviction" || bad "maxmemory-policy is not noeviction"
  if redis-cli -h 127.0.0.1 ping 2>/dev/null | grep -q PONG; then bad "redis accepts unauthenticated commands"; else ok "authentication required"; fi
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ':6379$' | grep -vqE '^(127\.0\.0\.1|\[::1\]):6379$'; then bad "Redis listens on a public interface"; else ok "listening on loopback only"; fi
else
  bad "redis not answering"
fi

svc() {
  local unit=$1 url=$2 label=$3
  if systemctl is-active --quiet "$unit"; then ok "$unit active (since $(systemctl show -p ActiveEnterTimestamp --value "$unit"))"; else bad "$unit not active"; fi
  if curl -fsS -o /dev/null --max-time 10 "$url"; then ok "$label responds ($url)"; else bad "$label not responding ($url)"; fi
  local restarts
  restarts=$(systemctl show -p NRestarts --value "$unit" 2>/dev/null || echo 0)
  [ "${restarts:-0}" -lt 5 ] && ok "restarts: ${restarts:-0}" || meh "$unit restarted ${restarts} times (crash loop?)"
}
section "MEDUSA SERVER"
svc sparky-medusa-server http://127.0.0.1:9000/health "server /health"
section "MEDUSA WORKER"
svc sparky-medusa-worker http://127.0.0.1:9001/health "worker /health"
section "STOREFRONT"
svc sparky-storefront http://127.0.0.1:3000/robots.txt "storefront"

section "NGINX"
if systemctl is-active --quiet nginx && nginx -t >/dev/null 2>&1; then ok "nginx active, config valid"; else bad "nginx inactive or config invalid"; fi

section "HTTPS"
if [ -f /etc/letsencrypt/live/sparky/fullchain.pem ]; then
  end=$(openssl x509 -enddate -noout -in /etc/letsencrypt/live/sparky/fullchain.pem | cut -d= -f2)
  days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
  [ "$days" -gt 14 ] && ok "certificate valid for $days more days" || bad "certificate expires in $days days"
  for d in "$STORE_DOMAIN" "$API_DOMAIN"; do
    [ -n "$d" ] || continue
    if curl -fsS -o /dev/null --max-time 15 --resolve "$d:443:127.0.0.1" "https://$d/robots.txt" || curl -fsS -o /dev/null --max-time 15 --resolve "$d:443:127.0.0.1" "https://$d/health"; then ok "https://$d served with a valid certificate"; else bad "https://$d failed TLS verification"; fi
  done
else
  meh "no Let's Encrypt certificate installed"
fi

section "STORE API"
if [ -n "$PK" ] && regions=$(api http://127.0.0.1:9000/store/regions 2>/dev/null); then
  region=$(echo "$regions" | jq -r '.regions[0].id')
  ok "store API with publishable key (region $(echo "$regions" | jq -r '.regions[0].name'))"
else
  bad "store API not answering with the publishable key"
  region=""
fi
if curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:9000/store/products | grep -q '^400$'; then ok "store API rejects requests without a publishable key"; else meh "store API did not reject a request without a publishable key"; fi

section "DATABASE MIGRATIONS"
cur=$(basename "$(readlink -f "$SPARKY_CURRENT")")
mig=$(cat "$SPARKY_STATE_DIR/migrated-release" 2>/dev/null || echo none)
[ "$cur" = "$mig" ] && ok "migrations applied for active release $cur" || bad "active release $cur but migrations last ran for $mig"

section "PRODUCTS"
n=$(pg_env psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "select count(*) from product where status='published' and deleted_at is null" 2>/dev/null || echo 0)
[ "$n" -gt 0 ] && ok "$n published products" || meh "no published products"
if [ -n "$region" ]; then
  pc=$(api "http://127.0.0.1:9000/store/products?region_id=$region&limit=1&fields=id,*variants.calculated_price" | jq -r '.count')
  [ "$pc" = "$n" ] && ok "storefront API sees all $pc published products" || meh "store API count $pc vs published $n (sales channel assignment?)"
fi
if [ -f "$SPARKY_BACKEND_ENV" ] && grep -q '^FILE_PROVIDER=s3' "$SPARKY_BACKEND_ENV"; then
  shopify_imgs=$(pg_env psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "select count(*) from image where url like '%cdn.shopify.com%' and deleted_at is null")
  [ "$shopify_imgs" = 0 ] && ok "no product images depend on the Shopify CDN" || bad "$shopify_imgs product images still point at cdn.shopify.com"
fi

section "CART"
if [ "$QUIET" = 1 ]; then :; elif [ -n "$region" ]; then
  vid=$(api "http://127.0.0.1:9000/store/products?region_id=$region&limit=20&fields=id,metadata,variants.id" | jq -r '[.products[] | select((.metadata.personalization_photo // "") == "") ][0].variants[0].id')
  if [ -n "$vid" ] && [ "$vid" != null ]; then
    cart=$(api -X POST http://127.0.0.1:9000/store/carts -d "{\"region_id\":\"$region\"}" | jq -r .cart.id)
    items=$(api -X POST "http://127.0.0.1:9000/store/carts/$cart/line-items" -d "{\"variant_id\":\"$vid\",\"quantity\":1}" | jq -r '.cart.items | length')
    [ "$items" = 1 ] && ok "cart created and item added ($cart)" || bad "could not add an item to a cart"
    so=$(api "http://127.0.0.1:9000/store/shipping-options?cart_id=$cart" | jq -r '.shipping_options | length')
    section "CHECKOUT"
    [ "$so" -gt 0 ] && ok "$so shipping option(s) available for India" || bad "no shipping options for a cart"
  else
    meh "no purchasable product to test the cart with"
  fi
fi

section "PAYMENT"
if [ -n "$region" ]; then
  providers=$(api "http://127.0.0.1:9000/store/payment-providers?region_id=$region" | jq -r '[.payment_providers[].id] | join(",")')
  case ",$providers," in *,pp_system_default,*) bad "pp_system_default (no-money provider) is offered to customers" ;; esac
  case ",$providers," in *,pp_razorpay_razorpay,*) ok "Razorpay enabled for the region" ;; *) meh "Razorpay is not enabled" ;; esac
  case ",$providers," in *,pp_cod_cod,*) ok "Cash on Delivery enabled" ;; esac
  [ -n "$providers" ] || bad "no payment providers — checkout impossible"
  if grep -q '^RAZORPAY_KEY_ID=' "$SPARKY_BACKEND_ENV"; then
    grep -q '^RAZORPAY_WEBHOOK_SECRET=.\+' "$SPARKY_BACKEND_ENV" && ok "Razorpay webhook secret configured" || bad "Razorpay webhook secret missing"
    grep -q '^RAZORPAY_API_BASE=' "$SPARKY_BACKEND_ENV" && bad "RAZORPAY_API_BASE test override present"
  fi
fi

section "BACKUP"
last=$(cat "$SPARKY_STATE_DIR/last-backup" 2>/dev/null || true)
if [ -n "$last" ] && [ -f "$last/db.dump" ]; then
  age_h=$(( ($(date +%s) - $(stat -c %Y "$last/db.dump")) / 3600 ))
  [ "$age_h" -le 36 ] && ok "last backup $(basename "$last") (${age_h}h ago)" || bad "last backup is ${age_h}h old"
  systemctl is-active --quiet sparky-backup.timer && ok "backup timer active" || meh "backup timer not active"
  [ -f "$SPARKY_STATE_DIR/last-remote-backup" ] && ok "last off-machine backup: $(cat "$SPARKY_STATE_DIR/last-remote-backup")" || meh "no off-machine backup yet"
else
  bad "no backup found"
fi

section "RESTORE"
if [ -f "$SPARKY_STATE_DIR/last-restore-verify" ]; then
  ok "last restore verification: $(head -1 "$SPARKY_STATE_DIR/last-restore-verify") ($(tail -1 "$SPARKY_STATE_DIR/last-restore-verify"))"
else
  meh "restore has never been verified (run restore.sh --verify-latest)"
fi

[ "$QUIET" = 1 ] || echo
if [ "$FAILS" -gt 0 ]; then
  fail "health check: $FAILS failure(s), $WARNS warning(s)"
  exit 1
fi
[ "$QUIET" = 1 ] || pass "health check: 0 failures, $WARNS warning(s)"
