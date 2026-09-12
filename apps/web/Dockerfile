# WCIES web app containerization (Sprint 6 decision #20; no new deps).
#
# Dev profile (target: dev)  - Vite dev server with HMR, source mounted.
#                              Standalone on purpose: building it needs NO
#                              network, because the host's proxy DNS hands
#                              out unroutable fake IPs to builds at random.
#                              Dependencies are installed on the container's
#                              first start into compose volumes, where DNS
#                              is pinned to public resolvers (compose `dns:`)
#                              and the npmmirror CDN is directly reachable.
# Prod profile (default)     - multi-stage: pnpm build -> nginx static hosting
#                              with SPA history-api fallback (BrowserRouter).
#
# Build:
#   docker build --target dev  -t wcies-web-dev  apps/web
#   docker build               -t wcies-web      apps/web

# ---- Dev image: Vite + HMR (decision #20) ----
FROM node:24-alpine AS dev
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
ENV npm_config_registry=https://registry.npmmirror.com
RUN corepack enable
WORKDIR /app
EXPOSE 5173
# Same-port mapping (5173->5173) keeps the HMR websocket working: the browser
# connects to the mapped port which lands on the container's Vite server.
# Self-healing start: on the first run the compose node_modules volumes are
# empty, so this installs the workspace there (volumes only - the container
# never writes node_modules into the host working tree) and builds the
# @wcies/* dists that workspace imports need. Later starts are a no-op.
CMD ["sh", "-c", "pnpm install --frozen-lockfile && pnpm build:packages && pnpm --filter @wcies/web dev -- --host 0.0.0.0"]

# ---- Stage 1: build (prod target only) ----
FROM node:24-alpine AS build
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
ENV npm_config_registry=https://registry.npmmirror.com
RUN corepack enable
WORKDIR /app

# Workspace-aware install: copy lockfile + manifests first for layer caching.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY packages/platform-contracts/package.json packages/platform-contracts/
RUN pnpm install --frozen-lockfile

# Build workspace packages, then the web app.
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm --filter @wcies/web build

# ---- Stage 2: production nginx (default target) ----
FROM nginx:1.27-alpine AS production
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
