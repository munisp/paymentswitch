# Local Docker Compose Provisioning Runbook for APISIX, Keycloak, and Live Identity Gates

**Scope:** An isolated, disposable environment only. This procedure prepares the configuration and runtime required for the repository’s identity preflight and APISIX → Keycloak → backend gate. It is **not** a production deployment procedure.

> **Evidence boundary:** This sandbox does not contain Docker Compose v2, an isolated `.env.assurance`, a local CA, Keycloak users, or real bearer tokens. Consequently, this document is executable guidance, not evidence that the live gates passed here. The repository is still an RC.1 prerelease.

## 1. What This Runbook Provisions

| Layer | Local outcome | Enforcement boundary |
|---|---|---|
| PostgreSQL | `payment_switch` application database and a dedicated `keycloak` database owned by `keycloak_user` | The first-run bootstrap script requires `KEYCLOAK_DB_PASSWORD` and creates no committed credential |
| Keycloak | Realm import with portal, API, APISIX, and admin PKCE clients | Keycloak is internal-only; public identity paths traverse APISIX |
| APISIX | HTTPS listener on port `9443`, certificate/key validated before startup | The renderer rejects missing, malformed, mismatched, wrong-SAN, or near-expiry TLS material |
| Go ledger | Internal JWKS retrieval and independent RS256 issuer/audience validation | A bearer token remains required after APISIX boundary validation |
| Fraud scoring | Verified CPU-local model container on internal port `8002` | The legacy synthetic scoring image is not used by the Compose service |
| Gate inputs | Actual Keycloak-issued user, non-admin, and admin tokens plus the isolated CA | The script rejects missing or fabricated values before route assertions |

The assurance preflight enforces the required command availability, isolated-environment acknowledgement, 33 configuration values, readable TLS files, explicit HTTPS origin/callback pairs, and deployment-policy validation.[1]

## 2. Prerequisites and Safety Controls

Run the following only on an isolated workstation or disposable VM with Docker Engine and the Docker Compose v2 plugin. Do not point any variable, DNS name, certificate, user account, or datastore at production. The preflight itself requires `docker`, `curl`, `jq`, `openssl`, `go`, `cargo`, `rustc`, `node`, and `pnpm`.[1]

| Requirement | Verification command | Expected result |
|---|---|---|
| Docker Engine | `docker version` | Client and server versions are printed |
| Compose v2 | `docker compose version` | A v2 version is printed |
| Toolchain | `command -v curl jq openssl go cargo rustc node pnpm` | Every command resolves |
| Workspace | `git status --short` | No unintentional secret or certificate files are tracked |
| Disposable data | Confirm this is a new Compose volume set | First-run database scripts execute only on an empty PostgreSQL data volume |

> The `postgres_data` named volume is intentionally durable. The Keycloak database bootstrap runs only when PostgreSQL initializes an empty volume. Never run `docker compose down -v` against an environment containing data you need to keep.

## 3. Clone the Repository and Create a Private Environment File

```bash
# Replace the path if the repository is already available.
gh repo clone munisp/paymentswitch
cd paymentswitch

git checkout main
cp .env.assurance.example .env.assurance
chmod 600 .env.assurance
mkdir -p .local-assurance/tls
```

The environment file is intentionally ignored by Git. Confirm that it remains private:

```bash
git check-ignore -v .env.assurance
git status --short --ignored .env.assurance .local-assurance/tls
```

## 4. Generate Isolated Secrets

Use unique values. Do not reuse a secret across fields merely because all values are local. The following helper produces hexadecimal values that are safe in connection strings without URL encoding.

```bash
secret() { openssl rand -hex 32; }

POSTGRES_PASSWORD="$(secret)"
REDIS_PASSWORD="$(secret)"
MOJALOOP_POSTGRES_PASSWORD="$(secret)"
JWT_SECRET="$(secret)"
GRAFANA_PASSWORD="$(secret)"
APISIX_ADMIN_KEY="$(secret)"
KEYCLOAK_ADMIN_PASSWORD="$(secret)"
KEYCLOAK_DB_PASSWORD="$(secret)"
KEYCLOAK_CLIENT_SECRET="$(secret)"
KEYCLOAK_API_CLIENT_SECRET="$(secret)"
KEYCLOAK_APISIX_CLIENT_SECRET="$(secret)"
ADMIN_KEYCLOAK_CLIENT_SECRET="$(secret)"
ADMIN_AUTH_STATE_SECRET="$(secret)"

# The application and Permify DSNs use the same local application role.
DATABASE_URL="postgresql://payment_user:${POSTGRES_PASSWORD}@postgres:5432/payment_switch"
PERMIFY_DATABASE_URI="postgres://payment_user:${POSTGRES_PASSWORD}@postgres:5432/permify?sslmode=disable"
```

Populate the matching fields in `.env.assurance` without printing values to shell history. One safe approach is to use a local password manager or a restricted editor. The core identity values must be exactly the following shape; use your generated values in place of the all-caps names.

```dotenv
ASSURANCE_ENV=isolated
POSTGRES_PASSWORD=GENERATED_HEX_VALUE
DATABASE_URL=postgresql://payment_user:GENERATED_HEX_VALUE@postgres:5432/payment_switch
PERMIFY_DATABASE_URI=postgres://payment_user:GENERATED_HEX_VALUE@postgres:5432/permify?sslmode=disable
REDIS_PASSWORD=GENERATED_HEX_VALUE
MOJALOOP_POSTGRES_PASSWORD=GENERATED_HEX_VALUE
JWT_SECRET=GENERATED_HEX_VALUE
GRAFANA_PASSWORD=GENERATED_HEX_VALUE
APISIX_ADMIN_KEY=GENERATED_HEX_VALUE
KEYCLOAK_ADMIN=isolated-bootstrap-admin
KEYCLOAK_ADMIN_PASSWORD=GENERATED_HEX_VALUE
KEYCLOAK_DB_PASSWORD=GENERATED_HEX_VALUE
KEYCLOAK_CLIENT_SECRET=GENERATED_HEX_VALUE
KEYCLOAK_API_CLIENT_SECRET=GENERATED_HEX_VALUE
KEYCLOAK_APISIX_CLIENT_SECRET=GENERATED_HEX_VALUE
ADMIN_KEYCLOAK_CLIENT_ID=payment-switch-admin-dashboard
ADMIN_KEYCLOAK_CLIENT_SECRET=GENERATED_HEX_VALUE
ADMIN_AUTH_STATE_SECRET=GENERATED_HEX_VALUE
```

Do not set any of the server-only values with a `NEXT_PUBLIC_` prefix. In particular, `ADMIN_KEYCLOAK_CLIENT_SECRET` and `ADMIN_AUTH_STATE_SECRET` must stay on the Next.js server.[2]

## 5. Create an Isolated CA and Gateway Certificate

The certificate must have the gateway DNS name in its SAN extension. The APISIX bootstrap rejects a certificate that does not parse, does not match the key, expires within 24 hours, or does not contain `DNS:${APISIX_TLS_SERVER_NAME}`.[3]

```bash
cd .local-assurance/tls

# One-year disposable CA.
openssl req -x509 -new -nodes -newkey rsa:4096 -sha256 -days 365 \
  -keyout isolated-ca-key.pem \
  -out isolated-ca.pem \
  -subj '/CN=Payment Switch Isolated Assurance CA'

cat > gateway-san.cnf <<'EOF'
subjectAltName = DNS:gateway.assurance.example
extendedKeyUsage = serverAuth
keyUsage = critical, digitalSignature, keyEncipherment
EOF

openssl req -new -nodes -newkey rsa:2048 \
  -keyout gateway-key.pem \
  -out gateway.csr \
  -subj '/CN=gateway.assurance.example'

openssl x509 -req -sha256 -days 90 \
  -in gateway.csr \
  -CA isolated-ca.pem \
  -CAkey isolated-ca-key.pem \
  -CAcreateserial \
  -out gateway-cert.pem \
  -extfile gateway-san.cnf

chmod 600 isolated-ca-key.pem gateway-key.pem
chmod 644 isolated-ca.pem gateway-cert.pem
openssl verify -CAfile isolated-ca.pem gateway-cert.pem
openssl x509 -in gateway-cert.pem -noout -ext subjectAltName
cd ../..
```

Set the following values in `.env.assurance` using absolute paths from `pwd`:

```dotenv
APISIX_BASE_URL=https://gateway.assurance.example:9443
APISIX_TLS_SERVER_NAME=gateway.assurance.example
TLS_CA_FILE=/absolute/path/to/paymentswitch/.local-assurance/tls/isolated-ca.pem
APISIX_TLS_CERT_FILE_HOST=/absolute/path/to/paymentswitch/.local-assurance/tls/gateway-cert.pem
APISIX_TLS_KEY_FILE_HOST=/absolute/path/to/paymentswitch/.local-assurance/tls/gateway-key.pem
```

## 6. Configure Public URLs and Local Name Resolution

Use the same public gateway URL for the browser-facing Keycloak address and the issuer claim. Port `9443` is part of the external issuer in this Compose topology and must not be omitted.

```dotenv
KEYCLOAK_URL=https://gateway.assurance.example:9443/auth
KEYCLOAK_HOSTNAME=https://gateway.assurance.example:9443/auth
KEYCLOAK_ISSUER_URL=https://gateway.assurance.example:9443/auth/realms/payment-switch
KEYCLOAK_REALM=payment-switch
KEYCLOAK_LEDGER_CLIENT_ID=payment-switch-api
KEYCLOAK_LEDGER_AUDIENCE=payment-switch-api
PORTAL_ALLOWED_ORIGIN=https://portal.assurance.example
PORTAL_REDIRECT_URI=https://portal.assurance.example/callback
ADMIN_DASHBOARD_ALLOWED_ORIGIN=https://admin.assurance.example
ADMIN_AUTH_REDIRECT_URI=https://admin.assurance.example/api/auth/callback
```

Map the lab names locally. APISIX is published on the host; Keycloak itself is **not** published and must not be added as a direct host port.

```bash
sudo sh -c 'printf "127.0.0.1 gateway.assurance.example portal.assurance.example admin.assurance.example\\n" >> /etc/hosts'
```

For a browser test of the admin dashboard, serve the Next.js application through a local HTTPS reverse proxy at `https://admin.assurance.example`, using a certificate trusted by the browser. The gateway CA above is sufficient for command-line assurance calls, but import it into the browser trust store or use a local development CA for browser testing. The redirect URI must remain the exact `/api/auth/callback` URL shown above.[1]

## 7. Start a Fresh Isolated Stack

Compose database initialization only occurs for a new `postgres_data` volume. If this is a new disposable lab and `docker volume ls` confirms no data must be retained, initialize from scratch:

```bash
set -a
source .env.assurance
set +a

# Use this only for an empty disposable lab. It deletes named volumes for this project.
docker compose -f docker-compose.unified.yml down -v --remove-orphans

docker compose --env-file .env.assurance -f docker-compose.unified.yml up -d --build postgres redis tigerbeetle keycloak go-ledger fraud-detection apisix

docker compose -f docker-compose.unified.yml ps
```

The PostgreSQL startup sequence mounts the platform schema, then runs `db/postgres/0001_keycloak_database.sh`. That script creates a dedicated `keycloak_user` login and the `keycloak` database using `KEYCLOAK_DB_PASSWORD`; Keycloak’s JDBC configuration uses the same role and database.[4]

Do not expose application, ledger, fraud, data-pipeline, or Keycloak ports to the host for this gate. The live identity script treats an accessible direct port `3000`, `8080`, `8081`, `8082`, or `8180` as a failure because it could bypass APISIX.[5]

## 8. Verify Keycloak Import and Apply Isolated Client Secrets

Keycloak administration is intentionally performed from inside the container. First authenticate `kcadm.sh` against the internal listener:

```bash
docker compose -f docker-compose.unified.yml exec keycloak \
  /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 \
  --realm master \
  --user "$KEYCLOAK_ADMIN" \
  --password "$KEYCLOAK_ADMIN_PASSWORD"

docker compose -f docker-compose.unified.yml exec keycloak \
  /opt/keycloak/bin/kcadm.sh get realms/payment-switch
```

Set the runtime secrets on imported confidential clients. Execute these commands from a shell where `.env.assurance` is already sourced.

```bash
client_id() {
  docker compose -f docker-compose.unified.yml exec -T keycloak \
    /opt/keycloak/bin/kcadm.sh get clients -r payment-switch -q clientId="$1" \
    --fields id --format csv --noquotes | tail -n 1
}

for mapping in \
  "payment-switch-portal:$KEYCLOAK_CLIENT_SECRET" \
  "payment-switch-api:$KEYCLOAK_API_CLIENT_SECRET" \
  "apisix-gateway:$KEYCLOAK_APISIX_CLIENT_SECRET" \
  "payment-switch-admin-dashboard:$ADMIN_KEYCLOAK_CLIENT_SECRET"; do
  client="${mapping%%:*}"
  secret="${mapping#*:}"
  id="$(client_id "$client")"
  test -n "$id"
  docker compose -f docker-compose.unified.yml exec -T keycloak \
    /opt/keycloak/bin/kcadm.sh update "clients/$id" -r payment-switch -s "secret=$secret"
done
```

Verify the admin client still uses standard Authorization Code flow, rejects direct access grants, and has the exact URI/origin.

```bash
admin_client_id="$(client_id payment-switch-admin-dashboard)"
docker compose -f docker-compose.unified.yml exec keycloak \
  /opt/keycloak/bin/kcadm.sh get "clients/$admin_client_id" -r payment-switch \
  --fields clientId,standardFlowEnabled,directAccessGrantsEnabled,redirectUris,webOrigins
```

Expected properties include `standardFlowEnabled: true`, `directAccessGrantsEnabled: false`, redirect URI `https://admin.assurance.example/api/auth/callback`, and browser origin `https://admin.assurance.example`.[6]

## 9. Create Isolated Gate Users and Obtain Real Tokens

Create three disposable users: a normal user, a non-admin user, and an admin. The credentials below are local-lab values; generate different passwords and do not commit them.

```bash
create_gate_user() {
  local username="$1" password="$2" role="$3"
  docker compose -f docker-compose.unified.yml exec -T keycloak \
    /opt/keycloak/bin/kcadm.sh create users -r payment-switch \
    -s "username=$username" -s enabled=true -s emailVerified=true
  docker compose -f docker-compose.unified.yml exec -T keycloak \
    /opt/keycloak/bin/kcadm.sh set-password -r payment-switch \
    --username "$username" --new-password "$password" --temporary=false
  docker compose -f docker-compose.unified.yml exec -T keycloak \
    /opt/keycloak/bin/kcadm.sh add-roles -r payment-switch \
    --uusername "$username" --rolename "$role"
}

create_gate_user gate-user "$(openssl rand -base64 24)" operator
create_gate_user gate-nonadmin "$(openssl rand -base64 24)" auditor
create_gate_user gate-admin "$(openssl rand -base64 24)" admin
```

The preflight requires **actual Keycloak-issued** bearer tokens. Use a browser-based Authorization Code + PKCE session through the configured admin dashboard or an approved test OAuth client that is registered with an exact local HTTPS callback. Do not use fabricated JWT text, do not re-enable password grant on the production admin client, and do not substitute a decoded JWT payload for a token.[5] Capture the short-lived access token from the lab browser’s authenticated session only for the purpose of executing this isolated test; place the three values in the private file:

```dotenv
VALID_USER_BEARER_TOKEN=ACTUAL_GATE_USER_ACCESS_TOKEN
VALID_NONADMIN_BEARER_TOKEN=ACTUAL_GATE_NONADMIN_ACCESS_TOKEN
VALID_ADMIN_BEARER_TOKEN=ACTUAL_GATE_ADMIN_ACCESS_TOKEN
```

## 10. Execute Preflight and the Live Identity Gate

Run both scripts from the repository root. The first validates inputs only; the second performs the gateway, authorization, spoofed-header, CORS, Go, and Rust checks.

```bash
set -a
source .env.assurance
set +a

scripts/assurance/live_gate_preflight.sh
scripts/assurance/run_live_identity_gates.sh
```

The live identity gate records expected `401` responses for missing/invalid bearer tokens, `403` for a non-admin request to the admin route, acceptance of a valid user token through mobile tRPC, rejection of spoofed identity headers, rejection of an untrusted CORS origin, absence of direct host service ports, and native Go/Rust verification.[5]

| Output | Meaning |
|---|---|
| `Preflight passed` | Required values, tools, and static policy checks are present; no live route conclusion yet |
| `Live identity gates passed` | The scripted live APISIX/Keycloak/backend identity assertions passed and evidence was written to `.audit/live-identity-gate-results.txt` unless overridden |
| `FAIL ... expected=... actual=...` | Preserve the output and investigate the cited route/configuration; do not change expected codes to force success |
| `LIVE IDENTITY GATE NOT RUN` | `.env.assurance` is absent or was not selected through `LIVE_GATE_ENV_FILE` |

## 11. Post-Run Validation and Teardown

Use the CA for command-line checks and verify the public discovery issuer explicitly:

```bash
curl --fail --cacert "$TLS_CA_FILE" \
  "${APISIX_BASE_URL}/auth/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration" \
  | jq '.issuer, .jwks_uri'

curl --fail --cacert "$TLS_CA_FILE" "${APISIX_BASE_URL}/apisix/status"
```

The discovery document issuer must equal `KEYCLOAK_ISSUER_URL`. If it differs, correct the `KC_HOSTNAME`, APISIX public URL, local DNS, and certificate arrangement before issuing new tokens; downstream RS256 validators compare issuer exactly.

When evidence has been saved and no additional recovery testing is planned, stop the disposable lab:

```bash
docker compose -f docker-compose.unified.yml down
# Use only when the lab data and Keycloak realm can be destroyed:
# docker compose -f docker-compose.unified.yml down -v --remove-orphans
```

## 12. Troubleshooting

| Symptom | Likely cause | Corrective action |
|---|---|---|
| Preflight reports 41 or more failures | `.env.assurance` is missing or has example replacement values | Copy the example, set `ASSURANCE_ENV=isolated`, populate every required variable, source the file, and rerun |
| APISIX exits before startup | TLS file is unreadable, invalid, mismatched, wrong SAN, expiring, or `PORTAL_ALLOWED_ORIGIN` is absent | Inspect `docker compose logs apisix`; regenerate the certificate and verify its SAN/key pair |
| Keycloak cannot connect to PostgreSQL | Existing volume predates the Keycloak database bootstrap, or `KEYCLOAK_DB_PASSWORD` differs | For a disposable volume, bring the stack down with `-v` and initialize again; otherwise create/reconcile the role/database under change control |
| Issuer mismatch or JWKS validation failure | Public Keycloak URL omits `:9443`, proxy headers are wrong, or tokens came from a different realm | Check discovery through APISIX; make `KEYCLOAK_URL`, `KEYCLOAK_HOSTNAME`, and `KEYCLOAK_ISSUER_URL` agree exactly |
| Gate says a protected port is reachable | A Compose override publishes a service port, or a stale container remains | Run `docker compose ps`, inspect `docker ps --format '{{.Names}} {{.Ports}}'`, remove port mappings, and rerun |
| Fraud route does not use model-backed service | A local override points to `payment-core/fraud-detection` | Use the unified service build from `payment-core/services/fraud-detection-service/Dockerfile`; confirm `/healthz` reports CPU model readiness |
| Live gate returns 401 for a valid token | Audience, issuer, role, APISIX OIDC config, or downstream Go verifier differs from realm token claims | Compare discovery issuer and token claims; do not disable issuer/audience checks |
| Live gate returns 501 for kill-switch command | Lakehouse is intentionally read-only | This is expected until an authoritative, audited command service is implemented; do not simulate the command in the dashboard |

## References

[1]: scripts/assurance/live_gate_preflight.sh "Isolated identity preflight"
[2]: admin-dashboard/src/lib/auth/server.ts "Admin server-side PKCE and encrypted session implementation"
[3]: config/apisix/assurance-apisix-entrypoint.sh "Fail-closed APISIX TLS bootstrap wrapper"
[4]: db/postgres/0001_keycloak_database.sh "Dedicated Keycloak database bootstrap"
[5]: scripts/assurance/run_live_identity_gates.sh "APISIX-Keycloak-backend live identity gate"
[6]: config/keycloak/realm-export.json "Keycloak client contract"
[7]: https://datatracker.ietf.org/doc/html/rfc7636 "RFC 7636: Proof Key for Code Exchange by OAuth Public Clients"
