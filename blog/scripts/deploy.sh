#!/usr/bin/env bash
# Rolling deployment of the application layer (backend, then frontend) to EKS.
# Used by the Jenkins "EKS Deployment" stage, and can be run by hand for the first deployment.
# Required: BACKEND_IMAGE, FRONTEND_IMAGE (full image references, e.g. <account>.dkr.ecr.<region>.amazonaws.com/blog-backend:12-a1b2c3d)
# Optional: K8S_NAMESPACE (default: blog), ROLLOUT_TIMEOUT (default: 300s)
set -euo pipefail

: "${BACKEND_IMAGE:?BACKEND_IMAGE is required}"
: "${FRONTEND_IMAGE:?FRONTEND_IMAGE is required}"
NS="${K8S_NAMESPACE:-blog}"
TIMEOUT="${ROLLOUT_TIMEOUT:-300s}"

cd "$(dirname "$0")/.."

# The public URL of the ALB (used as the backend's CORS origin)
ALB_HOST="$(kubectl -n "${NS}" get ingress blog -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
export APP_URL="http://${ALB_HOST:-localhost}"

# Only these three placeholders are replaced; everything else in the manifests is left untouched
render() {
  # shellcheck disable=SC2016
  envsubst '${BACKEND_IMAGE} ${FRONTEND_IMAGE} ${APP_URL}' < "$1"
}

echo "Namespace:      ${NS}"
echo "Backend image:  ${BACKEND_IMAGE}"
echo "Frontend image: ${FRONTEND_IMAGE}"
echo "App URL:        ${APP_URL}"

# Backend first, so a new API is already live before the new UI that may depend on it
render k8s/app/backend.yaml | kubectl apply -n "${NS}" -f -
kubectl -n "${NS}" rollout status deployment/backend --timeout="${TIMEOUT}"

render k8s/app/frontend.yaml | kubectl apply -n "${NS}" -f -
kubectl -n "${NS}" rollout status deployment/frontend --timeout="${TIMEOUT}"

kubectl -n "${NS}" get deployments,replicasets,pods -l app.kubernetes.io/part-of=blog -o wide
