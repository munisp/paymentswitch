# Local Podman Certificate and Secret-Store Emulation

This procedure is for **offline configuration and container-contract testing only**. It does not create valid Keycloak tokens, a real operations-service credential, or production evidence. The preflight may validate file shape and variable presence, but Stage 3/4 still requires real staging services and real PKCE bearer tokens.

## 1. Create a disposable local CA and gateway certificate

```bash
cd /home/ubuntu/paymentswitch-verify-main
umask 077
export ASSURANCE_DIR="$PWD/.local-assurance"
mkdir -p "$ASSURANCE_DIR/tls" "$ASSURANCE_DIR/secrets"
openssl genrsa -out "$ASSURANCE_DIR/tls/ca-key.pem" 4096
openssl req -x509 -new -nodes -sha256 -days 7 \
  -key "$ASSURANCE_DIR/tls/ca-key.pem" \
  -out "$ASSURANCE_DIR/tls/isolated-ca.pem" \
  -subj "/O=Payment Switch Local Test/CN=Payment Switch Local CA"
openssl genrsa -out "$ASSURANCE_DIR/tls/gateway-key.pem" 2048
openssl req -new -sha256 -key "$ASSURANCE_DIR/tls/gateway-key.pem" \
  -out "$ASSURANCE_DIR/tls/gateway.csr" \
  -subj "/O=Payment Switch Local Test/CN=gateway.assurance.example"
cat > "$ASSURANCE_DIR/tls/gateway.ext" <<'EOF'
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:gateway.assurance.example,DNS:localhost,IP:127.0.0.1
EOF
openssl x509 -req -sha256 -days 7 \
  -in "$ASSURANCE_DIR/tls/gateway.csr" \
  -CA "$ASSURANCE_DIR/tls/isolated-ca.pem" \
  -CAkey "$ASSURANCE_DIR/tls/ca-key.pem" \
  -CAcreateserial \
  -out "$ASSURANCE_DIR/tls/gateway-cert.pem" \
  -extfile "$ASSURANCE_DIR/tls/gateway.ext"
openssl verify -CAfile "$ASSURANCE_DIR/tls/isolated-ca.pem" \
  "$ASSURANCE_DIR/tls/gateway-cert.pem"
openssl x509 -in "$ASSURANCE_DIR/tls/gateway-cert.pem" -noout -subject -issuer -dates -ext subjectAltName
openssl x509 -noout -modulus -in "$ASSURANCE_DIR/tls/gateway-cert.pem" | openssl sha256
openssl rsa  -noout -modulus -in "$ASSURANCE_DIR/tls/gateway-key.pem"  | openssl sha256
```

The two SHA-256 lines must match. The certificate must be trusted by the local client through `TLS_CA_FILE`, and the request hostname must be one of its SANs. Do not add this CA to the operating system trust store; pass it explicitly to test clients.

## 2. Emulate a secret manager without printing secrets

A local directory with mode `0700` is only a shape-compatible secret store. Generate random values into root-readable files and keep the directory ignored and disposable:

```bash
chmod 700 "$ASSURANCE_DIR/secrets"
for name in POSTGRES_PASSWORD KEYCLOAK_DB_PASSWORD REDIS_PASSWORD \
  MOJALOOP_DB_PASSWORD JWT_SECRET GRAFANA_PASSWORD APISIX_ADMIN_KEY \
  KEYCLOAK_ADMIN_PASSWORD KEYCLOAK_APISIX_CLIENT_SECRET \
  KEYCLOAK_API_CLIENT_SECRET KEYCLOAK_CLIENT_SECRET \
  ADMIN_KEYCLOAK_CLIENT_SECRET ADMIN_AUTH_STATE_SECRET \
  OPERATIONAL_CONFIGURATION_TOKEN; do
  openssl rand -hex 32 > "$ASSURANCE_DIR/secrets/$name"
  chmod 600 "$ASSURANCE_DIR/secrets/$name"
done
```

The local renderer below reads file contents without echoing them. It creates a new ignored `.env.assurance.local` with actual random strings but **does not make external services real**:

```bash
secret() { tr -d '\n' < "$ASSURANCE_DIR/secrets/$1"; }
cat > "$ASSURANCE_DIR/.env.assurance.local" <<EOF
ASSURANCE_ENV=isolated
ASSURANCE_MOCK_MODE=false
APISIX_BASE_URL=https://gateway.assurance.example:9443
APISIX_TLS_SERVER_NAME=gateway.assurance.example
TLS_CA_FILE=$ASSURANCE_DIR/tls/isolated-ca.pem
APISIX_TLS_CERT_FILE_HOST=$ASSURANCE_DIR/tls/gateway-cert.pem
APISIX_TLS_KEY_FILE_HOST=$ASSURANCE_DIR/tls/gateway-key.pem
POSTGRES_PASSWORD=$(secret POSTGRES_PASSWORD)
DATABASE_URL=postgresql://payment_user:$(secret POSTGRES_PASSWORD)@postgres:5432/payment_switch
PERMIFY_DATABASE_URI=postgres://payment_user:$(secret POSTGRES_PASSWORD)@postgres:5432/permify?sslmode=disable
REDIS_PASSWORD=$(secret REDIS_PASSWORD)
MOJALOOP_DB_PASSWORD=$(secret MOJALOOP_DB_PASSWORD)
MOJALOOP_POSTGRES_PASSWORD=$(secret MOJALOOP_DB_PASSWORD)
JWT_SECRET=$(secret JWT_SECRET)
GRAFANA_PASSWORD=$(secret GRAFANA_PASSWORD)
APISIX_ADMIN_KEY=$(secret APISIX_ADMIN_KEY)
KEYCLOAK_ADMIN=local-assurance-admin
KEYCLOAK_ADMIN_PASSWORD=$(secret KEYCLOAK_ADMIN_PASSWORD)
KEYCLOAK_DB_PASSWORD=$(secret KEYCLOAK_DB_PASSWORD)
KEYCLOAK_APISIX_CLIENT_SECRET=$(secret KEYCLOAK_APISIX_CLIENT_SECRET)
KEYCLOAK_API_CLIENT_SECRET=$(secret KEYCLOAK_API_CLIENT_SECRET)
KEYCLOAK_CLIENT_SECRET=$(secret KEYCLOAK_CLIENT_SECRET)
ADMIN_KEYCLOAK_CLIENT_ID=payment-switch-admin-dashboard
ADMIN_KEYCLOAK_CLIENT_SECRET=$(secret ADMIN_KEYCLOAK_CLIENT_SECRET)
ADMIN_AUTH_STATE_SECRET=$(secret ADMIN_AUTH_STATE_SECRET)
OPERATIONAL_CONFIGURATION_URL=https://operations.assurance.example
OPERATIONAL_CONFIGURATION_TOKEN=$(secret OPERATIONAL_CONFIGURATION_TOKEN)
KEYCLOAK_URL=https://gateway.assurance.example:9443/auth
KEYCLOAK_HOSTNAME=https://gateway.assurance.example:9443/auth
KEYCLOAK_ISSUER_URL=https://gateway.assurance.example:9443/auth/realms/payment-switch
KEYCLOAK_REALM=payment-switch
KEYCLOAK_CLIENT_ID=payment-switch-portal
KEYCLOAK_LEDGER_CLIENT_ID=payment-switch-api
KEYCLOAK_LEDGER_AUDIENCE=payment-switch-api
ADMIN_AUTH_REDIRECT_URI=https://admin.assurance.example/api/auth/callback
ADMIN_DASHBOARD_ALLOWED_ORIGIN=https://admin.assurance.example
MOBILE_AUTH_REDIRECT_URI=com.paymentswitch.mobile:/oauthredirect
PORTAL_ALLOWED_ORIGIN=https://portal.assurance.example
PORTAL_REDIRECT_URI=https://portal.assurance.example/callback
ALLOW_DESTRUCTIVE_RECOVERY_TESTS=false
EOF
chmod 600 "$ASSURANCE_DIR/.env.assurance.local"
```

Do not call this file `.env.assurance` unless the environment is deliberately being used for local contract testing. The preflight will accept the absence of sentinels, but Keycloak tokens and external service calls will still fail if those services do not exist.

## 3. Run static Podman and preflight checks

```bash
export ASSURANCE_ENV_FILE="$ASSURANCE_DIR/.env.assurance.local"
export ASSURANCE_CONTAINER_RUNTIME=podman
export CONTAINER_RUNTIME=podman
podman --version
podman info
podman compose version || podman-compose version
scripts/assurance/live_gate_preflight.sh
```

If the command fails because `podman` is absent, install Podman and a Compose provider on the staging host. If it fails on missing bearer tokens, that is correct: random strings are not Keycloak-signed JWTs and must not be promoted to live-gate evidence.

## 4. Start the isolated Podman stack

```bash
export ASSURANCE_EVIDENCE_DIR="$PWD/.audit/local-podman-$(date -u +%Y%m%dT%H%M%SZ)"
PODMAN_COMPOSE_BIN=podman-compose \
  ASSURANCE_ENV_FILE="$ASSURANCE_ENV_FILE" \
  scripts/assurance/validate_unified_stack_podman.sh
```

The wrapper renders the Compose model, builds images, starts the disposable stack, captures service status/logs, runs preflight, and then invokes the identity and dependency-recovery gates. It removes volumes by default. Set `KEEP_ASSURANCE_STACK=true` only while investigating a failed disposable run.

## 5. Evidence boundary

A successful certificate parse, Compose render, Keycloak database bootstrap, or container health check proves only local configuration and startup. It does not prove issuer/audience/signature validation, APISIX route enforcement, OPA verified claims, ledger re-verification, TigerBeetle quorum recovery, or Redis/PostgreSQL recovery. Those require real staging services, real PKCE-issued tokens, and retained Stage 3/4 gate logs.
