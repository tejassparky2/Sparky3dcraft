# shellcheck shell=bash
# Stages: preflight, system

stage_preflight() {
  local os ver a ram_mb disk_gb
  os=$(. /etc/os-release && echo "$ID")
  ver=$(. /etc/os-release && echo "$VERSION_ID")
  a=$(arch)
  info "uname -m: $(uname -m)   nproc: $(nproc)"
  free -h | sed 's/^/        /'
  df -h / | sed 's/^/        /'
  if swapon --show | grep -q .; then swapon --show | sed 's/^/        /'; else info "no swap configured"; fi

  [ "$os" = ubuntu ] || die "unsupported OS $os (Ubuntu 24.04 required)"
  if [ "$ver" = "24.04" ]; then pass "Ubuntu $ver"; else warn "Ubuntu $ver (tested on 24.04)"; fi
  case "$a" in
    arm64) pass "architecture aarch64/arm64 (Oracle Ampere A1 target)" ;;
    amd64) warn "architecture x86_64 — supported, but the production target is ARM64" ;;
    *) die "unsupported architecture $(uname -m)" ;;
  esac
  ram_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  [ "$ram_mb" -ge 3500 ] || die "at least 4 GB RAM required (found ${ram_mb} MB)"
  pass "RAM ${ram_mb} MB"
  disk_gb=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
  [ "$disk_gb" -ge 8 ] || die "at least 8 GB free disk required (found ${disk_gb} GB)"
  pass "free disk ${disk_gb} GB"
  for host in registry.npmjs.org deb.nodesource.com; do
    if curl -fsS -o /dev/null --max-time 15 "https://$host/"; then pass "reachable: $host"; else warn "cannot reach https://$host (install will fail if it stays unreachable)"; fi
  done
  # port conflicts with something that is not ours
  local p pid cmd
  for p in 80 443 3000 9000 9001; do
    pid=$(lsof -t -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | head -1 || true)
    [ -n "$pid" ] || continue
    cmd=$(tr '\0' ' ' </proc/"$pid"/cmdline 2>/dev/null | cut -c1-80)
    case "$cmd" in
      *nginx* | *"$SPARKY_HOME"*) info "port $p used by our service ($cmd)" ;;
      *) warn "port $p is in use by: $cmd — see the 'existing' stage" ;;
    esac
  done
}

stage_system() {
  export DEBIAN_FRONTEND=noninteractive
  CURRENT_CMD="apt-get update"
  run apt-get update -q
  CURRENT_CMD="apt-get install base packages"
  run apt-get install -y -q ca-certificates curl gnupg git jq rsync unzip lsof openssl \
    nginx postgresql postgresql-contrib redis-server certbot iptables-persistent logrotate
  pass "base packages installed (nginx $(nginx -v 2>&1 | cut -d/ -f2), PostgreSQL $(psql --version | awk '{print $3}'), Redis $(redis-server --version | awk '{print $3}' | cut -d= -f2))"

  if ! id "$SPARKY_USER" >/dev/null 2>&1; then
    run useradd --system --home-dir "$SPARKY_HOME" --shell /usr/sbin/nologin "$SPARKY_USER"
    pass "created system user $SPARKY_USER"
  else
    skip "user $SPARKY_USER exists"
  fi
  install -d -m 0755 -o "$SPARKY_USER" -g "$SPARKY_USER" "$SPARKY_HOME" "$SPARKY_RELEASES"
  install -d -m 0750 -o "$SPARKY_USER" -g "$SPARKY_USER" "$SPARKY_VAR" "$SPARKY_VAR/private-uploads" "$SPARKY_VAR/migration-snapshots" "$SPARKY_LOG_DIR"
  install -d -m 0700 -o root -g root "$SPARKY_BACKUP_DIR" "$SPARKY_STATE_DIR"
  install -d -m 0750 -o root -g "$SPARKY_USER" "$SPARKY_ETC"
  install -d -m 0755 /var/www/letsencrypt

  # swap: builds (Next.js/Medusa admin) spike memory. Optional — never fatal.
  if swapon --show | grep -q .; then
    skip "swap already configured"
  elif systemd-detect-virt --container >/dev/null 2>&1; then
    skip "running in a container — swap not managed here"
  else
    if [ ! -f /swapfile ]; then
      fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >>"$SPARKY_LOG" 2>&1 || true
    fi
    if swapon /swapfile >>"$SPARKY_LOG" 2>&1; then
      grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
      pass "2 GB swap enabled"
    else
      warn "could not enable swap (filesystem does not support swapfiles?) — continuing without swap"
    fi
  fi

  open_firewall_ports
}

# Oracle Cloud Ubuntu images ship iptables rules ending in a REJECT; UFW must
# NOT be enabled there. Insert ACCEPT for 80/443 before the REJECT and persist.
# Nothing is opened for 3000/9000/5432/6379 (they bind to localhost anyway).
open_firewall_ports() {
  if have ufw && ufw status 2>/dev/null | grep -q "Status: active"; then
    warn "UFW is active; ensuring 80/443 allowed (not changing other UFW rules)"
    run ufw allow 80/tcp
    run ufw allow 443/tcp
    return 0
  fi
  local changed=0 port
  for port in 80 443; do
    if ! iptables -C INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT 2>/dev/null; then
      local pos
      pos=$(iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')
      if [ -n "$pos" ]; then
        run iptables -I INPUT "$pos" -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT
      else
        run iptables -A INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT
      fi
      changed=1
    fi
  done
  if [ "$changed" = 1 ]; then
    run netfilter-persistent save
    pass "host firewall: 80/443 accepted (persisted). Also allow them in the OCI Security List / NSG."
  else
    skip "host firewall already accepts 80/443"
  fi
}
