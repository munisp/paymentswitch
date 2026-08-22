# pnpm Audit Remediation and Stage 3/4 Provisioning

## Audit baseline

The current audit was refreshed on **2026-08-20** from the repository root with `pnpm audit --json`. It reported **5 critical, 87 high, 92 moderate, and 13 low** advisories across 1,384 production dependency records. These are advisory records, not 197 independent packages: several advisories affect the same transitive package. No critical or high result should be dismissed by setting an audit ignore list without a documented security exception.

The five critical records collapse to four package families and five advisory records: `fast-xml-parser`, `jspdf`, `tar`, and `vitest` (with multiple critical advisories in the first two families). The actionable target is the patched version shown below or a later compatible version.

| Package family | Current affected path/version observed | Critical/high target | Required change |
|---|---|---:|---|
| `fast-xml-parser` | AWS SDK XML builder path, affected `5.2.5` | `>=5.3.5` for the critical advisory | Upgrade both AWS SDK packages together; if the lock still resolves an affected XML parser, add a temporary root override only after AWS SDK XML compatibility tests pass. |
| `jspdf` | Direct `jspdf@3.0.3`, also reached through `jspdf-autotable` | `>=4.2.1` | Upgrade `jspdf` and align `jspdf-autotable`; run PDF export tests with untrusted text, URLs, SVG/data inputs, and large values. Do not use an override that changes the public API without compiling the export pages. |
| `tar` | `@tailwindcss/vite@4.1.14 > @tailwindcss/oxide@4.1.14 > tar@7.5.1` | `>=7.5.19` | Upgrade `@tailwindcss/vite`/oxide and regenerate the lockfile. Do not manually edit the lockfile or force an incompatible tar major. |
| `vitest` | `vitest@2.1.9` through the current lock; `@vitest/coverage-v8@4.1.6` is already on a different major | `>=3.2.6` | Upgrade `vitest`, `@vitest/coverage-v8`, and their config together to one supported major. Run the complete suite, coverage, worker-isolation, and race-adjacent integration tests. |

The high findings collapse into shared families. Upgrade or override these only after lockfile review: `fast-uri >=3.1.5`, `postcss >=8.5.23`, `undici >=7.29.0`, `minimatch >=10.2.3` plus compatible v3/v5 branches, `brace-expansion >=2.1.4` plus compatible v1 branch, `nanoid >=5.1.16` (and any retained v3 branch >=3.3.18), `vite >=7.3.5`, `path-to-regexp >=0.1.13`, `picomatch >=4.0.4`/compatible v2 branch, `pnpm >=10.34.4`, `rollup >=4.59.0` or the compatible v2 branch, `serialize-javascript >=7.0.3`, `lodash`/`lodash-es >=4.18.0`, `ip-address >=10.3.1`, `form-data >=4.0.6`, and `tmp >=0.2.6`. `express`, `@trpc/server`, `jspdf`, and the AWS SDK require direct package review because they are reachable production dependencies.

## Dependency remediation sequence

Create a branch from the release candidate and preserve the audit JSON before changing dependencies. First upgrade direct production packages in coherent groups: the AWS SDK pair, `jspdf`/`jspdf-autotable`, `express` and its middleware, `axios`, and the direct `nanoid` dependency. Second upgrade build and test packages as aligned groups: `vite`, `vitest`, `@vitest/coverage-v8`, `postcss`, `@tailwindcss/vite`, `pnpm`, and the TypeScript/Vite plugins. Third use `pnpm up --latest` only for explicitly reviewed packages, then run `pnpm dedupe` and regenerate the lockfile with the repository-pinned pnpm version.

The first verification commands are:

```bash
corepack enable
corepack prepare pnpm@10.34.4 --activate
pnpm install --frozen-lockfile=false
pnpm audit --json > .audit/pnpm-audit-remediated.json || true
pnpm check
pnpm test -- --run
pnpm exec vitest run --coverage
pnpm exec vite build
```

Do not accept an audit count of zero until the scan is run against the actual production dependency graph and the image scanner also passes. If a transitive advisory cannot be upgraded immediately, the exception must identify the package path, exploitability in this platform, compensating control, owner, expiry date, and replacement issue. A blanket `pnpm audit --audit-level=none`, `--ignore`, or `|| true` is not closure.

## Required code-level hardening around vulnerable packages

The PDF export boundary must treat all merchant/customer strings as untrusted text, avoid HTML/SVG execution paths, constrain output size, and have regression tests for script-looking text, data URLs, malformed URLs, and oversized input. XML parsing must remain on the AWS SDK’s supported parser path; no caller-controlled XML should be parsed with permissive entity or external-resource behavior. HTTP clients must keep strict TLS verification, bounded timeouts, redirect limits, response-size limits, and allowlisted destinations. Express route tests must cover malformed query nesting, prototype-pollution keys, path decoding, request-body limits, and rate-limit behavior. Build/test packages are not runtime application code, but critical CI vulnerabilities still block the release because they can alter generated assets or test trust.

## Current Compose contract issues to correct before live use

The current Compose file references `MOJALOOP_DB_PASSWORD`, while the assurance template exposes `MOJALOOP_POSTGRES_PASSWORD`; add the exact `MOJALOOP_DB_PASSWORD` variable to the template and preflight contract or change both Compose references consistently. The Compose Go ledger service must receive the nonzero `TIGERBEETLE_CLUSTER_ID` used by the StatefulSet; add it to the environment template, preflight, and service environment. Pin the Compose TigerBeetle image rather than using `latest`, and use a disposable isolated volume for first bootstrap. These are configuration blockers, not values that mock keys can solve.

## Isolated TLS provisioning

Use a disposable assurance directory and never reuse production certificates. The following commands create a private CA and a gateway certificate with the DNS names needed by the local stack. Replace the hostnames with the actual isolated DNS names used by the staging environment.

```bash
cd /path/to/paymentswitch
umask 077
mkdir -p .local-assurance
openssl genrsa -out .local-assurance/ca-key.pem 4096
openssl req -x509 -new -nodes -key .local-assurance/ca-key.pem \
  -sha256 -days 30 -out .local-assurance/isolated-ca.pem \
  -subj "/O=Payment Switch Assurance/CN=Payment Switch Assurance CA"
openssl genrsa -out .local-assurance/isolated-gateway-key.pem 2048
openssl req -new -key .local-assurance/isolated-gateway-key.pem \
  -out .local-assurance/gateway.csr \
  -subj "/O=Payment Switch Assurance/CN=gateway.assurance.example"
cat > .local-assurance/gateway.ext <<'EOF'
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:gateway.assurance.example,DNS:localhost,IP:127.0.0.1
EOF
openssl x509 -req -in .local-assurance/gateway.csr \
  -CA .local-assurance/isolated-ca.pem -CAkey .local-assurance/ca-key.pem \
  -CAcreateserial -out .local-assurance/isolated-gateway-cert.pem \
  -days 30 -sha256 -extfile .local-assurance/gateway.ext
openssl verify -CAfile .local-assurance/isolated-ca.pem \
  .local-assurance/isolated-gateway-cert.pem
```

Add the isolated gateway, portal, and admin names to the staging DNS or `/etc/hosts`. Copy `.env.assurance.example` to `.env.assurance`, replace every sentinel with unique generated values, set the TLS paths to the files above, and obtain real Keycloak bearer tokens through browser PKCE. Do not use the local `.env.assurance` mock file for this step.

## Docker Compose Stage 3/4 sequence

Install Docker Engine with Compose v2 on the staging host and verify `docker compose version`. Then validate the rendered configuration before starting anything:

```bash
set -a; . ./.env.assurance; set +a
scripts/assurance/live_gate_preflight.sh

docker compose --env-file .env.assurance -f docker-compose.unified.yml config --quiet
docker compose --env-file .env.assurance -f docker-compose.unified.yml build --pull
# Record image digests before deployment.
docker compose --env-file .env.assurance -f docker-compose.unified.yml up -d

docker compose --env-file .env.assurance -f docker-compose.unified.yml ps
docker compose --env-file .env.assurance -f docker-compose.unified.yml logs --no-color keycloak apisix go-ledger > .audit/stage-1-2-service-logs.txt
```

Verify PostgreSQL is healthy and the Keycloak database/role bootstrap completed. Verify Keycloak’s OIDC discovery and JWKS endpoints through the intended APISIX HTTPS boundary, not an exposed direct administration port. Verify APISIX’s certificate, route configuration, and adapter health. Obtain real admin/non-admin/user tokens through PKCE, source the same environment, and run:

```bash
scripts/assurance/run_live_identity_gates.sh
```

The Stage 3 acceptance record must show valid access, non-admin denial, invalid/expired/wrong-audience/wrong-signature denial, spoofed-header denial, direct-port denial, and downstream Go ledger re-verification. Stage 4 then creates durable fixtures, applies migrations, and runs:

```bash
export ALLOW_DESTRUCTIVE_RECOVERY_TESTS=true
scripts/assurance/run_dependency_recovery_gates.sh
```

Every outage must produce explicit denial or 5xx without a substitute balance, fraud score, settlement row, or seed record, followed by a successful repeat after service recovery. A local mock key, a self-signed certificate that is not trusted by the test client, or a successful Compose health check does not close either live gate.

## Closure decision

The current audit count is a release blocker. The first code changes should be dependency upgrades and lockfile regeneration, followed by the package-specific regression suite and fresh audit. The Stage 3/4 infrastructure work is independent: it requires Docker Compose v2, real isolated certificates, actual Keycloak PKCE tokens, durable PostgreSQL/TigerBeetle/Redis/Permify state, and retained gateway/ledger evidence. Until both sets of evidence exist, production promotion remains blocked.
