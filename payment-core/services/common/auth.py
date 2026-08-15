"""Shared service-side authorization dependencies.

Every business service must enforce authorization locally even when APISIX is the
external gateway. Missing or unverifiable credentials fail closed.
"""
from __future__ import annotations

import os
import time
from typing import Any, Annotated

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.algorithms import RSAAlgorithm

_bearer = HTTPBearer(auto_error=False)
_jwks_cache: dict[str, Any] = {"expires_at": 0.0, "keys": {}}


def _issuer() -> str:
    base = os.environ.get("KEYCLOAK_PUBLIC_URL") or os.environ.get("KEYCLOAK_URL")
    realm = os.environ.get("KEYCLOAK_REALM", "payment-switch")
    if not base:
        raise RuntimeError("KEYCLOAK_URL or KEYCLOAK_PUBLIC_URL must be configured")
    return f"{base.rstrip('/')}/realms/{realm}"


async def _get_key(kid: str) -> Any:
    now = time.time()
    if now >= _jwks_cache["expires_at"]:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{_issuer()}/protocol/openid-connect/certs")
            response.raise_for_status()
            keys = response.json().get("keys", [])
        _jwks_cache["keys"] = {key.get("kid"): key for key in keys if key.get("kid")}
        _jwks_cache["expires_at"] = now + 300
    key = _jwks_cache["keys"].get(kid)
    if not key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown signing key")
    return RSAAlgorithm.from_jwk(key)


async def require_auth(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> dict[str, Any]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token required")
    token = credentials.credentials
    try:
        header = jwt.get_unverified_header(token)
        key = await _get_key(header["kid"])
        claims = jwt.decode(
            token,
            key=key,
            algorithms=["RS256"],
            issuer=_issuer(),
            audience=os.environ.get("KEYCLOAK_AUDIENCE", "payment-switch-api"),
            options={"require": ["exp", "iat", "sub", "iss", "aud"]},
            leeway=30,
        )
        return claims
    except (KeyError, ValueError, jwt.PyJWTError, httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid access token") from exc


def require_roles(*roles: str):
    async def dependency(claims: Annotated[dict[str, Any], Depends(require_auth)]) -> dict[str, Any]:
        realm_roles = set(claims.get("realm_access", {}).get("roles", []))
        scope_roles = set(str(claims.get("scope", "")).split())
        if roles and not (realm_roles | scope_roles).intersection(roles):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return claims
    return dependency


AuthClaims = Annotated[dict[str, Any], Depends(require_auth)]
