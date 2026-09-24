#!/usr/bin/env bash
# Integration test: Shopify Admin API + CSV import into a FRESH database.
# Proves: dependency-ordered import, idempotent re-run (no duplicates),
# inventory from source, customers get login identities (no passwords),
# historical orders flagged, CSV import after API import adopts by handle.
# Requires: local PostgreSQL (sudo -u postgres), Redis, apps/backend deps.
set -Eeuo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BACKEND=$ROOT/apps/backend
TMP=$(mktemp -d)
DB=medusa_it_$$
PASS=$(openssl rand -hex 16)
FAKE_PID=""
cleanup() {
  [ -n "$FAKE_PID" ] && kill "$FAKE_PID" 2>/dev/null || true
  sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS $DB;" -c "DROP ROLE IF EXISTS it_$$;" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT
fail() { echo "[FAIL] $*"; exit 1; }
pass() { echo "[PASS] $*"; }

sudo -u postgres psql -q -v ON_ERROR_STOP=1 -c "CREATE ROLE it_$$ LOGIN PASSWORD '$PASS';" -c "CREATE DATABASE $DB OWNER it_$$;" >/dev/null
export NODE_ENV=development
export DATABASE_URL="postgres://it_$$:$PASS@127.0.0.1:5432/$DB"
export REDIS_URL=redis://127.0.0.1:6379/8 EVENTS_REDIS_URL=redis://127.0.0.1:6379/9 WE_REDIS_URL=redis://127.0.0.1:6379/10 LOCKING_REDIS_URL=redis://127.0.0.1:6379/11 CACHE_REDIS_URL=redis://127.0.0.1:6379/12
export JWT_SECRET=$(openssl rand -hex 32) COOKIE_SECRET=$(openssl rand -hex 32)
export STORE_CORS=http://localhost:3000 ADMIN_CORS=http://localhost:9000 AUTH_CORS=http://localhost:9000
export FILE_PROVIDER=local COD_ENABLED=true SPARKY_DISABLE_SYSTEM_PAYMENT=true
export SMTP_HOST= RAZORPAY_KEY_ID= STOREFRONT_REVALIDATE_URL=
export SHOPIFY_SNAPSHOT_DIR=$TMP/snapshots
cd "$BACKEND"
# isolate from the developer's .env
mv .env "$TMP/.env.dev" 2>/dev/null && trap 'mv "$TMP/.env.dev" "$BACKEND/.env" 2>/dev/null; cleanup' EXIT || true

npx medusa db:migrate >"$TMP/migrate.log" 2>&1 || { tail -20 "$TMP/migrate.log"; fail "db:migrate"; }
pass "fresh database migrated"
SPARKY_STORE_CONFIG=integration-tests/fixtures/store.config.test.json npx medusa exec ./src/scripts/setup-store.ts >"$TMP/setup.log" 2>&1 || { tail -20 "$TMP/setup.log"; fail "setup-store"; }
pass "store set up"

PORT=9922 node "$ROOT/tests/fakes/shopify-admin-fake.mjs" >"$TMP/fake.log" 2>&1 &
FAKE_PID=$!
sleep 1
export SHOPIFY_SOURCE=admin SHOPIFY_SHOP_DOMAIN=fixture.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_test_fixture SHOPIFY_ADMIN_API_BASE_TEST_ONLY=http://127.0.0.1:9922/admin/api
export IMPORT_ENTITIES=products,collections,customers,orders

IMPORT_MODE=probe npx medusa exec ./src/scripts/import-shopify.ts >"$TMP/probe.log" 2>&1 || { tail -20 "$TMP/probe.log"; fail "probe"; }
grep -q "orders query OK" "$TMP/probe.log" || fail "probe did not validate orders query"
pass "admin API probe"

q() { psql "$DATABASE_URL" -Atc "$1"; }
for run in 1 2; do
  IMPORT_MODE=apply npx medusa exec ./src/scripts/import-shopify.ts >"$TMP/import$run.log" 2>&1 || { grep -E "ERROR|Error" "$TMP/import$run.log" | head; fail "import run $run"; }
  grep -E "\] (products|categories|customers|orders):" "$TMP/import$run.log" | sed "s/^/  run$run /"
done
[ "$(q "select count(*) from product where deleted_at is null")" = 9 ] || fail "product count"
[ "$(q "select count(*) from product_variant where deleted_at is null")" = 9 ] || fail "variant count"
[ "$(q "select count(*) from product_category where deleted_at is null")" = 2 ] || fail "category count"
[ "$(q "select count(*) from customer where deleted_at is null")" = 3 ] || fail "customer count"
[ "$(q "select count(*) from \"order\" where deleted_at is null")" = 2 ] || fail "order count"
pass "counts after 2 runs: 9 products, 9 variants, 2 categories, 3 customers, 2 orders (no duplicates)"
grep -q "orders: created=0 updated=0 adopted=0 unchanged=2" "$TMP/import2.log" || fail "second run should leave orders unchanged"
grep -q "customers: created=0 updated=0 adopted=0 unchanged=3" "$TMP/import2.log" || fail "second run should leave customers unchanged"
pass "second run is a no-op"
[ "$(q "select count(*) from inventory_level where deleted_at is null")" = 9 ] || fail "inventory levels"
[ "$(q "select min(stocked_quantity)::int from inventory_level")" = 5 ] || fail "stock from source"
pass "inventory levels imported from source quantities"
[ "$(q "select count(*) from provider_identity where provider='emailpass' and entity_id like 'fixture.customer%'")" = 3 ] || fail "login identities"
[ "$(q "select count(*) from provider_identity where provider_metadata::text ilike '%shopify%'")" = 0 ] || fail "no shopify password material"
pass "migrated customers have login identities with random unusable passwords (activation required)"
[ "$(q "select count(*) from \"order\" where metadata->>'historical'='true' and metadata->>'shopify_financial_status'='PAID'")" = 2 ] || fail "historical flags"
[ "$(q "select count(*) from order_payment_collection")" = 0 ] || fail "historical orders must not have Medusa payments"
pass "historical orders flagged; no fake Medusa payment records"
[ "$(q "select count(*) from \"order\" o join customer c on c.id=o.customer_id where o.metadata->>'historical'='true'")" = 2 ] || fail "order-customer link"
pass "historical orders linked to migrated customers"
[ "$(q "select count(*) from image where metadata->>'alt'='Fixture alt text'")" -ge 1 ] || fail "alt text from admin API"
pass "image alt text taken from Admin API"

# CSV import on top of an API import must not duplicate (adopt by handle)
python3 - "$BACKEND/integration-tests/fixtures/shopify-public-products.json" "$TMP/products.csv" <<'PY'
import csv, json, sys
p = json.load(open(sys.argv[1]))["products"]
cols = ["Handle","Title","Body (HTML)","Vendor","Type","Tags","Published","Option1 Name","Option1 Value","Variant SKU","Variant Grams","Variant Inventory Tracker","Variant Inventory Qty","Variant Inventory Policy","Variant Price","Variant Compare At Price","Variant Requires Shipping","Variant Taxable","Image Src","Image Position","Image Alt Text","Status"]
w = csv.writer(open(sys.argv[2], "w", newline=""))
w.writerow(cols)
for x in p:
    v = x["variants"][0]
    for i, img in enumerate(x["images"] or [{"src": ""}]):
        if i == 0:
            w.writerow([x["handle"], x["title"], x["body_html"], x["vendor"], x["product_type"], ", ".join(x["tags"]), "true", "Title", "Default Title", "", v["grams"], "shopify", 7, "deny", v["price"], v["compare_at_price"] or "", "true", "true", img["src"], 1, "", "active"])
        else:
            w.writerow([x["handle"]] + [""] * 17 + [img["src"], i + 1, "", ""])
PY
if SHOPIFY_SOURCE=csv SHOPIFY_CSV_PATH=$TMP/products.csv IMPORT_ENTITIES=products IMPORT_MODE=apply npx medusa exec ./src/scripts/import-shopify.ts >"$TMP/csv-blocked.log" 2>&1; then fail "source switch should be refused without IMPORT_ALLOW_SOURCE_SWITCH"; fi
grep -q "IMPORT_ALLOW_SOURCE_SWITCH" "$TMP/csv-blocked.log" || fail "expected source-switch guard message"
pass "switching from API to CSV identity is refused by default"
IMPORT_ALLOW_SOURCE_SWITCH=true SHOPIFY_SOURCE=csv SHOPIFY_CSV_PATH=$TMP/products.csv IMPORT_ENTITIES=products IMPORT_MODE=apply npx medusa exec ./src/scripts/import-shopify.ts >"$TMP/csv.log" 2>&1 || { grep -E "ERROR" "$TMP/csv.log" | head; fail "csv import"; }
grep -q "products: created=0 updated=0 adopted=9" "$TMP/csv.log" || { grep "products:" "$TMP/csv.log"; fail "csv should adopt all 9 by handle"; }
[ "$(q "select count(*) from product where deleted_at is null")" = 9 ] || fail "csv duplicated products"
pass "CSV import after API import adopted 9 products by handle; still 9 products"

ACTIVATION_MODE=dry-run npx medusa exec ./src/scripts/send-customer-activation.ts >"$TMP/act.log" 2>&1 || true
grep -q "would send=3" "$TMP/act.log" || fail "activation dry-run"; pass "activation dry-run lists 3 migrated customers"
if ACTIVATION_MODE=send STOREFRONT_URL=http://localhost:3000 npx medusa exec ./src/scripts/send-customer-activation.ts >"$TMP/act2.log" 2>&1; then fail "send without SMTP must fail"; fi
grep -q "No email provider configured" "$TMP/act2.log" || fail "expected no-email-provider error"; pass "activation send refuses without an email provider"
echo "ALL SHOPIFY IMPORT INTEGRATION CHECKS PASSED"
