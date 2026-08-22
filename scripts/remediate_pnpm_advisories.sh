#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APPLY=0
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=1
elif [[ "${1:-}" != "" && "${1:-}" != "--dry-run" ]]; then
  echo "usage: $0 [--dry-run|--apply]" >&2
  exit 2
fi

# Minimum versions from the audit advisories. The script deliberately upgrades
# the related tRPC packages together to avoid an incompatible minor-version
# graph. Axios is upgraded beyond every currently reported patched floor.
AXIOS_VERSION="1.19.0"
TRPC_VERSION="11.18.0"
DRIZZLE_VERSION="0.45.2"

packages=(
  "axios@${AXIOS_VERSION}"
  "@trpc/server@${TRPC_VERSION}"
  "@trpc/client@${TRPC_VERSION}"
  "@trpc/react-query@${TRPC_VERSION}"
  "drizzle-orm@${DRIZZLE_VERSION}"
)

printf '%s\n' "Dependency remediation plan"
printf '%s\n' "  axios: ${AXIOS_VERSION}"
printf '%s\n' "  @trpc/server, @trpc/client, @trpc/react-query: ${TRPC_VERSION}"
printf '%s\n' "  drizzle-orm: ${DRIZZLE_VERSION}"
printf '%s\n' "  mode: $([[ $APPLY -eq 1 ]] && echo apply || echo dry-run)"

if [[ "$APPLY" -eq 0 ]]; then
  echo
  echo "Dry run only. Re-run with --apply to update package.json and pnpm-lock.yaml."
  exit 0
fi

command -v pnpm >/dev/null || { echo "pnpm is required" >&2; exit 1; }

# Update direct dependencies and regenerate the lockfile through pnpm rather
# than editing the lockfile by hand.
pnpm up "${packages[@]}"

# Frozen-install reproducibility is a release gate.
pnpm install --frozen-lockfile

# Verify the targeted versions are actually resolved at the root.
pnpm list axios @trpc/server @trpc/client @trpc/react-query drizzle-orm --depth 0

# Run the production dependency audit. pnpm audit may return nonzero when
# residual transitive advisories remain; preserve its exit status in a file and
# print a machine-readable result without suppressing the evidence.
set +e
pnpm audit --prod --json > audit/artifacts/pnpm-audit-after-remediation.json 2>audit/artifacts/pnpm-audit-after-remediation.err
audit_rc=$?
set -e
printf '%s\n' "$audit_rc" > audit/artifacts/pnpm-audit-after-remediation.exit
printf 'pnpm audit exit code: %s\n' "$audit_rc"

# Keep type/build checks outside this script’s dependency-update responsibility,
# but run the fast package-manager integrity check here.
pnpm install --frozen-lockfile --lockfile-only

if [[ "$audit_rc" -ne 0 ]]; then
  echo "Residual advisories remain; inspect audit/artifacts/pnpm-audit-after-remediation.json" >&2
  exit "$audit_rc"
fi

echo "Targeted dependency remediation completed with a clean production audit."
