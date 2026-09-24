# shellcheck shell=bash
# Answers, plan and final report. Only what the installer genuinely needs.

collect_answers() {
  CURRENT_STAGE=answers
  ask SPARKY_MODE "Mode (staging = safe test deployment, noindex; production = cutover)" "staging"
  case "$SPARKY_MODE" in staging | production) ;; *) die "SPARKY_MODE must be staging or production" ;; esac
  ask STORE_DOMAIN "Storefront domain" "sparky3dcraft.tech"
  ask API_DOMAIN "API + Admin domain (Admin at https://<api>/app)" "api.${STORE_DOMAIN}"
  ask ADMIN_EMAIL "Medusa Admin email"
  ask ENABLE_TLS "Obtain Let's Encrypt certificates now? (yes/no — DNS must already point here)" "yes"
  if [ "$ENABLE_TLS" = yes ]; then ask LETSENCRYPT_EMAIL "Email for Let's Encrypt expiry notices" "$ADMIN_EMAIL"; fi
  ask FILE_PROVIDER "Product media storage: s3 (OCI Object Storage / R2 / S3) or local (staging only)" "s3"
  if [ "$FILE_PROVIDER" = s3 ]; then
    ask S3_ENDPOINT "S3 endpoint (OCI: https://<namespace>.compat.objectstorage.<region>.oraclecloud.com)"
    ask S3_REGION "S3 region (OCI region id, e.g. ap-mumbai-1)"
    ask S3_BUCKET "Public bucket for product media"
    ask S3_FILE_URL "Public base URL of that bucket (OCI: https://objectstorage.<region>.oraclecloud.com/n/<namespace>/b/<bucket>/o)"
    ask S3_PRIVATE_BUCKET "PRIVATE bucket for customer personalization photos (empty = local disk on this VPS)" "" no
    ask S3_ACCESS_KEY_ID "S3 access key id (OCI: Customer Secret Key access key)"
    ask_secret S3_SECRET_ACCESS_KEY "S3 secret access key"
    [ -n "$S3_SECRET_ACCESS_KEY" ] || die "S3 secret access key is required for FILE_PROVIDER=s3"
    ask S3_DISABLE_ACL "Omit per-object ACL headers (yes for OCI)" "yes"
  fi
  ask_secret RAZORPAY_KEY_ID "Razorpay key id (rzp_live_… / rzp_test_…; empty = no online payment yet)"
  if [ -n "$RAZORPAY_KEY_ID" ]; then
    ask_secret RAZORPAY_KEY_SECRET "Razorpay key secret"
    ask_secret RAZORPAY_WEBHOOK_SECRET "Razorpay webhook secret (Dashboard → Webhooks)"
  fi
  ask COD_ENABLED "Offer Cash on Delivery? (the current Shopify store does not) (true/false)" "false"
  if [ "$COD_ENABLED" = true ]; then ask COD_MAX_ORDER_AMOUNT "Maximum order value for COD in INR (empty = no limit)" "" no; fi
  ask SMTP_HOST "SMTP host for transactional email (empty = no emails; password reset will not work)" "" no
  if [ -n "$SMTP_HOST" ]; then
    ask SMTP_PORT "SMTP port" "587"
    ask SMTP_SECURE "SMTP implicit TLS (true for 465, false for STARTTLS/587)" "false"
    ask SMTP_USER "SMTP username" "" no
    ask_secret SMTP_PASS "SMTP password"
    ask SMTP_FROM "From address, e.g. Sparky 3D Craft Co <orders@${STORE_DOMAIN}>"
    ask MERCHANT_NOTIFICATION_EMAIL "Where to send contact-form messages" "$ADMIN_EMAIL"
  fi
  ask SHIPPING_STANDARD_AMOUNT "Standard shipping price in INR (merchant-approved; 0 = free)"
  [[ "$SHIPPING_STANDARD_AMOUNT" =~ ^[0-9]+(\.[0-9]{1,2})?$ ]] || die "shipping price must be a number"
  ask SHIPPING_FREE_THRESHOLD "Free shipping when items total ≥ INR (empty = never)" "" no
  ask WAREHOUSE_CITY "Dispatch location city" "Bengaluru"
  ask WAREHOUSE_POSTCODE "Dispatch location PIN code" "560086"
  ask MIGRATION_SOURCE "Shopify migration source: public (no credentials), admin (API token), csv, skip" "public"
  case "$MIGRATION_SOURCE" in
    public) ask SHOPIFY_STORE_URL "Shopify store URL" "https://${STORE_DOMAIN}" ;;
    admin)
      ask SHOPIFY_SHOP_DOMAIN "Shopify shop domain (xxxx.myshopify.com)"
      ask_secret SHOPIFY_ADMIN_TOKEN "Shopify Admin API access token"
      ask SHOPIFY_IMPORT_ENTITIES "Entities to import" "products,collections,customers,orders"
      ;;
    csv) ask SHOPIFY_CSV_PATH "Path to Shopify products CSV export" ;;
    skip) ;;
    *) die "MIGRATION_SOURCE must be public|admin|csv|skip" ;;
  esac
  ask ENABLE_BACKUPS "Enable daily backups? (yes/no)" "yes"
  if [ "$ENABLE_BACKUPS" = yes ]; then
    ask BACKUP_S3_BUCKET "Off-machine backup bucket (S3-compatible, private; empty = local only)" "" no
    ask BACKUP_RETENTION_DAYS "Local backup retention in days" "14"
  fi
  if [ "$SPARKY_MODE" = production ] && [ "$FILE_PROVIDER" != s3 ]; then
    die "production mode requires FILE_PROVIDER=s3 (local media storage is staging-only)"
  fi
}

print_plan() {
  CURRENT_STAGE=plan
  echo "PLAN"
  echo "  mode ............. $SPARKY_MODE$([ "$SPARKY_MODE" = staging ] && echo " (search engines blocked, DNS unchanged)")"
  local sc=https
  [ "$ENABLE_TLS" = yes ] || sc=http
  echo "  storefront ....... $sc://$STORE_DOMAIN  → 127.0.0.1:3000 (Next.js)"
  echo "  api + admin ...... $sc://$API_DOMAIN (/app)  → 127.0.0.1:9000 (Medusa server) + worker 127.0.0.1:9001"
  echo "  database ......... PostgreSQL 16 medusa_db (localhost only)"
  echo "  redis ............ Redis 7 (localhost only, password, noeviction)"
  echo "  media ............ $FILE_PROVIDER${S3_BUCKET:+ ($S3_BUCKET)}"
  echo "  payments ......... $([ -n "${RAZORPAY_KEY_ID:-}" ] && echo "Razorpay${RAZORPAY_KEY_ID:0:8}…" || echo "Razorpay NOT configured") $([ "$COD_ENABLED" = true ] && echo "+ COD")"
  echo "  email ............ ${SMTP_HOST:-NOT configured}"
  echo "  migration ........ $MIGRATION_SOURCE"
  echo "  TLS .............. $ENABLE_TLS"
  echo "  backups .......... ${ENABLE_BACKUPS}${BACKUP_S3_BUCKET:+ + remote $BACKUP_S3_BUCKET}"
  echo "  public ports ..... 22, 80, 443 only"
  echo
  if [ "${SPARKY_NONINTERACTIVE:-0}" != 1 ] && [ -t 0 ]; then
    read -r -p "Proceed? [y/N] " ok
    [ "$ok" = y ] || [ "$ok" = Y ] || die "aborted by user"
  fi
}

print_report() {
  local url_s="https://$STORE_DOMAIN" url_a="https://$API_DOMAIN/app"
  [ "$ENABLE_TLS" = yes ] || { url_s="http://$STORE_DOMAIN"; url_a="http://$API_DOMAIN/app"; }
  echo
  echo "REPORT"
  pass "installation complete ($SPARKY_MODE mode)"
  echo "  storefront: $url_s"
  echo "  admin:      $url_a   (user: $ADMIN_EMAIL — initial password in $SPARKY_SECRETS, change it after first login)"
  echo "  health:     sudo $SPARKY_CURRENT/deploy/healthcheck.sh"
  echo "  backup:     sudo $SPARKY_CURRENT/deploy/backup.sh"
  echo "  verify:     sudo $SPARKY_CURRENT/deploy/final-verification.sh --mode $SPARKY_MODE"
  echo "  log:        $SPARKY_LOG"
  if [ -z "${RAZORPAY_KEY_ID:-}" ]; then warn "online payments are not configured (Razorpay keys missing)"; fi
  if [ -z "${SMTP_HOST:-}" ]; then warn "email is not configured: order confirmations and password resets will not be sent"; fi
  if [ "$SPARKY_MODE" = staging ]; then info "staging: when all checks pass, follow docs/release/RELEASE-CHECKLIST.md for cutover"; fi
}
