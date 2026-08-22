#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APPLY=0
RUN_CHECKS=0
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=1
  [[ "${2:-}" == "--run-checks" ]] && RUN_CHECKS=1
elif [[ "${1:-}" == "--dry-run" || -z "${1:-}" ]]; then
  :
elif [[ "${1:-}" == "--help" ]]; then
  echo "usage: $0 [--dry-run|--apply [--run-checks]]"
  exit 0
else
  echo "usage: $0 [--dry-run|--apply [--run-checks]]" >&2
  exit 2
fi

# Floors selected from the current pnpm audit. Direct parent upgrades are kept
# conservative; the script does not force major Express/React/ExcelJS changes.
# The scoped overrides handle vulnerable transitive packages where the parent
# package has no compatible release exposing a patched child.
DIRECT_UPGRADES=(
  "jspdf@4.2.1"
  "express-rate-limit@8.6.2"
  "nanoid@5.1.16"
  "@aws-sdk/client-s3@3.1111.0"
  "@aws-sdk/s3-request-presigner@3.1111.0"
)

printf '%s\n' "Residual critical/high remediation plan"
printf '%s\n' "  direct upgrades: ${DIRECT_UPGRADES[*]}"
printf '%s\n' "  scoped overrides: dompurify>=3.4.13, fast-xml-parser>=5.10.1, lodash/lodash-es>=4.18.1, qs>=6.15.3, minimatch>=5.1.8, tmp>=0.2.6, path-to-regexp>=0.1.13, brace-expansion>=2.1.4"
printf '%s\n' "  mode: $([[ $APPLY -eq 1 ]] && echo apply || echo dry-run)"

if [[ "$APPLY" -eq 0 ]]; then
  echo "Dry run only. Re-run with --apply or --apply --run-checks to modify dependencies."
  exit 0
fi

command -v pnpm >/dev/null || { echo "pnpm is required" >&2; exit 1; }

# Update direct parents through pnpm so package.json and pnpm-lock.yaml remain
# synchronized. No hand-editing of lockfile integrity or resolution metadata.
pnpm up "${DIRECT_UPGRADES[@]}"

# Apply minimum safe transitive floors in the repository-level workspace
# configuration. This avoids the deprecated package-level `pnpm` field, which
# pnpm 10 ignores for overrides.
python3 scripts/update_pnpm_workspace_overrides.py

pnpm install
pnpm install --frozen-lockfile

mkdir -p audit/artifacts
set +e
pnpm audit --prod --json > audit/artifacts/pnpm-audit-after-second-wave.json 2>audit/artifacts/pnpm-audit-after-second-wave.err
audit_rc=$?
set -e
printf '%s\n' "$audit_rc" > audit/artifacts/pnpm-audit-after-second-wave.exit

if [[ "$RUN_CHECKS" -eq 1 ]]; then
  pnpm check
  pnpm test
  pnpm build
fi

pnpm list jspdf express-rate-limit nanoid @aws-sdk/client-s3 @aws-sdk/s3-request-presigner --depth 0
printf 'pnpm audit exit code: %s\n' "$audit_rc"

if [[ "$audit_rc" -ne 0 ]]; then
  echo "Residual advisories remain; inspect audit/artifacts/pnpm-audit-after-second-wave.json" >&2
  exit "$audit_rc"
fi

echo "Second-wave critical/high remediation completed with a clean production audit."
