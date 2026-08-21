import { createChildLogger } from '../lib/logger';

const log = createChildLogger('env');
// Validate required environment variables at startup
function validateEnv() {
  const warnings: string[] = [];
  
  if (!process.env.OAUTH_SERVER_URL && !process.env.KEYCLOAK_URL) {
    warnings.push("OAUTH_SERVER_URL or KEYCLOAK_URL should be configured for authentication");
  }

  if (process.env.NODE_ENV === "production") {
    const required = ["DATABASE_URL", "REDIS_URL", "KEYCLOAK_URL", "KEYCLOAK_REALM", "KEYCLOAK_CLIENT_ID", "ALLOWED_ORIGINS"];
    for (const key of required) {
      if (!process.env[key]?.trim()) warnings.push(`${key} is required in production`);
    }
    const origins = process.env.ALLOWED_ORIGINS?.split(",").map(value => value.trim()).filter(Boolean) ?? [];
    if (origins.includes("*")) warnings.push("ALLOWED_ORIGINS must not contain * in production");
  }
  
  if (!process.env.JWT_SECRET) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("FATAL: JWT_SECRET environment variable is required in production");
    }
    warnings.push("JWT_SECRET should be set for secure session tokens");
  }
  
  if (warnings.length > 0 && process.env.NODE_ENV === "production") {
    throw new Error(`FATAL: invalid production configuration: ${warnings.join("; ")}`);
  }
}

// Run validation on module load
validateEnv();

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "payment-switch",
  cookieSecret: process.env.JWT_SECRET ?? "dev-secret-change-in-production",
  databaseUrl: process.env.DATABASE_URL ?? "",
  // OAuth Server URL (for legacy auth service or Keycloak)
  // Falls back to Keycloak URL if OAUTH_SERVER_URL is not set
  oAuthServerUrl: process.env.OAUTH_SERVER_URL || 
    (process.env.KEYCLOAK_URL ? `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM ?? "payment-switch"}/protocol/openid-connect` : ""),
  // Keycloak Configuration
  keycloakUrl: process.env.KEYCLOAK_URL ?? "http://keycloak:8080",
  keycloakRealm: process.env.KEYCLOAK_REALM ?? "payment-switch",
  keycloakClientId: process.env.KEYCLOAK_CLIENT_ID ?? "payment-switch-api",
  keycloakClientSecret: process.env.KEYCLOAK_CLIENT_SECRET ?? "",
  // APISIX Configuration
  apisixAdminUrl: process.env.APISIX_ADMIN_URL ?? "http://apisix:9180",
  apisixAdminKey: process.env.APISIX_ADMIN_KEY ?? "",
  // Permify Configuration
  permifyUrl: process.env.PERMIFY_URL ?? "http://permify:3476",
  // OpenAppSec Configuration
  openappsecUrl: process.env.OPENAPPSEC_URL ?? "http://openappsec:8080",
  // Forge Configuration (image generation, LLM, voice transcription, maps)
  forgeApiUrl: process.env.FORGE_API_URL ?? "http://localhost:8090",
  forgeApiKey: process.env.FORGE_API_KEY ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
};
