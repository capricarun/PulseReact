#!/usr/bin/env bash
# End-to-end smoke test through the public entry point (ALB -> frontend nginx -> backend -> MySQL).
# Usage: scripts/smoke-test.sh http://<app-url>
# Exits non-zero on the first failure, so the pipeline can roll back.
set -euo pipefail

BASE_URL="${1:?Usage: smoke-test.sh <base-url>}"
BASE_URL="${BASE_URL%/}"
RUN_ID="$(date +%s)$RANDOM"
EMAIL="ci_${RUN_ID}@example.com"
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
  -d "{\"name\":\"CI Smoke ${RUN_ID}\",\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")" \
  || fail "register failed (backend -> database write)"
echo "${REGISTER}" | jq -e '.token' >/dev/null || fail "register did not return a token"
pass "user registered (backend -> MySQL write)"

TOKEN="$(curl -fsS --max-time 10 -X POST "${BASE_URL}/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" | jq -r '.token')"
[ -n "${TOKEN}" ] && [ "${TOKEN}" != "null" ] || fail "login failed"
pass "login works (JWT issued)"

curl -fsS --max-time 10 "${BASE_URL}/api/posts?page=1" | jq -e '.data | type == "array"' >/dev/null \
  || fail "the public post list did not load (MySQL read)"
pass "public post list loads (MySQL read)"

# The check post is a DRAFT: only its author can see it, so deployments never add posts to the public homepage
TITLE="Deployment check ${RUN_ID}"
SLUG="$(curl -fsS --max-time 10 -X POST "${BASE_URL}/api/posts" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"title\":\"${TITLE}\",\"body\":\"Automated smoke test run ${RUN_ID} after an EKS rollout.\",\"tag\":\"smoketest\",\"status\":\"draft\"}" \
  | jq -r '.slug')"
[ -n "${SLUG}" ] && [ "${SLUG}" != "null" ] || fail "creating a post failed"
pass "draft post created (${SLUG})"

curl -fsS --max-time 10 "${BASE_URL}/api/posts/${SLUG}" -H "Authorization: Bearer ${TOKEN}" \
  | jq -e --arg t "${TITLE}" '.title == $t and .status == "draft"' >/dev/null \
  || fail "the author could not read the new draft"
pass "author can read the draft (MySQL read)"

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${BASE_URL}/api/posts/${SLUG}")"
[ "${code}" = "404" ] || fail "draft was visible to anonymous visitors (HTTP ${code})"
pass "draft is hidden from the public"

curl -fsS --max-time 10 -X POST "${BASE_URL}/api/posts/${SLUG}/comments" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer ${TOKEN}" \
  -d '{"body":"Smoke test comment"}' | jq -e '.id' >/dev/null || fail "adding a comment failed"
curl -fsS --max-time 10 "${BASE_URL}/api/posts/${SLUG}" -H "Authorization: Bearer ${TOKEN}" \
  | jq -e '.comments | length == 1' >/dev/null || fail "the new comment was not returned with the post"
pass "comment added and read back"

echo "All smoke tests passed for ${BASE_URL}"
