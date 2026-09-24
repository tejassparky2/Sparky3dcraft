# Rollback

There are three levels. Pick the smallest one that fixes the problem.

## 1. Code rollback (seconds, no data change)

Releases are immutable directories in `/opt/sparky/releases/<UTC timestamp>-<git sha>`. The
active one is the `/opt/sparky/current` symlink. `upgrade.sh` keeps the 5 newest, and never
deletes the active or the previous release.

```bash
sudo ./deploy/rollback.sh --list        # newest first; incomplete builds are marked and not selectable
sudo ./deploy/rollback.sh --previous    # newest complete release older than the current one
sudo ./deploy/rollback.sh --to <release-dir-name>
```

The script switches the symlink atomically, restarts the server and worker, waits for health,
restarts the storefront, and runs `healthcheck.sh`.

After a rollback the database may have been migrated by the newer release:

- If both releases ship the **same migration set**, the health check passes. This is the common case for storefront or backend fixes.
- If the database has migrations the older code doesn't know, the health check **warns**. Medusa migrations are additive, so older code usually works. If it doesn't, use level 2.

`upgrade.sh` rolls back **automatically** when anything fails after the switch: migrations, service start, storefront build or health check.

## 2. Code + database rollback (minutes, loses writes since the backup)

```bash
sudo ./deploy/rollback.sh --previous --restore-db /var/backups/sparky/<…-pre-upgrade>
```

`upgrade.sh` always takes a `pre-upgrade` backup first, and its path is printed in the upgrade
log. Orders placed after that backup are **not** in the restored database. Before restoring,
export or list them (Admin → Orders, sorted by date) so they can be re-entered or fulfilled
by hand. The replaced database is kept (`medusa_db_replaced_<ts>`) for recovering individual rows.

## 3. Platform rollback to Shopify (DNS; only during the cutover window)

Shopify stays intact during the cutover window. To go back:

1. Remove the Shopify storefront password, or re-enable the online store, if it was paused.
2. Point the DNS records back to Shopify:
   - apex `A 23.227.38.65`, `www` `CNAME shops.myshopify.com`, as they were before cutover
   - note the pre-cutover records in the release checklist; the values above are Shopify's standard ones, confirm them in Shopify Admin → Domains
3. Orders placed on Medusa after cutover live **only in Medusa**. Fulfil them from Medusa Admin, which
   stays reachable at `https://api.<domain>/app` because the `api` record keeps pointing to the VM.
4. Disable Medusa checkout while the storefront DNS propagates: `sudo systemctl stop sparky-storefront`.

## Tested

In the Ubuntu 24.04 test container:

- `upgrade.sh` to a new commit (backup → build → typecheck and tests → migrate → switch → health)
- `rollback.sh --previous`, which served pages with HTTP 200
- the refusal to switch to an incomplete release
- rolling forward with `--to`
- a production DB restore with swap

The automatic rollback inside `upgrade.sh` was **not** triggered by a real failure in testing.
Its logic is simple (switch the symlink back and restart) but it is unexercised.
