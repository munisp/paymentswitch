# Staging Self-Hosted Runner and Live Recovery Gate Setup

This procedure provisions the private runner and protected GitHub environment used by the daily live cross-store partition-recovery job. The runner executes real PostgreSQL, APISIX, Go-projection, TigerBeetle, and Python-worker checks. It must be isolated from production and must never be granted production credentials.

## 1. Prepare the staging runner host

Create a dedicated Linux VM or Kubernetes-based runner in the **staging private network**. It must resolve `apisix-internal.payment-switch.svc.cluster.local`, reach the isolated PostgreSQL endpoint on TCP 5432, and reach GitHub Actions over outbound HTTPS. It must not have a route to production PostgreSQL, production TigerBeetle, or production operator networks.

Create an unprivileged runner account and install only the test prerequisites:

```bash
sudo useradd --create-home --shell /bin/bash gha-payment-switch
sudo install -d -o gha-payment-switch -g gha-payment-switch /opt/actions-runner
sudo apt-get update
sudo apt-get install -y ca-certificates curl git python3 python3-venv
```

Install the GitHub Actions runner using the current release URL and one-time registration token shown in **Repository Settings → Actions → Runners → New self-hosted runner**. Do not place the registration token in source control, shell history, or a CI secret.

```bash
sudo -iu gha-payment-switch
cd /opt/actions-runner
# Download the Linux x64 runner version displayed by GitHub, verify its published checksum,
# then extract it. The URL and version are intentionally obtained from GitHub at provisioning time.
./config.sh --url https://github.com/munisp/paymentswitch \
  --token '<one-time-registration-token>' \
  --name payment-switch-staging-recovery-01 \
  --labels payment-switch-staging \
  --unattended --replace
exit
sudo /opt/actions-runner/svc.sh install gha-payment-switch
sudo /opt/actions-runner/svc.sh start
```

The runner must appear in GitHub with these effective labels:

```text
self-hosted, linux, x64, payment-switch-staging
```

The daily workflow selects exactly those labels. Use an ephemeral runner or rebuild the runner after every sensitive incident exercise where feasible. Restrict interactive SSH access, enable operating-system patching and host monitoring, and allow the runner account no `sudo` access.

## 2. Configure private DNS, firewall, and TLS reachability

The runner must resolve the internal APISIX SNI and present a client certificate trusted by APISIX. Validate network reachability from the runner only after certificates are provisioned.

| Destination | Required access | Purpose |
|---|---|---|
| `github.com:443` and Actions endpoints | Outbound HTTPS | Receive jobs and upload evidence artifacts. |
| Isolated PostgreSQL:5432 | Private TCP | Create and verify the temporary saga/window/case. |
| `apisix-internal.payment-switch.svc.cluster.local:443` | Private HTTPS with mTLS | Query the Go reconciliation projection through APISIX. |
| No production endpoints | Deny | Prevent the test from accessing production money movement. |

APISIX must expose the internal reconciliation route with an SNI certificate for `apisix-internal.payment-switch.svc.cluster.local`, require the staging worker client certificate chain, and forward only to the Go reconciliation service over its own mTLS channel.

## 3. Provision a dedicated staging test transfer

Create one **non-production, dedicated** TigerBeetle transfer in the isolated staging cluster. Record its complete 128-bit transfer identity as exactly 32 hexadecimal characters and obtain the matching authoritative rail settlement reference. It must not represent a customer or production payment.

The recovery integration test does not create, retry, reverse, or mutate this transfer. It creates only temporary PostgreSQL saga/window/reconciliation records linked to that immutable identity, verifies the projection, then deletes its temporary rows.

## 4. Configure GitHub variables and protected staging secrets

Set the following repository or organisation variable, not a source-controlled value:

| Type | Name | Required value |
|---|---|---|
| Variable | `RUN_LIVE_CROSS_STORE_RECOVERY` | `true` only after all staging prerequisites and change approval are complete. |

Create or use the GitHub **staging** environment. Require reviewer approval and restrict access to the payment operations, ledger engineering, and security groups. Add these environment secrets:

| Secret | Source and requirement |
|---|---|
| `RECONCILIATION_CA_PEM` | CA that validates the APISIX internal listener certificate. |
| `RECONCILIATION_CLIENT_CERT_PEM` | Staging-only client certificate accepted by APISIX. |
| `RECONCILIATION_CLIENT_KEY_PEM` | Corresponding private key; rotate after suspected exposure. |
| `CROSS_STORE_INTEGRATION_POSTGRES_DSN` | Isolated staging DSN with a restricted test role. |
| `CROSS_STORE_POSTGRES_HOST` | Same isolated PostgreSQL host used by the worker. |
| `CROSS_STORE_POSTGRES_DB` | Dedicated staging database. |
| `CROSS_STORE_POSTGRES_USER` | Least-privilege test role. |
| `CROSS_STORE_POSTGRES_PASSWORD` | Password for that test role. |
| `RECONCILIATION_PROJECTION_URL` | `https://apisix-internal.payment-switch.svc.cluster.local` or the approved private equivalent. |
| `SETTLEMENT_LEDGER_RECONCILIATION_TOKEN` | The dedicated token configured in the Go projection; not an end-user access token. |
| `CROSS_STORE_TEST_TRANSFER_ID_128` | Dedicated real staging TigerBeetle transfer ID, exactly 32 hexadecimal characters. |
| `CROSS_STORE_TEST_SETTLEMENT_REFERENCE` | Matching staging rail/reference evidence. |

The PostgreSQL test role needs only the minimum permissions to insert/delete its temporary rows in `settlement_windows`, `idempotency_keys`, `payment_sagas`, and `settlement_reconciliation_cases`, and to read the final records. It must not have superuser, schema-alteration, or production-network access.

## 5. Preflight from the runner

After the GitHub environment approval, validate the runner has the expected labels and private network path. The test workflow materializes certificate secrets with `umask 077`; do not manually echo secrets into logs.

The live gate itself validates all required variables, certificate file readability, and 32-hex transfer identity before it runs:

```bash
CROSS_STORE_INTEGRATION=1 \
INTEGRATION_POSTGRES_DSN='postgres://...' \
POSTGRES_HOST='...' POSTGRES_DB='...' POSTGRES_USER='...' POSTGRES_PASSWORD='...' \
RECONCILIATION_PROJECTION_URL='https://apisix-internal.payment-switch.svc.cluster.local' \
SETTLEMENT_LEDGER_RECONCILIATION_TOKEN='...' \
SETTLEMENT_LEDGER_CA_FILE='/secure/ca.crt' \
SETTLEMENT_LEDGER_CLIENT_CERT_FILE='/secure/tls.crt' \
SETTLEMENT_LEDGER_CLIENT_KEY_FILE='/secure/tls.key' \
CROSS_STORE_TEST_TRANSFER_ID_128='0123456789abcdef0123456789abcdef' \
CROSS_STORE_TEST_SETTLEMENT_REFERENCE='staging-reference' \
bash scripts/assurance/run_cross_store_partition_recovery.sh
```

Run this only against the dedicated isolated staging setup. A missing secret, unreadable certificate, unavailable route, invalid certificate chain, invalid transfer ID, or failed consistency assertion must be treated as a failed gate.

## 6. Ongoing operational controls

Keep `RUN_LIVE_CROSS_STORE_RECOVERY=false` during maintenance, certificate rotation, or an active staging incident. Enable it only after staging readiness is re-approved. Review the 365-day evidence artifact daily, rotate the reconciliation token and client certificate on a defined schedule, and immediately revoke/reissue them if a runner compromise is suspected.
