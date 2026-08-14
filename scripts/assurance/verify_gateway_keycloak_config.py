#!/usr/bin/env python3
"""Static assurance checks for the APISIX-Keycloak-backend trust boundary.

These checks deliberately inspect source configuration only. A successful run means
unsafe configuration is blocked before deployment; it is not a substitute for the
real isolated runtime gates.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
APISIX_TEMPLATE = ROOT / "config/apisix/apisix.yaml.template"
COMPOSE_PATH = ROOT / "docker-compose.unified.yml"
REALM_PATH = ROOT / "config/keycloak/realm-export.json"
NODE_AUTH_PATH = ROOT / "server/security/keycloakAuth.ts"
GO_MAIN_PATH = ROOT / "payment-core/go-services/cmd/mojaloop-service/main.go"
GO_JWT_PATH = ROOT / "payment-core/go-services/internal/integration/keycloak_jwt.go"
TLS_ENTRYPOINT_PATH = ROOT / "config/apisix/assurance-apisix-entrypoint.sh"
TLS_DOCKERFILE_PATH = ROOT / "config/apisix/Dockerfile"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def main() -> int:
    template_text = read(APISIX_TEMPLATE)
    apisix = yaml.safe_load(template_text)
    compose_text = read(COMPOSE_PATH)
    compose = yaml.safe_load(compose_text)
    realm = json.loads(read(REALM_PATH))
    node_auth = read(NODE_AUTH_PATH)
    go_main = read(GO_MAIN_PATH)
    go_jwt = read(GO_JWT_PATH)
    tls_entrypoint = read(TLS_ENTRYPOINT_PATH)
    tls_dockerfile = read(TLS_DOCKERFILE_PATH)

    checks: list[tuple[str, bool, str]] = []

    def check(name: str, condition: bool, detail: str) -> None:
        checks.append((name, bool(condition), detail))

    routes = {route["id"]: route for route in apisix["routes"]}
    protected_ids = ["mobile-trpc", "protected-api", "ledger-api", "fraud-api", "analytics-api", "admin-api", "permify-api"]
    for route_id in protected_ids:
        plugin = routes[route_id]["plugins"]["openid-connect"]
        check(f"{route_id} requires bearer-only OIDC", plugin.get("bearer_only") is True, "bearer_only=true")
        check(f"{route_id} only accepts RS256", plugin.get("token_signing_alg_values_expected") == "RS256", "RS256 required")
        check(
            f"{route_id} does not forward identity headers",
            plugin.get("set_userinfo_header", False) is False and plugin.get("set_id_token_header", False) is False,
            "no userinfo/id-token forwarding",
        )

    for route_id in ["ledger-api", "fraud-api", "analytics-api", "admin-api", "permify-api"]:
        check(
            f"{route_id} outranks generic protected API",
            routes[route_id].get("priority", 0) > routes["protected-api"].get("priority", 0),
            f"priority {routes[route_id].get('priority')}",
        )

    for route_id in protected_ids:
        cors = routes[route_id]["plugins"].get("cors")
        if cors:
            check(f"{route_id} has no wildcard browser origin", cors.get("allow_origins") != "*", str(cors.get("allow_origins")))

    check("APISIX template contains a single runtime TLS SNI resource", "ssls:" in template_text and "__APISIX_TLS_SERVER_NAME__" in template_text, "runtime SNI placeholder")
    check("APISIX template never commits certificate material", "BEGIN PRIVATE KEY" not in template_text and "BEGIN CERTIFICATE" not in template_text, "no PEM in Git")
    check("APISIX TLS bootstrap validates certificate/key matching", "certificate and private key do not match" in tls_entrypoint and "openssl pkey" in tls_entrypoint, "key-pair validation")
    check("APISIX TLS bootstrap validates certificate SAN and expiry", "subjectAltName" in tls_entrypoint and "-checkend 86400" in tls_entrypoint, "SAN and expiry validation")
    check("APISIX TLS bootstrap chains to the official entrypoint", "exec /docker-entrypoint.sh" in tls_entrypoint, "official startup preserved")
    check("APISIX image extension runs as non-root", "USER apisix" in tls_dockerfile, "USER apisix")

    services = compose["services"]
    protected_internal_services = [
        "postgres", "redis", "tigerbeetle", "kafka", "web-portal", "go-ledger", "fraud-detection",
        "data-pipeline", "keycloak", "permify", "openappsec", "mojaloop-postgres", "central-ledger",
    ]
    for service in protected_internal_services:
        check(f"{service} has no direct host port publication", "ports" not in services[service], "ports omitted")
    check("APISIX only exposes TLS listener", services["apisix"].get("ports") == ["9443:9443"], str(services["apisix"].get("ports")))
    check("APISIX uses TLS bootstrap image", services["apisix"].get("build", {}).get("dockerfile") == "config/apisix/Dockerfile", "custom TLS bootstrap image")
    apisix_volumes = "\n".join(services["apisix"].get("volumes", []))
    check("APISIX receives certificate through required host secret path", "APISIX_TLS_CERT_FILE_HOST:?Set" in apisix_volumes, "required certificate mount")
    check("APISIX receives private key through required host secret path", "APISIX_TLS_KEY_FILE_HOST:?Set" in apisix_volumes, "required key mount")
    check("Operator tools are opt-in only", services["adminer"].get("profiles") == ["operator-tools"] and services["redis-commander"].get("profiles") == ["operator-tools"], "operator-tools profile")
    check("OpenAppSec learning mode is disabled", services["openappsec"]["environment"].get("LEARNING_MODE") == "false", "LEARNING_MODE=false")
    check("No historic static database or Redis passwords remain", all(value not in compose_text for value in ["payment_pass_2024", "redis_pass_2024", "mojaloop_pass_2024", "your-super-secret-jwt-key-change-in-production"]), "no static defaults")
    check("Kafka does not auto-create topics", services["kafka"]["environment"].get("KAFKA_AUTO_CREATE_TOPICS_ENABLE") == "false", "KAFKA_AUTO_CREATE_TOPICS_ENABLE=false")
    check("Keycloak uses production start mode and strict hostname", "start-dev" not in services["keycloak"]["command"] and services["keycloak"]["environment"].get("KC_HOSTNAME_STRICT") == "true", services["keycloak"]["command"])

    portal = next(client for client in realm["clients"] if client["clientId"] == "payment-switch-portal")
    api = next(client for client in realm["clients"] if client["clientId"] == "payment-switch-api")
    gateway = next(client for client in realm["clients"] if client["clientId"] == "apisix-gateway")
    check("Realm has no seeded user account", realm.get("users") == [], "users=[]")
    check("Portal has no wildcard origins or redirects", not any("*" in value for value in portal["redirectUris"] + portal["webOrigins"]), "explicit portal origin")
    check("Clients do not allow full scope", not portal["fullScopeAllowed"] and not api["fullScopeAllowed"] and not gateway["fullScopeAllowed"], "fullScopeAllowed=false")
    for client, variable in ((portal, "KEYCLOAK_CLIENT_SECRET"), (api, "KEYCLOAK_API_CLIENT_SECRET"), (gateway, "KEYCLOAK_APISIX_CLIENT_SECRET")):
        check(f"{client['clientId']} is confidential with injected secret", client.get("publicClient") is False and client.get("secret") == "${" + variable + "}", variable)
    check("Portal tokens have API audience mapper", any(mapper.get("protocolMapper") == "oidc-audience-mapper" and mapper.get("config", {}).get("included.client.audience") == "payment-switch-api" for mapper in portal["protocolMappers"]), "payment-switch-api audience")

    check("Node backend explicitly pins RS256", "algorithms: ['RS256']" in node_auth, "jose algorithms option")
    check("Go ledger uses Keycloak JWT middleware", "integration.NewKeycloakJWTValidator" in go_main and "rbac.Authenticate" not in go_main, "RS256/JWKS middleware")
    check("Go validator cryptographically verifies RS256 signatures", "rsa.VerifyPKCS1v15" in go_jwt and "trust the signature" not in go_jwt, "RSA SHA-256 verification")
    check("Go validator bounds JWKS response size", "io.LimitReader(resp.Body, 1<<20)" in go_jwt, "1 MiB cap")
    check("Go APISIX helper does not disable TLS verification", '"ssl_verify":                         false' not in go_jwt, "no ssl_verify=false helper")
    check("Go APISIX helper has no literal placeholder secret", "PLACEHOLDER_FROM_VAULT" not in go_jwt, "no generated placeholder secret")

    passed = 0
    for name, ok, detail in checks:
        print(f"{'PASS' if ok else 'FAIL'} {name}: {detail}")
        passed += int(ok)
    print(f"Summary: {passed}/{len(checks)} checks passed")
    return 0 if passed == len(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
