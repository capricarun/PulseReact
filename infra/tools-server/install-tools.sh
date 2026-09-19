#!/usr/bin/env bash
# One-time setup of the tools server (Ubuntu 24.04 LTS, t3.xlarge, 50 GiB gp3).
# Installs: Java 21, Jenkins LTS, Docker Engine + Compose, Trivy (pinned + checksum-verified),
#           AWS CLI v2, kubectl 1.35, jq, envsubst - and prepares the kernel settings SonarQube needs.
# Run as the "ubuntu" user:  sudo bash install-tools.sh
set -euo pipefail

TRIVY_VERSION="0.74.0"   # pinned: releases 0.69.4-0.69.6 were compromised in March 2026 (CVE-2026-33634)
KUBECTL_MINOR="v1.35"    # keep kubectl within one minor version of the EKS cluster

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo" >&2; exit 1; fi
export DEBIAN_FRONTEND=noninteractive

echo "==> Base packages"
apt-get update -y
apt-get install -y ca-certificates curl gnupg unzip jq git gettext-base fontconfig openjdk-21-jre

echo "==> Docker Engine + Compose plugin (official Docker repository)"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

echo "==> Jenkins LTS (official repository, 2026 signing key)"
curl -fsSL https://pkg.jenkins.io/debian-stable/jenkins.io-2026.key -o /etc/apt/keyrings/jenkins-keyring.asc
echo "deb [signed-by=/etc/apt/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/" \
  > /etc/apt/sources.list.d/jenkins.list
apt-get update -y
apt-get install -y jenkins
usermod -aG docker jenkins          # let pipelines run docker build/push
systemctl enable jenkins
systemctl restart jenkins

echo "==> Trivy ${TRIVY_VERSION} (verify the checksum before installing)"
tmp="$(mktemp -d)"
curl -fsSL -o "${tmp}/trivy.deb" "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.deb"
curl -fsSL -o "${tmp}/checksums.txt" "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_checksums.txt"
expected="$(grep " trivy_${TRIVY_VERSION}_Linux-64bit.deb\$" "${tmp}/checksums.txt" | awk '{print $1}')"
echo "${expected}  ${tmp}/trivy.deb" | sha256sum --check -
dpkg -i "${tmp}/trivy.deb"
rm -rf "${tmp}"

echo "==> AWS CLI v2"
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
rm -rf /tmp/aws && unzip -q /tmp/awscliv2.zip -d /tmp
/tmp/aws/install --update
rm -rf /tmp/aws /tmp/awscliv2.zip

echo "==> kubectl ${KUBECTL_MINOR}"
curl -fsSL "https://pkgs.k8s.io/core:/stable:/${KUBECTL_MINOR}/deb/Release.key" | gpg --dearmor --yes -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/${KUBECTL_MINOR}/deb/ /" \
  > /etc/apt/sources.list.d/kubernetes.list
apt-get update -y
apt-get install -y kubectl

echo "==> Kernel settings required by SonarQube's embedded Elasticsearch"
cat > /etc/sysctl.d/99-sonarqube.conf <<'EOF'
vm.max_map_count=524288
fs.file-max=131072
EOF
sysctl --system > /dev/null

echo "==> Folder for SonarQube + Nexus (docker compose)"
mkdir -p /opt/devops-tools

echo
echo "Installed versions:"
java -version 2>&1 | head -1
docker --version
docker compose version
echo "Jenkins $(jenkins --version)"
trivy --version | head -1
aws --version
kubectl version --client | head -1
echo
echo "Jenkins initial admin password:"
cat /var/lib/jenkins/secrets/initialAdminPassword 2>/dev/null || echo "(Jenkins is still starting - run: sudo cat /var/lib/jenkins/secrets/initialAdminPassword)"
