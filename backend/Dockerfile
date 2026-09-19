# syntax=docker/dockerfile:1
# Pulse backend: multi-stage build -> minimal Node.js runtime running as the non-root "node" user (UID 1000).
# Base images come from Amazon ECR Public (same images as Docker Hub, without Docker Hub's pull limits).

# ---------- Stage 1: install production dependencies only ----------
FROM public.ecr.aws/docker/library/node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# ---------- Stage 2: minimal runtime ----------
FROM public.ecr.aws/docker/library/node:24-alpine AS runtime

ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="pulse-backend" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.source="https://github.com/Vennilavanguvi/PulseReact"

# Non-secret defaults only. DB credentials and JWT_SECRET are injected at runtime (Kubernetes Secret).
ENV NODE_ENV=production \
    PORT=4000

WORKDIR /app

# npm, npx, corepack and yarn are not needed to run the app: removing them shrinks the image
# and removes their bundled packages from the vulnerability scan surface.
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-* \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg

# App files stay owned by root (read-only for the runtime user)
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./
COPY src ./src

# Non-root: the "node" user (UID/GID 1000) that ships with the Node.js image
USER 1000:1000
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "server.js"]
