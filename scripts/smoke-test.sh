#!/usr/bin/env bash
# End-to-end smoke test through the public entry point (ALB -> frontend nginx -> backend -> MySQL).
# Usage: scripts/smoke-test.sh http://<app-url>
# Exits non-zero on the first failure, so the pipeline can roll back.
set -euo pipefail

BASE_URL="${1:?Usage: smoke-test.sh <base-url>}"
BASE_URL="${BASE_URL%/}"
RUN_ID="$(date +%s)$RANDOM"
USERNAME="ci_${RUN_ID}"
EMAIL="${USERNAME}@example.com"
PASSWORD="Smoke-${RUN_ID}-pass"

pass() { printf '  \342\234\224 %s\n' "$1"; }
fail() { printf '  \342\234\230 %s\n' "$1" >&2; exit 1; }

# Retry helper: the ALB can take a few seconds to register new targets
wait_for() {
  local url="$1" expected="$2" tries="${3:-30}"
  for _ in $(seq 1 "$tries"); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" || true)"
    [ "$code" = "$expected" ] && return 0
    sleep 5
  done
  return 1
}

echo "Smoke testing ${BASE_URL}"

wait_for "${BASE_URL}/healthz" 200 || fail "frontend /healthz did not return 200"
pass "frontend (nginx) is healthy"

wait_for "${BASE_URL}/api/health" 200 || fail "backend /api/health did not return 200 through nginx"
pass "frontend -> backend proxy works (/api/health)"

curl -fsS --max-time 10 "${BASE_URL}/" | grep -q '<div id="root">' || fail "index.html was not served"
pass "React app index.html is served"

REGISTER="$(curl -fsS --max-time 10 -X POST "${BASE_URL}/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${USERNAME}\",\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"displayName\":\"CI Smoke\"}")" \
  || fail "register failed (backend -> database write)"
echo "${REGISTER}" | jq -e '.token' >/dev/null || fail "register did not return a token"
pass "user registered (backend -> MySQL write)"

TOKEN="$(curl -fsS --max-time 10 -X POST "${BASE_URL}/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" | jq -r '.token')"
[ -n "${TOKEN}" ] && [ "${TOKEN}" != "null" ] || fail "login failed"
pass "login works (JWT issued)"

CONTENT="Deployment check ${RUN_ID} #smoketest"
POST_ID="$(curl -fsS --max-time 10 -X POST "${BASE_URL}/api/posts" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"content\":\"${CONTENT}\"}" | jq -r '.id')"
[ -n "${POST_ID}" ] && [ "${POST_ID}" != "null" ] || fail "creating a post failed"
pass "post created (id ${POST_ID})"

curl -fsS --max-time 10 "${BASE_URL}/api/posts?page=1" -H "Authorization: Bearer ${TOKEN}" \
  | jq -e --arg c "${CONTENT}" '.posts[] | select(.content == $c) | .hashtags | index("smoketest")' >/dev/null \
  || fail "new post not found in the feed"
pass "post is visible in the feed with its hashtag (MySQL read)"

LIKED="$(curl -fsS --max-time 10 -X POST "${BASE_URL}/api/posts/${POST_ID}/like" \
  -H "Authorization: Bearer ${TOKEN}" | jq -r '.liked')"
[ "${LIKED}" = "true" ] || fail "like toggle failed"
pass "like toggled (transactional update)"

echo "All smoke tests passed for ${BASE_URL}"
