# shellcheck shell=bash
# Stages: migration, systemd, nginx, tls, backups, tests

stage_migration() {
  if [ "$MIGRATION_SOURCE" = skip ]; then
    skip "Shopify migration skipped (run deploy/migrate.sh later)"
    return 0
  fi
  "$DEPLOY_DIR/migrate.sh" --apply
}

stage_systemd() {
  local u
  for u in sparky-medusa-server sparky-medusa-worker sparky-storefront; do
    systemctl is-enabled --quiet "$u" || die "$u is not enabled"
    systemctl is-active --quiet "$u" || die "$u is not running"
    [ "$(systemctl show -p Restart --value "$u")" = on-failure ] || die "$u must restart on failure"
  done
  pass "services enabled at boot, running, Restart=on-failure: server, worker, storefront"
}

stage_nginx() {
  local tmp f
  install -d /etc/nginx/snippets
  for f in proxy-params security-headers api-locations storefront-locations tls; do
    tmp=$(mktemp)
    cp "$DEPLOY_DIR/nginx/$f.conf" "$tmp"
    install_if_changed "$tmp" "/etc/nginx/snippets/sparky-$f.conf" 0644 || true
  done
  tmp=$(mktemp)
  cp "$DEPLOY_DIR/nginx/sparky-common.conf" "$tmp"
  install_if_changed "$tmp" /etc/nginx/conf.d/sparky-common.conf 0644 || true
  # default server: drop requests for unknown hostnames
  tmp=$(mktemp)
  printf 'server {\n  listen 80 default_server;\n  listen [::]:80 default_server;\n  server_name _;\n  location ^~ /.well-known/acme-challenge/ { root /var/www/letsencrypt; }\n  location / { return 444; }\n}\n' >"$tmp"
  strip_ipv6_if_unsupported "$tmp"
  install_if_changed "$tmp" /etc/nginx/sites-available/sparky-default 0644 || true
  ln -sfn /etc/nginx/sites-available/sparky-default /etc/nginx/sites-enabled/sparky-default
  rm -f /etc/nginx/sites-enabled/default
  write_site_config
  CURRENT_CMD="nginx -t"
  local nt
  nt=$(nginx -t 2>&1) || { printf '%s\n' "$nt" | sed 's/^/        /' >&2; die "nginx configuration test failed (nginx -t)"; }
  run systemctl enable nginx
  run systemctl reload-or-restart nginx
  pass "nginx configured and reloaded (config test passed)"
}

# Hosts without IPv6 in the kernel cannot bind [::]:80 — drop those listeners.
strip_ipv6_if_unsupported() {
  if [ ! -e /proc/net/if_inet6 ]; then
    sed -i '/listen \[::\]/d' "$1"
  fi
}

CERT_NAME=${CERT_NAME:-sparky}
export CERT_NAME

# write_site_config [http|https]   (default: https when a certificate exists)
write_site_config() {
  local tmp variant=${1:-http}
  if [ -z "${1:-}" ] && [ -f "/etc/letsencrypt/live/$CERT_NAME/fullchain.pem" ]; then variant=https; fi
  tmp=$(mktemp)
  render "$DEPLOY_DIR/nginx/sparky-$variant.conf" "$tmp"
  strip_ipv6_if_unsupported "$tmp"
  install_if_changed "$tmp" /etc/nginx/sites-available/sparky 0644 || true
  ln -sfn /etc/nginx/sites-available/sparky /etc/nginx/sites-enabled/sparky
  info "nginx site variant: $variant"
}

# Proves DNS points here AND port 80 is reachable from outside, using the
# same path Let's Encrypt will use.
probe_domain() {
  local d=$1 token
  token=$(gen_secret 16)
  install -d /var/www/letsencrypt/.well-known/acme-challenge
  echo "$token" >"/var/www/letsencrypt/.well-known/acme-challenge/sparky-probe"
  local got
  got=$(curl -fsS --max-time 10 "http://$d/.well-known/acme-challenge/sparky-probe" 2>/dev/null || true)
  rm -f /var/www/letsencrypt/.well-known/acme-challenge/sparky-probe
  [ "$got" = "$token" ]
}

stage_tls() {
  if [ "$ENABLE_TLS" != yes ]; then
    warn "TLS disabled: Medusa Admin login needs HTTPS (secure cookies). Use only for local tests."
    return 0
  fi
  local domains=() d
  for d in "$STORE_DOMAIN" "www.$STORE_DOMAIN" "$API_DOMAIN"; do
    if probe_domain "$d"; then
      pass "DNS + port 80 reach this server: $d"
      domains+=(-d "$d")
    elif [ "$d" = "www.$STORE_DOMAIN" ]; then
      warn "www.$STORE_DOMAIN does not reach this server — certificate issued without it"
    else
      die "$d does not resolve to this server or port 80 is blocked (OCI security list / host firewall). DNS must be set before TLS."
    fi
  done
  CURRENT_CMD="certbot certonly --webroot"
  run certbot certonly --webroot -w /var/www/letsencrypt --cert-name "$CERT_NAME" "${domains[@]}" \
    --non-interactive --agree-tos -m "$LETSENCRYPT_EMAIL" --keep-until-expiring --expand
  install -d /etc/letsencrypt/renewal-hooks/deploy
  printf '#!/bin/sh\nsystemctl reload nginx\n' >/etc/letsencrypt/renewal-hooks/deploy/sparky-reload-nginx.sh
  chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/sparky-reload-nginx.sh
  write_site_config https
  local nt
  if ! nt=$(nginx -t 2>&1); then
    printf '%s\n' "$nt" | sed 's/^/        /' >&2
    # never leave a config nginx cannot load (a restart or reboot would take the site down)
    write_site_config http
    nginx -t >>"$SPARKY_LOG" 2>&1 && systemctl reload nginx
    die "nginx configuration test failed after enabling TLS — HTTP config restored; certificate is kept"
  fi
  run systemctl reload nginx
  systemctl is-enabled --quiet certbot.timer 2>/dev/null && pass "automatic renewal: certbot.timer enabled" || warn "certbot.timer not enabled — check renewal"
  CURRENT_CMD="certbot renew --dry-run"
  if certbot renew --dry-run --cert-name "$CERT_NAME" >>"$SPARKY_LOG" 2>&1; then pass "certificate renewal dry-run OK"; else warn "renewal dry-run failed (see log)"; fi
  local d2
  for d2 in "$STORE_DOMAIN" "$API_DOMAIN"; do
    curl -fsS -o /dev/null --max-time 15 "https://$d2/" -H 'User-Agent: sparky-installer' 2>/dev/null || curl -fsS -o /dev/null --max-time 15 "https://$d2/health" || die "https://$d2 not reachable with a valid certificate"
    pass "https://$d2 valid certificate"
  done
}

stage_backups() {
  if [ "${ENABLE_BACKUPS:-yes}" != yes ]; then
    skip "backups disabled by answer"
    return 0
  fi
  conf_set "$SPARKY_INSTALL_CONF" BACKUP_RETENTION_DAYS "${BACKUP_RETENTION_DAYS:-14}"
  if [ -n "${BACKUP_S3_BUCKET:-}" ]; then conf_set "$SPARKY_INSTALL_CONF" BACKUP_S3_BUCKET "$BACKUP_S3_BUCKET"; fi
  install_units sparky-backup.service sparky-backup.timer sparky-healthcheck.service sparky-healthcheck.timer
  run systemctl enable --now sparky-backup.timer sparky-healthcheck.timer
  "$DEPLOY_DIR/backup.sh" --tag install >>"$SPARKY_LOG" 2>&1 || die "first backup failed"
  pass "daily backup timer enabled; first backup written"
  "$DEPLOY_DIR/restore.sh" --verify-latest >>"$SPARKY_LOG" 2>&1 || die "backup restore verification failed"
  pass "backup verified by restoring into a temporary database"
}

stage_tests() {
  "$DEPLOY_DIR/healthcheck.sh" || die "health check failed"
}
