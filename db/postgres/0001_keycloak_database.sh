#!/usr/bin/env bash
# This runs only on first PostgreSQL volume initialization. It creates a dedicated
# Keycloak database and owner using the externally supplied isolated secret.
set -euo pipefail

: "${KEYCLOAK_DB_PASSWORD:?KEYCLOAK_DB_PASSWORD must be set for Keycloak database bootstrap}"

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=keycloak_db_password="$KEYCLOAK_DB_PASSWORD" <<'EOSQL'
CREATE ROLE keycloak_user LOGIN PASSWORD :'keycloak_db_password';
CREATE DATABASE keycloak OWNER keycloak_user;
EOSQL
