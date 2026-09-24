# syntax=docker/dockerfile:1
# Marginal blog frontend: multi-stage build -> static files served by unprivileged nginx (UID 101).
# Base images come from Amazon ECR Public (same images as Docker Hub, without Docker Hub's pull limits).

# ---------- Stage 1: build the React (Vite) app ----------
FROM public.ecr.aws/docker/library/node:24-alpine AS build
WORKDIR /app

# Install exact versions from the lockfile first, so this layer is cached until dependencies change
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# Vite bakes VITE_* variables into the JavaScript at build time.
# "/api" = same origin: the browser calls /api and nginx forwards it to the backend.
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# ---------- Stage 2: minimal runtime ----------
FROM public.ecr.aws/nginx/nginx-unprivileged:1.30-alpine AS runtime

ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="blog-frontend" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.source="https://github.com/capricarun/PulseReact"

# Runtime configuration (overridden by the Kubernetes ConfigMap). No secrets live in this image.
ENV BACKEND_UPSTREAM=backend:4000 \
    NGINX_ENVSUBST_FILTER=BACKEND_UPSTREAM

# Replace the default site with our template (rendered to /etc/nginx/conf.d/default.conf at start-up).
# Install Alpine security fixes that are newer than the base image (e.g. libexpat CVE-2026-93990 -> 2.8.5),
# so the Trivy gate does not block on OS packages that already have a patched version.
# apk needs root; the image switches back to the unprivileged nginx user (101) below.
USER root
RUN apk upgrade --no-cache \
 && rm -f /etc/nginx/conf.d/default.conf
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]

# Non-root: the nginx-unprivileged image user (UID/GID 101)
USER 101:101
