# WCIES web app containerization (Sprint 6 decision #20; no new deps).
#
# Dev profile (target: dev)  - Vite dev server with HMR, source mounted.
# Prod profile (default)     - multi-stage: pnpm build -> nginx static hosting
#                              with SPA history-api fallback (BrowserRouter).
#
# Build:
#   docker build --target dev  -t wcies-web-dev  apps/web
#   docker build               -t wcies-web      apps/web
# Run (dev, HMR works from the container):
#   docker run --rm -p 5173:5173 -v ${PWD}:/app -v node_modules:/app/node_modules wcies-web-dev

# ---- Stage 1: build (also the base of the dev image) ----
FROM node:24-alpine AS build
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

# ---- Dev image: Vite + HMR (decision #20) ----
FROM node:24-alpine AS dev
RUN corepack enable
WORKDIR /app
EXPOSE 5173
# Same-port mapping (5173->5173) keeps the HMR websocket working: the browser
# connects to the mapped port which lands on the container's Vite server.
CMD ["pnpm", "--filter", "@wcies/web", "dev", "--", "--host", "0.0.0.0"]

# ---- Stage 2: production nginx (default target) ----
FROM nginx:1.27-alpine AS production
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
