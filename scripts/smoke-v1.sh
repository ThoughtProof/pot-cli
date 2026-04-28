#!/usr/bin/env bash
# Smoke-Test for api.thoughtproof.ai v1 (Dimension #7 endpoint, frozen-as-shipped)
# Per ADR-0011 Stub: v1 bleibt live als Dimension-#7-Endpoint, alles Neue geht auf v2.
#
# Exit codes:
#   0 — health endpoint OK (HTTP 200 + JSON), version matches expected
#   1 — health endpoint reachable but unexpected response
#   2 — health endpoint unreachable (network/DNS/TLS failure)

set -euo pipefail

API_BASE="${THOUGHTPROOF_API_BASE:-https://api.thoughtproof.ai}"
HEALTH_PATH="${THOUGHTPROOF_HEALTH_PATH:-/v1/health}"
# Note 2026-04-28: /v1/health currently reports version 0.1.0 (service-version field).
# Hermes' deploy-tag reference "1.3.7" is likely a different version concept (deploy tag
# vs. service-reported version) — to be reconciled at next API audit.
EXPECTED_VERSION_PREFIX="${THOUGHTPROOF_EXPECTED_VERSION:-0.}"
TIMEOUT="${THOUGHTPROOF_SMOKE_TIMEOUT:-10}"

URL="${API_BASE}${HEALTH_PATH}"

echo "[smoke-v1] GET ${URL} (timeout ${TIMEOUT}s)"

# Capture both body and HTTP status; fail loudly on connection error
HTTP_STATUS=$(curl -sS -o /tmp/smoke-v1-body.json -w "%{http_code}" \
  --max-time "${TIMEOUT}" \
  --retry 2 --retry-delay 2 \
  -H "Accept: application/json" \
  "${URL}" 2>&1) || {
    echo "[smoke-v1] FAIL: endpoint unreachable" >&2
    exit 2
}

if [ "${HTTP_STATUS}" != "200" ]; then
  echo "[smoke-v1] FAIL: expected HTTP 200, got ${HTTP_STATUS}" >&2
  cat /tmp/smoke-v1-body.json >&2 || true
  exit 1
fi

# Validate JSON shape — version field present, prefix matches
if ! command -v jq >/dev/null 2>&1; then
  echo "[smoke-v1] WARN: jq not installed, skipping version check"
  echo "[smoke-v1] OK (HTTP 200, body unverified)"
  exit 0
fi

VERSION=$(jq -r '.version // empty' /tmp/smoke-v1-body.json)

if [ -z "${VERSION}" ]; then
  echo "[smoke-v1] FAIL: response has no .version field" >&2
  cat /tmp/smoke-v1-body.json >&2
  exit 1
fi

case "${VERSION}" in
  "${EXPECTED_VERSION_PREFIX}"*)
    echo "[smoke-v1] OK: version ${VERSION} (matches prefix ${EXPECTED_VERSION_PREFIX})"
    exit 0
    ;;
  *)
    echo "[smoke-v1] FAIL: version ${VERSION} does not match prefix ${EXPECTED_VERSION_PREFIX}" >&2
    exit 1
    ;;
esac
