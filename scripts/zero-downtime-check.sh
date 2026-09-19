#!/usr/bin/env bash
# Proves the rolling update has no downtime: calls the UI and the API twice a second while a
# deployment is running, and prints every failed request.
# Usage: scripts/zero-downtime-check.sh http://<app-url> [duration-seconds]   (default 240 s)
set -uo pipefail

BASE_URL="${1:?Usage: zero-downtime-check.sh <base-url> [duration-seconds]}"
BASE_URL="${BASE_URL%/}"
DURATION="${2:-240}"

end=$((SECONDS + DURATION))
total=0
failed=0

echo "Checking ${BASE_URL} for ${DURATION}s - start the deployment now"
while [ "${SECONDS}" -lt "${end}" ]; do
  for path in "/" "/api/health"; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "${BASE_URL}${path}")"
    total=$((total + 1))
    if [ "${code}" != "200" ]; then
      failed=$((failed + 1))
      echo "$(date +%H:%M:%S)  ${path}  HTTP ${code}  <-- failed"
    fi
  done
  if [ $((total % 40)) -eq 0 ]; then
    echo "$(date +%H:%M:%S)  ${total} requests so far, ${failed} failed"
  fi
  sleep 0.5
done

echo "Result: ${total} requests, $((total - failed)) succeeded, ${failed} failed"
[ "${failed}" -eq 0 ]
