# shellcheck shell=bash
# Stages: node, database, redis

NODE_MAJOR=${NODE_MAJOR:-22}

stage_node() {
  local cur=""
  have node && cur=$(node -v)
  if [[ "$cur" =~ ^v${NODE_MAJOR}\. ]] && node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)'; then
    skip "Node $cur already installed"
  else
    # NodeSource publishes arm64 and amd64 builds for Ubuntu (verified in preflight arch check)
    install -d -m 0755 /etc/apt/keyrings
    if [ ! -f /etc/apt/keyrings/nodesource.gpg ]; then
      CURRENT_CMD="download NodeSource signing key"
      curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    fi
    chmod 0644 /etc/apt/keyrings/nodesource.gpg # apt reads keys as the unprivileged _apt user
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
    run apt-get update -q
    run apt-get install -y -q nodejs
  fi
  local na
  na=$(node -p process.arch)
  case "$(arch)/$na" in arm64/arm64 | amd64/x64) ;; *) die "node architecture $na does not match host $(uname -m)" ;; esac
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)' || die "Node >= 22.12 required by Medusa 2.21 (have $(node -v))"
  pass "Node $(node -v) ($na), npm $(npm -v)"
}

stage_database() {
  run systemctl enable --now postgresql
  local pgver confd
  pgver=$(psql --version | awk '{print $3}' | cut -d. -f1)
  confd=/etc/postgresql/$pgver/main/conf.d
  install -d "$confd"
  cp "$DEPLOY_DIR/postgres/sparky.conf" /tmp/sparky-pg.conf
  if install_if_changed /tmp/sparky-pg.conf "$confd/sparky.conf" 0644 postgres:postgres; then
    run systemctl restart postgresql
    pass "PostgreSQL tuning installed ($confd/sparky.conf)"
  fi
  local pass_db
  pass_db=$(secret DB_PASSWORD 24)
  # role: create or re-sync password (idempotent)
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='medusa'" | grep -q 1; then
    CURRENT_CMD="ALTER ROLE medusa PASSWORD <redacted>"
    # shellcheck disable=SC2024 # the log is root-owned and we run as root
    printf "\\set pw '%s'\nALTER ROLE medusa WITH LOGIN PASSWORD :'pw';\n" "$pass_db" | sudo -u postgres psql -q -v ON_ERROR_STOP=1 >>"$SPARKY_LOG" 2>&1
    skip "role medusa exists (password synced)"
  else
    CURRENT_CMD="CREATE ROLE medusa <redacted>"
    # shellcheck disable=SC2024 # the log is root-owned and we run as root
    printf "\\set pw '%s'\nCREATE ROLE medusa WITH LOGIN PASSWORD :'pw';\n" "$pass_db" | sudo -u postgres psql -q -v ON_ERROR_STOP=1 >>"$SPARKY_LOG" 2>&1
    pass "created role medusa"
  fi
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='medusa_db'" | grep -q 1; then
    skip "database medusa_db exists"
  else
    run sudo -u postgres createdb -O medusa medusa_db
    pass "created database medusa_db"
  fi
  run sudo -u postgres psql -q -d medusa_db -c "CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;"
  # never listen publicly
  if sudo -u postgres psql -tAc "SHOW listen_addresses" | grep -qvE '^(localhost|127\.0\.0\.1)$'; then
    die "PostgreSQL listen_addresses is not localhost-only"
  fi
  PGPASSWORD="$pass_db" psql -h 127.0.0.1 -U medusa -d medusa_db -tAc "SELECT 1" | grep -q 1 || die "cannot connect as medusa"
  pass "PostgreSQL: medusa@127.0.0.1/medusa_db reachable; listening on localhost only"
}

stage_redis() {
  local pw
  pw=$(secret REDIS_PASSWORD 32)
  export REDIS_PASSWORD=$pw
  local ram_mb
  ram_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  if [ "$ram_mb" -ge 8000 ]; then export REDIS_MAXMEMORY=1gb; else export REDIS_MAXMEMORY=384mb; fi
  render "$DEPLOY_DIR/redis/sparky.conf" /tmp/sparky-redis.conf
  local changed=0
  install_if_changed /tmp/sparky-redis.conf /etc/redis/sparky.conf 0640 redis:redis && changed=1
  if ! grep -q '^include /etc/redis/sparky.conf' /etc/redis/redis.conf; then
    echo 'include /etc/redis/sparky.conf' >>/etc/redis/redis.conf
    changed=1
  fi
  run systemctl enable redis-server
  if [ "$changed" = 1 ]; then run systemctl restart redis-server; fi
  sleep 1
  REDISCLI_AUTH=$pw redis-cli -h 127.0.0.1 ping | grep -q PONG || die "redis did not answer PING with the configured password"
  if redis-cli -h 127.0.0.1 ping 2>/dev/null | grep -q PONG; then die "redis answers without a password"; fi
  [ "$(REDISCLI_AUTH=$pw redis-cli -h 127.0.0.1 config get maxmemory-policy | tail -1)" = noeviction ] || die "redis maxmemory-policy must be noeviction (BullMQ)"
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ':6379$' | grep -vqE '^(127\.0\.0\.1|\[::1\]):6379$'; then
    die "redis is listening on a non-loopback address"
  fi
  pass "Redis: password required, loopback only, noeviction, maxmemory $REDIS_MAXMEMORY"
}
