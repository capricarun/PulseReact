// Project-04 CI/CD pipeline for the Pulse three-tier app
// GitHub push -> Checkout -> Build -> Test -> SonarQube -> Quality Gate -> Docker Build -> Trivy
//             -> Image Versioning -> Push (Nexus + ECR) -> EKS Deployment (rolling) -> Deployment Validation
pipeline {
  agent any

  options {
    skipDefaultCheckout(true)
    disableConcurrentBuilds()
    timestamps()
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timeout(time: 60, unit: 'MINUTES')
  }

  triggers {
    githubPush() // GitHub webhook -> http://<JENKINS_IP>:8080/github-webhook/
  }

  tools {
    nodejs 'node24' // Manage Jenkins -> Tools -> NodeJS installations
  }

  environment {
    AWS_REGION     = 'ap-south-1'
    CLUSTER_NAME   = 'pulse-eks'
    K8S_NAMESPACE  = 'pulse'
    NEXUS_REGISTRY = 'localhost:8083' // Nexus Docker (hosted) repository connector on this server
    BACKEND_REPO   = 'pulse-backend'
    FRONTEND_REPO  = 'pulse-frontend'
    SCANNER_HOME   = tool 'sonar-scanner' // Manage Jenkins -> Tools -> SonarQube Scanner installations
    KUBECONFIG     = "${WORKSPACE}/.kube/config" // per-build kubeconfig, never shared between jobs
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        script {
          env.GIT_SHORT      = sh(script: 'git rev-parse --short=7 HEAD', returnStdout: true).trim()
          env.IMAGE_TAG      = "${env.BUILD_NUMBER}-${env.GIT_SHORT}" // unique, traceable version e.g. 42-a1b2c3d
          env.AWS_ACCOUNT_ID = sh(script: 'aws sts get-caller-identity --query Account --output text', returnStdout: true).trim()
          env.ECR_REGISTRY   = "${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com"
          currentBuild.displayName = "#${env.BUILD_NUMBER} (${env.IMAGE_TAG})"
        }
        sh 'git log -1 --pretty="Commit %h by %an: %s"'
      }
    }

    stage('Build') {
      steps {
        dir('backend') {
          sh 'npm ci --no-audit --no-fund'
        }
        dir('frontend') {
          sh 'npm ci --no-audit --no-fund'
          sh 'VITE_API_URL=/api npm run build'
        }
      }
    }

    stage('Test') {
      steps {
        dir('backend') {
          sh 'npm test'
          // LCOV paths are relative to backend/; prefix them so SonarQube (run from the repo root) can match the files
          sh "sed -i 's#^SF:#SF:backend/#' coverage/lcov.info"
        }
        dir('frontend') {
          sh 'npm test'
        }
      }
      post {
        always {
          junit allowEmptyResults: true, testResults: 'backend/test-results/*.xml, frontend/test-results/*.xml'
        }
      }
    }

    stage('SonarQube Analysis') {
      steps {
        withSonarQubeEnv('sonarqube') { // Manage Jenkins -> System -> SonarQube servers (name must match)
          sh '"${SCANNER_HOME}/bin/sonar-scanner" -Dsonar.projectVersion="${IMAGE_TAG}"'
        }
      }
    }

    stage('Quality Gate') {
      steps {
        timeout(time: 10, unit: 'MINUTES') {
          // Waits for SonarQube's webhook; aborts the pipeline (so nothing is deployed) if the gate fails
          waitForQualityGate abortPipeline: true
        }
      }
    }

    stage('Docker Build') {
      steps {
        sh '''
          docker build --pull \
            --build-arg APP_VERSION="${IMAGE_TAG}" \
            -t "${BACKEND_REPO}:${IMAGE_TAG}" backend

          docker build --pull \
            --build-arg APP_VERSION="${IMAGE_TAG}" \
            --build-arg VITE_API_URL=/api \
            -t "${FRONTEND_REPO}:${IMAGE_TAG}" frontend

          docker image ls --filter "reference=pulse-*:${IMAGE_TAG}"
        '''
      }
    }

    stage('Trivy Scan') {
      steps {
        sh '''
          mkdir -p reports

          # 1) Repository: leaked secrets + Dockerfile/Kubernetes misconfigurations (HIGH/CRITICAL fail the build)
          trivy fs --scanners secret,misconfig --severity HIGH,CRITICAL --exit-code 1 --no-progress \
            --skip-dirs backend/node_modules --skip-dirs frontend/node_modules --skip-dirs frontend/dist .

          for IMAGE in "${BACKEND_REPO}:${IMAGE_TAG}" "${FRONTEND_REPO}:${IMAGE_TAG}"; do
            NAME="${IMAGE%%:*}"
            # 2) Full vulnerability report (all severities) kept as build evidence: JSON + HTML
            trivy image --scanners vuln --no-progress --format json --output "reports/trivy-${NAME}.json" "${IMAGE}"
            trivy convert --format template --template "@/usr/local/share/trivy/templates/html.tpl" \
              --output "reports/trivy-${NAME}.html" "reports/trivy-${NAME}.json"
            # 3) Gate: block deployment on HIGH/CRITICAL vulnerabilities that already have a fixed version
            trivy image --scanners vuln --no-progress --skip-db-update \
              --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 "${IMAGE}"
          done
        '''
      }
      post {
        always {
          archiveArtifacts artifacts: 'reports/**', allowEmptyArchive: true
        }
      }
    }

    stage('Image Versioning') {
      steps {
        sh '''
          for REPO in "${BACKEND_REPO}" "${FRONTEND_REPO}"; do
            docker tag "${REPO}:${IMAGE_TAG}" "${NEXUS_REGISTRY}/${REPO}:${IMAGE_TAG}"
            docker tag "${REPO}:${IMAGE_TAG}" "${ECR_REGISTRY}/${REPO}:${IMAGE_TAG}"
          done
          docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -F ":${IMAGE_TAG}"
        '''
      }
    }

    stage('Push to Nexus and ECR') {
      steps {
        withCredentials([usernamePassword(credentialsId: 'nexus-docker', usernameVariable: 'NEXUS_USER', passwordVariable: 'NEXUS_PASS')]) {
          sh '''
            echo "${NEXUS_PASS}" | docker login "${NEXUS_REGISTRY}" -u "${NEXUS_USER}" --password-stdin
            docker push "${NEXUS_REGISTRY}/${BACKEND_REPO}:${IMAGE_TAG}"
            docker push "${NEXUS_REGISTRY}/${FRONTEND_REPO}:${IMAGE_TAG}"
            docker logout "${NEXUS_REGISTRY}"
          '''
        }
        // ECR login uses the EC2 instance role - no AWS keys stored in Jenkins
        sh '''
          aws ecr get-login-password --region "${AWS_REGION}" | docker login "${ECR_REGISTRY}" -u AWS --password-stdin
          docker push "${ECR_REGISTRY}/${BACKEND_REPO}:${IMAGE_TAG}"
          docker push "${ECR_REGISTRY}/${FRONTEND_REPO}:${IMAGE_TAG}"
          docker logout "${ECR_REGISTRY}"
        '''
      }
    }

    stage('EKS Deployment') {
      steps {
        script {
          sh '''
            mkdir -p "$(dirname "${KUBECONFIG}")"
            aws eks update-kubeconfig --name "${CLUSTER_NAME}" --region "${AWS_REGION}" --kubeconfig "${KUBECONFIG}"
          '''
          try {
            sh '''
              export BACKEND_IMAGE="${ECR_REGISTRY}/${BACKEND_REPO}:${IMAGE_TAG}"
              export FRONTEND_IMAGE="${ECR_REGISTRY}/${FRONTEND_REPO}:${IMAGE_TAG}"
              bash scripts/deploy.sh
            '''
          } catch (err) {
            echo 'Rollout did not complete - rolling back to the previous version'
            sh '''
              kubectl -n "${K8S_NAMESPACE}" rollout undo deployment/backend  || true
              kubectl -n "${K8S_NAMESPACE}" rollout undo deployment/frontend || true
            '''
            throw err
          }
        }
      }
    }

    stage('Deployment Validation') {
      steps {
        script {
          try {
            sh '''
              APP_URL="http://$(kubectl -n "${K8S_NAMESPACE}" get ingress pulse -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')"
              echo "Application URL: ${APP_URL}"
              kubectl -n "${K8S_NAMESPACE}" get deployments,pods -o wide
              kubectl -n "${K8S_NAMESPACE}" get deployment backend frontend \
                -o jsonpath='{range .items[*]}{.metadata.name}{" -> "}{.spec.template.spec.containers[0].image}{"\\n"}{end}'
              bash scripts/smoke-test.sh "${APP_URL}"
            '''
          } catch (err) {
            echo 'Smoke tests failed - rolling back to the previous version'
            sh '''
              kubectl -n "${K8S_NAMESPACE}" rollout undo deployment/backend  || true
              kubectl -n "${K8S_NAMESPACE}" rollout undo deployment/frontend || true
              kubectl -n "${K8S_NAMESPACE}" rollout status deployment/backend  --timeout=300s || true
              kubectl -n "${K8S_NAMESPACE}" rollout status deployment/frontend --timeout=300s || true
            '''
            throw err
          }
        }
      }
    }
  }

  post {
    success {
      echo "Deployed ${env.IMAGE_TAG} to ${env.CLUSTER_NAME}"
    }
    always {
      // Remove local image copies so the build server's disk does not fill up
      sh '''
        for REPO in "${BACKEND_REPO}" "${FRONTEND_REPO}"; do
          docker image rm -f "${REPO}:${IMAGE_TAG}" "${NEXUS_REGISTRY}/${REPO}:${IMAGE_TAG}" "${ECR_REGISTRY}/${REPO}:${IMAGE_TAG}" 2>/dev/null || true
        done
        docker image prune -f > /dev/null 2>&1 || true
      '''
    }
  }
}
