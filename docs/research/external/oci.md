# Oracle Cloud (OCI): Object Storage S3 compatibility, Always Free, Ampere A1 and Ubuntu 24.04

Researched: 2026-09-24.

## Question

This covers the OCI S3 Compatibility API:

- endpoints, keys and path-style addressing
- the public object URL format
- AWS SDK v3 incompatibilities (checksums, ACLs)
- Always Free limits

It also covers the Ampere A1 / Ubuntu 24.04 host: the iptables REJECT rule, security lists and NSGs, Node 22 on arm64, PostgreSQL 16, Redis 7 and certbot.

## Findings

### 1. S3 Compatibility API

**Endpoints** (from the "Object Storage Amazon S3 Compatibility API" and "Dedicated Endpoints" docs):

- Traditional path-style: `https://<namespace>.compat.objectstorage.<region>.oraclecloud.com`
- Dedicated (recommended by Oracle "for the strongest security posture"): `https://<namespace>.compat.objectstorage.<region>.oci.customer-oci.com`. "Your existing Object Storage service API endpoints continue to work, and using dedicated endpoints is optional."
- Virtual-hosted style is supported since **2026-02-10**: `https://<bucket>.vhcompat.objectstorage.<region>.oci.customer-oci.com`. Existing buckets need an update, which has been possible since 2026-04-20. **Path-style works everywhere and remains the safe choice.** Oracle's AWS SDK examples use `enablePathStyleAccess()` / `s3ForcePathStyle: true`.
- Dual-stack IPv6 endpoints (`ds.oci.customer-oci.com`) are available since 2026-08-11.
- **Region:** use the OCI region identifier (for example `ap-mumbai-1`). "If your application doesn't support setting the region identifier … set the region to `us-east-1` or leave it blank … you can only use the Amazon S3 Compatibility API in your … home region."
- **Credentials:** a **Customer Secret Key** (access key and secret key pair) created per user in the Console (User settings → Customer secret keys). Only SigV4 is accepted ("AWS Signature Version 2 (SigV2) isn't supported").
- Buckets created through the S3 API land in the root compartment unless you set a designated S3 compartment. Create the bucket in the Console instead.
- **ACLs:** "Oracle Cloud Infrastructure doesn't use ACLs for objects." Visibility is set per bucket, not per object.
- **Checksums** (release notes and support doc):
  - Since **2026-07-17**, `Content-Encoding: aws-chunked` (single and multipart) with **trailer checksums** CRC32, CRC32C, SHA256 and CRC64NVME is supported and validated.
  - Since the same date, `DeleteObjects`/BulkDelete accepts `x-amz-checksum-sha256` and `x-amz-checksum-crc32c` as alternatives to `Content-MD5`.
  - **`x-amz-checksum-crc32` on DeleteObjects is rejected with 400** "Missing required header for this request: Content-Md5". A third party tested this against a real bucket on 2026-08-26: https://github.com/thanatostyrannos/elasticsearch-oci-s3-workaround
  - Before 2026-07, community reports show OCI returning `501 NotImplemented "AWS chunked encoding not supported"` for AWS SDK v3.729+ default checksums.
- **AWS SDK v3 behaviour** (verified in `@aws-sdk/checksums@3.1001.1`):
  - `DEFAULT_CHECKSUM_ALGORITHM = ChecksumAlgorithm.CRC32`.
  - A checksum is added when `requestChecksumCalculation === WHEN_SUPPORTED || requestChecksumRequired`.
  - So `requestChecksumCalculation: "WHEN_REQUIRED"` removes checksums from PutObject and UploadPart. **DeleteObjects is a "checksum required" operation, so it still gets CRC32, which OCI rejects.**
  - Setting `AWS_REQUEST_CHECKSUM_CALCULATION=when_required` and `AWS_RESPONSE_CHECKSUM_VALIDATION=when_required` through the environment is equivalent.

**Public read URLs**

- Bucket visibility: `oci os bucket update --name <b> --public-access-type [NoPublicAccess | ObjectRead | ObjectReadWithoutList]`. The Console path is Actions → Edit visibility.
  - The Oracle page's literal text says "ObjectReadWithoutList: Allows public access for the GetObject, HeadObject, and ListObjects operations. ObjectRead: Allows public access for the GetObject and HeadObject operations."
  - That reads inverted relative to the names. Verify with an anonymous `ListObjects` after setting it (UNVERIFIED which one hides listing). We want **no anonymous listing**.
- Oracle recommends pre-authenticated requests (PARs) over public buckets. For public catalog images, a public bucket is simpler.
- Object URL (native API path `/n/<ns>/b/<bucket>/o/<object>` from the Dedicated Endpoints table):
  - `https://objectstorage.<region>.oraclecloud.com/n/<ns>/b/<bucket>/o/<object>`
  - or dedicated: `https://<ns>.objectstorage.<region>.oci.customer-oci.com/n/<ns>/b/<bucket>/o/<object>`
  - The exact form of anonymous GET on the dedicated host is UNVERIFIED; test it.
  - Object names containing `/` should be URL-encoded as `%2F` in native URLs. Whether unencoded slashes work is UNVERIFIED, so avoid `/` in keys or test it.

### 2. Always Free limits (current page, verified from raw HTML)

- **Ampere A1:** "the first **1,500 OCPU hours and 9,000 GB hours** per month … For Always Free tenancies, this is equivalent to **2 OCPUs and 12 GB of memory**." This is lower than the older 4 OCPU / 24 GB figure that many blog posts still quote.
- Two VM.Standard.E2.1.Micro (AMD, 1/8 OCPU, 1 GB) instances.
- Block volume: **200 GB total** (boot plus block) and 5 backups. The minimum boot volume is 47 GB.
- Object Storage:
  - Always-Free-only accounts: **20 GB** combined Standard/IA/Archive.
  - Paid or trial accounts: 10 GB Standard + 10 GB IA + 10 GB Archive.
  - **50,000 Object Storage API requests per month** in both cases.
- Outbound data: **10 TB/month**. One flexible load balancer at 10 Mbps.
- **Idle reclamation:** "Oracle will deem … instances as idle if, during a 7-day period … CPU utilization for the 95th percentile is less than 20%, Network utilization is less than 20%, Memory utilization is less than 20% (applies to A1 shapes only)."
  - Converting the tenancy to Pay-As-You-Go avoids reclamation. That comes from common knowledge and is not re-verified on this page (UNVERIFIED).

### 3. Ubuntu 24.04 host firewall on OCI

Oracle Compute Known Issues, "Ubuntu instance fails to reboot after enabling Uncomplicated Firewall (UFW)":

> Do not use UFW to edit firewall rules. Platform images are preconfigured with firewall rules to enable instances to make outgoing connections to the instance's boot and block volumes … UFW may remove these rules … To modify or add new firewall rules, update the /etc/iptables/rules.v4 file instead … To have the rules take effect immediately, run: `sudo su -` then `iptables-restore < /etc/iptables/rules.v4`

- "Essential Firewall Rules": root-only access to iSCSI endpoints `169.254.0.2:3260` and `169.254.2.0/24:3260`. **Do not flush iptables.**
- The image ships `netfilter-persistent` and `iptables-persistent`. The INPUT chain ends with `-A INPUT -j REJECT --reject-with icmp-host-prohibited`, so new ACCEPT rules must come **before** it.
- Oracle's Apache-on-Ubuntu tutorial uses:

  ```bash
  sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
  sudo netfilter-persistent save
  ```

  Do the same for 443. Check positions first with `sudo iptables -L INPUT --line-numbers`.
- **VCN layer:** add ingress rules to the subnet's Security List or to an NSG on the VNIC: source `0.0.0.0/0`, TCP, destination ports 80 and 443. Oracle's tutorial ticks "Stateless". A stateful rule, the default, is simpler and fine. Keep 22 restricted to your IP where possible.
- Razorpay webhooks require port 80 or 443, which is compatible.

### 4. Packages on Ubuntu 24.04 (noble) arm64

From packages.ubuntu.com on 2026-09-24:

- `postgresql-16`: noble 16.2, **noble-updates 16.15-0ubuntu0.24.04.1**. The contrib extensions `pg_trgm` and `unaccent` ship in this package in current Debian/Ubuntu packaging (UNVERIFIED for this exact build).
- `redis-server`: 5:7.0.15 (noble-updates `7.0.15-1ubuntu0.24.04.4`, universe). Redis 7.0 is fine for BullMQ (Medusa event bus and workflow engine).
- `nginx`: 1.24.0-2ubuntu7.18.
- `certbot` and `python3-certbot-nginx`: 2.9.0-1 (universe, arch `all`, so arm64 works). The certbot snap is also published for arm64 (UNVERIFIED this session).
- **`nodejs` in noble is 18.19.1, too old.** Medusa needs `^20.19 || >=22.12` and Next 16 needs `>=20.9`.
- NodeSource `https://deb.nodesource.com/node_22.x` repository: `Architectures: amd64 arm64 armhf x86_64`. The latest arm64 package is **22.23.3-1nodesource1** (repo Release date 2026-09-23). nodejs.org says v22.23.3 was released 2026-09-23, LTS "Jod".
- Node release schedule (nodejs/Release `schedule.json`):
  - v22: maintenance since 2025-10-21, **EOL 2027-04-30**
  - v24 "Krypton": LTS, maintenance from 2026-10-20, EOL 2028-04-30
  - v20: EOL 2026-04-30
- `sharp@0.35.4` (Next 16.3.6 optional dependency) ships prebuilt `@img/sharp-linux-arm64` and `@img/sharp-libvips-linux-arm64`. It needs Node >=20.9.

## Sources

- https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/s3compatibleapi.htm
- https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/s3compatibleapi_topic-Amazon_S3_Compatibility_API_Support.htm
- https://docs.oracle.com/en-us/iaas/Content/Object/Concepts/dedicatedendpoints.htm
- https://docs.oracle.com/en-us/iaas/releasenotes/services/objectstorage/index.htm
- https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/managingbuckets_topic-To_change_the_visibility_of_a_bucket.htm
- https://docs.oracle.com/en-us/iaas/Content/Security/Reference/objectstorage_security.htm
- https://docs.oracle.com/en/learn/ocios-s3-api-cpp/
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- https://docs.oracle.com/en-us/iaas/Content/Compute/known-issues.htm
- https://docs.oracle.com/en-us/iaas/Content/Compute/References/bestpracticescompute.htm
- https://docs.oracle.com/en-us/iaas/developer-tutorials/tutorials/apache-on-ubuntu/01oci-ubuntu-apache-summary.htm
- https://github.com/thanatostyrannos/elasticsearch-oci-s3-workaround ; https://github.com/omnidotdev/providers/pull/27 ; https://github.com/velero-io/velero/issues/10543
- npm tarball `@aws-sdk/checksums@3.1001.1` (`dist-cjs/submodules/flexible-checksums/index.js`)
- https://packages.ubuntu.com/noble/arm64/postgresql-16 (and redis-server, certbot, nginx, nodejs; the same pages under noble-updates)
- https://deb.nodesource.com/node_22.x/dists/nodistro/Release ; https://nodejs.org/dist/index.json ; https://raw.githubusercontent.com/nodejs/Release/main/schedule.json
- Community (firewall): https://dev.to/armiedema/opening-up-port-80-and-443-for-oracle-cloud-servers-j35

## Confidence

- **High:** endpoints, Always Free numbers (raw page), the UFW warning, package versions, and SDK checksum defaults.
- **Medium:** OCI checksum behaviour for unchunked PutObject with an `x-amz-checksum-crc32` header, which the docs describe as "unchanged". Test it.
- **Low:** the public-access-type semantics as worded, and native URL encoding of `/`.

## Implications for us

1. **Size the VM for 2 OCPU and 12 GB**, not 4 and 24. Keep memory headroom:
   - Medusa server ~1 GB, worker ~1 GB, Next ~0.5–1 GB, Postgres ~1–2 GB, Redis ~256 MB.
   - Add a 2–4 GB swap file.
   - Watch the idle-reclaim thresholds, or upgrade to PAYG, which still costs $0 within the free allowances.
2. **The 50,000 Object Storage requests per month limit is tight** if browsers load images directly from the bucket. Serve product images through Next.js `/_next/image`, which caches optimized output on disk with a 4 h default TTL in Next 16, and/or put Cloudflare in front. Uploads and imports also count toward the limit.
3. Medusa `file-s3` config for OCI:
   - `endpoint: https://<ns>.compat.objectstorage.<region>.oraclecloud.com`
   - `region: <oci-region>`
   - `additional_client_config: { forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" }`
   - `acl: false`
   - `file_url: https://objectstorage.<region>.oraclecloud.com/n/<ns>/b/<bucket>/o`
4. **Bulk delete will likely fail on OCI**, because DeleteObjects forces CRC32. Medusa swallows the error, so objects are orphaned rather than the request failing. Options:
   - Accept the orphans.
   - Subclass `S3FileService` in a custom file provider and override `delete` to loop over `DeleteObjectCommand`, or pass `ChecksumAlgorithm: "CRC32C"`.
   - Add a periodic cleanup job.
5. Firewall:
   - Add ACCEPT rules for 80 and 443 **before** the REJECT line in `/etc/iptables/rules.v4`, then run `netfilter-persistent save` or `iptables-restore`.
   - Never enable UFW.
   - Also open 80 and 443 in the Security List or an NSG.
   - Keep 9000 (Medusa) and 8000/3000 (Next) bound to localhost behind nginx.
6. Install Node 22 from NodeSource (`node_22.x`, arm64). Install PostgreSQL 16, Redis 7.0, nginx and certbot from noble and noble-updates.
