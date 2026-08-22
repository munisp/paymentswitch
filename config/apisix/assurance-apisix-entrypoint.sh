#!/usr/bin/env sh
# Render the standalone APISIX TLS resource only from supplied isolated secret files.
# This wrapper intentionally fails before APISIX starts if the certificate/key pair is
# absent, malformed, mismatched, or does not match the configured public SNI.
set -eu

: "${APISIX_TLS_CERT_FILE:?APISIX_TLS_CERT_FILE is required}"
: "${APISIX_TLS_KEY_FILE:?APISIX_TLS_KEY_FILE is required}"
: "${APISIX_TLS_SERVER_NAME:?APISIX_TLS_SERVER_NAME is required}"
: "${PORTAL_ALLOWED_ORIGIN:?PORTAL_ALLOWED_ORIGIN is required}"

for required_file in "$APISIX_TLS_CERT_FILE" "$APISIX_TLS_KEY_FILE"; do
  if [ ! -r "$required_file" ] || [ ! -s "$required_file" ]; then
    echo "APISIX TLS bootstrap failed: unreadable or empty secret file: $required_file" >&2
    exit 64
  fi
done

if ! openssl x509 -in "$APISIX_TLS_CERT_FILE" -noout >/dev/null 2>&1; then
  echo "APISIX TLS bootstrap failed: certificate is not a valid PEM X.509 certificate" >&2
  exit 65
fi
if ! openssl pkey -in "$APISIX_TLS_KEY_FILE" -noout >/dev/null 2>&1; then
  echo "APISIX TLS bootstrap failed: private key is not a valid PEM key" >&2
  exit 66
fi

cert_public_key="$(openssl x509 -in "$APISIX_TLS_CERT_FILE" -noout -pubkey | openssl pkey -pubin -outform DER | sha256sum | awk '{print $1}')"
key_public_key="$(openssl pkey -in "$APISIX_TLS_KEY_FILE" -pubout -outform DER | sha256sum | awk '{print $1}')"
if [ "$cert_public_key" != "$key_public_key" ]; then
  echo "APISIX TLS bootstrap failed: certificate and private key do not match" >&2
  exit 67
fi

if ! openssl x509 -in "$APISIX_TLS_CERT_FILE" -noout -checkend 86400 >/dev/null 2>&1; then
  echo "APISIX TLS bootstrap failed: certificate expires within 24 hours or is invalid" >&2
  exit 68
fi

if ! openssl x509 -in "$APISIX_TLS_CERT_FILE" -noout -ext subjectAltName 2>/dev/null | grep -F "DNS:${APISIX_TLS_SERVER_NAME}" >/dev/null; then
  echo "APISIX TLS bootstrap failed: certificate SAN does not include ${APISIX_TLS_SERVER_NAME}" >&2
  exit 69
fi

TEMPLATE=/usr/local/apisix/conf/apisix.yaml.template
OUTPUT=/usr/local/apisix/conf/apisix.yaml
if [ ! -r "$TEMPLATE" ]; then
  echo "APISIX TLS bootstrap failed: missing declarative configuration template" >&2
  exit 70
fi

cert_indented=/tmp/apisix-cert.pem
key_indented=/tmp/apisix-key.pem
sed 's/^/      /' "$APISIX_TLS_CERT_FILE" > "$cert_indented"
sed 's/^/      /' "$APISIX_TLS_KEY_FILE" > "$key_indented"

sed \
  -e "/__APISIX_TLS_CERT_PEM__/r $cert_indented" \
  -e '/__APISIX_TLS_CERT_PEM__/d' \
  -e "/__APISIX_TLS_KEY_PEM__/r $key_indented" \
  -e '/__APISIX_TLS_KEY_PEM__/d' \
  -e "s/__APISIX_TLS_SERVER_NAME__/${APISIX_TLS_SERVER_NAME}/g" \
  -e "s|__PORTAL_ALLOWED_ORIGIN__|${PORTAL_ALLOWED_ORIGIN}|g" \
  "$TEMPLATE" > "$OUTPUT"

chmod 0600 "$OUTPUT"
rm -f "$cert_indented" "$key_indented"

exec /docker-entrypoint.sh "$@"
