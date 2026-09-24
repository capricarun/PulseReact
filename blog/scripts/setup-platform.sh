#!/usr/bin/env bash
# One-time setup of the Marginal blog next to Pulse on the same EKS cluster (pulse-eks).
# Run it yourself with admin AWS credentials and a cluster-admin kubeconfig - NOT from Jenkins.
# Pulse (namespace "pulse", pulse-alb) is not changed by anything in this script.
#
#   1. ECR repositories blog-backend and blog-frontend (scan on push, same lifecycle policy as Pulse)
#   2. Lets the Jenkins IAM role push to those two repositories (extra inline policy)
#   3. Secret "pulse/blog/app" in AWS Secrets Manager with generated passwords
#      (the "pulse/" prefix is what External Secrets is already allowed to read - no IAM change needed)
#   4. Kubernetes: namespace "blog", RBAC, secrets sync, Services, network policies, MySQL, Ingress (new ALB "blog-alb")
#   5. Monitoring (ServiceMonitor + alerts), if the Prometheus Operator is installed
#
# Usage (from the repository root or anywhere):
#   JENKINS_ROLE_NAME=<IAM role of the Jenkins EC2 instance> bash blog/scripts/setup-platform.sh
# Find the role name with:  aws iam list-roles --query "Roles[?contains(RoleName, 'enkins')].RoleName"
# Safe to run more than once.
set -euo pipefail

: "${JENKINS_ROLE_NAME:?Set JENKINS_ROLE_NAME to the IAM role used by the Jenkins EC2 instance}"
REGION="${AWS_REGION:-ap-south-1}"
CLUSTER="${CLUSTER_NAME:-pulse-eks}"
NS=blog
SECRET_ID=pulse/blog/app

BLOG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "${BLOG_DIR}/.." && pwd)"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"

echo "== 1) ECR repositories"
for REPO in blog-backend blog-frontend; do
  if ! aws ecr describe-repositories --region "${REGION}" --repository-names "${REPO}" >/dev/null 2>&1; then
    aws ecr create-repository --region "${REGION}" --repository-name "${REPO}" \
      --image-scanning-configuration scanOnPush=true --encryption-configuration encryptionType=AES256 >/dev/null
    echo "   created ${REPO}"
  else
    echo "   ${REPO} already exists"
  fi
  aws ecr put-lifecycle-policy --region "${REGION}" --repository-name "${REPO}" \
    --lifecycle-policy-text "file://${REPO_ROOT}/infra/ecr-lifecycle-policy.json" >/dev/null
done

echo "== 2) Jenkins may push to the blog repositories"
sed "s/\${AWS_ACCOUNT_ID}/${ACCOUNT_ID}/g" "${BLOG_DIR}/infra/jenkins-blog-ecr-policy.json" > /tmp/jenkins-blog-ecr-policy.json
aws iam put-role-policy --role-name "${JENKINS_ROLE_NAME}" --policy-name blog-ecr-push \
  --policy-document file:///tmp/jenkins-blog-ecr-policy.json
rm -f /tmp/jenkins-blog-ecr-policy.json

echo "== 3) Application secret in AWS Secrets Manager (${SECRET_ID})"
if aws secretsmanager describe-secret --region "${REGION}" --secret-id "${SECRET_ID}" >/dev/null 2>&1; then
  echo "   already exists - keeping the current values"
else
  SECRET_JSON="$(printf '{"MYSQL_ROOT_PASSWORD":"%s","DB_PASSWORD":"%s","JWT_SECRET":"%s"}' \
    "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" "$(openssl rand -hex 48)")"
  aws secretsmanager create-secret --region "${REGION}" --name "${SECRET_ID}" \
    --description "Marginal blog: MySQL and JWT secrets" --secret-string "${SECRET_JSON}" >/dev/null
  unset SECRET_JSON
  echo "   created with generated values (never printed or stored in Git)"
fi

echo "== 4) Kubernetes resources in namespace '${NS}'"
aws eks update-kubeconfig --name "${CLUSTER}" --region "${REGION}" >/dev/null
K8S="${BLOG_DIR}/k8s"
kubectl apply -f "${K8S}/platform/namespace.yaml"
kubectl apply -f "${K8S}/platform/rbac.yaml"
kubectl apply -f "${K8S}/platform/external-secrets.yaml"
echo "   waiting for External Secrets to create blog-app-secrets..."
kubectl -n "${NS}" wait externalsecret/blog-app-secrets --for=condition=Ready --timeout=120s
kubectl apply -f "${K8S}/platform/services.yaml"
kubectl apply -f "${K8S}/platform/network-policies.yaml"

kubectl -n "${NS}" create configmap mysql-init \
  --from-file=01-schema.sql="${BLOG_DIR}/backend/sql/schema.sql" \
  --from-file=02-create-app-user.sh="${K8S}/database/create-app-user.sh" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f "${K8S}/database/mysql.yaml"
echo "   waiting for MySQL (the first start loads the schema and demo posts)..."
kubectl -n "${NS}" rollout status statefulset/mysql --timeout=600s

kubectl apply -f "${K8S}/platform/ingress.yaml"

echo "== 5) Monitoring"
if kubectl get crd servicemonitors.monitoring.coreos.com >/dev/null 2>&1; then
  kubectl apply -f "${K8S}/monitoring/backend-servicemonitor.yaml"
  kubectl apply -f "${K8S}/monitoring/blog-alerts.yaml"
else
  echo "   Prometheus Operator not installed - skipped"
fi

echo "== Waiting for the new load balancer (blog-alb)..."
HOST=""
for _ in $(seq 1 60); do
  HOST="$(kubectl -n "${NS}" get ingress blog -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
  [ -n "${HOST}" ] && break
  sleep 5
done

echo
echo "Platform ready. Blog URL (live after the first Jenkins deployment): http://${HOST:-<pending - check: kubectl -n blog get ingress blog>}"
echo "Next: in Jenkins create a Pipeline job for this repository with Script Path 'blog/Jenkinsfile' and run it once."
