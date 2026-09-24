# Backup and restore

## What is backed up

`deploy/backup.sh` runs daily at 02:30 IST via the `sparky-backup.timer`. It also runs before
every upgrade, migration apply, restore and verification.

| File | Contents |
|---|---|
| `db.dump` | `pg_dump -Fc` of the Medusa database (catalog, customers, orders, settings, mappings) |
| `config.tgz` | `/etc/sparky` (env files, secrets, install answers, store config) and the nginx site config |
| `private-uploads.tgz` | Customer personalization photos, **only when stored on local disk** (S3 private bucket otherwise) |
| `manifest.json` | Timestamp, tag, active release path, counts of products/orders/customers/source mappings |
| `SHA256SUMS` | Checksums of all of the above |

- **Local copy:** `/var/backups/sparky/<UTC timestamp>-<tag>/`, root-only. Local backups older than `BACKUP_RETENTION_DAYS` (default 14) are removed, but **at least 3 are always kept**.
- **Off-machine copy** (when `BACKUP_S3_BUCKET` is set): the backup directory is packed as a tar and encrypted with `openssl enc -aes-256-cbc -pbkdf2 -iter 200000`, keyed by `BACKUP_ENCRYPTION_KEY`. It is uploaded to `s3://<bucket>/sparky-backups/`. Remote copies older than 60 days are pruned (`BACKUP_REMOTE_RETENTION_DAYS`).

> **Store `BACKUP_ENCRYPTION_KEY` offline** (password manager). If the VM is lost, the key is
> the only way to read the remote backups. `sudo grep BACKUP_ENCRYPTION_KEY /etc/sparky/secrets.env`

Product **media** lives in the OCI bucket and is not copied by `backup.sh`. Protect it with OCI
Object Storage **versioning** on `sparky-media`, or a replication policy or lifecycle rule.
Imported media can also be re-created from Shopify by re-running the import with
`IMPORT_FORCE_IMAGES=true` while Shopify still exists.

## Restore verification (non-destructive)

```bash
sudo ./deploy/restore.sh --verify-latest
```

This restores the newest backup into a **temporary** database, checks the checksums and compares
product, order and customer counts with the manifest, then drops the temporary database. It also
cleans up leftovers from interrupted runs. `healthcheck.sh` reports the date of the last
verification, and `final-verification.sh` runs it.

## Restore production

```bash
sudo ./deploy/restore.sh --list
sudo ./deploy/restore.sh --from /var/backups/sparky/<dir> --yes-restore-production [--with-uploads]
```

Steps:

1. Takes a safety backup (`pre-restore`) of the current state.
2. Restores into a new database and verifies it (checksums and counts).
3. Stops the storefront, worker and server.
4. Swaps databases by rename. The old database is **kept** as `medusa_db_replaced_<timestamp>`.
5. Starts the services and runs the health check.

Drop the kept database once you are satisfied:
`sudo -u postgres dropdb medusa_db_replaced_<timestamp>`.

Restoring an older database under newer code: first roll the code back to the release that made
the backup (`manifest.json` → `release`) with `rollback.sh --to <release>`, or use
`rollback.sh --previous --restore-db <dir>`, which does both.

## Disaster recovery (VM lost)

1. Create a new VM, clone the repo at the same release, and run `install.sh` with the same answers (domains, buckets).
2. Put `BACKUP_ENCRYPTION_KEY` back into `/etc/sparky/secrets.env` (0600).
3. `sudo ./deploy/restore.sh --fetch-remote <backup name>`. This downloads, decrypts and checksum-verifies the backup into `/var/backups/sparky/`.
4. `sudo ./deploy/restore.sh --from /var/backups/sparky/<backup name> --yes-restore-production --with-uploads`.
5. Compare `config.tgz` with the new `/etc/sparky` (the secrets for Razorpay, SMTP and S3 are the same). Then point DNS at the new VM.

## Tested

In the Ubuntu 24.04 test container (with an S3-compatible endpoint), the following were run and passed:

- daily backup, encrypted remote upload and remote listing
- `--verify-latest`
- a production restore with DB swap: health check 0 failures afterwards
- temp-database cleanup
- `--fetch-remote`: download, decrypt and checksum-verify, with the result byte-identical to the original local backup

Not tested: real OCI Object Storage as the backup target (the test used an S3-compatible
emulator), and a full disaster recovery onto a second VM.
