import { createChildLogger } from "../lib/logger";

const log = createChildLogger("env");
const isProduction = process.env.NODE_ENV === "production";

function value(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function validateEnv(): void {
  const warnings: string[] = [];
  const failures: string[] = [];
  const jwtSecret = value("JWT_SECRET");

  if (!value("OAUTH_SERVER_URL") && !value("KEYCLOAK_URL")) {
    warnings.push(
      "OAUTH_SERVER_URL or KEYCLOAK_URL should be configured for authentication"
    );
  }
  if (!jwtSecret) {
    if (isProduction) failures.push("JWT_SECRET is required in production");
    else warnings.push("JWT_SECRET should be set for secure session tokens");
  } else if (
    isProduction &&
    (jwtSecret.length < 32 || jwtSecret === "dev-secret-change-in-production")
  ) {
    failures.push(
      "JWT_SECRET must be a non-default value of at least 32 characters"
    );
  }

  if (isProduction) {
    for (const name of [
      "DATABASE_URL",
      "KEYCLOAK_URL",
      "KEYCLOAK_REALM",
      "KEYCLOAK_CLIENT_ID",
      "ALLOWED_ORIGINS",
      "APISIX_ADMIN_URL",
      "APISIX_ADMIN_KEY",
      "OPA_URL",
      "PERMIFY_URL",
      "PERMIFY_TENANT_ID",
      "PERMIFY_AUTH_TOKEN",
      "REDIS_URL",
      "ENCRYPTION_KEY",
      "WEBHOOK_SIGNING_KEY",
      "PAYMENT_ORCHESTRATOR_URL",
    ]) {
      if (!value(name)) failures.push(`${name} is required in production`);
    }
    const origins = value("ALLOWED_ORIGINS")
      .split(",")
      .map(origin => origin.trim())
      .filter(Boolean);
    if (origins.includes("*")) {
      failures.push("ALLOWED_ORIGINS must not contain * in production");
    }

    for (const name of ["ENCRYPTION_KEY", "WEBHOOK_SIGNING_KEY"]) {
      const secret = value(name);
      if (secret && secret.length < 32)
        failures.push(`${name} must be at least 32 characters`);
    }

    const requiredFlags: Record<string, string> = {
      ENABLE_REAL_INTEGRATIONS: "true",
      OPA_REQUIRED: "true",
      PERMIFY_ENFORCEMENT_REQUIRED: "true",
      MULTIPART_RATE_REDIS_REQUIRED: "true",
      PAYMENT_ORCHESTRATOR_REQUIRED: "true",
    };
    for (const [name, expected] of Object.entries(requiredFlags)) {
      if (value(name) !== expected)
        failures.push(`${name} must be ${expected} in production`);
    }
    if (value("ENABLE_DEV_AUTH") === "true")
      failures.push("ENABLE_DEV_AUTH must not be enabled in production");
  }

  if (failures.length)
    throw new Error(`Fatal environment configuration: ${failures.join("; ")}`);
  if (warnings.length)
    log.warn({ warnings: warnings.join("; ") }, "[ENV] Configuration warnings");
}

validateEnv();

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "payment-switch",
  cookieSecret: process.env.JWT_SECRET ?? "dev-secret-change-in-production",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl:
    process.env.OAUTH_SERVER_URL ||
    (process.env.KEYCLOAK_URL
      ? `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM ?? "payment-switch"}/protocol/openid-connect`
      : ""),
  keycloakUrl: process.env.KEYCLOAK_URL ?? "http://keycloak:8080",
  keycloakRealm: process.env.KEYCLOAK_REALM ?? "payment-switch",
  keycloakClientId: process.env.KEYCLOAK_CLIENT_ID ?? "payment-switch-api",
  keycloakClientSecret: process.env.KEYCLOAK_CLIENT_SECRET ?? "",
  apisixAdminUrl: process.env.APISIX_ADMIN_URL ?? "http://apisix:9180",
  apisixAdminKey: process.env.APISIX_ADMIN_KEY ?? "",
  permifyUrl: process.env.PERMIFY_URL ?? "http://permify:3476",
  openappsecUrl: process.env.OPENAPPSEC_URL ?? "http://openappsec:8080",
  forgeApiUrl: process.env.FORGE_API_URL ?? "http://localhost:8090",
  forgeApiKey: process.env.FORGE_API_KEY ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction,
};
