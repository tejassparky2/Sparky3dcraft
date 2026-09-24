# Troubleshooting

Start with:

```bash
sudo ./deploy/healthcheck.sh      # what is broken
sudo ./deploy/diagnose.sh         # versions, services, ports, redacted env, recent errors
```

Every installer failure prints the stage, the command, the last log lines and a likely cause.
Re-running `install.sh` is always safe: completed stages are skipped.

## Installer

| Symptom | Cause | Fix |
|---|---|---|
| `NO_PUBKEY` / NodeSource apt error | keyring unreadable (restrictive umask) | fixed in the installer (keyring made 0644). Re-run `--from-stage node` |
| `npm ... SELF_SIGNED_CERT_IN_CHAIN` | a TLS-intercepting proxy | export `NODE_EXTRA_CA_CERTS=/path/ca.pem` (and `HTTPS_PROXY`) before `sudo -E ./deploy/install.sh`. They are passed to the `sparky` user |
| `could not enable swap` warning | container, or a filesystem without swapfile support | harmless. On a VM with < 8 GB RAM, add swap manually |
| `missing required answer: X` | non-interactive run without that key | add it to the answers file |
| `shipping price must be a number` | no merchant-approved shipping price given | get the price from the merchant (docs/SHIPPING.md) |
| certbot fails | DNS not pointing here yet, or port 80 blocked in the OCI Security List | `dig +short <domain>` must return this VM's IP. Open 80/443 in OCI. Then `--only tls` |
| nginx `[::]:80` bind error | IPv6 disabled | the installer strips IPv6 listeners automatically when IPv6 is unavailable |

## Medusa

| Symptom | Cause | Fix |
|---|---|---|
| server exits at start with `Refusing to start: ...` | production env validation (weak secret, missing REDIS_URL, wildcard CORS, test-only variable) | read the message and fix `/etc/sparky/backend.env` via the installer |
| `/health` fails, log shows Redis `NOAUTH`/`ECONNREFUSED` | Redis down or password mismatch | `systemctl status redis-server`, then `redis-cli -a "$(sudo grep ^REDIS_PASSWORD= /etc/sparky/secrets.env \| cut -d= -f2)" ping` |
| orders not emailed, webhooks not processed | **worker** not running | `systemctl status sparky-medusa-worker`, then `curl 127.0.0.1:9001/health` |
| `EACCES` writing under `/opt` | something tried to write into the read-only release | services may write only to `/var/lib/sparky`, the logs and `.medusa/server` (systemd `ReadWritePaths`) |
| Admin login loops / cookie not set | reached over HTTP, or `X-Forwarded-Proto` missing | use `https://api.<domain>/app`. The nginx proxy params set `X-Forwarded-Proto` |
| `migrations match` warning after rollback | DB has migrations newer than the code | usually harmless. If errors appear: `rollback.sh --restore-db` (docs/ROLLBACK.md) |

## Storefront

| Symptom | Cause | Fix |
|---|---|---|
| Admin edits not visible | revalidation call failing | worker log `storefront-revalidate`. Both env files must share the same `REVALIDATE_SECRET` (re-run `--from-stage medusa`). Pages refresh within 30 s anyway |
| images broken | bucket not public-read, or `MEDUSA_IMAGE_HOSTS` missing the bucket URL | `curl -I <image url>` must return 200 without auth. Re-run `--from-stage storefront` |
| "Failed to fetch" at checkout | `STORE_CORS` doesn't include the exact storefront origin | re-run `--from-stage medusa` with the right domains |
| site shows noindex in production | still built in staging mode | `install.sh --mode production --from-stage medusa` (the storefront is rebuilt) |
| 502 from nginx | storefront or Medusa down | `systemctl status sparky-storefront`, then `journalctl -u sparky-storefront -n 100` |

## Payments

| Symptom | Cause | Fix |
|---|---|---|
| Razorpay button missing | Razorpay not enabled on the region (keys missing) | `healthcheck.sh` → PAYMENT. Re-run the installer with keys |
| paid but no order | browser closed before completion **and** webhook not delivered | Razorpay Dashboard → Webhooks → deliveries. The URL must be `https://api.<domain>/hooks/razorpay`, return 200, and use the same secret as `RAZORPAY_WEBHOOK_SECRET`. The worker must be running. After fixing, Razorpay retries automatically for 24 h |
| webhook deliveries 400 | secret mismatch | set the same secret in Dashboard and installer |
| webhook deliveries 503 | `RAZORPAY_WEBHOOK_SECRET` empty | configure it |

## Backups

| Symptom | Fix |
|---|---|
| `remote upload failed` | check S3 credentials and bucket name. `sudo ./deploy/healthcheck.sh` → BACKUP |
| restore verify count mismatch | the backup was taken during a write-heavy moment, or it is corrupt. Try the previous backup. Never restore production from a backup that fails `--verify-latest` |
